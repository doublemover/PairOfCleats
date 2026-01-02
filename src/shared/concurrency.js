/**
 * Run async work over items with a concurrency limit.
 * @param {Array<any>} items
 * @param {number} limit
 * @param {(item:any, index:number)=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, index:number)=>Promise<void>}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithConcurrency(items, limit, worker, options = {}) {
  if (!items.length) return options.collectResults === false ? null : [];
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const results = collectResults ? new Array(items.length) : null;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      const result = await worker(items[idx], idx);
      if (collectResults) results[idx] = result;
      if (onResult) await onResult(result, idx);
    }
  });
  await Promise.all(runners);
  return results;
}
