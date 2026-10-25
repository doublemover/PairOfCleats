import { runWithIndependentSchedulerOwner } from '../../../shared/concurrency/scheduler-task-scope.js';
import path from 'node:path';
import { estimateJsonBytes } from '../../../shared/cache/size.js';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';
import { logLine } from '../../../shared/progress-runtime.js';
import { runBuildCleanupWithTimeout } from '../cleanup-timeout.js';
import {
  BUILD_STATE_DURABILITY_CLASS,
  isRequiredBuildStateDurability,
  resolveBuildStateDurabilityClass
} from './durability.js';
import {
  formatBuildStateLockOwner,
  isBuildStateLockUnavailableResult
} from './store.js';

const DEFAULT_DEBOUNCE_MS = 250;
const LONG_DEBOUNCE_MS = 500;
const VERY_LONG_DEBOUNCE_MS = 1000;
const MAX_PENDING_AGE_MS = 2000;
const LARGE_PATCH_BYTES = 64 * 1024;
const PATCH_WAITER_TIMEOUT_MS_DEFAULT = 30000;
const LOCK_UNAVAILABLE_RETRY_LOG_INTERVAL_MS = 5000;
const BUILD_STATE_LOCK_UNAVAILABLE_CODE = 'ERR_BUILD_STATE_LOCK_UNAVAILABLE';

export const PATCH_QUEUE_WAIT_STATUS = Object.freeze({
  FLUSHED: 'flushed',
  TIMED_OUT: 'timed_out'
});

const resolveDebounceMs = (patch) => {
  if (!patch || typeof patch !== 'object') return DEFAULT_DEBOUNCE_MS;
  const patchBytes = estimateJsonBytes(patch);
  if (patchBytes > LARGE_PATCH_BYTES) return VERY_LONG_DEBOUNCE_MS;
  if (patch.heartbeat) return LONG_DEBOUNCE_MS;
  if (patch.progress || patch.stageCheckpoints) return LONG_DEBOUNCE_MS;
  return DEFAULT_DEBOUNCE_MS;
};

export const createPatchQueue = ({
  mergeState,
  applyStatePatch,
  recordStateError,
  waiterTimeoutMs = PATCH_WAITER_TIMEOUT_MS_DEFAULT
} = {}) => {
  const resolvedWaiterTimeoutMs = Number.isFinite(Number(waiterTimeoutMs))
    ? Math.max(0, Math.floor(Number(waiterTimeoutMs)))
    : PATCH_WAITER_TIMEOUT_MS_DEFAULT;
  const stateQueues = new Map();
  const statePending = new Map();
  const statePendingLifecycles = new Map();
  const lockRetryLogAtMsByBuildRoot = new Map();

  const createFlushedOutcome = (value, extras = null) => ({
    status: PATCH_QUEUE_WAIT_STATUS.FLUSHED,
    value: value ?? null,
    ...(extras && typeof extras === 'object' ? extras : {})
  });
  const createTimedOutOutcome = (buildRoot, elapsedMs) => ({
    status: PATCH_QUEUE_WAIT_STATUS.TIMED_OUT,
    value: null,
    buildRoot,
    timeoutMs: resolvedWaiterTimeoutMs,
    elapsedMs
  });

  const settleWaiter = (pending, waiter, method, value) => {
    if (!waiter || waiter.settled) return;
    waiter.settled = true;
    if (waiter.timerCancel) {
      waiter.timerCancel();
      waiter.timerCancel = null;
      waiter.timer = null;
    } else if (waiter.timer) {
      clearTimeout(waiter.timer);
      waiter.timer = null;
    }
    if (pending?.waiters?.length) {
      const index = pending.waiters.indexOf(waiter);
      if (index >= 0) {
        // This array is private and dense. Preserve waiter order without a
        // replacement array, or copying next-flush waiters for a detached batch.
        for (let i = index + 1; i < pending.waiters.length; i += 1) {
          pending.waiters[i - 1] = pending.waiters[i];
        }
        pending.waiters.pop();
      }
    }
    if (method === 'reject') {
      waiter.reject(value);
      return;
    }
    waiter.resolve(value);
  };

  const createWaiter = (buildRoot, pending, durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT) => {
    const key = path.resolve(buildRoot);
    const createdAtMs = Date.now();
    let resolvePromise = null;
    let rejectPromise = null;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const waiter = {
      settled: false,
      timer: null,
      timerCancel: null,
      createdAtMs,
      durabilityClass: resolveBuildStateDurabilityClass(durabilityClass),
      resolve: resolvePromise,
      reject: rejectPromise
    };
    if (!isRequiredBuildStateDurability(durabilityClass) && resolvedWaiterTimeoutMs > 0) {
      waiter.timer = setTimeout(() => {
        const elapsedMs = Math.max(0, Date.now() - createdAtMs);
        settleWaiter(pending, waiter, 'resolve', createTimedOutOutcome(key, elapsedMs));
        logLine(
          `[build_state] patch queue waiter timed out after ${resolvedWaiterTimeoutMs}ms for ${key}; continuing without waiting for flush completion.`,
          {
            kind: 'warning',
            buildState: {
              event: 'patch-waiter-timeout',
              buildRoot: key,
              timeoutMs: resolvedWaiterTimeoutMs,
              elapsedMs
            }
          }
        );
      }, resolvedWaiterTimeoutMs);
      // Keep waiter timeout referenced: callers may await this promise and
      // require deterministic resolution even during low-activity periods.
      waiter.timerCancel = pending.lifecycle.registerTimer(waiter.timer, {
        label: 'build-state-waiter-timeout'
      });
    }
    return { waiter, promise };
  };

  const createTimedOutOutcomeForWaiter = (buildRoot, waiter) => {
    const key = path.resolve(buildRoot);
    const startedAt = Number.isFinite(Number(waiter?.createdAtMs))
      ? Number(waiter.createdAtMs)
      : Date.now();
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    return createTimedOutOutcome(key, elapsedMs);
  };

  const isLockUnavailable = (err) => (
    String(err?.code || '') === BUILD_STATE_LOCK_UNAVAILABLE_CODE
    || err?.buildState?.reason === 'lock-unavailable'
    || err?.buildState?.retryable === true
    || isBuildStateLockUnavailableResult(err)
  );

  const isRetryableLockUnavailable = (err, durabilityClass) => (
    !isRequiredBuildStateDurability(durabilityClass)
    && isLockUnavailable(err)
  );

  const isActiveStateKey = (key) => (
    stateQueues.has(key)
    || statePending.has(key)
    || statePendingLifecycles.has(key)
  );

  const enqueueStateUpdate = (buildRoot, action) => {
    if (!buildRoot) return Promise.resolve(null);
    const key = path.resolve(buildRoot);
    const prior = stateQueues.get(key) || Promise.resolve();
    // This queue retains pending batches and explicit flush/drain ownership.
    // Its I/O cannot borrow the lifetime of whichever file posted the patch.
    const next = runWithIndependentSchedulerOwner(() => prior.catch(() => {}).then(action));
    // This queue is driven by fire-and-forget flushes, so consume the raw
    // rejection immediately and let explicit awaiters observe it separately.
    next.catch(() => null);
    const queued = next
      .catch(() => null)
      .finally(() => {
        if (stateQueues.get(key) === queued) stateQueues.delete(key);
      });
    stateQueues.set(key, queued);
    return next;
  };

  const getPendingLifecycle = (buildRoot) => {
    const key = path.resolve(buildRoot);
    if (!statePendingLifecycles.has(key)) {
      statePendingLifecycles.set(
        key,
        createLifecycleRegistry({ name: `build-state-pending:${path.basename(key)}` })
      );
    }
    return statePendingLifecycles.get(key);
  };

  const releasePendingLifecycle = (buildRoot, expectedLifecycle) => {
    const key = path.resolve(buildRoot);
    const lifecycle = statePendingLifecycles.get(key);
    if (!lifecycle || lifecycle !== expectedLifecycle) return;
    lockRetryLogAtMsByBuildRoot.delete(key);
    statePendingLifecycles.delete(key);
    void runBuildCleanupWithTimeout({
      label: 'build-state.patch-queue.lifecycle.close',
      cleanup: () => lifecycle.close()
    }).then((result) => {
      if (!result?.timedOut) return;
      logLine(
        `[build_state] pending patch lifecycle close timed out for ${key}; continuing cleanup.`,
        {
          kind: 'warning',
          buildState: {
            event: 'patch-pending-lifecycle-close-timeout',
            buildRoot: key,
            elapsedMs: result?.elapsedMs ?? null
          }
        }
      );
    }).catch((error) => {
      logLine(
        `[build_state] pending patch lifecycle close failed for ${key}: ${error?.message || String(error)}`,
        {
          kind: 'warning',
          buildState: {
            event: 'patch-pending-lifecycle-close-failed',
            buildRoot: key
          }
        }
      );
    });
  };

  const getPendingEntry = (buildRoot) => {
    const key = path.resolve(buildRoot);
    if (!statePending.has(key)) {
      statePending.set(key, {
        patch: null,
        failedBatch: null,
        events: [],
        timer: null,
        timerCancel: null,
        lifecycle: getPendingLifecycle(buildRoot),
        durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
        waiters: [],
        activeFlushes: 0,
        activeBatches: new Set(),
        retryNotBeforeMs: null,
        pendingSinceMs: null,
        lastLogicalUpdateAtMs: null,
        coalescedPatchCount: 0,
        lastFlushStartedAtMs: null,
        lastFlushCompletedAtMs: null,
        lastFlushDurationMs: null,
        lastDurableAcknowledgementAtMs: null,
        lastDurableLogicalUpdateAtMs: null
      });
    }
    return statePending.get(key);
  };

  // Detached batches still own this lifecycle, including their waiter timers.
  // An older flush must neither retire a sibling's owner nor delete a newer
  // pending entry that happens to use the same build-root key.
  const releaseIdlePendingEntry = (buildRoot, pending) => {
    const key = path.resolve(buildRoot);
    if (!pending || statePending.get(key) !== pending || pending.activeFlushes > 0
      || pending.patch || pending.failedBatch || pending.timer || pending.waiters.length > 0) return;
    statePending.delete(key);
    releasePendingLifecycle(buildRoot, pending.lifecycle);
  };

  const buildPendingTelemetry = (pending) => {
    if (!pending || typeof pending !== 'object') return {};
    const nowMs = Date.now();
    const pendingBatches = [pending.patch ? pending : null, pending.failedBatch].filter(Boolean);
    const unacknowledged = [...pendingBatches, ...pending.activeBatches];
    const oldest = entries => entries.reduce((time, batch) => Number.isFinite(batch.pendingSinceMs)
      ? Math.min(time, batch.pendingSinceMs) : time, Infinity);
    const age = time => Number.isFinite(time) ? Math.max(0, nowMs - time) : 0;
    const pendingLagMs = age(oldest(unacknowledged));
    const activeStartedAtMs = [...pending.activeBatches].reduce((time, batch) => Number.isFinite(batch.startedAtMs)
      ? Math.min(time, batch.startedAtMs) : time, Infinity);
    const newestLogicalAtMs = unacknowledged.reduce((time, batch) => Number.isFinite(batch.lastLogicalUpdateAtMs)
      ? Math.max(time, batch.lastLogicalUpdateAtMs) : time, -Infinity);
    return {
      queued: true,
      pendingLagMs,
      pendingSinceMs: pendingLagMs,
      oldestPendingAgeMs: age(oldest(pendingBatches)),
      activeWriteAgeMs: age(activeStartedAtMs),
      newestLogicalUpdateAgeMs: age(newestLogicalAtMs),
      lastDurableAcknowledgementAtMs: pending.lastDurableAcknowledgementAtMs,
      lastDurableLogicalUpdateAtMs: pending.lastDurableLogicalUpdateAtMs,
      activeFlushes: pending.activeFlushes,
      pendingPatchBytes: estimateJsonBytes(pending.patch),
      pendingWaiterCount: Array.isArray(pending.waiters) ? pending.waiters.length : 0,
      coalescedPatches: Math.max(0, Math.floor(Number(pending.coalescedPatchCount) || 0)),
      lastFlushDurationMs: Number.isFinite(pending.lastFlushDurationMs)
        ? Math.max(0, Math.floor(Number(pending.lastFlushDurationMs)))
        : null
    };
  };

  const cancelPendingTimer = pending => {
    if (pending.timerCancel) pending.timerCancel();
    else if (pending.timer) clearTimeout(pending.timer);
    pending.timerCancel = null;
    pending.timer = null;
  };

  const schedulePendingFlush = (buildRoot, pending) => {
    cancelPendingTimer(pending);
    if (pending.activeFlushes > 0 || (!pending.patch && !pending.failedBatch)) return;
    const nowMs = Date.now();
    const oldestAtMs = Math.min(...[pending.patch ? pending.pendingSinceMs : null,
      pending.failedBatch?.pendingSinceMs].filter(Number.isFinite));
    const debounceMs = resolveDebounceMs(pending.patch || pending.failedBatch.patch);
    const ageRemainingMs = Math.max(0, MAX_PENDING_AGE_MS - Math.max(0, nowMs - oldestAtMs));
    // Failed storage retains a retry backoff even after maximum healthy age.
    // New progress cannot reset the original healthy deadline or bypass backoff.
    const delay = Math.max(Math.min(debounceMs, ageRemainingMs),
      Number.isFinite(pending.retryNotBeforeMs) ? Math.max(0, pending.retryNotBeforeMs - nowMs) : 0);
    pending.timer = setTimeout(() => {
      const cancel = pending.timerCancel;
      pending.timer = null; pending.timerCancel = null;
      cancel?.();
      void flushPendingState(buildRoot);
    }, delay);
    pending.timer.unref?.();
    pending.timerCancel = pending.lifecycle.registerTimer(pending.timer, { label: 'build-state-debounce' });
  };

  const flushPendingState = async (buildRoot) => {
    const key = path.resolve(buildRoot);
    const pending = statePending.get(key);
    if (!pending || (!pending.patch && !pending.failedBatch)) return null;
    cancelPendingTimer(pending);
    let patch = pending.patch;
    let events = pending.events;
    let durabilityClass = resolveBuildStateDurabilityClass(
      pending.durabilityClass,
      BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
    );
    const batch = { pendingSinceMs: pending.pendingSinceMs, lastLogicalUpdateAtMs: pending.lastLogicalUpdateAtMs,
      coalescedPatchCount: pending.coalescedPatchCount, startedAtMs: null };
    const waiters = pending.waiters;
    pending.patch = null;
    pending.events = [];
    pending.durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT;
    pending.waiters = [];
    pending.pendingSinceMs = null;
    pending.lastLogicalUpdateAtMs = null;
    pending.coalescedPatchCount = 0;
    pending.activeFlushes += 1;
    pending.activeBatches.add(batch);
    try {
      const result = await enqueueStateUpdate(
        buildRoot,
        async () => {
          // Recover inside the serialized owner, before any later detached batch
          // can commit. Newer fields win and event chronology remains oldest first.
          if (pending.failedBatch) {
            const failed = pending.failedBatch;
            batch.pendingSinceMs = Number.isFinite(batch.pendingSinceMs)
              ? Math.min(batch.pendingSinceMs, failed.pendingSinceMs) : failed.pendingSinceMs;
            batch.lastLogicalUpdateAtMs = Number.isFinite(batch.lastLogicalUpdateAtMs)
              ? Math.max(batch.lastLogicalUpdateAtMs, failed.lastLogicalUpdateAtMs) : failed.lastLogicalUpdateAtMs;
            batch.coalescedPatchCount += failed.coalescedPatchCount + (patch ? 1 : 0);
            patch = patch ? mergeState(failed.patch, patch) : failed.patch;
            events = [...failed.events, ...events];
            if (isRequiredBuildStateDurability(failed.durabilityClass)) {
              durabilityClass = BUILD_STATE_DURABILITY_CLASS.REQUIRED;
            }
            pending.failedBatch = null;
          }
          batch.startedAtMs = Date.now();
          pending.lastFlushStartedAtMs = batch.startedAtMs;
          try {
            const value = await applyStatePatch(buildRoot, patch, events, { durabilityClass });
            if (isLockUnavailable(value)) throw value;
            return value;
          } catch (error) {
            pending.failedBatch = { ...batch, patch, events, durabilityClass };
            throw error;
          }
        }
      );
      pending.lastFlushCompletedAtMs = Date.now();
      pending.lastFlushDurationMs = Math.max(0, pending.lastFlushCompletedAtMs - batch.startedAtMs);
      pending.lastDurableAcknowledgementAtMs = pending.lastFlushCompletedAtMs;
      pending.lastDurableLogicalUpdateAtMs = batch.lastLogicalUpdateAtMs;
      pending.retryNotBeforeMs = null;
      if (isLockUnavailable(result)) {
        throw result;
      }
      waiters.forEach((waiter) => settleWaiter(pending, waiter, 'resolve', createFlushedOutcome(result)));
      return result;
    } catch (err) {
      pending.lastFlushCompletedAtMs = Date.now();
      pending.lastFlushDurationMs = Math.max(0, pending.lastFlushCompletedAtMs - batch.startedAtMs);
      const lockUnavailable = isLockUnavailable(err);
      if (lockUnavailable) {
        waiters.forEach((waiter) => {
          if (isRequiredBuildStateDurability(waiter?.durabilityClass)) {
            settleWaiter(pending, waiter, 'reject', err);
            return;
          }
          settleWaiter(
            pending,
            waiter,
            'resolve',
            createTimedOutOutcomeForWaiter(buildRoot, waiter)
          );
        });
      } else {
        waiters.forEach((waiter) => settleWaiter(pending, waiter, 'reject', err));
      }
      pending.retryNotBeforeMs = Date.now() + resolveDebounceMs(pending.patch || pending.failedBatch?.patch);
      if (lockUnavailable) {
        const nowMs = Date.now();
        const lastLoggedAtMs = Number(lockRetryLogAtMsByBuildRoot.get(key) || 0);
        if (nowMs - lastLoggedAtMs >= LOCK_UNAVAILABLE_RETRY_LOG_INTERVAL_MS) {
          lockRetryLogAtMsByBuildRoot.set(key, nowMs);
          const lockOwner = err?.buildState?.lockOwner || err?.lockOwner || null;
          const ownerDetail = formatBuildStateLockOwner(lockOwner);
          logLine(
            `[build_state] state write lock unavailable for ${key}${ownerDetail ? ` (owner: ${ownerDetail})` : ''}; deferring best-effort patch flush and retrying.`,
            {
              kind: 'warning',
              buildState: {
                event: 'patch-lock-unavailable-retry',
                buildRoot: key,
                lockOwner
              }
            }
          );
        }
      } else {
        recordStateError(buildRoot, err);
      }
      return null;
    } finally {
      pending.activeFlushes -= 1;
      pending.activeBatches.delete(batch);
      if (pending.activeFlushes === 0) schedulePendingFlush(buildRoot, pending);
      releaseIdlePendingEntry(buildRoot, pending);
    }
  };

  const queueStatePatch = (
    buildRoot,
    patch,
    events = [],
    {
      flushNow = false,
      durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
      waitForFlush = true
    } = {}
  ) => {
    if (!buildRoot || !patch) return Promise.resolve(createFlushedOutcome(null));
    const pending = getPendingEntry(buildRoot);
    const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
    const enqueuedAtMs = Date.now();
    if (pending.patch) {
      pending.coalescedPatchCount += 1;
    } else {
      pending.pendingSinceMs = enqueuedAtMs;
      pending.coalescedPatchCount = 0;
    }
    pending.lastLogicalUpdateAtMs = enqueuedAtMs;
    pending.patch = pending.patch ? mergeState(pending.patch, patch) : patch;
    if (events.length) pending.events.push(...events);
    pending.durabilityClass = isRequiredBuildStateDurability(resolvedDurabilityClass)
      || isRequiredBuildStateDurability(pending.durabilityClass)
      ? BUILD_STATE_DURABILITY_CLASS.REQUIRED
      : BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT;
    let promise = null;
    if (waitForFlush || isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      const waiterResult = createWaiter(buildRoot, pending, resolvedDurabilityClass);
      pending.waiters.push(waiterResult.waiter);
      promise = waiterResult.promise;
    }
    cancelPendingTimer(pending);
    if (flushNow || isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      void flushPendingState(buildRoot);
    } else {
      schedulePendingFlush(buildRoot, pending);
    }
    if (promise) return promise;
    return Promise.resolve(createFlushedOutcome(null, buildPendingTelemetry(pending)));
  };

  const flushBuildState = async (buildRoot) => {
    if (!buildRoot) return createFlushedOutcome(null);
    const key = path.resolve(buildRoot);
    const startedAtMs = Date.now();
    const pending = statePending.get(key);
    if (pending?.timerCancel) {
      pending.timerCancel();
      pending.timerCancel = null;
      pending.timer = null;
    } else if (pending?.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    // Detachment is synchronous. Capture the serialized tail after admitting
    // this flush, including already detached work but excluding later arrivals.
    const flushing = flushPendingState(buildRoot);
    const barrier = stateQueues.get(key);
    if (barrier) await barrier;
    const result = await flushing;
    const nextPending = statePending.get(key);
    if (nextPending?.patch || nextPending?.failedBatch) {
      return createTimedOutOutcome(key, Math.max(0, Date.now() - startedAtMs));
    }
    releaseIdlePendingEntry(buildRoot, pending);
    return createFlushedOutcome(result);
  };

  return {
    queueStatePatch,
    flushBuildState,
    isActiveStateKey
  };
};
