#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-lock-mixed-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

let applyCount = 0;
const observedErrors = [];
const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch, events, context) => {
    applyCount += 1;
    if (applyCount === 1) {
      const err = new Error('synthetic lock unavailable');
      err.code = 'ERR_BUILD_STATE_LOCK_UNAVAILABLE';
      err.retryable = true;
      err.buildState = {
        retryable: true,
        reason: 'lock-unavailable',
        durabilityClass: context?.durabilityClass || null
      };
      throw err;
    }
    return { patch, events, durabilityClass: context?.durabilityClass || null };
  },
  recordStateError: (_buildRoot, error) => {
    observedErrors.push(error?.code || error?.message || String(error));
  }
});

const bestEffortWait = queue.queueStatePatch(
  buildRoot,
  { bestEffort: true },
  [{ type: 'best-effort' }],
  {
    flushNow: false,
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
  }
);

const requiredWait = queue.queueStatePatch(
  buildRoot,
  { required: true },
  [{ type: 'required' }],
  {
    flushNow: true,
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.REQUIRED
  }
).then(
  () => null,
  (error) => error
);

const [bestEffortOutcome, requiredError] = await Promise.all([
  bestEffortWait,
  requiredWait
]);

assert.equal(
  bestEffortOutcome?.status,
  PATCH_QUEUE_WAIT_STATUS.TIMED_OUT,
  'expected best-effort waiter to resolve timed_out during mixed-durability lock contention'
);
assert.equal(requiredError?.code, 'ERR_BUILD_STATE_LOCK_UNAVAILABLE');
assert.deepEqual(
  observedErrors,
  [],
  'expected lock-unavailable contention to stay out of hard state error recording for mixed durability'
);

const flushOutcome = await queue.flushBuildState(buildRoot);
assert.equal(flushOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
assert.equal(applyCount, 2, 'expected one failed mixed-durability attempt and one successful retry');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('patch queue mixed-durability lock-unavailable test passed');
