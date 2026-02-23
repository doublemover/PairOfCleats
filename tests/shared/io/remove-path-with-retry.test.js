#!/usr/bin/env node
import assert from 'node:assert/strict';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';

let busyAttempts = 0;
let busyPathExists = true;
const busyResult = await removePathWithRetry('virtual-busy-path', {
  attempts: 6,
  baseDelayMs: 1,
  maxDelayMs: 2,
  rm: async () => {
    busyAttempts += 1;
    if (busyAttempts < 3) {
      const error = new Error('busy');
      error.code = 'EBUSY';
      throw error;
    }
    busyPathExists = false;
  },
  exists: () => busyPathExists
});
assert.equal(busyResult.ok, true, 'expected retryable delete to eventually succeed');
assert.equal(busyAttempts, 3, 'expected retry loop to retry transient failures');

let nonRetryAttempts = 0;
const nonRetryResult = await removePathWithRetry('virtual-nonretry-path', {
  attempts: 6,
  baseDelayMs: 1,
  maxDelayMs: 2,
  rm: async () => {
    nonRetryAttempts += 1;
    const error = new Error('not retryable');
    error.code = 'EISDIR';
    throw error;
  },
  exists: () => true
});
assert.equal(nonRetryResult.ok, false, 'expected non-retryable delete to fail');
assert.equal(nonRetryAttempts, 1, 'expected non-retryable errors to fail fast');
assert.equal(nonRetryResult.error?.code, 'EISDIR', 'expected failure to expose source error code');

let goneChecks = 0;
const goneResult = await removePathWithRetry('virtual-gone-path', {
  attempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 2,
  rm: async () => {},
  exists: () => {
    goneChecks += 1;
    return false;
  }
});
assert.equal(goneResult.ok, true, 'expected helper to treat already-gone path as success');
assert.ok(goneChecks >= 1, 'expected existence check to run');

console.log('remove path with retry test passed');
