import PQueue from 'p-queue';

/**
 * Create shared task queues for IO, CPU, and embeddings work.
 * @param {{ioConcurrency:number,cpuConcurrency:number,embeddingConcurrency?:number,procConcurrency?:number,ioPendingLimit?:number,cpuPendingLimit?:number,embeddingPendingLimit?:number,procPendingLimit?:number,ioPendingBytesLimit?:number,cpuPendingBytesLimit?:number,embeddingPendingBytesLimit?:number,procPendingBytesLimit?:number}} input
 * @returns {{io:PQueue,cpu:PQueue,embedding:PQueue|null,proc?:PQueue}}
 */
export function createTaskQueues({
  ioConcurrency,
  cpuConcurrency,
  embeddingConcurrency,
  procConcurrency,
  ioPendingLimit,
  cpuPendingLimit,
  embeddingPendingLimit,
  procPendingLimit,
  ioPendingBytesLimit,
  cpuPendingBytesLimit,
  embeddingPendingBytesLimit,
  procPendingBytesLimit
}) {
  const io = new PQueue({ concurrency: Math.max(1, Math.floor(ioConcurrency || 1)) });
  const cpu = new PQueue({ concurrency: Math.max(1, Math.floor(cpuConcurrency || 1)) });
  const embeddingConcurrencyRaw = Number(embeddingConcurrency);
  const embeddingLimit = Number.isFinite(embeddingConcurrencyRaw)
    ? Math.floor(embeddingConcurrencyRaw)
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const embedding = embeddingLimit > 0
    ? new PQueue({ concurrency: embeddingLimit })
    : null;
  const procLimit = Number.isFinite(Number(procConcurrency))
    ? Math.max(1, Math.floor(Number(procConcurrency)))
    : null;
  const proc = procLimit ? new PQueue({ concurrency: procLimit }) : null;
  const applyLimit = (queue, limit) => {
    if (!Number.isFinite(limit) || limit <= 0) return;
    queue.maxPending = Math.floor(limit);
  };
  const applyBytesLimit = (queue, limit) => {
    if (!Number.isFinite(limit) || limit <= 0) return;
    queue.maxPendingBytes = Math.floor(limit);
  };
  applyLimit(io, ioPendingLimit);
  applyLimit(cpu, cpuPendingLimit);
  if (embedding) applyLimit(embedding, embeddingPendingLimit);
  applyBytesLimit(io, ioPendingBytesLimit);
  applyBytesLimit(cpu, cpuPendingBytesLimit);
  if (embedding) applyBytesLimit(embedding, embeddingPendingBytesLimit);
  if (proc) {
    applyLimit(proc, procPendingLimit);
    applyBytesLimit(proc, procPendingBytesLimit);
    return { io, cpu, embedding, proc };
  }
  return { io, cpu, embedding };
}
