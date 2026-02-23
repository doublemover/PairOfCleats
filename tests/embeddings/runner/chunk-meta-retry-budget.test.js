#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  parseChunkMetaTooLargeBytes,
  resolveChunkMetaRetryMaxBytes,
  resolveEmbeddingsChunkMetaRetryCeilingBytes
} from '../../../tools/build/embeddings/runner.js';

const parsed = parseChunkMetaTooLargeBytes({
  message: 'Binary-columnar data exceeds maxBytes (173305439 > 134217728)'
});
assert.deepEqual(
  parsed,
  { actualBytes: 173305439, maxBytes: 134217728 },
  'expected parser to extract actual/max bytes from maxBytes overflow message'
);

const retryBudget = resolveChunkMetaRetryMaxBytes({
  err: { message: 'Binary-columnar data exceeds maxBytes (173305439 > 134217728)' },
  currentMaxBytes: 134217728,
  retryCeilingBytes: 1073741824
});
assert.ok(Number.isFinite(retryBudget) && retryBudget > 134217728, 'expected adaptive retry budget above current');
assert.ok(retryBudget >= 173305439, 'expected retry budget to cover observed binary-columnar size');

assert.equal(
  resolveChunkMetaRetryMaxBytes({
    err: { message: 'other failure' },
    currentMaxBytes: 134217728,
    retryCeilingBytes: 1073741824
  }),
  null,
  'expected non-maxBytes errors to skip retry budget expansion'
);

assert.equal(
  resolveChunkMetaRetryMaxBytes({
    err: { message: 'Binary-columnar data exceeds maxBytes (173305439 > 134217728)' },
    currentMaxBytes: 536870912,
    retryCeilingBytes: 536870912
  }),
  null,
  'expected no retry when current budget already meets retry ceiling'
);

assert.equal(
  resolveEmbeddingsChunkMetaRetryCeilingBytes({ embeddings: { chunkMetaRetryCeilingBytes: 987654321 } }),
  987654321,
  'expected chunkMetaRetryCeilingBytes config override to be honored'
);

console.log('chunk_meta retry budget test passed');
