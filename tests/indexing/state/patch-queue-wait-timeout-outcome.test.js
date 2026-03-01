#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createPatchQueue,
  PATCH_QUEUE_WAIT_STATUS
} from '../../../src/index/build/build-state/patch-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-timeout-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

let applyCount = 0;
let resolveApply = null;
const applyDone = new Promise((resolve) => {
  resolveApply = resolve;
});

const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch) => {
    applyCount += 1;
    await sleep(60);
    resolveApply({ patch });
    return { ok: true, patch };
  },
  recordStateError: () => {},
  waiterTimeoutMs: 15
});

const outcome = await queue.queueStatePatch(buildRoot, { slow: true }, [], { flushNow: true });
assert.equal(outcome?.status, PATCH_QUEUE_WAIT_STATUS.TIMED_OUT, 'expected waiter timeout outcome');
assert.equal(outcome?.value, null, 'timed out outcome should not include flushed value');
assert.equal(outcome?.timeoutMs, 15, 'timed out outcome should include configured timeout');
assert.ok(Number.isFinite(outcome?.elapsedMs), 'timed out outcome should include elapsed duration');

const applied = await applyDone;
assert.equal(applyCount, 1, 'flush should complete once in the background after timeout');
assert.deepEqual(applied?.patch, { slow: true }, 'background flush should apply queued patch');

const flushOutcome = await queue.flushBuildState(buildRoot);
assert.equal(flushOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'explicit flush should resolve as flushed');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('patch queue wait timeout outcome test passed');
