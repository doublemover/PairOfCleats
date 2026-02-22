#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runNativeFeasibilityParityHarness } from '../../../src/shared/native-accel.js';

ensureTestingEnv(process.env);

const baseline = { hits: [{ id: 'a', score: 1.0 }], meta: { topK: 1 } };
const same = runNativeFeasibilityParityHarness({
  label: 'parity-equal',
  baseline,
  candidate: { hits: [{ id: 'a', score: 1.0 }], meta: { topK: 1 } }
});
const different = runNativeFeasibilityParityHarness({
  label: 'parity-different',
  baseline,
  candidate: { hits: [{ id: 'b', score: 1.0 }], meta: { topK: 1 } }
});

assert.equal(same.equivalent, true);
assert.equal(same.mismatchCount, 0);
assert.equal(different.equivalent, false);
assert.equal(different.mismatchCount, 1);
assert.equal(different.mismatches[0]?.reason, 'stable-json-mismatch');

console.log('native feasibility parity harness test passed');
