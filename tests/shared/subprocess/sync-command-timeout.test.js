#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isSyncCommandTimedOut,
  runSyncCommandWithTimeout,
  toSyncCommandExitCode
} from '../../../src/shared/subprocess.js';

const startedAt = Date.now();
const result = runSyncCommandWithTimeout(
  process.execPath,
  ['-e', 'setInterval(() => {}, 1000);'],
  {
    timeoutMs: 100,
    stdio: 'ignore',
    encoding: 'utf8'
  }
);
const elapsedMs = Date.now() - startedAt;

assert.equal(isSyncCommandTimedOut(result), true, 'expected sync command timeout classification');
assert.equal(toSyncCommandExitCode(result), null, 'expected null exit code for timed out sync command');
assert.equal(elapsedMs >= 90, true, `expected timeout guard to wait for configured timeout (elapsed=${elapsedMs}ms)`);
assert.equal(elapsedMs < 2000, true, `expected timeout guard to avoid long hangs (elapsed=${elapsedMs}ms)`);

console.log('sync command timeout guard test passed');
