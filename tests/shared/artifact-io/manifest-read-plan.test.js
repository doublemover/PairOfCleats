#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  loadPiecesManifestWithReadPlan,
  resolvePiecesManifestReadPlan
} from '../../../src/shared/artifact-io.js';

const strictPlan = resolvePiecesManifestReadPlan({ strict: true });
assert.deepEqual(strictPlan.attempts, [0, 25, 50], 'expected strict plan to include retry delays');
assert.deepEqual(strictPlan.retryableCodes, ['ERR_MANIFEST_MISSING'], 'expected strict plan retryable codes');

const nonStrictPlan = resolvePiecesManifestReadPlan({ strict: false });
assert.deepEqual(nonStrictPlan.attempts, [0], 'expected non-strict plan to make a single attempt');

let attempts = 0;
const slept = [];
const manifest = await loadPiecesManifestWithReadPlan('ignored', {
  strict: true,
  sleep: async (ms) => {
    slept.push(ms);
  },
  readManifest: () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('missing');
      error.code = 'ERR_MANIFEST_MISSING';
      throw error;
    }
    return { pieces: [{ path: 'token_postings.json' }] };
  }
});
assert.equal(attempts, 3, 'expected strict manifest plan to retry missing manifests');
assert.deepEqual(slept, [25, 50], 'expected retry delays to follow the manifest read plan');
assert.equal(manifest?.pieces?.length, 1, 'expected successful retry to return the manifest payload');

let nonRetryAttempts = 0;
await assert.rejects(
  loadPiecesManifestWithReadPlan('ignored', {
    strict: true,
    readManifest: () => {
      nonRetryAttempts += 1;
      const error = new Error('invalid');
      error.code = 'ERR_MANIFEST_INVALID';
      throw error;
    }
  }),
  /invalid/,
  'expected non-retryable manifest errors to fail fast'
);
assert.equal(nonRetryAttempts, 1, 'expected non-retryable manifest errors to avoid retries');

console.log('shared manifest read plan test passed');
