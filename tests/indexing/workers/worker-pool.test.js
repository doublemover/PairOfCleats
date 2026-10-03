#!/usr/bin/env node
import { quantizeVec } from '../../../src/index/embedding.js';
import {
  createWorkerPoolTestResources,
  WORKER_POOL_SAMPLE
} from './worker-pool-fixture.js';

const { syncTokens, workerPool } = await createWorkerPoolTestResources();
if (!workerPool) {
  console.log('worker pool test skipped (worker pool unavailable).');
  process.exit(0);
}

const workerTokens = await workerPool.tokenizeChunk({
  text: WORKER_POOL_SAMPLE,
  mode: 'code',
  ext: '.js'
});

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
