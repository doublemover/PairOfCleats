#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runBatched } from '../../../tools/build/embeddings/embed.js';

const texts = ['aaaa', 'bb', 'ccccc', 'd', 'eeee'];
const calls = [];
const batches = [];

const vectors = await runBatched({
  texts,
  batchSize: 4,
  maxBatchTokens: 6,
  estimateTokens: (text) => text.length,
  embed: async (batch) => {
    calls.push(batch);
    return batch.map((value) => [value.length]);
  },
  onBatch: (entry) => {
    batches.push(entry);
  }
});

assert.equal(vectors.length, texts.length);
assert.deepEqual(
  calls,
  [
    ['aaaa', 'bb'],
    ['ccccc', 'd'],
    ['eeee']
  ],
  'expected token-aware batching to split by token budget'
);
assert.equal(batches.length, 3);
assert.equal(batches[0].batchTokens, 6);
assert.equal(batches[1].batchTokens, 6);
assert.equal(batches[2].batchTokens, 4);
assert.equal(batches[2].completed, texts.length);

console.log('embedding batch token budget test passed');
