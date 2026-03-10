#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { applyStatePatch } from '../../../src/index/build/build-state/store.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-lock-required-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

const lockPath = path.join(buildRoot, 'build_state.write.lock');
const heldLock = await acquireFileLock({
  lockPath,
  waitMs: 0,
  pollMs: 1,
  staleMs: 30000,
  timeoutBehavior: 'null',
  metadata: { scope: 'build-state-lock-required-test' }
});
assert.ok(heldLock, 'expected fixture lock to be acquired');

try {
  await assert.rejects(
    applyStatePatch(
      buildRoot,
      {
        heartbeat: {
          stage: 'test',
          lastHeartbeatAt: new Date().toISOString()
        }
      },
      [],
      { durabilityClass: BUILD_STATE_DURABILITY_CLASS.REQUIRED }
    ),
    (error) => {
      assert.equal(error?.code, 'ERR_BUILD_STATE_LOCK_UNAVAILABLE');
      assert.equal(error?.retryable, true);
      assert.equal(error?.buildState?.durabilityClass, BUILD_STATE_DURABILITY_CLASS.REQUIRED);
      return true;
    },
    'expected required applyStatePatch to surface retryable lock-unavailable error'
  );
} finally {
  await heldLock.release({ force: true });
}

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('build-state lock unavailable required test passed');
