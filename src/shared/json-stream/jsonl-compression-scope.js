import { AsyncLocalStorage } from 'node:async_hooks';
import { createJsonlCompressionPool } from './jsonl-compression-pool.js';
const scope = new AsyncLocalStorage();

export const borrowJsonlCompressionPool = options => scope.getStore()?.pool(options) || null;

/** Scope ownership follows the existing artifact build invocation. Nested writers
 * borrow the resource and never close it; all exits await teardown. */
export const withJsonlCompressionScope = async ({ scheduler, cpuBudget = 1, signal = null }, operation) => {
  if (scope.getStore()) return operation();
  const size = Math.min(4, Math.max(1, Math.floor(Number(cpuBudget) || 1)));
  let pool = null;
  scheduler?.registerQueue?.('stage2.codec', { priority: 40, weight: 1, maxPending: size * 2,
    maxPendingBytes: size * (12 * 1024 * 1024 + 65536) });
  const owner = { pool(options) {
    if (!pool) pool = createJsonlCompressionPool({ ...options, workerCount: size,
      maxReservedBytes: size * (12 * 1024 * 1024 + 65536),
      schedule: scheduler?.schedule ? (job, tokens) => scheduler.schedule('stage2.codec', { cpu: 1, bytes: tokens.bytes, signal: tokens.signal || signal }, job) : job => job() });
    const level = Number.isFinite(Number(options.zstdLevel ?? options.level)) ? Math.floor(Number(options.zstdLevel ?? options.level)) : 3;
    return { size: pool.size, stats: () => pool.stats(), acquireBlock: (bytes, blockSignal) => pool.acquireBlock(bytes, blockSignal),
      compress: (buffer, task = {}) => pool.compress(buffer, { ...task, zstdLevel: level }) };
  } };
  let primary = null;
  try { return await scope.run(owner, operation); }
  catch (error) { primary = error; throw error; }
  finally {
    const settled = await Promise.allSettled(pool ? [pool.close()] : []);
    const failure = settled.find(result => result.status === 'rejected');
    if (failure) { if (primary) primary.codecTeardownError = failure.reason; else throw failure.reason; }
  }
};
