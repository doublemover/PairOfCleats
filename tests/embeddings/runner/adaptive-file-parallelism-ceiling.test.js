#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveEmbeddingsAdaptiveFileParallelismCeiling } from '../../../tools/build/embeddings/runner.js';

assert.equal(
  resolveEmbeddingsAdaptiveFileParallelismCeiling({
    baseFileParallelism: 16,
    maxMultiplier: 2,
    computeTokensTotal: 16,
    cpuConcurrency: 27,
    fdConcurrencyCap: 64
  }),
  16,
  'expected adaptive ceiling to respect scheduler thread/token cap'
);

assert.equal(
  resolveEmbeddingsAdaptiveFileParallelismCeiling({
    baseFileParallelism: 4,
    maxMultiplier: 2,
    computeTokensTotal: 16,
    cpuConcurrency: 16,
    fdConcurrencyCap: 64
  }),
  8,
  'expected adaptive ceiling to allow multiplier growth when within caps'
);

assert.equal(
  resolveEmbeddingsAdaptiveFileParallelismCeiling({
    baseFileParallelism: 4,
    maxMultiplier: 10,
    computeTokensTotal: 16,
    cpuConcurrency: 16,
    fdConcurrencyCap: 5
  }),
  5,
  'expected adaptive ceiling to respect fd cap'
);

assert.equal(
  resolveEmbeddingsAdaptiveFileParallelismCeiling({
    baseFileParallelism: 4,
    maxMultiplier: 3,
    computeTokensTotal: 3,
    cpuConcurrency: 32,
    fdConcurrencyCap: 64
  }),
  4,
  'expected adaptive ceiling to never drop below base file parallelism'
);

console.log('adaptive file parallelism ceiling test passed');
