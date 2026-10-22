import { runBuildCleanupWithTimeout, resolveBuildCleanupTimeoutMs } from './cleanup-timeout.js';

/** Preserve the operational failure when cleanup also fails. */
export const combineCacheWriterErrors = (operationError, cleanupError) => {
  if (!operationError) return cleanupError;
  if (operationError === cleanupError) return operationError;
  return Object.assign(new AggregateError([operationError, cleanupError],
    `${operationError.message}; cache writer cleanup also failed: ${cleanupError.message}`, { cause: operationError }),
  { code: operationError.code || cleanupError.code, name: operationError.name,
    cacheOwnershipPending: Boolean(operationError.cacheOwnershipPending || cleanupError.cacheOwnershipPending), operationError, cleanupError });
};

/** Other idle controls cannot prove that an explicitly pending child has closed. */
export const releaseCacheWriterOwnership = async ({ lease = null, release, operationError = null, drained = true }) => {
  if (operationError?.cacheOwnershipPending && operationError.cacheOwnershipReleased?.() !== true) throw operationError;
  if (!drained) throw Object.assign(new Error('Cache ownership retained because writer teardown did not complete.'),
    { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE', cacheOwnershipPending: true });
  lease?.assertOwned?.();
  lease?.invalidate();
  return release?.();
};

const poolsFor = runtime => {
  const pools = new Set([runtime.workerPool, runtime.quantizePool,
    runtime.workerPools?.tokenizePool, runtime.workerPools?.quantizePool].filter(Boolean));
  if (runtime.workerPools?.destroy && !Object.hasOwn(runtime.workerPools, 'tokenizePool')
    && !Object.hasOwn(runtime.workerPools, 'quantizePool')) pools.add(runtime.workerPools);
  return [...pools];
};

/** A missing activity receipt is not evidence that a present owner is idle. */
export const cacheWritersAreIdle = runtime => {
  try {
    if (runtime.cacheWriterPending && runtime.cacheWriterPending() !== 0) return false;
    if (runtime.scheduler) {
      const stats = runtime.scheduler.stats?.();
      if (!Number.isSafeInteger(stats?.runningTasks) || stats.runningTasks !== 0) return false;
      if (Object.values(stats.queues || {}).some(queue => queue.pending > 0 || queue.running > 0)) return false;
    }
    return poolsFor(runtime).every(pool => {
      const stats = pool.stats?.();
      return Number.isSafeInteger(stats?.activeTasks) && stats.activeTasks === 0
        && Number.isSafeInteger(stats.queuedTasks) && stats.queuedTasks === 0;
    });
  } catch { return false; }
};

/** Existing task registry/scheduler/pool owners settle before their cache lease. */
export const drainCacheWriters = async (runtime, { shutdown = false, timeoutMs = null, log = null } = {}) => {
  timeoutMs = resolveBuildCleanupTimeoutMs(timeoutMs, runtime.workerPool?.config?.cleanupTimeoutMs,
    runtime.workerPoolConfig?.cleanupTimeoutMs, runtime.cleanupTimeoutMs);
  const errors = [];
  const run = async (label, cleanup, bound = timeoutMs) => {
    try {
      await runBuildCleanupWithTimeout({ label, cleanup, timeoutMs: bound, log, swallowTimeout: false });
    } catch (error) { errors.push(error); }
  };
  if (shutdown) {
    await run('cache-writer.scheduler.shutdown', async () => {
      const result = await runtime.scheduler?.shutdown?.({ awaitRunning: true, timeoutMs });
      if (result?.timedOut) throw Object.assign(new Error('Cache writer scheduler did not drain.'), { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' });
    }, timeoutMs > 0 ? timeoutMs + 25 : 0);
    await run('cache-writer.worker-pools.destroy', async () => {
      const aggregate = runtime.workerPools?.destroy ? runtime.workerPools : null;
      const covered = new Set([aggregate, aggregate?.tokenizePool, aggregate?.quantizePool].filter(Boolean));
      const owners = [...(aggregate ? [aggregate] : []), ...poolsFor(runtime).filter(pool => !covered.has(pool))];
      const results = await Promise.allSettled(owners.map(owner => Promise.resolve().then(async () => {
        if (typeof owner.destroy !== 'function') throw Object.assign(new Error('Cache worker owner has no termination control.'), { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' });
        const result = await owner.destroy();
        if (result?.timedOut) throw Object.assign(new Error('Cache writer workers did not terminate.'), { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' });
      })));
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw Object.assign(new AggregateError(failures, 'Cache worker termination failed.'), { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' });
    });
  }
  await run('cache-writer.file-tasks.drain', () => runtime.cacheWriterDrain?.());
  if (!shutdown && !cacheWritersAreIdle(runtime)) errors.push(Object.assign(new Error('Cache writer activity remains after file-task drain.'),
    { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' }));
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw Object.assign(new AggregateError(errors, 'Cache writers failed to drain.'), { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' });
  runtime.semanticReplayVerification?.clear();
};
