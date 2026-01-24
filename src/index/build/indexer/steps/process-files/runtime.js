import os from 'node:os';
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
  const ioConcurrency = Math.max(fileConcurrency, importConcurrency);
  const cpuLimit = Math.max(1, os.cpus().length * 2);
  const cpuConcurrency = Math.max(1, Math.min(cpuLimit, fileConcurrency));
  // Keep shard workers from running too far ahead of the ordered append cursor.
  // Large pending windows can accumulate many completed-but-unappended file results
  // (especially when one earlier file is slow), which is a common source of V8 OOM
  // that often disappears under `--inspect`.
  const maxFilePending = Math.min(256, Math.max(32, fileConcurrency * 4));
  const maxIoPending = Math.min(512, Math.max(64, ioConcurrency * 4));
  const maxEmbeddingPending = Math.min(64, Math.max(16, embeddingConcurrency * 8));
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
