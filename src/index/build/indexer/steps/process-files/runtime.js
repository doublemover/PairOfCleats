import { createRuntimeQueues } from '../../../runtime/workers.js';
import {
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../../../cleanup-timeout.js';

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
  const requestedIoConcurrency = Math.max(1, Math.floor(Math.max(fileConcurrency, importConcurrency) || 1));
  const requestedCpuConcurrency = Math.max(1, Math.floor(fileConcurrency || 1));
  const baseIoConcurrency = Number.isFinite(baseRuntime.ioConcurrency)
    ? Math.max(1, Math.floor(baseRuntime.ioConcurrency))
    : requestedIoConcurrency;
  const baseCpuConcurrency = Number.isFinite(baseRuntime.cpuConcurrency)
    ? Math.max(1, Math.floor(baseRuntime.cpuConcurrency))
    : requestedCpuConcurrency;
  const ioConcurrency = Math.max(1, Math.min(baseIoConcurrency, requestedIoConcurrency));
  const cpuConcurrency = Math.max(1, Math.min(baseCpuConcurrency, requestedCpuConcurrency));
  const pendingLimits = baseRuntime?.envelope?.queues || null;
  const scheduler = baseRuntime?.scheduler || null;
  const stage1Queues = baseRuntime?.stage1Queues || null;
  const procConcurrency = baseRuntime?.procConcurrency ?? null;
  const cleanupTimeoutMs = resolveBuildCleanupTimeoutMs(
    baseRuntime?.indexingConfig?.stage1?.watchdog?.cleanupTimeoutMs,
    stage1Queues?.watchdog?.cleanupTimeoutMs
  );
  const cleanupLog = typeof baseRuntime?.log === 'function'
    ? baseRuntime.log
    : null;
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
    const idleTasks = [
      { label: 'shard-runtime.queue.io.idle', wait: () => queues.io.onIdle() },
      { label: 'shard-runtime.queue.cpu.idle', wait: () => queues.cpu.onIdle() }
    ];
    if (queues.embedding?.onIdle) {
      idleTasks.push({
        label: 'shard-runtime.queue.embedding.idle',
        wait: () => queues.embedding.onIdle()
      });
    }
    if (queues.proc?.onIdle) {
      idleTasks.push({
        label: 'shard-runtime.queue.proc.idle',
        wait: () => queues.proc.onIdle()
      });
    }
    await Promise.all(
      idleTasks.map((task) => runBuildCleanupWithTimeout({
        label: task.label,
        cleanup: task.wait,
        timeoutMs: cleanupTimeoutMs,
        log: cleanupLog
      }))
    );
    queues.io.clear();
    queues.cpu.clear();
    if (queues.embedding?.clear) queues.embedding.clear();
    if (queues.proc?.clear) queues.proc.clear();
  };
  const destroy = async () => {
    await destroyQueues();
    if (baseWorkerPools && baseWorkerPools !== baseRuntime.workerPools && baseWorkerPools.destroy) {
      await runBuildCleanupWithTimeout({
        label: 'shard-runtime.worker-pools.destroy',
        cleanup: () => baseWorkerPools.destroy(),
        timeoutMs: cleanupTimeoutMs,
        log: cleanupLog
      });
    } else if (baseWorkerPool && baseWorkerPool !== baseRuntime.workerPool && baseWorkerPool.destroy) {
      await runBuildCleanupWithTimeout({
        label: 'shard-runtime.worker-pool.destroy',
        cleanup: () => baseWorkerPool.destroy(),
        timeoutMs: cleanupTimeoutMs,
        log: cleanupLog
      });
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
