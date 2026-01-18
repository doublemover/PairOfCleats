#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyBranchFilter } from '../src/retrieval/cli/branch-filter.js';

let recorded = null;
const backendPolicy = { reason: 'auto', backendLabel: 'sqlite' };
const result = await applyBranchFilter({
  branchFilter: 'main',
  caseSensitive: false,
  repoBranch: 'dev',
  backendLabel: 'sqlite',
  backendPolicy,
  emitOutput: false,
  jsonOutput: true,
  recordSearchMetrics: (status) => {
    recorded = status;
  }
});

assert.equal(result.matched, false, 'expected branch mismatch to be reported');
assert.equal(recorded, 'ok', 'expected search metrics to be recorded');
assert.ok(result.payload, 'expected payload for branch mismatch');
assert.equal(result.payload.backend, 'sqlite');
assert.deepEqual(result.payload.prose, []);
assert.deepEqual(result.payload.code, []);
assert.deepEqual(result.payload.records, []);
assert.equal(result.payload.stats.branch, 'dev');
assert.equal(result.payload.stats.branchFilter, 'main');
assert.equal(result.payload.stats.branchMatch, false);
assert.deepEqual(result.payload.stats.backendPolicy, backendPolicy);

console.log('retrieval branch filter test passed');
