#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runBinary } from '../../../src/experimental/structural/binaries.js';

const startedAt = Date.now();
const result = runBinary(
  { command: process.execPath, argsPrefix: [] },
  ['-e', 'setTimeout(() => process.exit(0), 5200);'],
  {
    stdio: 'ignore',
    encoding: 'utf8'
  }
);
const elapsedMs = Date.now() - startedAt;

assert.equal(result.status, 0, 'expected structural binary execution to complete without implicit 5s timeout');
assert.equal(result.error, undefined, 'expected no timeout error for structural binary default run');
assert.equal(elapsedMs >= 5000, true, `expected structural binary run to outlive default sync timeout (elapsed=${elapsedMs}ms)`);

console.log('structural binary default timeout test passed');
