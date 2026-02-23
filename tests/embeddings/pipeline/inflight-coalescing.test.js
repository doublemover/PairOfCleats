#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runBatched = async ({ texts, embed, tokenEstimates = null }) => {
  if (Array.isArray(tokenEstimates)) {
    assert.equal(tokenEstimates.length, texts.length, 'expected token estimates to align with batch');
  }
  return embed(texts);
};

const assertVectorArrays = (vectors, count) => {
  assert.equal(Array.isArray(vectors), true);
  assert.equal(vectors.length, count);
  for (const vector of vectors) {
    assert.equal(Array.isArray(vector), true);
    assert.ok(vector.length > 0);
  }
};

const createInFlightCoalescer = () => {
  const pending = new Map();
  return {
    claim(text) {
      const existing = pending.get(text);
      if (existing) {
        return { owner: false, promise: existing.promise };
      }
      let resolvePromise = null;
      let rejectPromise = null;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const entry = {
        promise,
        resolve(value) {
          if (pending.get(text) === entry) pending.delete(text);
          resolvePromise(value);
        },
        reject(err) {
          if (pending.get(text) === entry) pending.delete(text);
          rejectPromise(err);
        }
      };
      pending.set(text, entry);
      return {
        owner: true,
        promise,
        resolve: entry.resolve,
        reject: entry.reject
      };
    }
  };
};

const entryA = {
  items: [{ index: 0 }],
  codeTexts: ['shared-coalesced-text'],
  docTexts: [''],
  codeMapping: [0],
  docMapping: [0]
};

const entryB = {
  items: [{ index: 0 }],
  codeTexts: ['shared-coalesced-text'],
  docTexts: [''],
  codeMapping: [0],
  docMapping: [0]
};

const embedCalls = [];
const getChunkEmbeddings = async (texts) => {
  embedCalls.push([...texts]);
  await wait(30);
  return texts.map((text) => [String(text).length]);
};

const textCacheStore = new Map();
const embeddingTextCache = {
  canCache: (text) => typeof text === 'string',
  get: (text) => textCacheStore.get(text) || null,
  set: (text, vector) => textCacheStore.set(text, vector),
  size: () => textCacheStore.size
};

const usage = [];
const processor = createFileEmbeddingsProcessor({
  embeddingBatchSize: 64,
  embeddingBatchTokenBudget: 4096,
  estimateEmbeddingTokens: (text) => Math.max(1, String(text || '').length),
  estimateEmbeddingTokensBatch: async (texts) => texts.map((text) => Math.max(1, String(text || '').length)),
  getChunkEmbeddings,
  runBatched,
  assertVectorArrays,
  scheduleCompute: (fn) => fn(),
  processFileEmbeddings: async () => {},
  mode: 'code',
  mergeCodeDocBatches: true,
  embeddingTextCache,
  embeddingInFlightCoalescer: createInFlightCoalescer(),
  onEmbeddingUsage: (entry) => usage.push(entry)
});

await Promise.all([
  processor(entryA),
  processor(entryB)
]);

assert.equal(embedCalls.length, 1, 'expected one embed call due in-flight coalescing across files');
assert.deepEqual(entryA.codeEmbeds, [[21]]);
assert.deepEqual(entryB.codeEmbeds, [[21]]);
assert.equal(usage.length, 2, 'expected usage callback for each file');
const hadJoin = usage.some((row) => Number(row.inFlightJoined || 0) > 0);
assert.equal(hadJoin, true, 'expected one file to join in-flight work from another file');

console.log('embeddings in-flight coalescing test passed');
