#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  RUN_CONFIG_KEYS,
  resolveRunConfig
} from '../../../src/retrieval/cli/resolve-run-config.js';

const buildNormalizedConfig = () => {
  const normalized = {};
  for (const [index, key] of RUN_CONFIG_KEYS.entries()) {
    if (key === 'scoreMode') continue;
    normalized[key] = `${key}:${index}`;
  }
  normalized.annEnabled = false;
  normalized.scoreBlendEnabled = false;
  normalized.scoreBlendSparseWeight = 0.25;
  normalized.scoreBlendAnnWeight = 0.75;
  normalized.rrfEnabled = true;
  return normalized;
};

const normalized = buildNormalizedConfig();
const resolved = resolveRunConfig({ normalized, scoreModeOverride: null });

assert.deepEqual(Object.keys(resolved), RUN_CONFIG_KEYS);
for (const key of RUN_CONFIG_KEYS) {
  if (key === 'scoreMode') continue;
  assert.equal(resolved[key], normalized[key], `expected ${key} to pass through`);
}
assert.equal(resolved.scoreMode, null);

const dense = resolveRunConfig({ normalized, scoreModeOverride: 'dense' });
assert.equal(dense.scoreMode, 'dense');
assert.equal(dense.annEnabled, true);
assert.equal(dense.scoreBlendEnabled, true);
assert.equal(dense.scoreBlendSparseWeight, 0);
assert.equal(dense.scoreBlendAnnWeight, 1);
assert.equal(dense.rrfEnabled, false);

const hybrid = resolveRunConfig({ normalized, scoreModeOverride: 'hybrid' });
assert.equal(hybrid.scoreMode, 'hybrid');
assert.equal(hybrid.annEnabled, true);
assert.equal(hybrid.scoreBlendEnabled, true);
assert.equal(hybrid.scoreBlendSparseWeight, 0.5);
assert.equal(hybrid.scoreBlendAnnWeight, 0.5);
assert.equal(hybrid.rrfEnabled, false);

const sparse = resolveRunConfig({ normalized, scoreModeOverride: 'sparse' });
assert.equal(sparse.scoreMode, 'sparse');
assert.equal(sparse.annEnabled, false);
assert.equal(sparse.scoreBlendEnabled, false);
assert.equal(sparse.scoreBlendSparseWeight, normalized.scoreBlendSparseWeight);
assert.equal(sparse.scoreBlendAnnWeight, normalized.scoreBlendAnnWeight);
assert.equal(sparse.rrfEnabled, false);

assert.throws(
  () => resolveRunConfig({ normalized, scoreModeOverride: 'invalid' }),
  /Invalid score mode "invalid"/
);

console.log('retrieval run config contract test passed');
