#!/usr/bin/env node
import assert from 'node:assert/strict';

import { runBatched } from '../../../tools/build/embeddings/embed.js';
import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const embedCalls = [];
const telemetry = [];

const getChunkEmbeddings = async (texts) => {
  embedCalls.push([...texts]);
  return texts.map((text) => [String(text).length]);
};

const assertVectorArrays = (vectors, count) => {
  assert.equal(Array.isArray(vectors), true);
  assert.equal(vectors.length, count);
  for (const vector of vectors) {
    assert.equal(Array.isArray(vector), true);
    assert.ok(vector.length > 0);
  }
};

const buildEntry = (text) => ({
  items: [{ index: 0 }],
  codeTexts: [text],
  docTexts: [''],
  codeMapping: [0],
  docMapping: [0]
});

const processor = createFileEmbeddingsProcessor({
  embeddingBatchSize: 16,
  embeddingBatchTokenBudget: 12,
  estimateEmbeddingTokens: (text) => String(text || '').length,
  estimateEmbeddingTokensBatch: async (texts) => texts.map((text) => String(text || '').length),
  getChunkEmbeddings,
  runBatched,
  assertVectorArrays,
  scheduleCompute: (fn) => fn(),
  processFileEmbeddings: async () => {},
  mode: 'code',
  mergeCodeDocBatches: true,
  globalMicroBatching: true,
  globalMicroBatchingFillTarget: 0.9,
  globalMicroBatchingMaxWaitMs: 20,
  onEmbeddingBatch: (entry) => telemetry.push(entry)
});

const first = buildEntry('aaa');
const second = buildEntry('bbbb');

await Promise.all([processor(first), processor(second)]);
await processor.drain();

assert.equal(embedCalls.length, 1, 'expected global micro-batching to merge cross-file payloads');
assert.deepEqual(embedCalls[0], ['aaa', 'bbbb']);
assert.deepEqual(first.codeEmbeds, [[3]]);
assert.deepEqual(second.codeEmbeds, [[4]]);

assert.equal(telemetry.length, 1);
assert.equal(telemetry[0].targetBatchTokens, 10);
assert.equal(telemetry[0].underfilledTokens, 3);
assert.ok(telemetry[0].batchFillRatio > 0.69 && telemetry[0].batchFillRatio < 0.71);
assert.equal(telemetry[0].mergedRequests, 2);
assert.equal(telemetry[0].mergedLabels, 1);
assert.ok(telemetry[0].queueWaitMs >= 0);

console.log('embeddings global batching fill telemetry test passed');
