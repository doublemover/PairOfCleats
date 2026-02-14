#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ANN_CANDIDATE_POLICY_REASONS,
  resolveAnnCandidateSet
} from '../../src/retrieval/scoring/ann-candidate-policy.js';

const allowedBitmap = {
  size: 1000000,
  has: (id) => id === 2 || id === 4 || id === 6
};

let allowedToSetCalls = 0;
const toSet = (value) => {
  if (!value) return null;
  if (value === allowedBitmap) {
    allowedToSetCalls += 1;
    return new Set([2, 4, 6]);
  }
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  if (typeof value[Symbol.iterator] === 'function') return new Set(value);
  return null;
};
const getSize = (value) => (value && Number.isFinite(value.size) ? Number(value.size) : null);
const hasId = (value, id) => Boolean(value && typeof value.has === 'function' && value.has(id));

const ok = resolveAnnCandidateSet({
  candidates: new Set([1, 2, 4, 8]),
  allowedIds: allowedBitmap,
  filtersActive: true,
  minDocCount: 1,
  maxDocCount: 20000,
  toSet,
  getSize,
  hasId
});

assert.equal(ok.reason, ANN_CANDIDATE_POLICY_REASONS.OK, 'expected constrained candidate path');
assert.equal(allowedToSetCalls, 0, 'allowedIds should not be materialized when fallback is not needed');
assert.deepEqual(
  Array.from(ok.set || []).sort((a, b) => a - b),
  [2, 4],
  'expected candidate filtering against allowedIds'
);

const fallback = resolveAnnCandidateSet({
  candidates: new Set([2]),
  allowedIds: allowedBitmap,
  filtersActive: true,
  minDocCount: 10,
  maxDocCount: 20000,
  toSet,
  getSize,
  hasId
});

assert.equal(
  fallback.reason,
  ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX,
  'expected allowed index fallback for undersized candidate sets'
);
assert.equal(allowedToSetCalls, 1, 'allowedIds should materialize only when fallback is required');
assert.deepEqual(
  Array.from(fallback.set || []).sort((a, b) => a - b),
  [2, 4, 6],
  'expected fallback to use full allowed index set'
);

console.log('ann candidate policy lazy materialization test passed');
