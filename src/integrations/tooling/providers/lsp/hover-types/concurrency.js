import { createAbortError, isAbortSignal, throwIfAborted } from '../../../../../shared/abort.js';
import { addStorageFailureContext } from '../../../../../shared/storage/operation-error.js';

export const DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY = 4;
export const DEFAULT_HOVER_CONCURRENCY = 8;

/**
 * Clamp numeric values to an integer range with fallback.
 * @param {unknown} value
 * @param {number} fallback
 * @param {{min?:number,max?:number}} [bounds]
 * @returns {number}
 */
export const clampIntRange = (value, fallback, { min = 1, max = 64 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return Math.max(min, Math.min(max, normalized));
};

/**
 * Run async work over a list with a fixed worker pool.
 * @param {Array<any>} items
 * @param {number} concurrency
 * @param {(item:any,index:number)=>Promise<void>} worker
 * @param {{signal?:AbortSignal|null}} [options]
 * @returns {Promise<void>}
 */
export const runWithConcurrency = async (items, concurrency, worker, options = {}) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const signal = options?.signal && typeof options.signal.aborted === 'boolean'
    ? options.signal
    : null;
  const maxWorkers = Math.max(1, Math.min(list.length, clampIntRange(concurrency, 1, { min: 1, max: 128 })));
  let index = 0, failed = false, firstRunner = -1, primary;
  const runners = Array.from({ length: maxWorkers }, async (_, runnerIndex) => {
    try {
      while (!failed) {
        throwIfAborted(signal);
        const current = index++;
        if (current >= list.length) break;
        await worker(list[current], current);
        throwIfAborted(signal);
      }
    } catch (error) {
      if (!failed) { failed = true; primary = error; firstRunner = runnerIndex; }
      throw error;
    }
  });
  const settled = await Promise.allSettled(runners);
  if (failed) {
    let failure = primary;
    for (let runnerIndex = 0; runnerIndex < settled.length; runnerIndex++) {
      if (runnerIndex !== firstRunner && settled[runnerIndex].status === 'rejected') {
        failure = addStorageFailureContext(failure, {}, settled[runnerIndex].reason, { secondaryPresent: true });
      }
    }
    throw failure;
  }
};

/** Progress observes completion; it must not return out of a work finally or
 * replace an original document failure with an independent logger failure.
 */
export const createDocumentProgressRunner = ({ total, worker, onProgress, now = Date.now }) => {
  let processed = 0, lastProgressAt = now();
  return async doc => {
    let failed = false, primary;
    try { return await worker(doc); }
    catch (error) { failed = true; primary = error; throw error; }
    finally {
      processed += 1;
      try {
        if (total >= 20) {
          const current = now();
          if (processed === total || processed % 20 === 0 || current - lastProgressAt >= 5000) {
            lastProgressAt = current;
            await onProgress({ processed, total });
          }
        }
      } catch (error) {
        if (failed) throw addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
        throw error;
      }
    }
  };
};

/**
 * Create a generic concurrency limiter for promise-returning tasks.
 * @param {number} concurrency
 * @returns {((fn:()=>Promise<any>,options?:{signal?:AbortSignal|null})=>Promise<any>) & {getMetrics:()=>object}}
 */
export const createConcurrencyLimiter = (concurrency) => {
  const maxWorkers = Math.max(1, clampIntRange(concurrency, 1, { min: 1, max: 256 }));
  let active = 0;
  let queue = [];
  let queueHead = 0;

  const dequeue = () => {
    if (queueHead >= queue.length) return null;
    const task = queue[queueHead];
    queueHead += 1;
    if (queueHead >= 1024 && queueHead * 2 >= queue.length) {
      queue = queue.slice(queueHead);
      queueHead = 0;
    }
    return task;
  };

  let queued = 0, cancelled = 0, admitted = 0, highWater = 0;
  const withdraw = task => {
    if (task.state !== 'queued') return;
    task.state = 'withdrawn'; queued -= 1; cancelled += 1;
    task.detach();
    const reject = task.reject;
    task.fn = null; task.resolve = null; task.reject = null; task.signal = null;
    reject(createAbortError());
  };
  const pump = () => {
    while (active < maxWorkers) {
      const task = dequeue();
      if (!task) break;
      if (task.state !== 'queued') continue;
      if (task.signal?.aborted) { withdraw(task); continue; }
      task.state = 'running'; queued -= 1; admitted += 1;
      task.detach(); active += 1;
      Promise.resolve().then(() => {
        throwIfAborted(task.signal);
        const fn = task.fn; task.fn = null;
        return fn();
      }).then(task.resolve, task.reject).finally(() => {
        task.state = 'settled'; task.fn = null; task.resolve = null; task.reject = null; task.signal = null;
        active -= 1; pump();
      });
    }
  };
  const limit = (fn, { signal: inputSignal = null } = {}) => new Promise((resolve, reject) => {
    const signal = isAbortSignal(inputSignal) ? inputSignal : null;
    if (signal?.aborted) { reject(createAbortError()); return; }
    const task = { fn, resolve, reject, signal, state: 'queued', detach: () => {} };
    const onAbort = () => withdraw(task);
    task.detach = () => { signal?.removeEventListener('abort', onAbort); task.detach = () => {}; };
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.push(task); queued += 1; highWater = Math.max(highWater, queued);
    pump();
  });
  limit.getMetrics = () => ({ active, queued, cancelled, admitted, highWater });
  return limit;
};

/**
 * Parse finite integer values with optional lower bound.
 * @param {unknown} value
 * @param {number|null} [min=null]
 * @returns {number|null}
 */
export const toFiniteInt = (value, min = null) => {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  if (!Number.isFinite(min)) return normalized;
  return Math.max(min, normalized);
};

export const createRequestBudgetController = (maxRequests) => {
  const cap = toFiniteInt(maxRequests, 0);
  if (!Number.isFinite(cap) || cap < 0) {
    return {
      enabled: false,
      tryReserve: () => true
    };
  }
  let used = 0;
  return {
    enabled: true,
    tryReserve: () => {
      if (used >= cap) return false;
      used += 1;
      return true;
    }
  };
};
