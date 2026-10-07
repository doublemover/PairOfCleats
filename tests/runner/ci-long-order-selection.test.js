#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNode } from '../helpers/run-node.js';
import { loadLaneManifestConfig, loadOrderedLaneManifest } from './lane-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tests', 'run.js');
const manifestConfig = await loadLaneManifestConfig({ root: ROOT });
const manifest = await loadOrderedLaneManifest({ root: ROOT, lane: 'ci-long', config: manifestConfig });
const expectedIds = Array.isArray(manifest?.tests)
  ? manifest.tests.map((entry) => entry.id)
  : [];

const result = runNode([runnerPath, '--lane', 'ci-long', '--list', '--json'], 'ci-long ordered lane list', ROOT, process.env, {
  stdio: 'pipe',
  allowFailure: true
});

assert.equal(result.status, 0, `expected ci-long list to succeed, got ${result.status}`);

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch (error) {
  assert.fail(`expected ci-long list JSON output, got parse error: ${error?.message || error}`);
}

const actualIds = Array.isArray(payload?.tests)
  ? payload.tests.map((test) => test.id)
  : [];
const nonLongSelected = Array.isArray(payload?.tests)
  ? payload.tests.filter((test) => !Array.isArray(test?.tags) || !test.tags.includes('long'))
  : [];
const longSelected = Array.isArray(payload?.tests)
  ? payload.tests.filter((test) => Array.isArray(test?.tags) && test.tags.includes('long'))
  : [];

assert.deepEqual(
  actualIds,
  expectedIds,
  'ci-long ordered lane should match ci-long.manifest.json exactly'
);
assert.equal(
  payload.tests[0]?.selectionSource,
  'ordered-manifest',
  'ci-long ordered selection should explain manifest-based selection'
);
assert.equal(
  payload.tests[0]?.selectionLane,
  'ci-long',
  'ci-long ordered selection should report the selected ordered lane'
);
assert(
  actualIds.length > 0,
  'ci-long selection should include ordered manifest entries'
);
assert(
  nonLongSelected.length > 0,
  'ci-long selection should include current non-long ordered entries'
);
for (const entry of longSelected) {
  assert.equal(
    entry?.presetStatus || '',
    '',
    'ci-long selection should not preset-skip long-tagged ordered entries'
  );
  assert.equal(
    entry?.skipReason || '',
    '',
    'ci-long selection should not carry an excluded-tag skip reason for ordered long entries'
  );
}

console.log('ci-long ordered selection test passed');
