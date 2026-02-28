#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';
import { getTrackedSubprocessCount, spawnSubprocess } from '../../../src/shared/subprocess.js';
import { sleep } from '../../../src/shared/sleep.js';

const childPromise = spawnSubprocess(
  process.execPath,
  ['-e', 'setInterval(() => {}, 10_000)'],
  {
    name: 'lsp-runtime-cleanup-contract-child',
    rejectOnNonZeroExit: false,
    timeoutMs: 60_000
  }
);
childPromise.catch(() => {});

await sleep(50);
assert.ok(
  getTrackedSubprocessCount() >= 1,
  'expected at least one tracked subprocess before cleanup'
);

await cleanupLspTestRuntime({ reason: 'lsp_runtime_cleanup_contract' });
await sleep(50);

assert.equal(
  getTrackedSubprocessCount(),
  0,
  'expected cleanupLspTestRuntime to reap tracked subprocesses'
);

await Promise.race([
  childPromise,
  sleep(2_000)
]);

console.log('lsp runtime cleanup reaps tracked subprocesses test passed');
