import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

export const WORKER_POOL_SAMPLE = 'helloWorld fooBar';

export const createWorkerPoolTestResources = async () => {
  const postingsConfig = normalizePostingsConfig({
    enablePhraseNgrams: true,
    phraseMinN: 2,
    phraseMaxN: 3,
    enableChargrams: true,
    chargramMinN: 3,
    chargramMaxN: 3
  });
  const dictWords = new Set(['hello', 'world', 'foo', 'bar']);
  const dictConfig = { segmentation: 'greedy' };
  const workerConfig = normalizeWorkerPoolConfig({
    enabled: true,
    maxWorkers: 1,
    maxFileBytes: 4096,
    quantizeBatchSize: 2,
    taskTimeoutMs: 5000
  }, { cpuLimit: 1 });

  const workerPool = await createIndexerWorkerPool({
    config: workerConfig,
    dictWords,
    dictConfig,
    postingsConfig
  });
  const context = createTokenizationContext({ dictWords, dictConfig, postingsConfig });
  const syncTokens = tokenizeChunkText({
    text: WORKER_POOL_SAMPLE,
    mode: 'code',
    ext: '.js',
    context
  });

  return { syncTokens, workerPool };
};
