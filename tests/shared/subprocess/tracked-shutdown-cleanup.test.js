#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  getTrackedSubprocessCount,
  registerChildProcessForCleanup,
  terminateTrackedSubprocesses
} from '../../../src/shared/subprocess.js';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
  stdio: 'ignore',
  detached: process.platform !== 'win32'
});

assert.ok(Number.isFinite(child.pid) && child.pid > 0, 'expected spawned child pid');

const unregister = registerChildProcessForCleanup(child, {
  killTree: true,
  detached: process.platform !== 'win32'
});

assert.equal(getTrackedSubprocessCount(), 1, 'expected tracked child registration');

const summary = await terminateTrackedSubprocesses({ reason: 'test', force: true });
assert.equal(summary.attempted, 1, 'expected one tracked child cleanup attempt');
assert.equal(summary.failures, 0, 'expected tracked child cleanup to succeed');
assert.equal(getTrackedSubprocessCount(), 0, 'expected tracked child registry to be empty');

await new Promise((resolve) => setTimeout(resolve, 200));
try {
  process.kill(child.pid, 0);
  assert.fail('expected tracked child process to be terminated');
} catch (error) {
  assert.notEqual(error?.code, 'EPERM', 'expected tracked child process to be terminated');
}

unregister();
console.log('tracked subprocess shutdown cleanup test passed');
