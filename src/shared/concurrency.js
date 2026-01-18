import PQueue from 'p-queue';

const queueErrorHandlers = new WeakSet();

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
  if (!items.length) return options.collectResults === false ? null : [];       
  if (queue && typeof queue.on === 'function' && !queueErrorHandlers.has(queue)) {
    queue.on('error', () => {});
    queueErrorHandlers.add(queue);
  }
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Math.floor(Number(options.retries))) : 0;
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Math.floor(Number(options.retryDelayMs))) : 0;
  const results = collectResults ? new Array(items.length) : null;
  const pending = new Set();
  const maxPending = Number.isFinite(queue?.maxPending) ? queue.maxPending : null;
  const enqueue = async (item, index) => {
    if (maxPending) {
      while (pending.size >= maxPending) {
        await Promise.race(pending);
      }
    }
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
    void task.catch(() => {});
    const cleanup = task.finally(() => pending.delete(task));
    void cleanup.catch(() => {});
  };
  for (let index = 0; index < items.length; index += 1) {
    await enqueue(items[index], index);
  }
  await Promise.all(pending);
  return results;
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
