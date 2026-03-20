import { createAbortError, isAbortSignal } from '../../abort.js';

export function createSchedulerDispatch({
  config,
  state,
  queueLifecycle,
  adaptiveController,
  captureTelemetryIfDue
}) {
  const canStart = (queue, req, backpressureState = null) => {
    const normalized = config.normalizeRequest(req);
    const resolvedBackpressure = backpressureState || queueLifecycle.evaluateWriteBackpressure();
    const producerBlocked = resolvedBackpressure.active
      && queue
      && queue.name !== config.writeBackpressure.writeQueue
      && config.writeBackpressure.producerQueues.has(queue.name);
    if (producerBlocked) {
      return false;
    }
    if (config.adaptiveSurfaceControllersEnabled && queue?.surface) {
      const surfaceState = config.adaptiveSurfaceStates.get(queue.surface);
      if (surfaceState) {
        const bypassSurfaceCap = normalized.cpu === 0
          && (normalized.io > 0 || normalized.mem > 0);
        const running = queueLifecycle.countSurfaceRunning(queue.surface);
        if (!bypassSurfaceCap && running >= surfaceState.currentConcurrency) {
          return false;
        }
      }
    }
    if (
      state.tokens.cpu.used + normalized.cpu > state.tokens.cpu.total
      || state.tokens.io.used + normalized.io > state.tokens.io.total
      || state.tokens.mem.used + normalized.mem > state.tokens.mem.total
    ) {
      return false;
    }
    const queueCap = queue?.maxInFlightBytes;
    if (queueCap && normalized.bytes > 0) {
      const queueBytes = config.normalizeByteCount(queue.inFlightBytes);
      const oversizeSingle = queueBytes === 0;
      if (!oversizeSingle && queueBytes + normalized.bytes > queueCap) {
        return false;
      }
    }
    if (config.globalMaxInFlightBytes && normalized.bytes > 0) {
      const runningBytes = config.normalizeByteCount(state.globalInFlightBytes);
      const oversizeSingle = runningBytes === 0;
      if (!oversizeSingle && runningBytes + normalized.bytes > config.globalMaxInFlightBytes) {
        return false;
      }
    }
    return true;
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
    for (let i = 0; i < queue.pending.length; i += 1) {
      if (canStart(queue, queue.pending[i].tokens, backpressureState)) return i;
    }
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
      const done = Promise.resolve()
        .then(next.fn)
        .then(
          (value) => {
            queue.stats.completed += 1;
            config.counters.completed += 1;
            next.resolve(value);
          },
          (err) => {
            queue.stats.failed += 1;
            config.counters.failed += 1;
            next.reject(err);
          }
        )
        .finally(() => {
          queue.running -= 1;
          queueLifecycle.bumpSurfaceRunning(queue.surface, -1);
          release(queue, used);
          state.runningTasks.delete(done);
          pump();
        });
      state.runningTasks.add(done);
      void done;
    }
  };

  const schedule = (queueName, tokensReq = { cpu: 1 }, fn) => {
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
    if (!config.enabled) {
      return Promise.resolve().then(fn);
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
    const normalizedReq = config.normalizeRequest(tokensReq || {});
    const queue = queueLifecycle.ensureQueue(queueName);
    if (queue.maxPending && queue.pending.length >= queue.maxPending) {
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
        resolve,
        reject,
        enqueuedAt: config.nowMs(),
        detachAbort: null
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
          reject(createAbortError());
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
          reject(createAbortError());
          return;
        }
      }
      queue.pending.push(pendingEntry);
      queue.pendingBytes = config.normalizeByteCount(queue.pendingBytes) + normalizedReq.bytes;
      adaptiveController.maybeAdaptTokens();
      queue.stats.scheduled += 1;
      config.counters.scheduled += 1;
      captureTelemetryIfDue('schedule');
      pump();
    });
  };

  return {
    canStart,
    reserve,
    release,
    findStartableIndex,
    pickNextQueue,
    pump,
    schedule
  };
}
