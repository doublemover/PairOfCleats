#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ANN_CANDIDATE_POLICY_REASONS,
  ANN_CANDIDATE_POLICY_SCHEMA_VERSION,
  resolveAnnCandidateSet
} from '../../src/retrieval/scoring/ann-candidate-policy.js';

const result = resolveAnnCandidateSet({
  candidates: new Set([1, 2, 3, 4, 5]),
  filtersActive: true,
  allowedIds: new Set([2, 4, 6, 8]),
  cap: 20,
  minDocCount: 2,
  maxDocCount: 10
});

assert.ok(result && typeof result === 'object', 'expected object result');
assert.ok(
  Object.values(ANN_CANDIDATE_POLICY_REASONS).includes(result.reason),
  'reason must be one of the contract reason codes'
);
assert.ok(result.explain && typeof result.explain === 'object', 'expected explain payload');
assert.equal(
  result.explain.schemaVersion,
  ANN_CANDIDATE_POLICY_SCHEMA_VERSION,
  'unexpected ann candidate policy schema version'
);
assert.equal(typeof result.explain.inputSize, 'number', 'expected numeric explain.inputSize');
assert.equal(typeof result.explain.candidateSize, 'number', 'expected numeric explain.candidateSize');
assert.ok(
  result.explain.outputMode === 'constrained' || result.explain.outputMode === 'full',
  'outputMode contract drift'
);
assert.equal(typeof result.explain.reason, 'string', 'expected explain.reason');
assert.equal(typeof result.explain.filtersActive, 'boolean', 'expected explain.filtersActive');

console.log('ann candidate policy contract test passed');
