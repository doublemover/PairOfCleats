#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  resolveProcessCleanupTimeoutMs,
  runCleanupWithTimeout
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const defaultTimeoutMs = resolveProcessCleanupTimeoutMs({ stage1Queues: { watchdog: {} } });
assert.equal(defaultTimeoutMs, 30000, 'expected default process cleanup timeout');

const configuredTimeoutMs = resolveProcessCleanupTimeoutMs({
  stage1Queues: {
    watchdog: {
      cleanupTimeoutMs: 4321
    }
  }
});
assert.equal(configuredTimeoutMs, 4321, 'expected configured process cleanup timeout to be honored');

const disabledTimeoutMs = resolveProcessCleanupTimeoutMs({
  stage1Queues: {
    watchdog: {
      cleanupTimeoutMs: 0
    }
  }
});
assert.equal(disabledTimeoutMs, 0, 'expected cleanup timeout to allow explicit disable');

const timeoutLogs = [];
const timedOut = await runCleanupWithTimeout({
  label: 'unit-timeout',
  timeoutMs: 25,
  cleanup: () => new Promise((resolve) => {
    setTimeout(resolve, 500);
  }),
  log: (line) => timeoutLogs.push(String(line))
});
assert.equal(timedOut.timedOut, true, 'expected never-resolving cleanup to time out');
assert.ok(
  timeoutLogs.some((line) => line.includes('unit-timeout timed out')),
  'expected timeout cleanup log line'
);

let fastCleanupCalled = false;
const completed = await runCleanupWithTimeout({
  label: 'unit-fast',
  timeoutMs: 500,
  cleanup: async () => {
    fastCleanupCalled = true;
  }
});
assert.equal(fastCleanupCalled, true, 'expected cleanup function to run');
assert.equal(completed.timedOut, false, 'expected fast cleanup to complete before timeout');

console.log('process files cleanup timeout test passed');
