import { coercePositiveIntMinOne } from './number-coerce.js';
import { readEffectiveMemory } from './effective-memory.js';

export const resolveAutoEmbeddingBatchSize = (totalMemBytes = readEffectiveMemory().totalBytes, options = {}) => {
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

export const resolveEmbeddingsBatchTokenBudget = ({
  indexingConfig,
  embeddingBatchSize
} = {}) => {
  const explicit = indexingConfig?.embeddings?.maxBatchTokens;
  if (explicit !== null && explicit !== undefined && String(explicit).trim() !== '') {
    const parsed = Math.floor(Number(explicit));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 0;
  }
  const batchSize = coercePositiveIntMinOne(embeddingBatchSize);
  if (!batchSize) return 0;
  const configuredMultiplier = Math.floor(Number(indexingConfig?.embeddings?.batchTokenMultiplier));
  const multiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
    ? configuredMultiplier
    : 256;
  return Math.max(1, batchSize * multiplier);
};

