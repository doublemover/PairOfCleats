#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createPatchQueue,
  PATCH_QUEUE_WAIT_STATUS
} from '../../../src/index/build/build-state/patch-queue.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-required-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

let applyCount = 0;
const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch) => {
    applyCount += 1;
    await sleep(60);
    return { ok: true, patch };
  },
  recordStateError: () => {},
  waiterTimeoutMs: 15
});

const startedAtMs = Date.now();
const outcome = await queue.queueStatePatch(
  buildRoot,
  { requiredWrite: true },
  [],
  {
    flushNow: true,
    durabilityClass: BUILD_STATE_DURABILITY_CLASS.REQUIRED
  }
);
const elapsedMs = Date.now() - startedAtMs;

assert.equal(outcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'required durability should await flush completion');
assert.deepEqual(outcome?.value?.patch, { requiredWrite: true }, 'required durability flush should return applied patch');
assert.equal(applyCount, 1, 'expected a single apply invocation');
assert.ok(elapsedMs >= 40, `required durability should not short-circuit at waiter timeout (elapsed=${elapsedMs}ms)`);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('patch queue required durability waits for flush test passed');
