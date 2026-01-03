import PQueue from 'p-queue';

/**
 * Create shared task queues for IO and CPU work.
 * @param {{ioConcurrency:number,cpuConcurrency:number}} input
 * @returns {{io:PQueue,cpu:PQueue}}
 */
export function createTaskQueues({ ioConcurrency, cpuConcurrency }) {
  const io = new PQueue({ concurrency: Math.max(1, Math.floor(ioConcurrency || 1)) });
  const cpu = new PQueue({ concurrency: Math.max(1, Math.floor(cpuConcurrency || 1)) });
  return { io, cpu };
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
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Math.floor(Number(options.retries))) : 0;
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Math.floor(Number(options.retryDelayMs))) : 0;
  const results = collectResults ? new Array(items.length) : null;
  const tasks = items.map((item, index) => queue.add(async () => {
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
  }));
  await Promise.all(tasks);
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
