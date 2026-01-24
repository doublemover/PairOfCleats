import PQueue from 'p-queue';

/**
 * Create shared task queues for IO, CPU, and embeddings work.
 * @param {{ioConcurrency:number,cpuConcurrency:number,embeddingConcurrency?:number,ioPendingLimit?:number,cpuPendingLimit?:number,embeddingPendingLimit?:number}} input
 * @returns {{io:PQueue,cpu:PQueue,embedding:PQueue}}
 */
export function createTaskQueues({
  ioConcurrency,
  cpuConcurrency,
  embeddingConcurrency,
  ioPendingLimit,
  cpuPendingLimit,
  embeddingPendingLimit
}) {
  const io = new PQueue({ concurrency: Math.max(1, Math.floor(ioConcurrency || 1)) });
  const cpu = new PQueue({ concurrency: Math.max(1, Math.floor(cpuConcurrency || 1)) });
  const embeddingLimit = Number.isFinite(Number(embeddingConcurrency))
    ? Math.max(1, Math.floor(Number(embeddingConcurrency)))
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const embedding = new PQueue({ concurrency: embeddingLimit });
  const applyLimit = (queue, limit) => {
    if (!Number.isFinite(limit) || limit <= 0) return;
    queue.maxPending = Math.floor(limit);
  };
  applyLimit(io, ioPendingLimit);
  applyLimit(cpu, cpuPendingLimit);
  applyLimit(embedding, embeddingPendingLimit);
  return { io, cpu, embedding };
}

/**
 * Run async work over items using a shared queue.
 * @param {PQueue} queue
 * @param {Array<any>} items
 * @param {(item:any, index:number)=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, index:number)=>Promise<void>,retries?:number,retryDelayMs?:number}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithQueue(queue, items, worker, options = {}) {
  const list = Array.from(items || []);
  if (!list.length) return options.collectResults === false ? null : [];
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Math.floor(Number(options.retries))) : 0;
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Math.floor(Number(options.retryDelayMs))) : 0;
  const results = collectResults ? new Array(list.length) : null;
  const pending = new Set();
  const pendingSignals = new Set();
  const maxPending = Number.isFinite(queue?.maxPending) ? queue.maxPending : null;
  let failure = null;
  let aborted = false;
  const recordFailure = (err) => {
    if (failure) return;
    failure = err || new Error('Queue task failed');
    aborted = true;
    if (queue && typeof queue.clear === 'function') {
      queue.clear();
    }
  };
  const queueErrorHandler = (err) => {
    recordFailure(err);
  };
  if (queue && typeof queue.on === 'function') {
    queue.on('error', queueErrorHandler);
  }
  const enqueue = async (item, index) => {
    if (aborted) return;
    if (maxPending) {
      while (pendingSignals.size >= maxPending && !aborted) {
        await Promise.race(pendingSignals);
      }
    }
    if (aborted) return;
    const task = queue.add(async () => {
      let attempt = 0;
      let result;
      while (true) {
        try {
          result = await worker(item, index);
          break;
        } catch (err) {
          attempt += 1;
          if (attempt > retries) throw err;
          if (retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }
      if (collectResults) results[index] = result;
      if (onResult) await onResult(result, index);
      return result;
    });
    pending.add(task);
    const settled = task.then(
      () => null,
      (err) => {
        recordFailure(err);
        return null;
      }
    );
    pendingSignals.add(settled);
    void task.catch(() => {});
    const cleanup = settled.finally(() => {
      pending.delete(task);
      pendingSignals.delete(settled);
    });
    void cleanup.catch(() => {});
  };
  try {
    for (let index = 0; index < list.length; index += 1) {
      await enqueue(list[index], index);
      if (aborted) break;
    }
    if (failure) throw failure;
    await Promise.all(pendingSignals);
    if (failure) throw failure;
    return results;
  } finally {
    if (queue && typeof queue.off === 'function') {
      queue.off('error', queueErrorHandler);
    }
  }
}

/**
 * Run async work over items with a per-call concurrency limit.
 * @param {Array<any>} items
 * @param {number} limit
 * @param {(item:any, index:number)=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, index:number)=>Promise<void>}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithConcurrency(items, limit, worker, options = {}) {
  const queue = new PQueue({ concurrency: Math.max(1, Math.floor(limit || 1)) });
  return runWithQueue(queue, items, worker, options);
}
