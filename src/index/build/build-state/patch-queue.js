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

const DEFAULT_DEBOUNCE_MS = 250;
const LONG_DEBOUNCE_MS = 500;
const VERY_LONG_DEBOUNCE_MS = 1000;
const LARGE_PATCH_BYTES = 64 * 1024;
const PATCH_WAITER_TIMEOUT_MS_DEFAULT = 30000;

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

  const createFlushedOutcome = (value) => ({
    status: PATCH_QUEUE_WAIT_STATUS.FLUSHED,
    value: value ?? null
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
      if (typeof waiter.timer?.unref === 'function') waiter.timer.unref();
      waiter.timerCancel = pending.lifecycle.registerTimer(waiter.timer, {
        label: 'build-state-waiter-timeout'
      });
    }
    return { waiter, promise };
  };

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
    stateQueues.set(key, next.finally(() => {
      if (stateQueues.get(key) === next) stateQueues.delete(key);
    }));
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
    if (!lifecycle) return;
    statePendingLifecycles.delete(key);
    void runBuildCleanupWithTimeout({
      label: 'build-state.patch-queue.lifecycle.close',
      cleanup: () => lifecycle.close()
    }).catch(() => {});
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
        waiters: []
      });
    }
    return statePending.get(key);
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
    const waiters = pending.waiters;
    pending.patch = null;
    pending.events = [];
    pending.durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT;
    pending.waiters = [];
    try {
      const result = await enqueueStateUpdate(
        buildRoot,
        () => applyStatePatch(buildRoot, patch, events, { durabilityClass })
      );
      waiters.forEach((waiter) => settleWaiter(pending, waiter, 'resolve', createFlushedOutcome(result)));
      if (!pending.patch && !pending.timer && pending.waiters.length === 0) {
        statePending.delete(key);
        releasePendingLifecycle(buildRoot);
      }
      return result;
    } catch (err) {
      waiters.forEach((waiter) => settleWaiter(pending, waiter, 'reject', err));
      /**
       * Preserve pending patch/events on write failure so state updates are not
       * dropped when the next flush succeeds.
       */
      pending.patch = pending.patch ? mergeState(patch, pending.patch) : patch;
      pending.durabilityClass = durabilityClass;
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
        pending.timerCancel = pending.lifecycle.registerTimer(pending.timer, {
          label: 'build-state-debounce-retry'
        });
      }
      recordStateError(buildRoot, err);
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
      durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
    } = {}
  ) => {
    if (!buildRoot || !patch) return Promise.resolve(createFlushedOutcome(null));
    const pending = getPendingEntry(buildRoot);
    const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
    pending.patch = pending.patch ? mergeState(pending.patch, patch) : patch;
    if (events.length) pending.events.push(...events);
    pending.durabilityClass = isRequiredBuildStateDurability(resolvedDurabilityClass)
      || isRequiredBuildStateDurability(pending.durabilityClass)
      ? BUILD_STATE_DURABILITY_CLASS.REQUIRED
      : BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT;
    const { waiter, promise } = createWaiter(buildRoot, pending, resolvedDurabilityClass);
    pending.waiters.push(waiter);
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
      pending.timerCancel = pending.lifecycle.registerTimer(pending.timer, {
        label: 'build-state-debounce'
      });
    }
    return promise;
  };

  const flushBuildState = async (buildRoot) => {
    if (!buildRoot) return createFlushedOutcome(null);
    const key = path.resolve(buildRoot);
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
