import { createRuntimeQueues } from '../../../runtime/workers.js';

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
  const pendingLimits = baseRuntime?.envelope?.queues || null;
  const scheduler = baseRuntime?.scheduler || null;
  const stage1Queues = baseRuntime?.stage1Queues || null;
  const procConcurrency = baseRuntime?.procConcurrency ?? null;
  const { queues } = createRuntimeQueues({
    ioConcurrency,
    cpuConcurrency,
    fileConcurrency,
    embeddingConcurrency,
    pendingLimits,
    scheduler,
    stage1Queues,
    procConcurrency
  });
  const destroyQueues = async () => {
    const idles = [
      queues.io.onIdle(),
      queues.cpu.onIdle(),
      queues.embedding.onIdle()
    ];
    if (queues.proc?.onIdle) idles.push(queues.proc.onIdle());
    await Promise.all(idles);
    queues.io.clear();
    queues.cpu.clear();
    queues.embedding.clear();
    if (queues.proc?.clear) queues.proc.clear();
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
