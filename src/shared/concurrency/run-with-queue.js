import PQueue from 'p-queue';
import { createAbortError, isAbortSignal, throwIfAborted } from '../abort.js';

/**
 * Run async work over items using a shared queue.
 * @param {PQueue} queue
 * @param {Array<any>} items
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onError?:(error:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onProgress?:(state:{done:number,total:number})=>Promise<void>,bestEffort?:boolean,signal?:AbortSignal,requireSignal?:boolean,signalLabel?:string,abortError?:Error,retries?:number,retryDelayMs?:number,backoffMs?:number,onBeforeDispatch?:(ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,estimateBytes?:(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>number}} [options]
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
  const maxPending = Number.isFinite(queue?.maxPending) ? queue.maxPending : null;
  const maxPendingBytes = Number.isFinite(queue?.maxPendingBytes)
    ? Math.max(1, Math.floor(Number(queue.maxPendingBytes)))
    : null;
  const estimateBytes = typeof options.estimateBytes === 'function'
    ? options.estimateBytes
    : null;
  if (queue && !Number.isFinite(Number(queue.inflightBytes))) {
    queue.inflightBytes = 0;
  }
  let aborted = false;
  let firstError = null;
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
    let error = err || new Error('Queue task failed');
    if (onError) {
      try {
        await onError(error, ctx);
      } catch (callbackErr) {
        error = callbackErr;
      }
    }
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
      throwIfAborted(signal);
      let result;
      try {
        result = await worker(item, ctx);
      } catch (err) {
        if (err?.retryable === false) throw err;
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
  const enqueue = async (item, index) => {
    const ctx = { index, item, signal };
    let taskBytes = 0;
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
    if (maxPending) {
      while (pendingSignals.size >= maxPending && !aborted) {
        await Promise.race(pendingSignals);
      }
    }
    if (maxPendingBytes && taskBytes > 0) {
      while (!aborted) {
        const inflightBytes = readInflightBytes();
        const fits = inflightBytes + taskBytes <= maxPendingBytes;
        const oversizeSingle = inflightBytes === 0 && pendingSignals.size === 0;
        if (fits || oversizeSingle) break;
        if (pendingSignals.size === 0) break;
        await Promise.race(pendingSignals);
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
    });
    void cleanup.catch(() => {});
  };
  const waitForPendingDrainOrAbort = async () => {
    if (!pendingSignals.size) return;
    const pendingDrain = Promise.all(Array.from(pendingSignals));
    if (!signal) {
      await pendingDrain;
      return;
    }
    if (signal.aborted) {
      throw abortError;
    }
    let onAbort = null;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(abortError);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([pendingDrain, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  try {
    for (let index = 0; index < list.length; index += 1) {
      await enqueue(list[index], index);
      if (aborted && !bestEffort) break;
    }
    await waitForPendingDrainOrAbort();
    if (signal?.aborted) throw abortError;
    if (firstError) throw firstError;
    if (bestEffort && errors.length) {
      throw new AggregateError(errors, 'runWithQueue best-effort failures');
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
