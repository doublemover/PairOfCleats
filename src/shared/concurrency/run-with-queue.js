import { addStorageFailureContext } from '../storage/operation-error.js';
import PQueue from 'p-queue';
import { createAbortError, isAbortSignal, throwIfAborted } from '../abort.js';
import { awaitWithKeepalive } from '../promise-keepalive.js';
import { isQueueRecoveryUnsafe as unsafeRecovery } from './queue-recovery.js';

const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const captureQueueOwnership = error => {
  if (!objectLike(error)) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};
const captureFailureDescriptors = error => {
  try { return Object.getOwnPropertyDescriptors(error); } catch { return null; }
};
const aggregateQueueFailures = (errors, message, { originalObservers = [], primaryDescriptors = null, stopRetry = false } = {}) => {
  const failure = new AggregateError(errors, message, { cause: errors[0] });
  const observers = [...originalObservers, ...errors.map(captureQueueOwnership)].filter(Boolean);
  if (primaryDescriptors) {
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'retryable',
      'cacheOwnershipPending', 'cacheOwnershipReleased']);
    for (const key of Reflect.ownKeys(primaryDescriptors)) {
      if (!reserved.has(key)) Object.defineProperty(failure, key, primaryDescriptors[key]);
    }
  }
  if (observers.length) Object.defineProperties(failure, {
    cacheOwnershipPending: { get: () => !observers.every(observe => observe()) },
    cacheOwnershipReleased: { value: () => observers.every(observe => observe()) },
    retryable: { value: false }
  });
  else if (stopRetry) failure.retryable = false;
  else if (primaryDescriptors?.retryable) {
    if (Object.hasOwn(primaryDescriptors.retryable, 'value')) Object.defineProperty(failure, 'retryable', primaryDescriptors.retryable);
    else failure.retryable = false;
  } else {
    try { if (errors[0]?.retryable === false) failure.retryable = false; }
    catch { failure.retryable = false; }
  }
  return failure;
};

/**
 * Run async work over items using a shared queue.
 * @param {PQueue} queue
 * @param {Array<any>} items
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onError?:(error:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onProgress?:(state:{done:number,total:number})=>Promise<void>,bestEffort?:boolean,signal?:AbortSignal,requireSignal?:boolean,signalLabel?:string,abortError?:Error,retries?:number,retryDelayMs?:number,backoffMs?:number,onBeforeDispatch?:(ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,estimateBytes?:(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>number,pendingDrainTimeoutMs?:number,pendingDrainStallPollMs?:number,onPendingDrainStall?:(state:{pending:number,elapsedMs:number})=>void}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithQueue(queue, items, worker, options = {}) {
  const list = Array.from(items || []);
  if (!list.length) return options.collectResults === false ? null : [];
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const onBeforeDispatch = typeof options.onBeforeDispatch === 'function'
    ? options.onBeforeDispatch
    : null;
  const schedulerMetadata = typeof options.schedulerMetadata === 'function' ? options.schedulerMetadata : null;
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Math.floor(Number(options.retries))) : 0;
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Math.floor(Number(options.retryDelayMs))) : 0;
  const backoffMs = Number.isFinite(Number(options.backoffMs)) ? Math.max(0, Math.floor(Number(options.backoffMs))) : null;
  const delayMs = backoffMs != null ? backoffMs : retryDelayMs;
  const bestEffort = options.bestEffort === true;
  const signal = isAbortSignal(options.signal) ? options.signal : null;
  const requireSignal = options.requireSignal === true;
  const signalLabel = typeof options.signalLabel === 'string' && options.signalLabel.trim()
    ? options.signalLabel.trim()
    : 'runWithQueue';
  if (requireSignal && !signal) {
    const err = new Error(`${signalLabel} requires an AbortSignal`);
    err.code = 'RUN_WITH_QUEUE_SIGNAL_REQUIRED';
    err.retryable = false;
    throw err;
  }
  const abortError = options.abortError instanceof Error ? options.abortError : createAbortError();
  const results = collectResults ? new Array(list.length) : null;
  const pendingSignals = new Set();
  let capacityChange = null, notifyCapacityChange = null;
  const readCapacityChange = () => {
    if (!capacityChange) capacityChange = new Promise(resolve => { notifyCapacityChange = resolve; });
    return capacityChange;
  };
  const notifyCapacity = () => {
    const notify = notifyCapacityChange;
    capacityChange = null; notifyCapacityChange = null;
    notify?.();
  };
  const parsedMaxPending = Number(queue?.maxPending);
  const maxPending = Number.isFinite(parsedMaxPending) && parsedMaxPending > 0
    ? Math.floor(parsedMaxPending)
    : null;
  const parsedMaxPendingBytes = Number(queue?.maxPendingBytes);
  const maxPendingBytes = Number.isFinite(parsedMaxPendingBytes) && parsedMaxPendingBytes > 0
    ? Math.floor(parsedMaxPendingBytes)
    : null;
  const estimateBytes = typeof options.estimateBytes === 'function'
    ? options.estimateBytes
    : null;
  const pendingDrainTimeoutMs = Number.isFinite(Number(options.pendingDrainTimeoutMs))
    ? Math.max(0, Math.floor(Number(options.pendingDrainTimeoutMs)))
    : 0;
  const pendingDrainStallPollMs = Number.isFinite(Number(options.pendingDrainStallPollMs))
    ? Math.max(0, Math.floor(Number(options.pendingDrainStallPollMs)))
    : 0;
  const onPendingDrainStall = typeof options.onPendingDrainStall === 'function'
    ? options.onPendingDrainStall
    : null;
  if (queue && !Number.isFinite(Number(queue.inflightBytes))) {
    queue.inflightBytes = 0;
  }
  let aborted = false;
  let firstError = null;
  let fatalResourceFailure = null;
  const errors = [];
  let doneCount = 0;
  const normalizePendingBytes = (value) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const resolveItemBytes = (item, ctx) => {
    if (estimateBytes) return normalizePendingBytes(estimateBytes(item, ctx));
    if (Number.isFinite(Number(item?.bytes))) return normalizePendingBytes(item.bytes);
    if (Number.isFinite(Number(item?.size))) return normalizePendingBytes(item.size);
    if (Number.isFinite(Number(item?.stat?.size))) return normalizePendingBytes(item.stat.size);
    return 0;
  };
  const readInflightBytes = () => normalizePendingBytes(queue?.inflightBytes);
  const setInflightBytes = (value) => {
    if (!queue) return;
    queue.inflightBytes = normalizePendingBytes(value);
  };
  const markAborted = () => {
    if (aborted) return;
    aborted = true;
  };
  const recordError = async (err, ctx) => {
    const primary = objectLike(err) ? err : new Error('Queue task failed', { cause: err });
    let error = primary;
    const resourceUnsafe = unsafeRecovery(primary);
    if (resourceUnsafe) { fatalResourceFailure ||= primary; markAborted(); }
    // A skip/publication callback cannot retire a failed worker/native owner.
    if (onError && !resourceUnsafe) {
      const originalObserver = captureQueueOwnership(primary);
      const originalDescriptors = captureFailureDescriptors(primary);
      let callbackError, callbackFailed = false;
      try {
        await onError(primary, ctx);
      } catch (callbackErr) {
        callbackFailed = true; callbackError = callbackErr;
      }
      if (callbackFailed || originalObserver) error = aggregateQueueFailures(
        callbackFailed ? [primary, callbackError] : [primary],
        callbackFailed ? 'Queue task and error handler failed' : 'Queue task retained resource ownership',
        { originalObservers: [originalObserver], primaryDescriptors: originalDescriptors }
      );
    }
    if (unsafeRecovery(error)) { fatalResourceFailure ||= error; markAborted(); }
    if (bestEffort) {
      errors.push(error);
      return;
    }
    if (!firstError) {
      firstError = error;
      markAborted();
    }
  };
  const recordProgress = async () => {
    if (!onProgress) return;
    try {
      await onProgress({ done: doneCount, total: list.length });
    } catch (err) {
      await recordError(err, { index: -1, item: null, signal });
    }
  };
  const abortHandler = () => {
    markAborted();
  };
  if (signal) {
    if (signal.aborted) {
      markAborted();
    } else {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  }
  const runWorker = async (item, ctx) => {
    let attempt = 0;
    while (true) {
      if (fatalResourceFailure) throw fatalResourceFailure;
      throwIfAborted(signal);
      let result;
      try {
        result = await worker(item, ctx);
      } catch (err) {
        const originalObserver = captureQueueOwnership(err);
        const primaryDescriptors = captureFailureDescriptors(err);
        if (originalObserver && !originalObserver()) {
          const failure = aggregateQueueFailures([err], 'Queue operation retains original resource ownership',
            { originalObservers: [originalObserver], primaryDescriptors });
          fatalResourceFailure ||= failure; markAborted(); throw failure;
        }
        if (unsafeRecovery(err)) { fatalResourceFailure ||= err; markAborted(); throw err; }
        if (primaryDescriptors?.retryable?.value === false) throw err;
        let retryable;
        try { retryable = err?.retryable; }
        catch (classificationError) {
          throw aggregateQueueFailures([err, classificationError], 'Queue operation retry policy could not be inspected',
            { originalObservers: [originalObserver], primaryDescriptors, stopRetry: true });
        }
        if (retryable === false) throw err;
        attempt += 1;
        if (attempt > retries) throw err;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        continue;
      }
      if (collectResults) results[ctx.index] = result;
      if (onResult) {
        await onResult(result, ctx);
      }
      return result;
    }
  };
  const waitForAnyPendingOrAbort = async () => {
    if (!pendingSignals.size) return;
    const pendingRace = readCapacityChange();
    if (!signal) {
      await awaitWithKeepalive(pendingRace);
      return;
    }
    if (signal.aborted) {
      markAborted();
      throw abortError;
    }
    let onAbort = null;
    const abortedPromise = new Promise((_, reject) => {
      onAbort = () => {
        markAborted();
        reject(abortError);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await awaitWithKeepalive(Promise.race([pendingRace, abortedPromise]));
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  const enqueue = async (item, index) => {
    const ctx = { index, item, signal };
    let taskBytes = 0;
    let shadow = null;
    if (aborted) return;
    if (signal?.aborted) {
      markAborted();
      return;
    }
    if (onBeforeDispatch) {
      try {
        await onBeforeDispatch(ctx);
      } catch (err) {
        await recordError(err, ctx);
        doneCount += 1;
        await recordProgress();
        return;
      }
      if (aborted || signal?.aborted) {
        if (signal?.aborted) markAborted();
        return;
      }
    }
    try {
      taskBytes = resolveItemBytes(item, ctx);
    } catch (err) {
      await recordError(err, ctx);
      doneCount += 1;
      await recordProgress();
      return;
    }
    // Optional evidence cannot change actual producer/admission outcomes.
    // A failed observer yields an explicitly missing prediction at dispatch.
    try { shadow = schedulerMetadata?.(item, ctx) || null; } catch { shadow = null; }
    if (maxPending) {
      while (pendingSignals.size >= maxPending && !aborted) {
        await waitForAnyPendingOrAbort();
      }
    }
    if (maxPendingBytes && taskBytes > 0) {
      while (!aborted) {
        const inflightBytes = readInflightBytes();
        const fits = inflightBytes + taskBytes <= maxPendingBytes;
        const oversizeSingle = inflightBytes === 0 && pendingSignals.size === 0;
        if (fits || oversizeSingle) break;
        if (pendingSignals.size === 0) break;
        await waitForAnyPendingOrAbort();
      }
    }
    if (aborted) return;
    if (taskBytes > 0) {
      setInflightBytes(readInflightBytes() + taskBytes);
    }
    let task;
    try {
      task = queue.add(
        () => runWorker(item, ctx),
        {
          bytes: taskBytes,
          ...(shadow ? { shadow } : {}),
          ...(signal ? { signal } : {})
        }
      );
    } catch (err) {
      if (taskBytes > 0) {
        setInflightBytes(readInflightBytes() - taskBytes);
      }
      await recordError(err, ctx);
      doneCount += 1;
      await recordProgress();
      return;
    }
    const settled = task.then(
      async () => {
        doneCount += 1;
        await recordProgress();
      },
      async (err) => {
        await recordError(err, ctx);
        doneCount += 1;
        await recordProgress();
      }
    );
    pendingSignals.add(settled);
    void task.catch(() => {});
    const cleanup = settled.finally(() => {
      if (taskBytes > 0) {
        setInflightBytes(readInflightBytes() - taskBytes);
      }
      pendingSignals.delete(settled);
      notifyCapacity();
    });
    void cleanup.catch(() => {});
  };
  const waitForPendingDrainOrAbort = async () => {
    if (!pendingSignals.size) return;
    if (signal?.aborted) {
      throw abortError;
    }
    const pendingDrain = Promise.all(Array.from(pendingSignals));
    const pendingStartedAt = Date.now();
    let timeoutId = null;
    let stallTimer = null;
    let onAbort = null;
    const raceCandidates = [pendingDrain];
    const startPendingDrainStallTimer = () => {
      if (!onPendingDrainStall || pendingDrainStallPollMs <= 0) return null;
      return setInterval(() => {
        try {
          onPendingDrainStall({
            pending: pendingSignals.size,
            elapsedMs: Math.max(0, Date.now() - pendingStartedAt)
          });
        } catch {}
      }, pendingDrainStallPollMs);
    };
    const clearPendingDrainTimers = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (stallTimer) clearInterval(stallTimer);
    };
    if (pendingDrainTimeoutMs > 0) {
      raceCandidates.push(new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error(
            `runWithQueue pending drain timed out after ${pendingDrainTimeoutMs}ms (pending=${pendingSignals.size}).`
          );
          err.code = 'RUN_WITH_QUEUE_PENDING_DRAIN_TIMEOUT';
          err.retryable = false;
          err.meta = {
            pending: pendingSignals.size,
            timeoutMs: pendingDrainTimeoutMs,
            elapsedMs: Math.max(0, Date.now() - pendingStartedAt)
          };
          reject(err);
        }, pendingDrainTimeoutMs);
      }));
    }
    if (!signal) {
      stallTimer = startPendingDrainStallTimer();
      try {
        await awaitWithKeepalive(Promise.race(raceCandidates));
      } finally {
        clearPendingDrainTimers();
      }
      return;
    }
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(abortError);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    raceCandidates.push(aborted);
    stallTimer = startPendingDrainStallTimer();
    try {
      await awaitWithKeepalive(Promise.race(raceCandidates));
    } finally {
      clearPendingDrainTimers();
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  try {
    for (let index = 0; index < list.length; index += 1) {
      await enqueue(list[index], index);
      if (aborted && !bestEffort) break;
    }
    try { await waitForPendingDrainOrAbort(); }
    catch (error) { if (fatalResourceFailure) throw fatalResourceFailure; throw error; }
    if (fatalResourceFailure) throw fatalResourceFailure;
    if (signal?.aborted) throw abortError;
    if (firstError) throw firstError;
    if (bestEffort && errors.length) {
      throw aggregateQueueFailures(errors, 'runWithQueue best-effort failures');
    }
    return results;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

/**
 * Run async work over items with a per-call concurrency limit.
 * @param {Array<any>} items
 * @param {number} limit
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,signal?:AbortSignal,requireSignal?:boolean,signalLabel?:string}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithConcurrency(items, limit, worker, options = {}) {
  const queue = new PQueue({ concurrency: Math.max(1, Math.floor(limit || 1)) });
  return runWithQueue(queue, items, worker, options);
}


/** Drain original work before exposing cancellation or failure. The signal is
 * passed to the actual worker, while the existing queue cannot race its drain.
 * No new operation starts after a failure, and every failed owner is retained.
 */
export async function runWithSettledConcurrency(items, limit, worker, { signal = null, collectResults = false } = {}) {
  throwIfAborted(signal);
  const failures = [], observedFailures = new Set();
  const results = await runWithConcurrency(items, limit, async (item, context) => {
    if (failures.length) return;
    try { throwIfAborted(signal); return await worker(item, { ...context, signal }); }
    catch (error) {
      if (!objectLike(error) || !observedFailures.has(error)) {
        failures.push(error); if (objectLike(error)) observedFailures.add(error);
      }
    }
  }, { collectResults, retries: 0 });
  if (failures.length === 1) throw failures[0];
  if (failures.length) {
    let failure = failures[0];
    for (const secondary of failures.slice(1)) failure = addStorageFailureContext(failure, { retryable: false }, secondary, { secondaryPresent: true });
    throw failure;
  }
  throwIfAborted(signal);
  return results;
}
