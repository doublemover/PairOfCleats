#!/usr/bin/env node
import assert from 'node:assert/strict';
import { canRunAnnQuery, isCandidateSetEmpty, isEmbeddingReady } from '../../../src/retrieval/ann/utils.js';

assert.equal(isEmbeddingReady([0.1]), true);
assert.equal(isEmbeddingReady(new Float32Array([0.1, 0.2])), true);
assert.equal(isEmbeddingReady([]), false);
assert.equal(isEmbeddingReady(null), false);

assert.equal(isCandidateSetEmpty(null), false);
assert.equal(isCandidateSetEmpty(new Set()), true);
assert.equal(isCandidateSetEmpty(new Set([1])), false);
assert.equal(isCandidateSetEmpty({ size: () => 0 }), true);
assert.equal(isCandidateSetEmpty({ size: () => 2 }), false);
assert.equal(isCandidateSetEmpty({ getSize: () => 0 }), true);
assert.equal(isCandidateSetEmpty([]), true);
assert.equal(isCandidateSetEmpty([1]), false);

const embedding = [0.1, 0.2];
assert.equal(
  canRunAnnQuery({ signal: null, embedding, candidateSet: null, backendReady: true, enabled: true }),
  true
);
assert.equal(
  canRunAnnQuery({ signal: { aborted: true }, embedding, candidateSet: null, backendReady: true, enabled: true }),
  false
);
assert.equal(
  canRunAnnQuery({ signal: null, embedding, candidateSet: new Set(), backendReady: true, enabled: true }),
  false
);
assert.equal(
  canRunAnnQuery({ signal: null, embedding, candidateSet: null, backendReady: false, enabled: true }),
  false
);
assert.equal(
  canRunAnnQuery({ signal: null, embedding, candidateSet: null, backendReady: true, enabled: false }),
  false
);

console.log('ann candidate set contract test passed');
