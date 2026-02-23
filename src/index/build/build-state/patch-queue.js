import path from 'node:path';
import { estimateJsonBytes } from '../../../shared/cache.js';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';

const DEFAULT_DEBOUNCE_MS = 250;
const LONG_DEBOUNCE_MS = 500;
const VERY_LONG_DEBOUNCE_MS = 1000;
const LARGE_PATCH_BYTES = 64 * 1024;

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
  recordStateError
} = {}) => {
  const stateQueues = new Map();
  const statePending = new Map();
  const statePendingLifecycles = new Map();

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
    void lifecycle.close().catch(() => {});
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
        resolves: [],
        rejects: []
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
    const resolves = pending.resolves;
    const rejects = pending.rejects;
    pending.patch = null;
    pending.events = [];
    pending.resolves = [];
    pending.rejects = [];
    try {
      const result = await enqueueStateUpdate(buildRoot, () => applyStatePatch(buildRoot, patch, events));
      resolves.forEach((resolve) => resolve(result));
      if (!pending.patch && !pending.timer) {
        statePending.delete(key);
        releasePendingLifecycle(buildRoot);
      }
      return result;
    } catch (err) {
      rejects.forEach((reject) => reject(err));
      recordStateError(buildRoot, err);
      if (!pending.patch && !pending.timer) {
        statePending.delete(key);
        releasePendingLifecycle(buildRoot);
      }
      return null;
    }
  };

  const queueStatePatch = (buildRoot, patch, events = [], { flushNow = false } = {}) => {
    if (!buildRoot || !patch) return Promise.resolve(null);
    const pending = getPendingEntry(buildRoot);
    pending.patch = pending.patch ? mergeState(pending.patch, patch) : patch;
    if (events.length) pending.events.push(...events);
    const promise = new Promise((resolve, reject) => {
      pending.resolves.push(resolve);
      pending.rejects.push(reject);
    });
    if (pending.timerCancel) {
      pending.timerCancel();
      pending.timerCancel = null;
    } else if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (pending.timer) {
      pending.timer = null;
    }
    if (flushNow) {
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
    if (!buildRoot) return null;
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
    if (pending && !pending.patch && !pending.timer) {
      statePending.delete(key);
      releasePendingLifecycle(buildRoot);
    }
    return result;
  };

  return {
    queueStatePatch,
    flushBuildState,
    isActiveStateKey
  };
};
