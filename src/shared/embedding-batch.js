import os from 'node:os';

export const resolveAutoEmbeddingBatchSize = (totalMemBytes = os.totalmem(), options = {}) => {
  const totalGb = totalMemBytes / (1024 ** 3);
  const memBatch = Math.min(128, Math.max(16, Math.floor(totalGb * 16)));

  const provider = typeof options.provider === 'string' ? options.provider.trim().toLowerCase() : '';
  const cpuCount = Number.isFinite(Number(options.cpuCount))
    ? Math.max(1, Math.floor(Number(options.cpuCount)))
    : null;

  if (cpuCount && (provider === 'onnx' || provider === 'stub')) {
    // CPU-only embedding paths: bias toward smaller batches when CPU is the bottleneck.
    // Still cap by memory-derived defaults to avoid surprising jumps on low-RAM hosts.
    const cpuBatch = Math.min(256, Math.max(16, cpuCount * 8));
    return Math.min(memBatch, cpuBatch);
  }

  return memBatch;
};
