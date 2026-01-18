import os from 'node:os';

export const resolveAutoEmbeddingBatchSize = (totalMemBytes = os.totalmem()) => {
  const totalGb = totalMemBytes / (1024 ** 3);
  const autoBatch = Math.floor(totalGb * 16);
  return Math.min(128, Math.max(16, autoBatch));
};
