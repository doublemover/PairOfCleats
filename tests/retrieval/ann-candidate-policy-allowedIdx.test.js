#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ANN_CANDIDATE_POLICY_REASONS,
  resolveAnnCandidateSet
} from '../../src/retrieval/scoring/ann-candidate-policy.js';

const result = resolveAnnCandidateSet({
  candidates: new Set([10, 11]),
  allowedIds: new Set([1, 2, 3]),
  filtersActive: true,
  minDocCount: 100,
  maxDocCount: 20000
});

assert.equal(
  result.reason,
  ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX,
  'expected filtersActiveAllowedIdx reason when small candidate set and filters are active'
);
assert.deepEqual(
  Array.from(result.set || []).sort((a, b) => a - b),
  [1, 2, 3],
  'expected allowed index fallback candidate set'
);
assert.equal(result.explain.allowedSize, 3, 'expected explain.allowedSize');
assert.equal(result.explain.outputSize, 3, 'expected explain.outputSize');

console.log('ann candidate policy allowedIdx test passed');
