import { createTaskQueues } from '../../../../../shared/concurrency.js';

export const resolveCheckpointBatchSize = (totalFiles, shardPlan) => {
  if (!Number.isFinite(totalFiles) || totalFiles <= 0) return 10;
  const minBatch = 10;
  const maxBatch = 250;
  if (Array.isArray(shardPlan) && shardPlan.length) {
    const perShard = Math.max(1, Math.ceil(totalFiles / shardPlan.length));
    const target = Math.ceil(perShard / 10);
    return Math.max(minBatch, Math.min(maxBatch, target));
  }
  const target = Math.ceil(totalFiles / 200);
  return Math.max(minBatch, Math.min(maxBatch, target));
};

export const createShardRuntime = (baseRuntime, { fileConcurrency, importConcurrency, embeddingConcurrency }) => {
  const baseWorkerPools = baseRuntime.workerPools;
  const baseWorkerPool = baseRuntime.workerPool;
  const baseQuantizePool = baseRuntime.quantizePool;
  const ioConcurrency = Number.isFinite(baseRuntime.ioConcurrency)
    ? Math.max(1, Math.floor(baseRuntime.ioConcurrency))
    : Math.max(fileConcurrency, importConcurrency);
  const cpuConcurrency = Number.isFinite(baseRuntime.cpuConcurrency)
    ? Math.max(1, Math.floor(baseRuntime.cpuConcurrency))
    : Math.max(1, fileConcurrency);
  // Keep shard workers from running too far ahead of the ordered append cursor.
  // Large pending windows can accumulate many completed-but-unappended file results
  // (especially when one earlier file is slow), which is a common source of V8 OOM
  // that often disappears under `--inspect`.
  const pendingLimits = baseRuntime?.envelope?.queues || null;
  const maxFilePending = Number.isFinite(pendingLimits?.cpu?.maxPending)
    ? pendingLimits.cpu.maxPending
    : Math.max(16, cpuConcurrency * 4);
  const maxIoPending = Number.isFinite(pendingLimits?.io?.maxPending)
    ? pendingLimits.io.maxPending
    : Math.max(8, ioConcurrency * 4);
  const maxEmbeddingPending = Number.isFinite(pendingLimits?.embedding?.maxPending)
    ? pendingLimits.embedding.maxPending
    : Math.max(16, embeddingConcurrency * 4);
  const queues = createTaskQueues({
    ioConcurrency,
    cpuConcurrency,
    embeddingConcurrency,
    ioPendingLimit: maxIoPending,
    cpuPendingLimit: maxFilePending,
    embeddingPendingLimit: maxEmbeddingPending
  });
  const destroyQueues = async () => {
    await Promise.all([
      queues.io.onIdle(),
      queues.cpu.onIdle(),
      queues.embedding.onIdle()
    ]);
    queues.io.clear();
    queues.cpu.clear();
    queues.embedding.clear();
  };
  const destroy = async () => {
    await destroyQueues();
    if (baseWorkerPools && baseWorkerPools !== baseRuntime.workerPools && baseWorkerPools.destroy) {
      await baseWorkerPools.destroy();
    } else if (baseWorkerPool && baseWorkerPool !== baseRuntime.workerPool && baseWorkerPool.destroy) {
      await baseWorkerPool.destroy();
    }
  };
  return {
    ...baseRuntime,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency,
    embeddingConcurrency,
    queues,
    workerPools: baseWorkerPools,
    workerPool: baseWorkerPool,
    quantizePool: baseQuantizePool,
    destroyQueues,
    destroy
  };
};
