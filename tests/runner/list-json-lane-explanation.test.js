#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tests', 'run.js');
const env = applyTestEnv({ syncProcess: false });

const result = runNode([runnerPath, '--lane', 'ci-lite', '--list', '--json'], 'ci-lite list json lane explanation', ROOT, env, {
  stdio: 'pipe'
});

assert.equal(result.status, 0, `expected ci-lite list to succeed, got ${result.status}`);

const payload = JSON.parse(result.stdout || '{}');
const tests = Array.isArray(payload?.tests) ? payload.tests : [];
assert.ok(tests.length > 0, 'expected ci-lite test selection');

const manifestSelected = tests.find((entry) => entry.selectionSource === 'ordered-manifest');
assert.ok(manifestSelected, 'expected at least one manifest-selected test');
assert.equal(manifestSelected.selectionLane, 'ci-lite', 'expected ci-lite selection lane explanation');
assert.ok(
  typeof manifestSelected.suiteCategory === 'string' && manifestSelected.suiteCategory.length > 0,
  'expected suite-category metadata for manifest-selected test'
);
assert.ok(
  typeof manifestSelected.suiteCategoryReason === 'string' && manifestSelected.suiteCategoryReason.length > 0,
  'expected suite-category reason for manifest-selected test'
);
assert.ok(
  String(manifestSelected.selectionDetail || '').endsWith('tests/ci-lite/ci-lite.manifest.json'),
  `expected ci-lite manifest detail, got: ${String(manifestSelected.selectionDetail || '')}`
);
assert.ok(
  typeof manifestSelected.laneSource === 'string' && manifestSelected.laneSource.length > 0,
  'expected lane-source explanation for selected test'
);
assert.ok(
  payload?.suiteCategorySummary && typeof payload.suiteCategorySummary === 'object',
  'expected suite-category summary in list JSON payload'
);

console.log('list json lane explanation test passed');
