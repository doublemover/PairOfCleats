#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveProvenance } from '../../../src/shared/provenance.js';

const assertThrows = (label, fn, message) => {
  try {
    fn();
  } catch (err) {
    assert.equal(err?.message, message, `${label} message`);
    return;
  }
  console.error(`${label} expected an error`);
  process.exit(1);
};

const now = () => '2026-02-03T00:00:00.000Z';

const merged = resolveProvenance({
  provenance: { indexSignature: 'abc123' },
  now
});
assert.equal(merged.indexSignature, 'abc123');
assert.equal(merged.generatedAt, '2026-02-03T00:00:00.000Z');
assert.deepEqual(merged.capsUsed, {});

const explicit = resolveProvenance({
  indexCompatKey: 'compat-1',
  capsUsed: { maxNodes: 50 },
  repo: 'repo',
  indexDir: 'index',
  now
});
assert.equal(explicit.indexCompatKey, 'compat-1');
assert.equal(explicit.generatedAt, '2026-02-03T00:00:00.000Z');
assert.deepEqual(explicit.capsUsed, { maxNodes: 50 });
assert.equal(explicit.repo, 'repo');
assert.equal(explicit.indexDir, 'index');

assertThrows(
  'missing provenance keys',
  () => resolveProvenance({ provenance: { generatedAt: 'now' } }),
  'Provenance must include indexSignature or indexCompatKey.'
);

assertThrows(
  'missing explicit keys',
  () => resolveProvenance({ label: 'GraphReport' }),
  'GraphReport requires indexSignature or indexCompatKey.'
);

console.log('provenance resolution ok');
