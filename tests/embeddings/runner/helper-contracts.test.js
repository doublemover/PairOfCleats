#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createEmbeddingInFlightCoalescer,
  createEmbeddingTextReuseCache,
  resolveEmbeddingsBatchTokenBudget,
  resolveEmbeddingsSqliteDenseWriteBatchSize
} from '../../../tools/build/embeddings/runner.js';

assert.equal(
  resolveEmbeddingsBatchTokenBudget({
    indexingConfig: { embeddings: { maxBatchTokens: 8192 } },
    embeddingBatchSize: 16
  }),
  8192,
  'expected explicit maxBatchTokens to win'
);

assert.equal(
  resolveEmbeddingsBatchTokenBudget({
    indexingConfig: { embeddings: { maxBatchTokens: 0 } },
    embeddingBatchSize: 16
  }),
  0,
  'expected non-positive explicit maxBatchTokens to disable token budgeting'
);

assert.equal(
  resolveEmbeddingsBatchTokenBudget({
    indexingConfig: { embeddings: {} },
    embeddingBatchSize: 16
  }),
  4096,
  'expected derived token budget from default batchTokenMultiplier (256)'
);

assert.equal(
  resolveEmbeddingsBatchTokenBudget({
    indexingConfig: { embeddings: { batchTokenMultiplier: 64 } },
    embeddingBatchSize: 16
  }),
  1024,
  'expected batchTokenMultiplier override to affect derived token budget'
);

assert.equal(
  resolveEmbeddingsSqliteDenseWriteBatchSize({ embeddings: {} }),
  256,
  'expected sqlite dense write batch size default'
);

assert.equal(
  resolveEmbeddingsSqliteDenseWriteBatchSize({ embeddings: { sqliteDenseWriteBatchSize: 1024 } }),
  1024,
  'expected sqlite dense write batch size override'
);

const textCache = createEmbeddingTextReuseCache({
  maxEntries: 2,
  maxTextChars: 5
});

const vecA = new Uint8Array([1, 2, 3]);
const vecB = new Uint8Array([2, 3, 4]);
const vecC = new Uint8Array([3, 4, 5]);

assert.equal(textCache.canCache('short'), true, 'expected short text to be cacheable');
assert.equal(textCache.canCache('this-is-too-long'), false, 'expected long text to be rejected');

textCache.set('a', vecA);
textCache.set('b', vecB);
assert.equal(textCache.get('a'), vecA, 'expected cache hit for first vector');
textCache.set('c', vecC);
assert.equal(textCache.get('a'), vecA, 'expected recently-read entry to stay hot');
assert.equal(textCache.get('b'), null, 'expected least-recently-used entry to be evicted');

const inFlight = createEmbeddingInFlightCoalescer({ maxEntries: 2 });
const ownerA = inFlight.claim('shared-text');
assert.equal(ownerA.owner, true, 'expected first claim to own the work');
const joinA = inFlight.claim('shared-text');
assert.equal(joinA.owner, false, 'expected second claim to join the in-flight work');
ownerA.resolve?.(vecA);
assert.deepEqual(await joinA.promise, vecA, 'expected joined claim to resolve with owner result');

const ownerB = inFlight.claim('b');
const ownerC = inFlight.claim('c');
assert.equal(ownerB.owner, true, 'expected independent key to own work');
assert.equal(ownerC.owner, true, 'expected second independent key to own work');
const bypass = inFlight.claim('d');
assert.equal(bypass.owner, true, 'expected claim beyond cap to bypass coalescing');
assert.equal(bypass.promise, null, 'expected bypassed claim to return null promise');
ownerB.resolve?.(vecB);
ownerC.resolve?.(vecC);

const stats = inFlight.stats();
assert.equal(stats.joins >= 1, true, 'expected at least one coalesced join');
assert.equal(stats.claims >= 3, true, 'expected owner claims to be tracked');
assert.equal(stats.bypassed >= 1, true, 'expected bypass count when cap is reached');

console.log('embeddings runner helper contract test passed');
