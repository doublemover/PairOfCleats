import path from 'node:path';
import { estimateJsonBytes } from '../../../shared/cache.js';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';
import { logLine } from '../../../shared/progress.js';
import { runBuildCleanupWithTimeout } from '../cleanup-timeout.js';
import {
  BUILD_STATE_DURABILITY_CLASS,
  isRequiredBuildStateDurability,
  resolveBuildStateDurabilityClass
} from './durability.js';
import { isBuildStateLockUnavailableResult } from './store.js';

const DEFAULT_DEBOUNCE_MS = 250;
const LONG_DEBOUNCE_MS = 500;
const VERY_LONG_DEBOUNCE_MS = 1000;
const LARGE_PATCH_BYTES = 64 * 1024;
const PATCH_WAITER_TIMEOUT_MS_DEFAULT = 30000;
const LOCK_UNAVAILABLE_RETRY_LOG_INTERVAL_MS = 5000;
const BUILD_STATE_LOCK_UNAVAILABLE_CODE = 'ERR_BUILD_STATE_LOCK_UNAVAILABLE';

const formatLockOwnerForLog = (owner) => {
  if (!owner || typeof owner !== 'object') return null;
  const parts = [];
  if (Number.isFinite(Number(owner.pid)) && Number(owner.pid) > 0) {
    parts.push(`pid=${Math.floor(Number(owner.pid))}`);
  }
  if (typeof owner.lockId === 'string' && owner.lockId.trim()) {
    parts.push(`lockId=${owner.lockId.trim()}`);
  }
  if (typeof owner.scope === 'string' && owner.scope.trim()) {
    parts.push(`scope=${owner.scope.trim()}`);
  }
  if (typeof owner.startedAt === 'string' && owner.startedAt.trim()) {
    parts.push(`startedAt=${owner.startedAt.trim()}`);
  }
  return parts.length ? parts.join(', ') : null;
};

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
      pending.waiters = pending.waiters.filter((candidate) => candidate !== waiter);
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
    const next = prior.catch(() => {}).then(action);
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

  const releasePendingLifecycle = (buildRoot) => {
    const key = path.resolve(buildRoot);
    const lifecycle = statePendingLifecycles.get(key);
    lockRetryLogAtMsByBuildRoot.delete(key);
    if (!lifecycle) return;
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
        events: [],
        timer: null,
        timerCancel: null,
        lifecycle: getPendingLifecycle(buildRoot),
        durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
        waiters: [],
        pendingSinceMs: null,
        lastLogicalUpdateAtMs: null,
        coalescedPatchCount: 0,
        lastFlushStartedAtMs: null,
        lastFlushCompletedAtMs: null,
        lastFlushDurationMs: null
      });
    }
    return statePending.get(key);
  };

  const buildPendingTelemetry = (pending) => {
    if (!pending || typeof pending !== 'object') return {};
    const nowMs = Date.now();
    const pendingLagMs = Number.isFinite(Number(pending.lastLogicalUpdateAtMs))
      ? Math.max(0, nowMs - Number(pending.lastLogicalUpdateAtMs))
      : 0;
    return {
      queued: true,
      pendingLagMs,
      pendingSinceMs: Number.isFinite(Number(pending.pendingSinceMs))
        ? Math.max(0, nowMs - Number(pending.pendingSinceMs))
        : 0,
      pendingPatchBytes: estimateJsonBytes(pending.patch),
      pendingWaiterCount: Array.isArray(pending.waiters) ? pending.waiters.length : 0,
      coalescedPatches: Math.max(0, Math.floor(Number(pending.coalescedPatchCount) || 0)),
      lastFlushDurationMs: Number.isFinite(Number(pending.lastFlushDurationMs))
        ? Math.max(0, Math.floor(Number(pending.lastFlushDurationMs)))
        : null
    };
  };

  const flushPendingState = async (buildRoot) => {
    const key = path.resolve(buildRoot);
    const pending = statePending.get(key);
    if (!pending || !pending.patch) return null;
    if (pending.timerCancel) {
      pending.timerCancel();
      pending.timerCancel = null;
      pending.timer = null;
    }
    const patch = pending.patch;
    const events = pending.events;
    const durabilityClass = resolveBuildStateDurabilityClass(
      pending.durabilityClass,
      BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
    );
    const pendingSinceMs = pending.pendingSinceMs;
    const lastLogicalUpdateAtMs = pending.lastLogicalUpdateAtMs;
    const coalescedPatchCount = pending.coalescedPatchCount;
    const waiters = pending.waiters;
    pending.patch = null;
    pending.events = [];
    pending.durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT;
    pending.waiters = [];
    pending.lastFlushStartedAtMs = Date.now();
    try {
      const result = await enqueueStateUpdate(
        buildRoot,
        () => applyStatePatch(buildRoot, patch, events, { durabilityClass })
      );
      pending.lastFlushCompletedAtMs = Date.now();
      pending.lastFlushDurationMs = Math.max(0, pending.lastFlushCompletedAtMs - pending.lastFlushStartedAtMs);
      pending.pendingSinceMs = null;
      pending.lastLogicalUpdateAtMs = null;
      pending.coalescedPatchCount = 0;
      if (isLockUnavailable(result)) {
        throw result;
      }
      waiters.forEach((waiter) => settleWaiter(pending, waiter, 'resolve', createFlushedOutcome(result)));
      if (!pending.patch && !pending.timer && pending.waiters.length === 0) {
        statePending.delete(key);
        releasePendingLifecycle(buildRoot);
      }
      return result;
    } catch (err) {
      pending.lastFlushCompletedAtMs = Date.now();
      pending.lastFlushDurationMs = Math.max(0, pending.lastFlushCompletedAtMs - pending.lastFlushStartedAtMs);
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
      /**
       * Preserve pending patch/events on write failure so state updates are not
       * dropped when the next flush succeeds.
       */
      pending.patch = pending.patch ? mergeState(patch, pending.patch) : patch;
      pending.durabilityClass = durabilityClass;
      pending.pendingSinceMs = Number.isFinite(Number(pendingSinceMs)) ? pendingSinceMs : Date.now();
      pending.lastLogicalUpdateAtMs = Number.isFinite(Number(lastLogicalUpdateAtMs))
        ? lastLogicalUpdateAtMs
        : pending.pendingSinceMs;
      pending.coalescedPatchCount = Math.max(
        Math.floor(Number(pending.coalescedPatchCount) || 0),
        Math.floor(Number(coalescedPatchCount) || 0)
      );
      if (events.length) {
        pending.events = [...events, ...pending.events];
      }
      if (!pending.timer && pending.patch) {
        const delay = resolveDebounceMs(pending.patch);
        pending.timer = setTimeout(() => {
          pending.timer = null;
          pending.timerCancel = null;
          void flushPendingState(buildRoot);
        }, delay);
        pending.timer.unref?.();
        pending.timerCancel = pending.lifecycle.registerTimer(pending.timer, {
          label: 'build-state-debounce-retry'
        });
      }
      if (lockUnavailable) {
        const nowMs = Date.now();
        const lastLoggedAtMs = Number(lockRetryLogAtMsByBuildRoot.get(key) || 0);
        if (nowMs - lastLoggedAtMs >= LOCK_UNAVAILABLE_RETRY_LOG_INTERVAL_MS) {
          lockRetryLogAtMsByBuildRoot.set(key, nowMs);
          const lockOwner = err?.buildState?.lockOwner || err?.lockOwner || null;
          const ownerDetail = formatLockOwnerForLog(lockOwner);
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
      if (!pending.patch && !pending.timer && pending.waiters.length === 0) {
        statePending.delete(key);
        releasePendingLifecycle(buildRoot);
      }
      return null;
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
    if (pending.timerCancel) {
      pending.timerCancel();
      pending.timerCancel = null;
    } else if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (pending.timer) {
      pending.timer = null;
    }
    if (flushNow || isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      void flushPendingState(buildRoot);
    } else {
      const delay = resolveDebounceMs(pending.patch);
      pending.timer = setTimeout(() => {
        pending.timer = null;
        pending.timerCancel = null;
        void flushPendingState(buildRoot);
      }, delay);
      pending.timer.unref?.();
      pending.timerCancel = pending.lifecycle.registerTimer(pending.timer, {
        label: 'build-state-debounce'
      });
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
    const result = await flushPendingState(buildRoot);
    const nextPending = statePending.get(key);
    if (nextPending?.patch) {
      return createTimedOutOutcome(key, Math.max(0, Date.now() - startedAtMs));
    }
    if (pending && !pending.patch && !pending.timer && pending.waiters.length === 0) {
      statePending.delete(key);
      releasePendingLifecycle(buildRoot);
    }
    return createFlushedOutcome(result);
  };

  return {
    queueStatePatch,
    flushBuildState,
    isActiveStateKey
  };
};
