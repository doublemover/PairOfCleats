#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const runner = path.join(root, 'tests', 'run.js');

const listResult = spawnSync(process.execPath, [runner, '--list', '--json', '--lane', 'unit'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(listResult.status, 0, `expected --list to succeed, got ${listResult.status}`);
const payload = JSON.parse(listResult.stdout.trim() || '{}');
assert(Array.isArray(payload.tests), 'expected JSON list to include tests');
const ids = payload.tests.map((test) => test.id);
assert(ids.includes('test-runner'), 'expected test-runner in unit lane list');
assert(!ids.includes('run'), 'runner entrypoint should be excluded from discovery');

const matchResult = spawnSync(process.execPath, [runner, '--list', '--match', 'test-runner'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(matchResult.status, 0, `expected --match list to succeed, got ${matchResult.status}`);
const lines = matchResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
assert(lines.includes('test-runner'), 'expected match list to include test-runner');

const badLane = spawnSync(process.execPath, [runner, '--lane', 'nope'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(badLane.status, 2, `expected unknown lane to exit 2, got ${badLane.status}`);

const emptyMatch = spawnSync(process.execPath, [runner, '--list', '--match', 'does-not-exist'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(emptyMatch.status, 2, `expected empty selection to exit 2, got ${emptyMatch.status}`);

console.log('test runner smoke test passed');
