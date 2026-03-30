#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { destroyWorkerPoolLifecycleWithTimeout } from '../../../src/index/build/workers/pool.js';

applyTestEnv();

const messages = [];
const result = await destroyWorkerPoolLifecycleWithTimeout({
  poolLabel: 'destroy-timeout-contract',
  timeoutMs: 20,
  log: (line) => messages.push(String(line || '')),
  lifecycle: {
    async destroy() {
      await new Promise(() => {});
    }
  }
});

assert.equal(result.skipped, false, 'expected worker-pool destroy helper to run cleanup');
assert.equal(result.timedOut, true, 'expected worker-pool destroy helper to fail open on timeout');
assert.ok(messages.some((line) => line.includes('worker-pool.destroy-timeout-contract.lifecycle-destroy timed out')), 'expected timeout log to include pool label');

console.log('worker pool destroy timeout test passed');
