#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveEmbeddingsFileParallelism } from '../../../tools/build/embeddings/runner.js';

const fdCapped = resolveEmbeddingsFileParallelism({
  indexingConfig: {},
  computeTokensTotal: 12,
  cpuConcurrency: 12,
  fdConcurrencyCap: 3,
  hnswEnabled: false
});
assert.equal(
  fdCapped,
  3,
  `expected FD-aware cap to clamp embeddings file parallelism to 3; got ${fdCapped}`
);

const configuredStillFdCapped = resolveEmbeddingsFileParallelism({
  indexingConfig: { embeddings: { fileParallelism: 10 } },
  computeTokensTotal: 12,
  cpuConcurrency: 12,
  fdConcurrencyCap: 2,
  hnswEnabled: false
});
assert.equal(
  configuredStillFdCapped,
  2,
  `expected configured file parallelism to still honor FD cap=2; got ${configuredStillFdCapped}`
);

console.log('embeddings file parallelism fd cap test passed');
