#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTempBuildRoot = async (prefix, run) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const buildRoot = path.join(tempRoot, 'build');
  await fs.mkdir(buildRoot, { recursive: true });
  try {
    await run(buildRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

await withTempBuildRoot('poc-patch-queue-best-effort-', async (buildRoot) => {
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
  assert.equal(firstOutcome?.status, PATCH_QUEUE_WAIT_STATUS.TIMED_OUT);

  const deferredFlushOutcome = await queue.flushBuildState(buildRoot);
  assert.equal(deferredFlushOutcome?.status, PATCH_QUEUE_WAIT_STATUS.TIMED_OUT);

  const secondOutcome = await queue.queueStatePatch(
    buildRoot,
    { second: true },
    [{ type: 'second' }],
    {
      flushNow: true,
      durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
    }
  );
  assert.equal(secondOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);

  await queue.flushBuildState(buildRoot);
  assert.equal(applyCount, 3);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0]?.patch, { first: true, second: true });
  assert.deepEqual((applied[0]?.events || []).map((event) => event?.type), ['first', 'second']);
  assert.equal(applied[0]?.durabilityClass, BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT);
  assert.deepEqual(observedErrors, []);
});

await withTempBuildRoot('poc-patch-queue-mixed-', async (buildRoot) => {
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
  ).then(() => null, (error) => error);

  const [bestEffortOutcome, requiredError] = await Promise.all([bestEffortWait, requiredWait]);
  assert.equal(bestEffortOutcome?.status, PATCH_QUEUE_WAIT_STATUS.TIMED_OUT);
  assert.equal(requiredError?.code, 'ERR_BUILD_STATE_LOCK_UNAVAILABLE');
  assert.deepEqual(observedErrors, []);
  const flushOutcome = await queue.flushBuildState(buildRoot);
  assert.equal(flushOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
  assert.equal(applyCount, 2);
});

await withTempBuildRoot('poc-patch-queue-owner-', async (buildRoot) => {
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
      /owner: pid=4242, lockId=holder-123, scope=build-state-write, startedAt=2026-03-10T00:00:00.000Z/
    );
  } finally {
    process.stderr.write = originalWrite;
  }
});

await withTempBuildRoot('poc-patch-queue-forwarding-', async (buildRoot) => {
  const observed = [];
  const queue = createPatchQueue({
    mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
    applyStatePatch: async (_root, patch, _events, context) => {
      observed.push({
        patch,
        durabilityClass: context?.durabilityClass || null
      });
      return { ok: true, patch };
    },
    recordStateError: () => {},
    waiterTimeoutMs: 1000
  });

  const bestEffortOutcome = await queue.queueStatePatch(
    buildRoot,
    { bestEffort: true },
    [],
    {
      durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
      flushNow: true
    }
  );
  assert.equal(bestEffortOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
  assert.equal(observed[0]?.durabilityClass, BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT);

  const escalated = [];
  const queueB = createPatchQueue({
    mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
    applyStatePatch: async (_root, patch, _events, context) => {
      escalated.push({
        patch,
        durabilityClass: context?.durabilityClass || null
      });
      return { ok: true, patch };
    },
    recordStateError: () => {},
    waiterTimeoutMs: 1000
  });
  const [firstOutcome, secondOutcome] = await Promise.all([
    queueB.queueStatePatch(buildRoot, { first: true }, [], {
      durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
      flushNow: false
    }),
    queueB.queueStatePatch(buildRoot, { second: true }, [], {
      durabilityClass: BUILD_STATE_DURABILITY_CLASS.REQUIRED,
      flushNow: false
    })
  ]);
  assert.equal(firstOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
  assert.equal(secondOutcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
  assert.deepEqual(escalated[0]?.patch, { first: true, second: true });
  assert.equal(escalated[0]?.durabilityClass, BUILD_STATE_DURABILITY_CLASS.REQUIRED);
});

await withTempBuildRoot('poc-patch-queue-required-', async (buildRoot) => {
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
  assert.equal(outcome?.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
  assert.deepEqual(outcome?.value?.patch, { requiredWrite: true });
  assert.equal(applyCount, 1);
  assert.ok(elapsedMs >= 40);
});

await withTempBuildRoot('poc-patch-queue-retry-', async (buildRoot) => {
  let applyCount = 0;
  const applied = [];
  const observedErrors = [];
  const queue = createPatchQueue({
    mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
    applyStatePatch: async (_root, patch, events) => {
      applyCount += 1;
      if (applyCount === 1) {
        throw new Error('synthetic apply failure');
      }
      applied.push({ patch, events });
      return { ok: true };
    },
    recordStateError: (_buildRoot, err) => {
      observedErrors.push(err?.message || String(err));
    }
  });

  await assert.rejects(
    queue.queueStatePatch(buildRoot, { first: true }, [{ type: 'first' }], { flushNow: true }),
    /synthetic apply failure/
  );
  await queue.queueStatePatch(buildRoot, { second: true }, [{ type: 'second' }], { flushNow: true });
  await queue.flushBuildState(buildRoot);
  assert.equal(observedErrors.length, 1);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].patch, { first: true, second: true });
  assert.deepEqual(applied[0].events.map((event) => event.type), ['first', 'second']);
});

console.log('indexing state patch queue contract matrix test passed');
