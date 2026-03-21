#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setProgressHandlers } from '../../../src/shared/progress.js';
import { startHeartbeat } from '../../../src/index/build/build-state/heartbeat.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-heartbeat-nonblocking-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

const calls = [];
const logs = [];
const restoreHandlers = setProgressHandlers({
  logLine(msg, meta) {
    logs.push({ msg, meta });
  }
});

try {
  const stop = startHeartbeat({
    buildRoot,
    stage: 'stage1',
    intervalMs: 10,
    updateBuildStateOutcome: async (_buildRoot, _patch, options) => {
      calls.push(options);
      return {
        status: 'flushed',
        value: null,
        queued: true,
        pendingLagMs: 50000,
        pendingSinceMs: 50000,
        pendingPatchBytes: 256,
        pendingWaiterCount: 0,
        coalescedPatches: 3,
        lastFlushDurationMs: 120
      };
    },
    flushBuildState: async () => ({ status: 'flushed', value: null }),
    buildRootExists: async () => true
  });

  await sleep(25);
  await stop();

  assert.equal(calls.length >= 1, true, 'expected heartbeat to enqueue at least one update');
  assert.equal(calls[0]?.waitForFlush, false, 'expected heartbeat writes to enqueue without waiting');
  const lagLog = logs.find((entry) => entry?.meta?.buildState?.event === 'heartbeat-write-lag');
  assert.ok(lagLog, 'expected heartbeat lag warning under queued lag telemetry');
  assert.match(String(lagLog?.msg || ''), /heartbeat durability lag/i);
} finally {
  restoreHandlers();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('build-state heartbeat nonblocking test passed');
