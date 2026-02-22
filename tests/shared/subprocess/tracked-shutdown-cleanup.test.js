#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  getTrackedSubprocessCount,
  registerChildProcessForCleanup,
  terminateTrackedSubprocesses
} from '../../../src/shared/subprocess.js';

const isAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

const childA = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
  stdio: 'ignore',
  detached: process.platform !== 'win32'
});
const childB = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
  stdio: 'ignore',
  detached: process.platform !== 'win32'
});

assert.ok(Number.isFinite(childA.pid) && childA.pid > 0, 'expected childA pid');
assert.ok(Number.isFinite(childB.pid) && childB.pid > 0, 'expected childB pid');

const unregisterA = registerChildProcessForCleanup(childA, {
  killTree: true,
  detached: process.platform !== 'win32',
  scope: 'scope-a'
});
const unregisterB = registerChildProcessForCleanup(childB, {
  killTree: true,
  detached: process.platform !== 'win32',
  scope: 'scope-b'
});

assert.equal(getTrackedSubprocessCount(), 2, 'expected both children to be tracked');
assert.equal(getTrackedSubprocessCount('scope-a'), 1, 'expected one child in scope-a');
assert.equal(getTrackedSubprocessCount('scope-b'), 1, 'expected one child in scope-b');

const scopedSummary = await terminateTrackedSubprocesses({ reason: 'test-scoped', force: true, scope: 'scope-a' });
assert.equal(scopedSummary.attempted, 1, 'expected scoped cleanup to target only one child');
assert.equal(scopedSummary.failures, 0, 'expected scoped cleanup to succeed');
assert.equal(scopedSummary.scope, 'scope-a', 'expected scoped cleanup summary to include scope');
assert.equal(getTrackedSubprocessCount(), 1, 'expected one tracked child to remain after scoped cleanup');
assert.equal(getTrackedSubprocessCount('scope-b'), 1, 'expected scope-b child to remain tracked');

const childATerminated = await waitFor(() => !isAlive(childA.pid), 5000);
assert.equal(childATerminated, true, 'expected scope-a child to be terminated by scoped cleanup');
assert.equal(isAlive(childB.pid), true, 'expected scope-b child to remain alive after scope-a cleanup');

const summary = await terminateTrackedSubprocesses({ reason: 'test', force: true });
assert.equal(summary.attempted, 1, 'expected remaining tracked child cleanup attempt');
assert.equal(summary.failures, 0, 'expected remaining tracked child cleanup to succeed');
assert.equal(getTrackedSubprocessCount(), 0, 'expected tracked child registry to be empty');

const childBTerminated = await waitFor(() => !isAlive(childB.pid), 5000);
assert.equal(childBTerminated, true, 'expected remaining child process to be terminated');

unregisterA();
unregisterB();
console.log('tracked subprocess shutdown cleanup test passed');
