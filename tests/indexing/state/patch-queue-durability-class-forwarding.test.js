#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-durability-'));
const buildRootA = path.join(tempRoot, 'build-a');
const buildRootB = path.join(tempRoot, 'build-b');
await fs.mkdir(buildRootA, { recursive: true });
await fs.mkdir(buildRootB, { recursive: true });

const observedA = [];
const queueA = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch, _events, context) => {
    observedA.push({
      patch,
      durabilityClass: context?.durabilityClass || null
    });
    return { ok: true, patch };
  },
  recordStateError: () => {},
  waiterTimeoutMs: 1000
});

const bestEffortOutcome = await queueA.queueStatePatch(
  buildRootA,
  { bestEffort: true },
  [],
  {
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
    flushNow: true
  }
);
assert.equal(bestEffortOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'expected best-effort patch to flush');
assert.equal(observedA.length, 1, 'expected one apply for best-effort case');
assert.equal(
  observedA[0]?.durabilityClass,
  BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
  'expected best-effort durability class forwarded to applyStatePatch'
);

const observedB = [];
const queueB = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch, _events, context) => {
    observedB.push({
      patch,
      durabilityClass: context?.durabilityClass || null
    });
    return { ok: true, patch };
  },
  recordStateError: () => {},
  waiterTimeoutMs: 1000
});

const first = queueB.queueStatePatch(
  buildRootB,
  { first: true },
  [],
  {
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
    flushNow: false
  }
);
const second = queueB.queueStatePatch(
  buildRootB,
  { second: true },
  [],
  {
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.REQUIRED,
    flushNow: false
  }
);
const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
assert.equal(firstOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'first waiter should flush after required escalation');
assert.equal(secondOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'required waiter should flush');
assert.equal(observedB.length, 1, 'expected one merged apply for escalated case');
assert.deepEqual(observedB[0]?.patch, { first: true, second: true }, 'expected merged patch payload');
assert.equal(
  observedB[0]?.durabilityClass,
  BUILD_STATE_DURABILITY_CLASS.REQUIRED,
  'expected pending patch durability to escalate to required'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('patch queue durability class forwarding test passed');
