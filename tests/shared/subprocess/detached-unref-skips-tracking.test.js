#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getTrackedSubprocessCount, spawnSubprocess } from '../../../src/shared/subprocess.js';

let trackedAtSpawn = -1;
let timedOut = false;
try {
  await spawnSubprocess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000);'],
    {
      detached: true,
      unref: true,
      timeoutMs: 50,
      stdio: ['ignore', 'ignore', 'ignore'],
      captureStdout: false,
      captureStderr: false,
      rejectOnNonZeroExit: false,
      onSpawn: () => {
        trackedAtSpawn = getTrackedSubprocessCount();
      }
    }
  );
} catch (error) {
  timedOut = error?.code === 'SUBPROCESS_TIMEOUT';
}

assert.equal(timedOut, true, 'expected detached subprocess timeout for bounded test completion');
assert.equal(trackedAtSpawn, 0, 'expected detached+unref subprocess not to be parent-exit tracked');
assert.equal(getTrackedSubprocessCount(), 0, 'expected no tracked subprocesses after completion');

console.log('detached unref subprocess tracking opt-out test passed');
