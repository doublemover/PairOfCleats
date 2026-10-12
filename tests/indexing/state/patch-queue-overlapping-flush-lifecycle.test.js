#!/usr/bin/env node
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';
import { createBuildCheckpointTracker } from '../../../src/index/build/build-state/progress.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const nextTurn = () => new Promise(setImmediate);
const withDeadline = async (promise, message) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 2500); })
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const mergeState = (base, patch) => ({ ...(base || {}), ...(patch || {}) });

// A and B detach their batches from one pending owner. C is the final progress
// checkpoint, queued after A completes while B still applies. A must not retire
// B's owner; B must not discard C or cancel C's debounce and waiter timers.
{
  const buildRoot = path.join(os.tmpdir(), 'poc-overlapping-final-checkpoint');
  const a = deferred();
  const b = deferred();
  const startedA = deferred();
  const startedB = deferred();
  const writes = [];
  const queue = createPatchQueue({
    mergeState,
    waiterTimeoutMs: 2000,
    recordStateError: () => {},
    applyStatePatch: async (_root, patch) => {
      if (patch.heartbeat === 'A') {
        startedA.resolve();
        await a.promise;
      }
      if (patch.progress?.code?.processedFiles === 8118) {
        startedB.resolve();
        await b.promise;
      }
      writes.push(patch.progress?.code?.processedFiles ?? patch.heartbeat);
      return patch;
    }
  });
  try {
    await queue.queueStatePatch(buildRoot, { heartbeat: 'A' }, [], { flushNow: true, waitForFlush: false });
    await withDeadline(startedA.promise, 'first flush did not start');
    const tracker = createBuildCheckpointTracker({
      buildRoot,
      mode: 'code',
      totalFiles: 8168,
      batchSize: 8118,
      intervalMs: 1e9,
      updateBuildStateOutcome: (root, patch, options) => queue.queueStatePatch(root, patch, [], options)
    });
    for (let index = 0; index < 8118; index += 1) tracker.tick();
    const previousFlush = queue.flushBuildState(buildRoot);
    a.resolve();
    await withDeadline(startedB.promise, 'second flush did not start');
    await nextTurn();
    for (let index = 0; index < 50; index += 1) tracker.tick();
    const finalCheckpoint = tracker.finish();
    b.resolve();
    await previousFlush;
    await withDeadline(finalCheckpoint, 'final checkpoint was stranded by an older flush');
    assert.deepEqual(writes, ['A', 8118, 8168], 'the final fifty files must be durably observed before finish resolves');
    const heartbeat = await queue.queueStatePatch(buildRoot, { heartbeat: 'D' }, [], { flushNow: true });
    assert.equal(heartbeat.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
    assert.deepEqual(writes, ['A', 8118, 8168, 'D']);
    await nextTurn();
    assert.equal(queue.isActiveStateKey(path.resolve(buildRoot)), false, 'idle ownership must still be released');
  } finally {
    a.resolve();
    b.resolve();
  }
}

// A detached batch's best-effort waiter remains bounded while its apply is
// blocked, even after a sibling completes and a no-pending explicit flush runs.
{
  const buildRoot = path.join(os.tmpdir(), 'poc-overlapping-detached-waiter');
  const a = deferred();
  const b = deferred();
  const startedA = deferred();
  const startedB = deferred();
  const appliedB = deferred();
  const queue = createPatchQueue({
    mergeState,
    waiterTimeoutMs: 80,
    recordStateError: () => {},
    applyStatePatch: async (_root, patch) => {
      if (patch.id === 'A') {
        startedA.resolve();
        await a.promise;
      } else if (patch.id === 'B') {
        startedB.resolve();
        await b.promise;
        appliedB.resolve();
      }
      return patch;
    }
  });
  try {
    await queue.queueStatePatch(buildRoot, { id: 'A' }, [], { flushNow: true, waitForFlush: false });
    await withDeadline(startedA.promise, 'first timeout fixture flush did not start');
    const waiter = queue.queueStatePatch(buildRoot, { id: 'B' }, [], { flushNow: true });
    let requiredSettled = false;
    const required = queue.queueStatePatch(buildRoot, { id: 'C' }, [], {
      durabilityClass: BUILD_STATE_DURABILITY_CLASS.REQUIRED
    }).then((outcome) => { requiredSettled = true; return outcome; });
    a.resolve();
    await withDeadline(startedB.promise, 'detached batch did not start');
    await nextTurn();
    await queue.flushBuildState(buildRoot);
    const outcome = await withDeadline(waiter, 'detached waiter timeout was cancelled by another flush');
    assert.equal(outcome.status, PATCH_QUEUE_WAIT_STATUS.TIMED_OUT);
    assert.equal(outcome.timeoutMs, 80);
    assert.equal(requiredSettled, false, 'required writes keep waiting for their serialized apply');
    b.resolve();
    await withDeadline(appliedB.promise, 'timed-out batch did not finish in the background');
    const requiredOutcome = await withDeadline(required, 'required waiter was stranded by sibling retirement');
    assert.equal(requiredOutcome.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
    assert.equal(requiredOutcome.value.id, 'C');
    await nextTurn();
    assert.equal(queue.isActiveStateKey(path.resolve(buildRoot)), false);
    const heartbeat = await queue.queueStatePatch(buildRoot, { heartbeat: 'after-timeout' }, [], { flushNow: true });
    assert.equal(heartbeat.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
  } finally {
    a.resolve();
    b.resolve();
  }
}

// A younger detached batch can also fail after an older sibling completes.
// Its retry must remain on the live owner and preserve the newer patch/events.
{
  const buildRoot = path.join(os.tmpdir(), 'poc-overlapping-failed-flush');
  const a = deferred();
  const b = deferred();
  const startedA = deferred();
  const startedB = deferred();
  const applied = [];
  const errors = [];
  let attempts = 0;
  const queue = createPatchQueue({
    mergeState,
    waiterTimeoutMs: 2000,
    recordStateError: (_root, error) => errors.push(error.message),
    applyStatePatch: async (_root, patch, events) => {
      if (patch.id === 'A') {
        startedA.resolve();
        await a.promise;
      }
      if (patch.retry && ++attempts === 1) {
        startedB.resolve();
        await b.promise;
        throw new Error('overlapping write failure');
      }
      applied.push({ patch, events });
      return patch;
    }
  });
  try {
    await queue.queueStatePatch(buildRoot, { id: 'A' }, [], { flushNow: true, waitForFlush: false });
    await withDeadline(startedA.promise, 'failure fixture first flush did not start');
    await queue.queueStatePatch(buildRoot, { retry: true }, [{ type: 'B' }], { waitForFlush: false });
    const failedFlush = queue.flushBuildState(buildRoot);
    a.resolve();
    await withDeadline(startedB.promise, 'failure fixture second flush did not start');
    await nextTurn();
    const nextPatch = queue.queueStatePatch(buildRoot, { final: true }, [{ type: 'C' }]);
    b.resolve();
    await failedFlush;
    const outcome = await withDeadline(nextPatch, 'failed sibling stranded the newer patch');
    assert.equal(outcome.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
    assert.deepEqual(errors, ['overlapping write failure']);
    assert.equal(attempts, 2);
    assert.deepEqual(applied, [
      { patch: { id: 'A' }, events: [] },
      { patch: { retry: true, final: true }, events: [{ type: 'B' }, { type: 'C' }] }
    ]);
    await nextTurn();
    assert.equal(queue.isActiveStateKey(path.resolve(buildRoot)), false);
    const heartbeat = await queue.queueStatePatch(buildRoot, { heartbeat: 'after-retry' }, [], { flushNow: true });
    assert.equal(heartbeat.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
  } finally {
    a.resolve();
    b.resolve();
  }
}

console.log('overlapping patch flushes preserve final checkpoints, detached timeouts, retries, and idle lifecycle cleanup');
