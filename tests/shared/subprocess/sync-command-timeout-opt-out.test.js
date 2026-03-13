#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runSyncCommandWithTimeout } from '../../../src/shared/subprocess.js';

const startedAt = Date.now();
const result = runSyncCommandWithTimeout(
  process.execPath,
  ['-e', 'setTimeout(() => process.exit(0), 5200);'],
  {
    timeoutMs: null,
    stdio: 'ignore',
    encoding: 'utf8'
  }
);
const elapsedMs = Date.now() - startedAt;

assert.equal(result.status, 0, 'expected sync command to complete normally when timeout is disabled');
assert.equal(result.error, undefined, 'expected no timeout/spawn error when timeout is disabled');
assert.equal(elapsedMs >= 5000, true, `expected disabled timeout to allow long command to finish (elapsed=${elapsedMs}ms)`);

console.log('sync command timeout opt-out test passed');
