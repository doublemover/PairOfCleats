#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildCheckpointTracker } from '../../../src/index/build/build-state/progress.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const calls = [];
const tracker = createBuildCheckpointTracker({
  buildRoot: 'C:\\tmp\\build-state-progress-nonblocking',
  mode: 'code',
  totalFiles: 4,
  batchSize: 1,
  intervalMs: 60000,
  updateBuildStateOutcome: async (_buildRoot, _patch, options) => {
    calls.push(options);
    return options?.waitForFlush === false
      ? { status: 'flushed', value: null, queued: true, pendingLagMs: 1500 }
      : { status: 'flushed', value: { ok: true } };
  }
});

tracker.tick();
await sleep(0);
assert.equal(calls.length >= 1, true, 'expected tick-triggered progress enqueue');
assert.equal(calls[0]?.waitForFlush, false, 'expected non-forced progress writes to avoid flush waiting');

await tracker.finish();
assert.equal(calls.length >= 2, true, 'expected finish to force a final progress flush');
assert.equal(calls.at(-1)?.waitForFlush, true, 'expected finish to await the final flush');

console.log('build-state progress nonblocking test passed');
