#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import {
  applyStatePatch,
  isBuildStateLockUnavailableResult
} from '../../../src/index/build/build-state/store.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-lock-unavailable-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

const lockPath = path.join(buildRoot, 'build_state.write.lock');
const heldLock = await acquireFileLock({
  lockPath,
  waitMs: 0,
  pollMs: 1,
  staleMs: 30000,
  timeoutBehavior: 'null',
  metadata: { scope: 'build-state-lock-unavailable-test' }
});
assert.ok(heldLock, 'expected fixture lock to be acquired');

try {
  const result = await applyStatePatch(
    buildRoot,
    {
      heartbeat: {
        stage: 'test',
        lastHeartbeatAt: new Date().toISOString()
      }
    },
    [],
    { durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT }
  );
  assert.equal(isBuildStateLockUnavailableResult(result), true);
  assert.equal(result?.code, 'ERR_BUILD_STATE_LOCK_UNAVAILABLE');
  assert.equal(result?.retryable, true);
  assert.equal(result?.buildState?.retryable, true);
  assert.equal(result?.buildState?.reason, 'lock-unavailable');
} finally {
  await heldLock.release({ force: true });
}

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('build-state lock unavailable retryable test passed');
