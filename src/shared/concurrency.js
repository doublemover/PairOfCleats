import PQueue from 'p-queue';
import { createAbortError, throwIfAborted } from './abort.js';

/**
 * Create shared task queues for IO, CPU, and embeddings work.
 * @param {{ioConcurrency:number,cpuConcurrency:number,embeddingConcurrency?:number,procConcurrency?:number,ioPendingLimit?:number,cpuPendingLimit?:number,embeddingPendingLimit?:number,procPendingLimit?:number}} input
 * @returns {{io:PQueue,cpu:PQueue,embedding:PQueue,proc?:PQueue}}
 */
export function createTaskQueues({
  ioConcurrency,
  cpuConcurrency,
  embeddingConcurrency,
  procConcurrency,
  ioPendingLimit,
  cpuPendingLimit,
  embeddingPendingLimit,
  procPendingLimit
}) {
  const io = new PQueue({ concurrency: Math.max(1, Math.floor(ioConcurrency || 1)) });
  const cpu = new PQueue({ concurrency: Math.max(1, Math.floor(cpuConcurrency || 1)) });
  const embeddingLimit = Number.isFinite(Number(embeddingConcurrency))
    ? Math.max(1, Math.floor(Number(embeddingConcurrency)))
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const embedding = new PQueue({ concurrency: embeddingLimit });
  const procLimit = Number.isFinite(Number(procConcurrency))
    ? Math.max(1, Math.floor(Number(procConcurrency)))
    : null;
  const proc = procLimit ? new PQueue({ concurrency: procLimit }) : null;
  const applyLimit = (queue, limit) => {
    if (!Number.isFinite(limit) || limit <= 0) return;
    queue.maxPending = Math.floor(limit);
  };
  applyLimit(io, ioPendingLimit);
  applyLimit(cpu, cpuPendingLimit);
  applyLimit(embedding, embeddingPendingLimit);
  if (proc) {
    applyLimit(proc, procPendingLimit);
    return { io, cpu, embedding, proc };
  }
  return { io, cpu, embedding };
}

/**
 * Run async work over items using a shared queue.
 * @param {PQueue} queue
 * @param {Array<any>} items
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onError?:(error:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onProgress?:(state:{done:number,total:number})=>Promise<void>,bestEffort?:boolean,signal?:AbortSignal,abortError?:Error,retries?:number,retryDelayMs?:number,backoffMs?:number}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithQueue(queue, items, worker, options = {}) {
  const list = Array.from(items || []);
  if (!list.length) return options.collectResults === false ? null : [];
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Math.floor(Number(options.retries))) : 0;
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Math.floor(Number(options.retryDelayMs))) : 0;
  const backoffMs = Number.isFinite(Number(options.backoffMs)) ? Math.max(0, Math.floor(Number(options.backoffMs))) : null;
  const delayMs = backoffMs != null ? backoffMs : retryDelayMs;
  const bestEffort = options.bestEffort === true;
  const signal = options.signal && typeof options.signal.aborted === 'boolean' ? options.signal : null;
  const abortError = options.abortError instanceof Error ? options.abortError : createAbortError();
  const results = collectResults ? new Array(list.length) : null;
  const pendingSignals = new Set();
  const maxPending = Number.isFinite(queue?.maxPending) ? queue.maxPending : null;
  let aborted = false;
  let firstError = null;
  const errors = [];
  let doneCount = 0;
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
    if (aborted) return;
    if (signal?.aborted) {
      markAborted();
      return;
    }
    if (maxPending) {
      while (pendingSignals.size >= maxPending && !aborted) {
        await Promise.race(pendingSignals);
      }
    }
    if (aborted) return;
    const task = queue.add(() => runWorker(item, ctx));
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
      pendingSignals.delete(settled);
    });
    void cleanup.catch(() => {});
  };
  try {
    for (let index = 0; index < list.length; index += 1) {
      await enqueue(list[index], index);
      if (aborted && !bestEffort) break;
    }
    await Promise.all(pendingSignals);
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
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,signal?:AbortSignal}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithConcurrency(items, limit, worker, options = {}) {
  const queue = new PQueue({ concurrency: Math.max(1, Math.floor(limit || 1)) });
  return runWithQueue(queue, items, worker, options);
}
