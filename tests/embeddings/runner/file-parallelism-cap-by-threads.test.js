#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveEmbeddingsFileParallelism } from '../../../tools/build/embeddings/runner.js';

assert.equal(
  resolveEmbeddingsFileParallelism({
    indexingConfig: {},
    computeTokensTotal: 27,
    cpuConcurrency: 16,
    hnswEnabled: false
  }),
  16,
  'expected scheduler token-derived parallelism to be capped by cpuConcurrency'
);

assert.equal(
  resolveEmbeddingsFileParallelism({
    indexingConfig: {},
    computeTokensTotal: 8,
    cpuConcurrency: 16,
    hnswEnabled: false
  }),
  8,
  'expected lower token-driven parallelism to be preserved'
);

assert.equal(
  resolveEmbeddingsFileParallelism({
    indexingConfig: {},
    computeTokensTotal: null,
    cpuConcurrency: 16,
    hnswEnabled: false
  }),
  16,
  'expected cpuConcurrency fallback when scheduler tokens are unavailable'
);

assert.equal(
  resolveEmbeddingsFileParallelism({
    indexingConfig: { embeddings: { fileParallelism: 5 } },
    computeTokensTotal: 27,
    cpuConcurrency: 16,
    hnswEnabled: false
  }),
  5,
  'expected explicit embeddings.fileParallelism override to win'
);

assert.equal(
  resolveEmbeddingsFileParallelism({
    indexingConfig: { embeddings: { fileParallelism: 64 } },
    computeTokensTotal: 27,
    cpuConcurrency: 16,
    hnswEnabled: false
  }),
  16,
  'expected explicit embeddings.fileParallelism to still respect cpuConcurrency cap'
);

assert.equal(
  resolveEmbeddingsFileParallelism({
    indexingConfig: { embeddings: { fileParallelism: 5 } },
    computeTokensTotal: 27,
    cpuConcurrency: 16,
    hnswEnabled: true
  }),
  1,
  'expected HNSW path to force serial file processing'
);

console.log('embeddings file parallelism thread-cap test passed');
