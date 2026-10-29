import { runWithSchedulerTaskLease, currentSchedulerTaskLease } from '../scheduler-task-scope.js';
import { createAbortError, isAbortSignal, coerceAbortSignal } from '../../abort.js';
import { appendBounded } from '../scheduler-telemetry.js';
import { schedulerReplayLimitIdentity } from '../scheduler-dispatch-replay.js';
import { observeStorageResource } from '../../storage/failure-observation.js';

export function createSchedulerDispatch({
  config,
  state,
  queueLifecycle,
  adaptiveController,
  captureTelemetryIfDue,
  dispatchReplay
}) {
  const blockedScans = new WeakMap();
  const retainedSettlements = new Set();
  let settlementTimer = null;
  const observeRetainedSettlements = () => {
    settlementTimer = null;
    for (const entry of retainedSettlements) {
      let settled = false;
      try { settled = entry.observation.isSettled(); } catch {}
      if (!settled) continue;
      retainedSettlements.delete(entry);
      entry.retire(); entry.resolve();
    }
    if (retainedSettlements.size) {
      settlementTimer = setTimeout(observeRetainedSettlements, 25);
    }
  };
  const replayEnvelope = () => ({ tokens: { cpu: { ...state.tokens.cpu }, io: { ...state.tokens.io }, mem: { ...state.tokens.mem } },
    globalBytes: state.globalInFlightBytes, globalMaxBytes: config.globalMaxInFlightBytes,
    writeBackpressure: { ...queueLifecycle.evaluateWriteBackpressure() },
    queues: config.queueOrder.map(entry => ({ name: entry.name, surface: entry.surface, running: entry.running,
      suspendedCpu: entry.suspendedCpu, concurrency: entry.concurrency, configuredConcurrency: entry.configuredConcurrency,
      adapterConcurrency: entry.adapterConcurrency, maxPending: entry.maxPending, maxPendingBytes: entry.maxPendingBytes,
      maxInFlightBytes: entry.maxInFlightBytes, inFlightBytes: entry.inFlightBytes,
      priority: entry.priority, weight: entry.weight,
      surfaceConcurrency: config.adaptiveSurfaceStates.get(entry.surface)?.currentConcurrency ?? null })) });
  const admissionIdentity = (queue, pressure) => JSON.stringify([
    state.tokens.cpu.used,state.tokens.cpu.total,state.tokens.io.used,state.tokens.io.total,
    state.tokens.mem.used,state.tokens.mem.total,queue.running,queue.suspendedCpu,queue.resumeTarget?.running,queue.resumeTarget?.suspendedCpu,queue.resumeTarget?.concurrency,queue.concurrency,queue.maxPending,
    queue.inFlightBytes,queue.maxInFlightBytes,state.globalInFlightBytes,config.globalMaxInFlightBytes,
    config.adaptiveSurfaceControllersEnabled,queue.surface,
    config.adaptiveSurfaceStates.get(queue.surface)?.currentConcurrency,
    queueLifecycle.countSurfaceRunning(queue.surface),pressure?.active,
    config.writeBackpressure.enabled,config.writeBackpressure.writeQueue,
    config.writeBackpressure.producerQueues.has(queue.name)
  ]);
  const admissionBlockReason = (queue, req, backpressureState = null) => {
    const normalized = config.normalizeRequest(req);
    const computeQueue = queue?.resumeTarget || queue;
    const active = Math.max(0, (computeQueue?.running || 0) - (computeQueue?.suspendedCpu || 0));
    if (computeQueue?.concurrency && active >= computeQueue.concurrency) return 'queue-concurrency';
    if (!queue?.resumeTarget && queue?.suspendedCpu > 0) {
      const retainedLimit = (queue.concurrency || state.tokens.cpu.total) + (queue.maxPending || state.tokens.cpu.total);
      if (queue.running >= retainedLimit) return 'retained-file-window';
    }
    const resolvedBackpressure = backpressureState || queueLifecycle.evaluateWriteBackpressure();
    const producerBlocked = resolvedBackpressure.active
      && queue
      && queue.name !== config.writeBackpressure.writeQueue
      && config.writeBackpressure.producerQueues.has(queue.name);
    if (producerBlocked) {
      return 'write-backpressure';
    }
    if (config.adaptiveSurfaceControllersEnabled && queue?.surface) {
      const surfaceState = config.adaptiveSurfaceStates.get(queue.surface);
      if (surfaceState) {
        const bypassSurfaceCap = normalized.cpu === 0
          && (normalized.io > 0 || normalized.mem > 0);
        const running = queueLifecycle.countSurfaceRunning(queue.surface);
        if (!bypassSurfaceCap && running >= surfaceState.currentConcurrency) {
          return 'surface-concurrency';
        }
      }
    }
    const tokenBlocked = (kind, requested) => {
      const pool = state.tokens[kind];
      if (requested <= 0) return false;
      if (pool.used + requested <= pool.total) return false;
      return !(pool.used === 0 && requested > pool.total);
    };
    if (tokenBlocked('cpu', normalized.cpu)) return 'cpu-tokens';
    if (tokenBlocked('io', normalized.io)) return 'io-tokens';
    if (tokenBlocked('mem', normalized.mem)) return 'memory-tokens';
    const queueCap = queue?.maxInFlightBytes;
    if (queueCap && normalized.bytes > 0) {
      const queueBytes = config.normalizeByteCount(queue.inFlightBytes);
      const oversizeSingle = queueBytes === 0;
      if (!oversizeSingle && queueBytes + normalized.bytes > queueCap) {
        return 'queue-bytes';
      }
    }
    if (config.globalMaxInFlightBytes && normalized.bytes > 0) {
      const runningBytes = config.normalizeByteCount(state.globalInFlightBytes);
      const oversizeSingle = runningBytes === 0;
      if (!oversizeSingle && runningBytes + normalized.bytes > config.globalMaxInFlightBytes) {
        return 'global-bytes';
      }
    }
    return null;
  };

  const canStart = (queue, req, backpressureState = null) => (
    admissionBlockReason(queue, req, backpressureState) === null
  );

  // Sample only on explicit stats/telemetry requests, never on every enqueue.
  // Each task is evaluated against the SAME current capacity; runnable is not
  // a promise that all runnable tasks fit simultaneously. Reasons partition
  // blocked tasks by their first binding admission constraint.
  const snapshotQueueAdmission = (queue, at = config.nowMs(), backpressureState = null) => {
    const pressure = backpressureState || queueLifecycle.evaluateWriteBackpressure();
    let runnable = 0;
    let oldestRunnableWaitMs = 0;
    const blockedBy = {};
    for (const entry of queue.pending) {
      const reason = admissionBlockReason(queue, entry.tokens, pressure);
      if (reason) blockedBy[reason] = (blockedBy[reason] || 0) + 1;
      else {
        runnable += 1;
        oldestRunnableWaitMs = Math.max(oldestRunnableWaitMs, at - entry.enqueuedAt);
      }
    }
    let oldestRunningMs = 0;
    for (const startedAt of queue.runningSince.values()) {
      oldestRunningMs = Math.max(oldestRunningMs, at - startedAt);
    }
    return { runnable, blocked: queue.pending.length - runnable, blockedBy,
      retainedRunning: queue.running, suspendedCpu: queue.suspendedCpu || 0,
      activeComputeRunning: Math.max(0, queue.running - (queue.suspendedCpu || 0)),
      oldestRunnableWaitMs: Math.max(0, oldestRunnableWaitMs), oldestRunningMs: Math.max(0, oldestRunningMs) };
  };

  const reserve = (queue, req) => {
    const normalized = config.normalizeRequest(req);
    state.tokens.cpu.used += normalized.cpu;
    state.tokens.io.used += normalized.io;
    state.tokens.mem.used += normalized.mem;
    if (queue && normalized.bytes > 0) {
      queue.inFlightBytes = config.normalizeByteCount(queue.inFlightBytes) + normalized.bytes;
      state.globalInFlightBytes = config.normalizeByteCount(state.globalInFlightBytes) + normalized.bytes;
    }
    return normalized;
  };

  const release = (queue, used) => {
    const normalized = config.normalizeRequest(used || {});
    state.tokens.cpu.used = Math.max(0, state.tokens.cpu.used - normalized.cpu);
    state.tokens.io.used = Math.max(0, state.tokens.io.used - normalized.io);
    state.tokens.mem.used = Math.max(0, state.tokens.mem.used - normalized.mem);
    if (queue && normalized.bytes > 0) {
      queue.inFlightBytes = Math.max(0, config.normalizeByteCount(queue.inFlightBytes) - normalized.bytes);
      state.globalInFlightBytes = Math.max(
        0,
        config.normalizeByteCount(state.globalInFlightBytes) - normalized.bytes
      );
    }
  };

  const findStartableIndex = (queue, backpressureState = null) => {
    if (!queue?.pending?.length) return -1;
    const pressure = backpressureState || queueLifecycle.evaluateWriteBackpressure();
    const identity = admissionIdentity(queue,pressure);
    const previous = blockedScans.get(queue);
    const start = previous?.identity === identity && previous.index <= queue.pending.length
      && (previous.index === 0 || queue.pending[previous.index-1] === previous.tail) ? previous.index : 0;
    for (let i = start; i < queue.pending.length; i += 1) {
      if (canStart(queue, queue.pending[i].tokens, pressure)) {
        blockedScans.delete(queue);
        return i;
      }
    }
    blockedScans.set(queue,{ identity,index:queue.pending.length,tail:queue.pending.at(-1) });
    return -1;
  };

  const pickNextQueue = (backpressureState = null) => {
    if (!config.queueOrder.length) return null;
    const now = config.nowMs();
    let starving = null;
    let picked = null;
    for (const queue of config.queueOrder) {
      if (!queue.pending.length) continue;
      const index = findStartableIndex(queue, backpressureState);
      if (index < 0) continue;
      const waited = now - queue.pending[index].enqueuedAt;
      if (waited >= config.starvationMs && (!starving || waited > starving.waited)) {
        starving = { queue, waited, index };
        continue;
      }
      const weightBoostMs = Math.max(1, Number(queue.weight) || 1) * 250;
      const priorityPenaltyMs = Math.max(0, Number(queue.priority) || 0) * 5;
      const waitP95Ms = Number(queue.stats?.waitP95Ms) || 0;
      const agingBoostMs = waitP95Ms > 0 ? Math.max(0, waited - waitP95Ms) : 0;
      const score = waited + weightBoostMs + agingBoostMs - priorityPenaltyMs;
      if (!picked || score > picked.score) {
        picked = { queue, index, score };
      }
    }
    if (starving) return { queue: starving.queue, starved: true, index: starving.index };
    return picked ? { queue: picked.queue, starved: false, index: picked.index } : null;
  };

  const createTaskLease = (queue, used, signal) => {
    const cpu = used.cpu;
    const lease = { queue, used, signal, active: true, surfaceActive: true, suspended: false, depth: 0, resuming: false,
      resumePromise: null, resumeResolve: null, resumeReject: null, pendingWaits: new Set(), retainedComputeWaits: new Set() };
    lease.trackWait = (operation, { retainCpu = false } = {}) => {
      if (!lease.active) return Promise.reject(Object.assign(new Error('Scheduler task retired before nested wait.'), {
        code: 'ERR_SCHEDULER_TASK_RETIRED'
      }));
      if (retainCpu && !(lease.used.cpu > 0)) return Promise.reject(Object.assign(new Error('Worker execution requires retained CPU admission.'), {
        code: 'ERR_SCHEDULER_COMPUTE_NOT_ADMITTED'
      }));
      let pending;
      try { pending = Promise.resolve(operation()); } catch (error) { pending = Promise.reject(error); }
      lease.pendingWaits.add(pending);
      if (retainCpu) lease.retainedComputeWaits.add(pending);
      pending.finally(() => {
        lease.pendingWaits.delete(pending); lease.retainedComputeWaits.delete(pending);
      }).catch(() => {});
      return pending;
    };
    const enqueueResume = () => {
      if (lease.resuming || !lease.active || !lease.suspended || lease.depth) return;
      lease.resuming = true;
      const resolveResume = lease.resumeResolve, rejectResume = lease.resumeReject;
      const name = '@resume:' + queue.name;
      const resumeQueue = queueLifecycle.ensureQueue(name);
      resumeQueue.resumeTarget = queue; resumeQueue.surface = queue.surface;
      resumeQueue.priority = queue.priority; resumeQueue.weight = queue.weight;
      // The original task retains file/bytes/memory ownership. This entry owns
      // only compute admission, then transfers that exact reservation back.
      schedule(name, { cpu, signal: coerceAbortSignal(null) }, () => {
        if (!lease.active) throw new Error('Scheduler task retired before CPU reacquisition.');
        if (lease.depth) return false;
        const admitted = currentSchedulerTaskLease();
        if (!admitted || admitted.used.cpu !== cpu) throw new Error('Invalid scheduler CPU permit transfer.');
        admitted.used.cpu = 0; admitted.surfaceActive = false;
        if (resumeQueue.surface !== queue.surface) {
          queueLifecycle.bumpSurfaceRunning(resumeQueue.surface, -1); queueLifecycle.bumpSurfaceRunning(queue.surface, 1);
        }
        lease.used.cpu = cpu; lease.surfaceActive = true;
        queue.suspendedCpu = Math.max(0, queue.suspendedCpu - 1);
        lease.suspended = false;
        return true;
      }).then(transferred => {
        lease.resuming = false;
        if (transferred) resolveResume();
        enqueueResume();
      }, error => { lease.resuming = false; rejectResume(error); });
    };
    const suspendCpu = async operation => {
      if (!lease.active) throw new Error('Scheduler task retired before nested wait.');
      if (!cpu) return operation();
      // A worker still computes against this exact permit. A concurrent I/O
      // callback may wait, but it cannot lend that permit to unrelated work.
      if (lease.retainedComputeWaits.size) return operation();
      lease.depth++;
      if (!lease.suspended) {
        lease.suspended = true; lease.surfaceActive = false;
        lease.used.cpu = 0; state.tokens.cpu.used = Math.max(0, state.tokens.cpu.used - cpu);
        queue.suspendedCpu += 1; queueLifecycle.bumpSurfaceRunning(queue.surface, -1);
        lease.resumePromise = new Promise((resolve, reject) => { lease.resumeResolve = resolve; lease.resumeReject = reject; });
        lease.resumePromise.catch(() => {});
        pump();
      }
      let value, primary = null, failed = false;
      try { value = await operation(); } catch (error) { primary = error; failed = true; }
      lease.depth--; enqueueResume();
      try { await lease.resumePromise; }
      catch (error) {
        const reacquisition = Object.assign(new Error('Scheduler CPU reacquisition failed.', { cause: error }), {
          code: 'ERR_SCHEDULER_CPU_REACQUIRE', schedulerCpuReacquisitionFailed: true
        });
        if (failed) {
          let attached = false;
          try { primary.cpuReacquisitionError = reacquisition; attached = primary.cpuReacquisitionError === reacquisition; } catch {}
          if (attached) throw primary;
          throw Object.assign(new AggregateError([primary, reacquisition],
            'Nested operation failed and scheduler CPU reacquisition did not complete.', { cause: primary }), {
            code: 'ERR_SCHEDULER_CPU_REACQUIRE', schedulerCpuReacquisitionFailed: true
          });
        }
        throw reacquisition;
      }
      if (failed) throw primary;
      return value;
    };
    lease.suspendCpu = operation => lease.trackWait(() => suspendCpu(operation));
    lease.drainWaits = () => {
      const drain = async () => {
        while (lease.pendingWaits.size) {
          if (lease.retainedComputeWaits.size) await Promise.allSettled([...lease.retainedComputeWaits]);
          else if (lease.suspended) await Promise.allSettled([...lease.pendingWaits]);
          else await suspendCpu(async () => {
            while (lease.pendingWaits.size && !lease.retainedComputeWaits.size) await Promise.allSettled([...lease.pendingWaits]);
          });
        }
      };
      return drain();
    };
    return lease;
  };

  const startQueuedTask = (queue, index, starved = false) => {
    const next = queue.pending[index];
    if (!next) return;
    dispatchReplay?.capture({ queues: config.queueOrder, baseline: next,
      admissionReason: admissionBlockReason,
      envelope: replayEnvelope });
    queue.pending.splice(index, 1);
    queue.pendingBytes = Math.max(0, config.normalizeByteCount(queue.pendingBytes) - config.normalizeByteCount(next.bytes));
    if (typeof next.detachAbort === 'function') {
      try {
        next.detachAbort();
      } catch {}
    }
    queue.running += 1;
    queueLifecycle.bumpSurfaceRunning(queue.surface, 1);
    queue.stats.started += 1;
    config.counters.started += 1;
    if (starved) {
      queue.stats.starvation += 1;
      config.counters.starvation += 1;
    }
    queueLifecycle.recordQueueWaitTime(queue, config.nowMs() - next.enqueuedAt);
    const used = reserve(queue, next.tokens);
    const lease = createTaskLease(queue, used, next.signal);
    lease.replayIdentity = next.replayIdentity || null;
    const startedAt = config.nowMs();
    dispatchReplay?.observeStart(next);
    queue.runningSince.set(next, startedAt);
    const done = Promise.resolve()
      .then(() => {
        if (state.shuttingDown) throw new Error('scheduler is shut down');
        if (next.signal?.aborted) throw createAbortError();
        return runWithSchedulerTaskLease(lease, async () => {
          let value, primary, failed = false;
          try { value = await next.fn(); } catch (error) { primary = error; failed = true; }
          if (lease.pendingWaits.size) {
            const detached = Object.assign(new Error(`Scheduler task ${queue.name} finished with an unawaited nested wait (pending=${lease.pendingWaits.size}, retainedCompute=${lease.retainedComputeWaits.size}, depth=${lease.depth}, suspended=${lease.suspended}).`), {
              code: 'ERR_SCHEDULER_UNAWAITED_WAIT', schedulerQueue: queue.name
            });
            // Promise races/timeouts do not settle their losing operation.
            // Keep source/result bytes, memory and file-window ownership until
            // every operation registered by this task has actually retired.
            try { await lease.drainWaits(); }
            catch (error) { detached.cpuReacquisitionError = error; }
            if (!failed) { primary = detached; failed = true; }
            else { try { primary.schedulerUnawaitedWait = detached; } catch {} }
          }
          if (failed) throw primary;
          return value;
        });
      })
      .then(value => ({ value, failed: false }), error => ({ error, failed: true }))
      .then(outcome => {
        const retire = (alreadyRejected = false) => {
          dispatchReplay?.observeEnd(next, outcome.failed ? 'failed' : 'completed');
          appendBounded(queue.stats.runSamples, Math.max(0, config.nowMs() - startedAt), config.WAIT_TIME_SAMPLE_LIMIT);
          queue.runningSince.delete(next);
          queue.running -= 1;
          lease.active = false;
          if (lease.suspended) {
            queue.suspendedCpu = Math.max(0, queue.suspendedCpu - 1);
            const retired = new Error('Scheduler task retired with an unawaited suspended operation.');
            retired.code = 'ERR_SCHEDULER_TASK_RETIRED';
            lease.resumeReject?.(retired);
          }
          if (lease.surfaceActive) queueLifecycle.bumpSurfaceRunning(queue.surface, -1);
          release(queue, used);
          state.runningTasks.delete(done);
          pump();
          // Completion is observable only after this exact task's reservations
          // retire. Immediate optional-child admission must see the released state.
          if (outcome.failed) {
            if (!alreadyRejected) { queue.stats.failed += 1; config.counters.failed += 1; next.reject(outcome.error); }
          } else {
            queue.stats.completed += 1; config.counters.completed += 1; next.resolve(outcome.value);
          }
        };
        if (outcome.failed) {
          const observation = observeStorageResource(outcome.error, { phase: 'scheduler-task-resource-retirement' });
          let pendingFailure;
          try { observation.requireSettled(); } catch (failure) { pendingFailure = failure; }
          if (pendingFailure) {
            // The function rejected, but its original child/resource did not
            // retire. Reject the public request now while retaining this exact
            // admission and drain promise. Only the captured original observer
            // can release it; rewritten diagnostic fields grant no authority.
            lease.active = false;
            const held = new Promise(resolve => { retainedSettlements.add({ observation, resolve, retire: () => retire(true) }); });
            if (!settlementTimer) {
              settlementTimer = setTimeout(observeRetainedSettlements, 25);
            }
            queue.stats.failed += 1; config.counters.failed += 1; next.reject(pendingFailure);
            return held;
          }
        }
        retire();
      }).catch(error => {
        // Never leave the public request pending if teardown diagnostics fail.
        next.reject(error);
      });
    state.runningTasks.add(done);
    void done;
  };

  const pump = () => {
    if (state.shuttingDown) return;
    while (true) {
      adaptiveController.maybeAdaptTokens();
      const backpressureState = queueLifecycle.evaluateWriteBackpressure();
      const pick = pickNextQueue(backpressureState);
      if (!pick) return;
      const { queue, starved, index } = pick;
      const next = queue.pending[index];
      if (!next || !canStart(queue, next.tokens, backpressureState)) return;
      startQueuedTask(queue, index, starved);
    }
  };


  const enqueue = (queueName, tokensReq = { cpu: 1 }, fn, ifAvailable = false) => {
    if (typeof tokensReq === 'function') {
      fn = tokensReq;
      tokensReq = { cpu: 1 };
    }
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('schedule requires a function'));
    }
    const scheduleSignal = isAbortSignal(tokensReq)
      ? tokensReq
      : (isAbortSignal(tokensReq?.signal)
        ? tokensReq.signal
        : null);
    if (config.shouldRequireSignalForQueue(queueName) && !scheduleSignal) {
      const queue = queueLifecycle.ensureQueue(queueName);
      queue.stats.rejected += 1;
      queue.stats.rejectedSignalRequired += 1;
      queue.stats.scheduled += 1;
      config.counters.scheduled += 1;
      config.counters.rejected += 1;
      config.counters.rejectedByReason.signalRequired += 1;
      return Promise.reject(config.createSignalRequiredError(queueName));
    }
    if (state.shuttingDown) {
      config.counters.rejected += 1;
      config.counters.rejectedByReason.shutdown += 1;
      return Promise.reject(new Error('scheduler is shut down'));
    }
    if (scheduleSignal?.aborted) {
      config.counters.rejected += 1;
      config.counters.rejectedByReason.abort += 1;
      return Promise.reject(createAbortError());
    }
    let normalizedReq;
    try { normalizedReq = config.normalizeRequest(tokensReq || {}); }
    catch (error) {
      config.counters.rejected += 1;
      config.counters.rejectedByReason.invalidRequest += 1;
      return Promise.reject(error);
    }
    if (!config.enabled && !queueLifecycle.ensureQueue(queueName).concurrency) {
      const done = Promise.resolve().then(() => {
        if (state.shuttingDown) throw new Error('scheduler is shut down');
        if (scheduleSignal?.aborted) throw createAbortError();
        return fn();
      }).finally(() => state.runningTasks.delete(done));
      state.runningTasks.add(done);
      return done;
    }
    const queue = queueLifecycle.ensureQueue(queueName);
    // An internal nested operation must not wait for bytes/memory held by its
    // own parent. Dispatch older runnable work first, then either reserve now
    // or decline without queueing. The caller keeps its ordinary inline path.
    if (ifAvailable) {
      pump();
      if (queue.pending.length || !canStart(queue, normalizedReq)) return null;
    }
    if (!queue.resumeTarget && queue.maxPending && queue.pending.length >= queue.maxPending) {
      queue.stats.rejected += 1;
      queue.stats.rejectedMaxPending += 1;
      queue.stats.scheduled += 1;
      config.counters.scheduled += 1;
      config.counters.rejected += 1;
      config.counters.rejectedByReason.maxPending += 1;
      return Promise.reject(new Error(`queue ${queueName} is at maxPending`));
    }
    if (queue.maxPendingBytes && normalizedReq.bytes > 0) {
      const pendingBytes = config.normalizeByteCount(queue.pendingBytes);
      const nextPendingBytes = pendingBytes + normalizedReq.bytes;
      const oversizeSingle = pendingBytes === 0 && queue.pending.length === 0;
      if (!oversizeSingle && nextPendingBytes > queue.maxPendingBytes) {
        queue.stats.rejected += 1;
        queue.stats.rejectedMaxPendingBytes += 1;
        queue.stats.scheduled += 1;
        config.counters.scheduled += 1;
        config.counters.rejected += 1;
        config.counters.rejectedByReason.maxPendingBytes += 1;
        return Promise.reject(new Error(`queue ${queueName} is at maxPendingBytes`));
      }
    }
    return new Promise((resolve, reject) => {
      const pendingEntry = {
        tokens: normalizedReq,
        bytes: normalizedReq.bytes,
        fn,
        signal: scheduleSignal,
        resolve,
        reject,
        enqueuedAt: config.nowMs(),
        detachAbort: null
      };
      dispatchReplay?.register(pendingEntry, queueName, tokensReq?.shadow);
      pendingEntry.reject = error => {
        dispatchReplay?.observeEnd(pendingEntry, 'rejected');
        reject(error);
      };
      if (scheduleSignal) {
        const onAbort = () => {
          const pendingIndex = queue.pending.indexOf(pendingEntry);
          if (pendingIndex < 0) return;
          queue.pending.splice(pendingIndex, 1);
          queue.pendingBytes = Math.max(
            0,
            config.normalizeByteCount(queue.pendingBytes) - config.normalizeByteCount(pendingEntry.bytes)
          );
          queue.stats.rejected += 1;
          queue.stats.rejectedAbort += 1;
          config.counters.rejected += 1;
          config.counters.rejectedByReason.abort += 1;
          captureTelemetryIfDue('abort');
          pendingEntry.reject(createAbortError());
          pump();
        };
        scheduleSignal.addEventListener('abort', onAbort, { once: true });
        pendingEntry.detachAbort = () => scheduleSignal.removeEventListener('abort', onAbort);
        if (scheduleSignal.aborted) {
          pendingEntry.detachAbort();
          queue.stats.rejected += 1;
          queue.stats.rejectedAbort += 1;
          config.counters.rejected += 1;
          config.counters.rejectedByReason.abort += 1;
          pendingEntry.reject(createAbortError());
          return;
        }
      }
      queue.pending.push(pendingEntry);
      queue.pendingBytes = config.normalizeByteCount(queue.pendingBytes) + normalizedReq.bytes;
      if (!ifAvailable) adaptiveController.maybeAdaptTokens();
      queue.stats.scheduled += 1;
      config.counters.scheduled += 1;
      captureTelemetryIfDue('schedule');
      if (ifAvailable) startQueuedTask(queue, queue.pending.indexOf(pendingEntry));
      else pump();
    });
  };
  const schedule = (queueName, tokensReq, fn) => enqueue(queueName, tokensReq, fn);
  const scheduleIfAvailable = (queueName, tokensReq, fn) => enqueue(queueName, tokensReq, fn, true);

  return {
    getReplayResourceIdentity: () => config.queueOrder.length <= 64
      && config.queueOrder.every(queue => typeof queue.name === 'string' && queue.name.length <= 128)
      ? schedulerReplayLimitIdentity(replayEnvelope()) : null,
    canStart,
    snapshotQueueAdmission,
    reserve,
    release,
    findStartableIndex,
    pickNextQueue,
    pump,
    schedule,
    scheduleIfAvailable
  };
}
