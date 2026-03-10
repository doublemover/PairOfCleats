#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-lock-owner-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

const originalWrite = process.stderr.write.bind(process.stderr);
const observedLogs = [];
process.stderr.write = ((chunk, encoding, callback) => {
  observedLogs.push(String(chunk));
  if (typeof callback === 'function') callback();
  return true;
});

let applyCount = 0;
const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async () => {
    applyCount += 1;
    if (applyCount === 1) {
      return {
        ok: false,
        deferred: true,
        retryable: true,
        code: 'ERR_BUILD_STATE_LOCK_UNAVAILABLE',
        lockOwner: {
          pid: 4242,
          lockId: 'holder-123',
          scope: 'build-state-write',
          startedAt: '2026-03-10T00:00:00.000Z'
        },
        buildState: {
          retryable: true,
          reason: 'lock-unavailable',
          durabilityClass: 'best_effort',
          lockOwner: {
            pid: 4242,
            lockId: 'holder-123',
            scope: 'build-state-write',
            startedAt: '2026-03-10T00:00:00.000Z'
          }
        }
      };
    }
    return { ok: true };
  },
  recordStateError: () => {}
});

try {
  const outcome = await queue.queueStatePatch(
    buildRoot,
    { heartbeat: true },
    [{ type: 'heartbeat' }],
    {
      flushNow: true,
      durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
    }
  );
  assert.equal(outcome?.status, PATCH_QUEUE_WAIT_STATUS.TIMED_OUT);
  assert.match(
    observedLogs.join('\n'),
    /owner: pid=4242, lockId=holder-123, scope=build-state-write, startedAt=2026-03-10T00:00:00.000Z/,
    'expected build-state retry log to include current lock owner attribution'
  );
} finally {
  process.stderr.write = originalWrite;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('patch queue lock-unavailable owner attribution test passed');
