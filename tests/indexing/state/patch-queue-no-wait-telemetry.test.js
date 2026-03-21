#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-nowait-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

let applyCount = 0;
let releaseApply = null;
const applyBlocked = new Promise((resolve) => {
  releaseApply = resolve;
});

const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch) => {
    applyCount += 1;
    await applyBlocked;
    return { ok: true, patch };
  },
  recordStateError: () => {},
  waiterTimeoutMs: 25
});

const first = await queue.queueStatePatch(
  buildRoot,
  { heartbeat: { stage: 'stage1', lastHeartbeatAt: '2026-03-21T00:00:00.000Z' } },
  [],
  { waitForFlush: false }
);
assert.equal(first?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'expected no-wait enqueue outcome');
assert.equal(first?.queued, true, 'expected no-wait enqueue to report queued telemetry');
assert.equal(first?.pendingWaiterCount, 0, 'expected no waiter allocation for no-wait heartbeat');
assert.equal(first?.coalescedPatches, 0, 'expected first enqueue to start without coalescing');

const second = await queue.queueStatePatch(
  buildRoot,
  { heartbeat: { stage: 'stage1', lastHeartbeatAt: '2026-03-21T00:00:05.000Z' } },
  [],
  { waitForFlush: false }
);
assert.equal(second?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'expected second no-wait enqueue outcome');
assert.equal(second?.queued, true, 'expected second no-wait enqueue to report queued telemetry');
assert.equal(second?.pendingWaiterCount, 0, 'expected no waiter allocation after coalescing');
assert.equal(second?.coalescedPatches >= 1, true, 'expected second enqueue to coalesce over pending patch');
assert.equal(second?.pendingPatchBytes > 0, true, 'expected pending patch byte estimate');

releaseApply();

const flushed = await queue.flushBuildState(buildRoot);
assert.equal(flushed?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED, 'expected explicit flush to complete');
assert.equal(applyCount, 1, 'expected coalesced no-wait updates to flush once');
await sleep(20);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('patch queue no-wait telemetry test passed');
