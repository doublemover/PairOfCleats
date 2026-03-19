#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tests', 'run.js');
const orderPath = path.join(ROOT, 'tests', 'ci-long', 'ci-long.order.txt');

const expectedIds = fs.readFileSync(orderPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const result = spawnSync(process.execPath, [runnerPath, '--lane', 'ci-long', '--list', '--json'], {
  cwd: ROOT,
  encoding: 'utf8'
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

assert.deepEqual(
  actualIds,
  expectedIds,
  'ci-long ordered lane should match ci-long.order.txt exactly'
);
assert(
  actualIds.includes('indexing/imports/replay-perf-budget'),
  'ci-long selection should include current non-long ordered entries'
);
assert(
  nonLongSelected.length > 50,
  'ci-long selection should not collapse to only long-tagged tests'
);

console.log('ci-long ordered selection test passed');
