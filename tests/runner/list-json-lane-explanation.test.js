#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const result = spawnSync(process.execPath, [runnerPath, '--lane', 'ci-lite', '--list', '--json'], {
  cwd: ROOT,
  encoding: 'utf8'
});

assert.equal(result.status, 0, `expected ci-lite list to succeed, got ${result.status}`);

const payload = JSON.parse(result.stdout || '{}');
const tests = Array.isArray(payload?.tests) ? payload.tests : [];
assert.ok(tests.length > 0, 'expected ci-lite test selection');

const manifestSelected = tests.find((entry) => entry.selectionSource === 'ordered-manifest');
assert.ok(manifestSelected, 'expected at least one manifest-selected test');
assert.equal(manifestSelected.selectionLane, 'ci-lite', 'expected ci-lite selection lane explanation');
assert.ok(
  String(manifestSelected.selectionDetail || '').endsWith('tests/ci-lite/ci-lite.manifest.json'),
  `expected ci-lite manifest detail, got: ${String(manifestSelected.selectionDetail || '')}`
);
assert.ok(
  typeof manifestSelected.laneSource === 'string' && manifestSelected.laneSource.length > 0,
  'expected lane-source explanation for selected test'
);

console.log('list json lane explanation test passed');
