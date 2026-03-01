#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-lock-retry-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

let applyCount = 0;
const applied = [];
const observedErrors = [];
const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch, events, context) => {
    applyCount += 1;
    if (applyCount <= 2) {
      const err = new Error('synthetic lock unavailable');
      err.code = 'ERR_BUILD_STATE_LOCK_UNAVAILABLE';
      err.retryable = true;
      err.buildState = { retryable: true, reason: 'lock-unavailable' };
      throw err;
    }
    applied.push({
      patch,
      events,
      durabilityClass: context?.durabilityClass || null
    });
    return { ok: true };
  },
  recordStateError: (_buildRoot, err) => {
    observedErrors.push(err?.code || err?.message || String(err));
  },
  waiterTimeoutMs: 1000
});

const firstOutcome = await queue.queueStatePatch(
  buildRoot,
  { first: true },
  [{ type: 'first' }],
  {
    flushNow: true,
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
  }
);
assert.equal(
  firstOutcome?.status,
  PATCH_QUEUE_WAIT_STATUS.TIMED_OUT,
  'best-effort lock contention should resolve as timed_out and retry in background'
);

const deferredFlushOutcome = await queue.flushBuildState(buildRoot);
assert.equal(
  deferredFlushOutcome?.status,
  PATCH_QUEUE_WAIT_STATUS.TIMED_OUT,
  'explicit flush should report timed_out while deferred patch remains queued'
);

const secondOutcome = await queue.queueStatePatch(
  buildRoot,
  { second: true },
  [{ type: 'second' }],
  {
    flushNow: true,
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
  }
);
assert.equal(secondOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'follow-up flush should succeed');

await queue.flushBuildState(buildRoot);

assert.equal(applyCount, 3, 'expected two deferred lock-unavailable attempts followed by one success');
assert.equal(applied.length, 1, 'expected one successful apply');
assert.deepEqual(
  applied[0]?.patch,
  { first: true, second: true },
  'expected deferred patch to be merged into subsequent flush'
);
assert.deepEqual(
  (applied[0]?.events || []).map((event) => event?.type),
  ['first', 'second'],
  'expected deferred events to remain in order'
);
assert.equal(
  applied[0]?.durabilityClass,
  BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
  'expected durability class forwarding to remain best-effort'
);
assert.deepEqual(
  observedErrors,
  [],
  'retryable lock-unavailable should not be recorded as a hard state error'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('patch queue lock-unavailable best-effort retry test passed');
