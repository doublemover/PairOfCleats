#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

const asIterable = (items) => ({
  *[Symbol.iterator]() {
    for (const item of items) yield item;
  }
});

const workerConfig = normalizeWorkerPoolConfig({
  enabled: true,
  maxWorkers: 1,
  taskTimeoutMs: 5000
}, { cpuLimit: 1 });

const workerPool = await createIndexerWorkerPool({
  config: workerConfig,
  dictWords: asIterable(['alpha', 'beta', 42, null]),
  dictConfig: { segmentation: 'auto' },
  postingsConfig: {},
  codeDictWords: asIterable(['function', 'class', 99]),
  codeDictLanguages: asIterable(['javascript', 'typescript', false]),
  codeDictWordsByLanguage: new Map([
    ['javascript', asIterable(['const', 'let'])],
    ['typescript', asIterable(['interface', 'type'])]
  ])
});

if (!workerPool) {
  console.log('worker pool iterable normalization test skipped (worker pool unavailable).');
  process.exit(0);
}

const result = await workerPool.tokenizeChunk({
  text: 'const value = alphaBeta',
  mode: 'code',
  ext: '.ts'
});

assert.ok(result && Array.isArray(result.tokens), 'expected tokenize result from worker pool');
await workerPool.destroy();
console.log('worker pool iterable normalization test passed');
