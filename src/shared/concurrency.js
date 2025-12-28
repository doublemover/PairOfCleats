/**
 * Run async work over items with a concurrency limit.
 * @param {Array<any>} items
 * @param {number} limit
 * @param {(item:any, index:number)=>Promise<any>} worker
 * @returns {Promise<any[]>}
 */
export async function runWithConcurrency(items, limit, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}
