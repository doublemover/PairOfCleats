#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveEmbeddingsAutoTuneRecommendation,
  loadEmbeddingsAutoTuneRecommendation,
  writeEmbeddingsAutoTuneRecommendation
} from '../../../tools/build/embeddings/autotune-profile.js';

applyTestEnv();

const repoCacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-embeddings-autotune-'));
const cadenceMs = 60 * 1000;
const initialWriteAtMs = Date.parse('2026-02-23T00:00:00.000Z');
const firstTimestampIso = new Date(initialWriteAtMs).toISOString();
const secondTimestampIso = new Date(initialWriteAtMs + cadenceMs + 1).toISOString();

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

const firstWrite = await writeEmbeddingsAutoTuneRecommendation({
  repoCacheRoot,
  provider: 'xenova',
  modelId: 'Xenova/bge-small-en-v1.5',
  recommended: recommendation,
  observed: { textsEmbedded: 1000 },
  minWriteIntervalMs: cadenceMs,
  now: initialWriteAtMs
});
assert.ok(firstWrite, 'expected first recommendation write');
assert.equal(firstWrite.sampleCount, 1);
assert.equal(firstWrite.updatedAt, firstTimestampIso);

const skippedWrite = await writeEmbeddingsAutoTuneRecommendation({
  repoCacheRoot,
  provider: 'xenova',
  modelId: 'Xenova/bge-small-en-v1.5',
  recommended: {
    ...recommendation,
    batchSize: recommendation.batchSize + 10
  },
  observed: { textsEmbedded: 1200 },
  minWriteIntervalMs: cadenceMs,
  now: initialWriteAtMs + 1
});
assert.ok(skippedWrite, 'expected cadence-limited write to return prior entry');
assert.equal(skippedWrite.sampleCount, 1, 'expected sample count unchanged when write is skipped');
assert.equal(
  skippedWrite.recommended.batchSize,
  recommendation.batchSize,
  'expected skipped write to keep prior recommendation'
);

const loaded = loadEmbeddingsAutoTuneRecommendation({
  repoCacheRoot,
  provider: 'xenova',
  modelId: 'Xenova/bge-small-en-v1.5'
});
assert.ok(loaded, 'expected stored recommendation');
assert.equal(loaded.recommended.batchSize, recommendation.batchSize);
assert.equal(loaded.recommended.maxBatchTokens, recommendation.maxBatchTokens);
assert.equal(loaded.sampleCount, 1, 'expected skipped write to avoid profile churn');

const secondWrite = await writeEmbeddingsAutoTuneRecommendation({
  repoCacheRoot,
  provider: 'xenova',
  modelId: 'Xenova/bge-small-en-v1.5',
  recommended: {
    ...recommendation,
    batchSize: recommendation.batchSize + 10
  },
  observed: { textsEmbedded: 1500 },
  minWriteIntervalMs: cadenceMs,
  now: initialWriteAtMs + cadenceMs + 1
});
assert.ok(secondWrite, 'expected write after cadence interval');
assert.equal(secondWrite.sampleCount, 2);
assert.equal(secondWrite.updatedAt, secondTimestampIso);
assert.equal(secondWrite.recommended.batchSize, recommendation.batchSize + 10);

const loadedAfterCadence = loadEmbeddingsAutoTuneRecommendation({
  repoCacheRoot,
  provider: 'xenova',
  modelId: 'Xenova/bge-small-en-v1.5'
});
assert.ok(loadedAfterCadence, 'expected stored recommendation after cadence write');
assert.equal(loadedAfterCadence.sampleCount, 2);
assert.equal(loadedAfterCadence.updatedAt, secondTimestampIso);
assert.equal(loadedAfterCadence.recommended.batchSize, recommendation.batchSize + 10);

await fs.rm(repoCacheRoot, { recursive: true, force: true });
console.log('embedding autotune profile test passed');
