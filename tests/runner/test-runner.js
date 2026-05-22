#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { runNode } from '../helpers/run-node.js';

const root = process.cwd();
const runner = path.join(root, 'tests', 'run.js');
const smokeTarget = 'runner/harness/skip-target';

const listResult = runNode([runner, '--list', '--json', '--lane', 'unit'], 'runner unit list JSON', root, process.env, {
  stdio: 'pipe',
  allowFailure: true
});
assert.equal(listResult.status, 0, `expected --list to succeed, got ${listResult.status}`);
const payload = JSON.parse(listResult.stdout.trim() || '{}');
assert(Array.isArray(payload.tests), 'expected JSON list to include tests');
const ids = payload.tests.map((test) => test.id);
assert(ids.includes(smokeTarget), 'expected runner harness smoke target in unit lane list');
assert(!ids.includes('run'), 'runner entrypoint should be excluded from discovery');
const selfEntry = payload.tests.find((test) => test.id === smokeTarget);
assert.equal(selfEntry?.suiteCategory, 'meta', 'expected runner smoke test to be classified as meta');

const matchResult = runNode([runner, '--list', '--lane', 'unit', '--match', 'skip-target'], 'runner skip-target list', root, process.env, {
  stdio: 'pipe',
  allowFailure: true
});
assert.equal(matchResult.status, 0, `expected --match list to succeed, got ${matchResult.status}`);
const lines = matchResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
assert(lines.includes(smokeTarget), 'expected match list to include runner harness target');

const badLane = runNode([runner, '--lane', 'nope'], 'runner bad lane failure', root, process.env, {
  stdio: 'pipe',
  allowFailure: true
});
assert.equal(badLane.status, 2, `expected unknown lane to exit 2, got ${badLane.status}`);

const emptyMatch = runNode([runner, '--list', '--match', 'does-not-exist'], 'runner empty match failure', root, process.env, {
  stdio: 'pipe',
  allowFailure: true
});
assert.equal(emptyMatch.status, 2, `expected empty selection to exit 2, got ${emptyMatch.status}`);

console.log('test runner smoke test passed');
