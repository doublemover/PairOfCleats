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
 * @param {{collectResults?:boolean,onResult?:(result:any, index:number)=>Promise<void>}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithQueue(queue, items, worker, options = {}) {
  if (!items.length) return options.collectResults === false ? null : [];
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const results = collectResults ? new Array(items.length) : null;
  const tasks = items.map((item, index) => queue.add(async () => {
    const result = await worker(item, index);
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
