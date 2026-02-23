#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveEmbeddingsAutoTuneRecommendation,
  loadEmbeddingsAutoTuneRecommendation,
  writeEmbeddingsAutoTuneRecommendation
} from '../../../tools/build/embeddings/autotune-profile.js';

const repoCacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-embeddings-autotune-'));

const recommendation = deriveEmbeddingsAutoTuneRecommendation({
  observed: {
    textsEmbedded: 1000,
    batches: 10,
    batchComputeMs: 600,
    computeQueuePressure: 0.1,
    reuseRate: 0.2
  },
  current: {
    batchSize: 32,
    maxBatchTokens: 8192,
    fileParallelism: 2
  }
});

assert.ok(recommendation, 'expected recommendation payload');
assert.ok(recommendation.batchSize >= 32, 'expected recommendation to preserve or increase batch size');
assert.ok(recommendation.maxBatchTokens >= 8192, 'expected recommendation to preserve token budget floor');

await writeEmbeddingsAutoTuneRecommendation({
  repoCacheRoot,
  provider: 'xenova',
  modelId: 'Xenova/bge-small-en-v1.5',
  recommended: recommendation,
  observed: {
    textsEmbedded: 1000
  }
});

const loaded = loadEmbeddingsAutoTuneRecommendation({
  repoCacheRoot,
  provider: 'xenova',
  modelId: 'Xenova/bge-small-en-v1.5'
});

assert.ok(loaded, 'expected stored recommendation');
assert.equal(loaded.recommended.batchSize, recommendation.batchSize);
assert.equal(loaded.recommended.maxBatchTokens, recommendation.maxBatchTokens);

await fs.rm(repoCacheRoot, { recursive: true, force: true });
console.log('embedding autotune profile test passed');
