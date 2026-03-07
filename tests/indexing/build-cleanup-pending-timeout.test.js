#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../helpers/test-env.js';
import {
  __getPendingBuildCleanupOperationCountForTests,
  runBuildCleanupWithTimeout
} from '../../src/index/build/cleanup-timeout.js';

ensureTestingEnv(process.env);

const pendingBefore = __getPendingBuildCleanupOperationCountForTests();
const result = await runBuildCleanupWithTimeout({
  label: 'build-cleanup-pending-timeout',
  timeoutMs: 10,
  cleanup: async () => new Promise(() => {}),
  swallowTimeout: true
});

assert.equal(result.skipped, false, 'expected cleanup timeout test to execute cleanup');
assert.equal(result.timedOut, true, 'expected hung cleanup to time out');
assert.equal(result.pending, true, 'expected timed out cleanup to remain tracked as pending');
assert.equal(
  __getPendingBuildCleanupOperationCountForTests(),
  pendingBefore + 1,
  'expected pending cleanup tracker to retain the timed-out cleanup operation'
);

console.log('build cleanup pending timeout test passed');
