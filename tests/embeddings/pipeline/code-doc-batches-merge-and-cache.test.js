#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const runBatched = async ({ texts, embed }) => embed(texts);
const assertVectorArrays = (vectors, count) => {
  assert.equal(Array.isArray(vectors), true);
  assert.equal(vectors.length, count);
  for (const vector of vectors) {
    assert.equal(Array.isArray(vector), true);
    assert.ok(vector.length > 0);
  }
};

const buildEntry = () => ({
  items: [{ index: 0 }, { index: 1 }, { index: 2 }],
  codeTexts: ['same', 'same', 'alpha'],
  docTexts: ['', 'same-doc', 'same-doc'],
  codeMapping: [0, 1, 2],
  docMapping: [0, 1, 2]
});

const embedCalls = [];
const getChunkEmbeddings = async (texts) => {
  embedCalls.push([...texts]);
  return texts.map((text) => [String(text).length]);
};
getChunkEmbeddings.supportsParallelDispatch = true;

const textCacheStore = new Map();
const embeddingTextCache = {
  canCache: (text) => typeof text === 'string',
  get: (text) => textCacheStore.get(text) || null,
  set: (text, vector) => textCacheStore.set(text, vector),
  size: () => textCacheStore.size
};

const usage = [];
let processed = 0;
const processFileEmbeddings = async () => {
  processed += 1;
};

const processor = createFileEmbeddingsProcessor({
  embeddingBatchSize: 128,
  getChunkEmbeddings,
  runBatched,
  assertVectorArrays,
  scheduleCompute: (fn) => fn(),
  processFileEmbeddings,
  mode: 'code',
  parallelDispatch: true,
  mergeCodeDocBatches: true,
  embeddingTextCache,
  onEmbeddingUsage: (entry) => usage.push(entry)
});

const first = buildEntry();
await processor(first);
assert.equal(embedCalls.length, 1, 'expected first file to dispatch one merged code+doc batch');
assert.deepEqual(
  embedCalls[0],
  ['same', 'alpha', 'same-doc'],
  'expected duplicate texts to dedupe before embedding dispatch'
);
assert.deepEqual(first.codeEmbeds, [[4], [4], [5]]);
assert.deepEqual(first.docVectorsRaw, [null, [8], [8]]);

const second = buildEntry();
await processor(second);
assert.equal(embedCalls.length, 1, 'expected second file to reuse in-memory cache with no embed call');
assert.deepEqual(second.codeEmbeds, [[4], [4], [5]]);
assert.deepEqual(second.docVectorsRaw, [null, [8], [8]]);

assert.equal(usage.length, 2);
assert.equal(usage[0].requested, 5);
assert.equal(usage[0].embedded, 3);
assert.equal(usage[0].cacheHits, 0);
assert.equal(usage[0].batchDedupHits, 2);
assert.equal(usage[1].requested, 5);
assert.equal(usage[1].embedded, 0);
assert.equal(usage[1].cacheHits, 5);
assert.equal(textCacheStore.size, 3);
assert.equal(processed, 2);

console.log('embeddings code/doc merged batching + text cache reuse test passed');
