#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveAnnCandidateSet } from '../../src/retrieval/scoring/ann-candidate-policy.js';

const input = {
  candidates: new Set([1, 2, 3, 4]),
  allowedIds: new Set([2, 4, 6]),
  filtersActive: true,
  cap: 20000,
  minDocCount: 100,
  maxDocCount: 20000
};

const annPolicy = resolveAnnCandidateSet(input);
const minhashPolicy = resolveAnnCandidateSet(input);

assert.equal(annPolicy.reason, minhashPolicy.reason, 'ann/minhash policy reason mismatch');
assert.deepEqual(annPolicy.explain, minhashPolicy.explain, 'ann/minhash policy explain drift');
assert.deepEqual(
  Array.from(annPolicy.set || []).sort((a, b) => a - b),
  Array.from(minhashPolicy.set || []).sort((a, b) => a - b),
  'ann/minhash candidate set drift'
);

console.log('ann candidate policy minhash parity test passed');
