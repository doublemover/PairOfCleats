import { state } from '../state.js';
import { createGraphWorkerClient } from './worker-client.js';
import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';
import { captureSceneFailure } from '../scene-failure-inspection.js';
import { createSceneWorkPrerequisites } from '../scene-work-prerequisites.js';

let latest = null;
const previousOwners = new WeakMap();
const priorOutcome = value => {
  if (value === undefined) return;
  if (value && typeof value === 'object' && Object.getOwnPropertyDescriptor(value, 'settled')?.value === true
    && Object.getOwnPropertyDescriptor(value, 'pending')?.value === false) return;
  throw Object.assign(new Error('Previous snapshot data closure was not confirmed.', { cause: value }), { sceneOwnershipPending: true });
};

/** Data lifetime is independent of renderer retry, context loss and scene rebuild. */
export const initSnapshotData = config => {
  const attempt = {}; latest = attempt;
  const resources = [], logicalErrors = [], early = new Map();
  let disposed = false, published = false, constructing = true, active = 0, cleaning = false, cleanupStarted = false;
  let client = null, expectedClient, source, remote, originalReady, originalFailure, releaseFallback;
  let hasPrimary = false, primary, returned = null, sourceCaptured = false, currentFailed = false, currentError;
  const prerequisites = createSceneWorkPrerequisites('Original snapshot data session work remains pending.');
  const work = Object.freeze(Object.defineProperty(new Error('Original snapshot data construction or callback has not returned.'),
    'sceneOwnershipReleased', { value: () => active === 0 }));
  const cleanupWork = Object.freeze(Object.defineProperty(new Error('Original snapshot data cleanup has not returned.'),
    'sceneOwnershipReleased', { value: () => !cleaning }));
  const cleanup = { dispose() {
    if (cleanupStarted) return;
    cleanupStarted = true; cleaning = true;
    try {
      const errors = [...logicalErrors];
      for (const resource of resources) try { resource.retire(); } catch (error) { errors.push(error); }
      const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
    } finally { cleaning = false; }
  } };
  const owner = prerequisites.attach(captureSceneResource(cleanup, 'original snapshot data session', 'dispose', [], { required: true }));
  prerequisites.retain(work);
  const tokenCurrent = () => latest === attempt && !disposed;
  const sameSource = () => sourceCaptured && state.sourceIndex === source && latest === attempt && state.remoteSource === remote && latest === attempt;
  const current = () => {
    if (!tokenCurrent() || !published) return false;
    if (currentFailed) throw currentError;
    try {
      return state.sourceIndex === source && tokenCurrent() && state.remoteSource === remote && tokenCurrent()
        && state.disposeSnapshotData === dispose && tokenCurrent() && state.graphWorkerClient === expectedClient && tokenCurrent();
    } catch (error) { currentFailed = true; currentError = error; prerequisites.retain(error); throw error; }
  };
  const retain = error => { prerequisites.retain(error); return error; };
  const report = failure => {
    if (!failure || currentFailed || latest !== attempt) return;
    try {
      const captured = captureSceneFailure(failure);
      if (latest === attempt && sameSource() && state.disposeSnapshotData == null && latest === attempt && state.graphWorkerClient == null && latest === attempt) {
        state.graphWorkerFailure = failure;
        if (latest === attempt && state.disposeSnapshotData == null && latest === attempt && state.graphWorkerClient == null && latest === attempt) state.graphWorkerError = captured.message;
      }
    } catch (error) { retain(error); }
  };
  const adopt = (resource, label, method = 'dispose', args = []) => {
    const cap = prerequisites.attach(captureSceneResource(resource, label, method, args, { required: true }));
    resources.push(cap); cap.assertCaptured(); return cap;
  };
  const revoke = () => {
    if (disposed) return;
    disposed = true; early.clear();
    if (!published || currentFailed) return;
    // Compare the original disposer again between setters. A reentrant setter
    // can publish a sibling; this owner may never clear its fields afterward.
    active++;
    try {
      if (state.disposeSnapshotData !== dispose) return;
      if (state.graphWorkerClient === expectedClient) state.graphWorkerClient = null;
      if (state.disposeSnapshotData !== dispose) return;
      if (state.graphWorkerClient == null) state.graphWorkerReady = false;
      if (state.disposeSnapshotData === dispose) state.disposeSnapshotData = null;
    } catch (error) { logicalErrors.push(retain(error)); }
    finally { active--; }
  };
  const dispose = () => {
    revoke(); prerequisites.refresh();
    if (cleaning) { owner.retainFailure(cleanupWork); throw cleanupWork; }
    return owner.retire();
  };
  const pagehide = () => dispose();
  const invoke = callback => {
    if (!current()) return;
    active++;
    try { return callback(); } catch (error) { retain(error); throw error; }
    finally { active--; }
  };
  const apply = notification => invoke(() => {
    if (notification.kind === 'failure') {
      const captured = captureSceneFailure(notification.error); retain(notification.error);
      if (!current()) return;
      state.graphWorkerReady = false; if (!current()) return;
      state.graphWorkerFailure = notification.error; if (!current()) return;
      state.graphWorkerError = captured.message; if (!current()) return;
      if (typeof originalFailure === 'function') Reflect.apply(originalFailure, state, [notification.error]);
      return;
    }
    state.graphWorkerProgress = notification.message; if (!current()) return;
    if (notification.kind === 'overview') { state.snapshotManifest = notification.manifest; if (!current()) return; }
    if (notification.kind === 'ready') {
      state.graphWorkerReady = true; if (!current()) return;
      if (typeof releaseFallback === 'function') Reflect.apply(releaseFallback, remote, []);
      if (!current()) return;
      if (typeof originalReady === 'function') Reflect.apply(originalReady, state, []);
    }
  });
  const admit = notification => {
    if (!current()) return;
    if (constructing) { early.delete(notification.kind); early.set(notification.kind, notification); }
    else apply(notification);
  };
  active++;
  try {
    const previous = state.disposeSnapshotData;
    if (tokenCurrent() && previous != null) {
      if (typeof previous !== 'function') throw new TypeError('Previous snapshot data has no original disposer.');
      let prior = previousOwners.get(previous);
      if (!prior) {
        prior = captureSceneResource({ dispose: () => {
          const value = Reflect.apply(previous, state, []);
          try { if (value instanceof Promise) return Reflect.apply(Promise.prototype.then, value, [priorOutcome]); }
          catch (error) { throw Object.assign(new AggregateError([error], 'Previous snapshot outcome inspection remains unknown.', { cause: error }), { sceneOwnershipPending: true }); }
          return priorOutcome(value);
        } }, 'previous original snapshot data callback', 'dispose', [], { required: true });
        previousOwners.set(previous, prior);
      }
      // Replacement has independent publication authority. The exact prior
      // failed owner already retains its cleanup; it cannot become this new
      // session's release prerequisite or force adoption of sibling resources.
      try { prior.retire(); } catch { /* retained in the existing exact owner inventory */ }
    }
    if (tokenCurrent() && config) {
      source = state.sourceIndex; if (!tokenCurrent()) return null;
      remote = state.remoteSource; if (!tokenCurrent()) return null;
      sourceCaptured = true;
      expectedClient = state.graphWorkerClient; if (!tokenCurrent()) return null;
      originalReady = state.onSourceQueryReady; if (!tokenCurrent()) return null;
      originalFailure = state.onSourceQueryFailure; if (!tokenCurrent()) return null;
      releaseFallback = remote?.releaseFallbackPages; if (!tokenCurrent()) return null;
      published = true; state.disposeSnapshotData = dispose;
      if (!current()) return null;
      expectedClient = null; state.graphWorkerClient = null;
      if (!current()) return null;
      state.graphWorkerReady = false; if (!current()) return null;
      const host = window;
      adopt(host, 'snapshot original pagehide listener', 'removeEventListener', ['pagehide', pagehide]);
      if (!current()) return null;
      const add = host.addEventListener; if (!current()) return null;
      if (typeof add !== 'function') throw new TypeError('Snapshot data requires original pagehide registration.');
      const workerConfig = {};
      for (const key of ['snapshot', 'endpoint', 'token', 'demand', 'WorkerImpl']) {
        const descriptor = Object.getOwnPropertyDescriptor(config, key);
        if (!current()) return null;
        if (descriptor) {
          if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Snapshot data requires original passive configuration fields.');
          workerConfig[key] = descriptor.value;
        }
      }
      client = createGraphWorkerClient({ ...workerConfig, onProgress: message => {
        if (!current()) return;
        const event = message.event; if (!current()) return;
        const kind = event === 'overview' || event === 'ready' ? event : 'progress';
        const manifest = kind === 'overview' ? message.manifest : undefined;
        if (current()) admit({ kind, message, manifest });
      }, onFailure: error => admit({ kind: 'failure', error }) });
      adopt(client, 'snapshot data original worker client');
      if (!current()) return null;
      expectedClient = client; state.graphWorkerClient = client;
      if (!current()) return null;
      const registration = Reflect.apply(add, host, ['pagehide', pagehide, { once: true }]);
      if (registration !== undefined) {
        retain(registration);
        throw Object.assign(new Error('Snapshot pagehide registration returned no confirmed void outcome.', { cause: registration }), { sceneOwnershipPending: true });
      }
      if (current()) returned = client;
    }
  } catch (error) { hasPrimary = true; primary = retain(error); }
  finally {
    constructing = false; active--;
    let owns = false;
    try { owns = current(); } catch (error) { if (!hasPrimary) { hasPrimary = true; primary = error; } }
    // Cleanup runs after original construction, including a stale late client.
    // An earlier failed/reentrant cleanup is retained, never silently retried.
    if (!returned || !owns) {
      const errors = [];
      try { dispose(); } catch (error) { errors.push(error); }
      const failure = preserveSceneCleanupFailures(primary, errors, { hasPrimary, forceAggregate: true });
      report(failure);
      returned = null;
    }
  }
  if (!returned) return null;
  try { for (const notification of early.values()) { if (!current()) break; apply(notification); } }
  catch (error) {
    retain(error);
    const errors = []; try { dispose(); } catch (cleanupError) { errors.push(cleanupError); }
    const failure = preserveSceneCleanupFailures(error, errors, { hasPrimary: true, forceAggregate: true });
    report(failure);
    returned = null;
  } finally { early.clear(); }
  if (!returned) return null;
  try { if (current()) return returned; } catch (error) { retain(error); }
  try { dispose(); } catch (error) { retain(error); }
  return null;
};
