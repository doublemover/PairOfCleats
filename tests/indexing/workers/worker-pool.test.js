#!/usr/bin/env node
import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';
import { quantizeVec } from '../../../src/index/embedding.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

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
if (!workerPool) {
  console.log('worker pool test skipped (worker pool unavailable).');
  process.exit(0);
}

const context = createTokenizationContext({ dictWords, dictConfig, postingsConfig });
const sample = 'helloWorld fooBar';
const syncTokens = tokenizeChunkText({ text: sample, mode: 'code', ext: '.js', context });
const workerTokens = await workerPool.runTokenize({ text: sample, mode: 'code', ext: '.js' });

if (JSON.stringify(syncTokens.tokens) !== JSON.stringify(workerTokens.tokens)) {
  console.error('worker pool test failed: tokens mismatch.');
  process.exit(1);
}
if (JSON.stringify(syncTokens.seq) !== JSON.stringify(workerTokens.seq)) {
  console.error('worker pool test failed: seq mismatch.');
  process.exit(1);
}
if (JSON.stringify(syncTokens.ngrams) !== JSON.stringify(workerTokens.ngrams)) {
  console.error('worker pool test failed: ngrams mismatch.');
  process.exit(1);
}
if (JSON.stringify(syncTokens.chargrams) !== JSON.stringify(workerTokens.chargrams)) {
  console.error('worker pool test failed: chargrams mismatch.');
  process.exit(1);
}
if (JSON.stringify(syncTokens.minhashSig) !== JSON.stringify(workerTokens.minhashSig)) {
  console.error('worker pool test failed: minhash mismatch.');
  process.exit(1);
}

const vectors = [
  [0, 0.5],
  [1, -1]
];
const syncQuant = vectors.map((vec) => quantizeVec(vec));
const workerQuant = await workerPool.runQuantize({ vectors });
if (JSON.stringify(syncQuant) !== JSON.stringify(workerQuant)) {
  console.error('worker pool test failed: quantize mismatch.');
  process.exit(1);
}

await workerPool.destroy();
console.log('worker pool test passed');
