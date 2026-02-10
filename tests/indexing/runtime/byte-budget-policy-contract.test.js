#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  applyByteBudget,
  resolveByteBudget,
  resolveByteBudgetMap
} from '../../../src/index/build/byte-budget.js';

const resolved = resolveByteBudgetMap({
  indexingConfig: {},
  maxJsonBytes: 1024
});
assert.equal(resolved.strict, false);
assert.equal(resolved.policies.chunk_meta.maxBytes, 1024);
assert.equal(resolved.policies.vfs_manifest.overflow, 'fail');
assert.equal(resolved.policies.graph_relations.overflow, 'drop');

const override = resolveByteBudget({
  artifact: 'token_postings',
  maxJsonBytes: 2048,
  overrides: {
    token_postings: { maxBytes: 512, overflow: 'warn', strict: true }
  },
  strict: false
});
assert.equal(override.maxBytes, 512);
assert.equal(override.overflow, 'warn');
assert.equal(override.strict, true);

const warnings = [];
const info = applyByteBudget({
  budget: { artifact: 'repo_map', maxBytes: 100, overflow: 'warn', strict: false },
  totalBytes: 140,
  label: 'repo_map',
  logger: (line) => warnings.push(line)
});
assert.equal(info.overBytes, 40);
assert.equal(warnings.length, 1, 'expected warn overflow to log');

let threw = null;
try {
  applyByteBudget({
    budget: { artifact: 'vfs_manifest', maxBytes: 100, overflow: 'fail', strict: false },
    totalBytes: 140,
    label: 'vfs_manifest'
  });
} catch (err) {
  threw = err;
}
assert.ok(threw, 'expected fail overflow to throw');
assert.equal(threw.code, 'ERR_BYTE_BUDGET');

console.log('byte budget policy contract test passed');
