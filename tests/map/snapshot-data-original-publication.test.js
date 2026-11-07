import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { initSnapshotData } from '../../src/map/isometric/client/data/session-owner.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

const workers = [];
class WorkerDouble {
  constructor() { this.closed = 0; this.sent = []; workers.push(this); }
  postMessage(message) {
    this.sent.push(message);
    if (message.kind === 'init') {
      this.onmessage({ data: { ...message, event: 'overview', manifest: { snapshot: message.snapshot } } });
      this.onmessage({ data: { ...message, event: 'ready' } });
    }
  }
  terminate() { this.closed++; }
  progress() { this.onmessage({ data: { protocol: MAP_DATA_PROTOCOL, snapshot: this.sent[0].snapshot, kind: 'init', event: 'progress' } }); }
}
const hostDouble = () => ({ listeners: new Set(), added: 0, removed: 0, addFails: false, removeFails: false,
  addEventListener(_event, callback) { this.added++; this.listeners.add(callback); if (this.addFails) throw false; },
  removeEventListener(_event, callback) { this.removed++; if (this.removeFails) throw this.removeFailure; this.listeners.delete(callback); }
});
const contains = (root, expected) => {
  const queue = [root], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (Object.is(value, expected)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
const config = (snapshot = 'source:a', WorkerImpl = WorkerDouble) => ({ snapshot, endpoint: '/snapshot', token: 'fixture', WorkerImpl });
const originalWindow = globalThis.window;
const reset = () => {
  if (typeof state.disposeSnapshotData === 'function') try { state.disposeSnapshotData(); } catch { /* retained exact owner inspected below */ }
  for (const key of Reflect.ownKeys(state)) delete state[key];
  state.sourceIndex = {}; state.remoteSource = null;
  const host = hostDouble(); globalThis.window = host; return host;
};
try {
  // Synchronous worker publications wait for the actual client publication.
  // Readiness survives the initial false value and original callbacks are bound.
  const host = reset(); let ready = 0, released = 0, releaseReads = 0;
  const remote = { get releaseFallbackPages() { releaseReads++; return function() { assert.equal(this, remote); released++; }; } };
  state.remoteSource = remote;
  state.onSourceQueryReady = function() { assert.equal(this, state); assert(state.graphWorkerClient); ready++; };
  const client = initSnapshotData(config()), worker = workers.at(-1);
  assert(client); assert.equal(state.graphWorkerClient, client); assert.equal(state.graphWorkerReady, true);
  assert.equal(state.snapshotManifest.snapshot, 'source:a'); assert.equal(ready, 1); assert.equal(released, 1); assert.equal(releaseReads, 1);
  Object.defineProperty(remote, 'releaseFallbackPages', { get() { assert.fail('later fallback getter cannot replace the original'); } });
  state.onSourceQueryReady = () => assert.fail('later ready callback cannot replace the original');
  state.renderer = {}; state.scene = {}; worker.progress();
  assert.equal(state.graphWorkerProgress.event, 'progress', 'renderer replacement does not revoke independent data lifetime');
  const originalDispose = state.disposeSnapshotData;
  host.removeEventListener = () => assert.fail('later host remover cannot replace original');
  originalDispose(); assert.equal(worker.closed, 1); assert.equal(host.removed, 1);
  assert.equal(state.graphWorkerClient, null); originalDispose(); assert.equal(worker.closed, 1);

  // A new initialization may run inside the original native constructor. The
  // late earlier client remains scoped cleanup; it cannot overwrite its sibling.
  reset(); let sibling, entered = false;
  class ReentrantWorker extends WorkerDouble {
    postMessage(message) {
      if (message.kind === 'init' && !entered) { entered = true; sibling = initSnapshotData(config('source:new')); }
      super.postMessage(message);
    }
  }
  const stale = initSnapshotData(config('source:old', ReentrantWorker));
  const oldWorker = workers.at(-2), newWorker = workers.at(-1);
  assert.equal(stale, null); assert(sibling); assert.equal(state.graphWorkerClient, sibling); assert.equal(state.graphWorkerReady, true);
  assert.equal(state.snapshotManifest.snapshot, 'source:new'); const siblingDisposer = state.disposeSnapshotData;
  oldWorker.progress(); assert.equal(state.snapshotManifest.snapshot, 'source:new'); assert.equal(state.graphWorkerClient, sibling);
  const oldClientOwner = getPendingSceneResourceOwners().find(owner => owner.label === 'snapshot data original worker client' && owner.resource !== sibling);
  assert(oldClientOwner, 'late original client remains strongly retained by its exact cleanup owner');
  oldClientOwner.release(); assert.equal(oldWorker.closed, 1); assert.equal(newWorker.closed, 0);
  for (const owner of getPendingSceneResourceOwners()) {
    if ((owner.label === 'original snapshot data session' || owner.label === 'previous original snapshot data callback') && owner.lastError) {
      try { owner.release(); } catch { /* independent original blockers remain pending */ }
    }
  }
  assert.equal(state.graphWorkerClient, sibling); assert.equal(state.disposeSnapshotData, siblingDisposer); assert.equal(newWorker.closed, 0);
  siblingDisposer(); assert.equal(newWorker.closed, 1);

  // A captured fallback release can start a sibling. The earlier ready callback
  // must not run afterward, even though its native notification was accepted.
  reset(); let replacement, replacing = false, originalReadyCalls = 0;
  state.remoteSource = { releaseFallbackPages() {
    if (!replacing) { replacing = true; state.onSourceQueryReady = () => {}; replacement = initSnapshotData(config('source:replacement')); }
  } };
  state.onSourceQueryReady = () => originalReadyCalls++;
  assert.equal(initSnapshotData(config('source:revoked')), null); assert(replacement);
  assert.equal(originalReadyCalls, 0); assert.equal(state.graphWorkerClient, replacement); assert.equal(state.graphWorkerReady, true);

  // A revocation setter can publish a sibling while the earlier disposer is on
  // its stack. Later earlier clears must leave the new publication untouched.
  reset(); const revoking = initSnapshotData(config('source:revoking')), revokingWorker = workers.at(-1);
  const revokeOriginal = state.disposeSnapshotData; let clientSlot = revoking, setterReentered = false, setterSibling;
  Object.defineProperty(state, 'graphWorkerClient', { configurable: true, get() { return clientSlot; }, set(value) {
    clientSlot = value;
    if (value === null && !setterReentered) { setterReentered = true; setterSibling = initSnapshotData(config('source:setter-sibling')); }
  } });
  assert.throws(() => revokeOriginal());
  assert(setterSibling); assert.equal(state.graphWorkerClient, setterSibling); assert.equal(state.graphWorkerReady, true);
  assert.equal(state.snapshotManifest.snapshot, 'source:setter-sibling'); assert.equal(revokingWorker.closed, 0);
  const revokingClientOwner = getPendingSceneResourceOwners().find(owner => owner.resource === revoking);
  assert(revokingClientOwner); revokingClientOwner.release(); assert.equal(revokingWorker.closed, 1);
  assert.equal(state.graphWorkerClient, setterSibling); assert.equal(state.graphWorkerReady, true);

  // Pagehide removal failure cannot skip original client cleanup or clear a
  // newer publication. Failed remover retry remains explicit and exact.
  const failingHost = reset(), removeFailure = Object.freeze(new Error('original pagehide removal failed'));
  const failingClient = initSnapshotData(config()), failingWorker = workers.at(-1), failedDispose = state.disposeSnapshotData;
  assert(failingClient);
  failingHost.removeFails = true; failingHost.removeFailure = removeFailure;
  assert.throws(() => failedDispose(), error => contains(error, removeFailure));
  assert.equal(failingWorker.closed, 1); assert.equal(state.graphWorkerClient, null); assert.equal(state.graphWorkerReady, false);
  const pagehideOwner = getPendingSceneResourceOwners().find(owner => owner.resource === failingHost);
  assert(pagehideOwner); assert.equal(failingHost.removed, 1);
  assert.throws(() => failedDispose()); assert.equal(failingHost.removed, 1); assert.equal(failingWorker.closed, 1);
  const nextHost = hostDouble(); globalThis.window = nextHost;
  const nextClient = initSnapshotData(config('source:next')), nextWorker = workers.at(-1), nextDispose = state.disposeSnapshotData;
  assert(nextClient); failingHost.removeFails = false; pagehideOwner.release();
  assert.equal(failingHost.removed, 2); assert.equal(failingWorker.closed, 1); assert.equal(nextWorker.closed, 0);
  assert.equal(state.graphWorkerClient, nextClient); assert.equal(state.disposeSnapshotData, nextDispose); nextDispose();

  // Installed-then-throwing registration and disposer setters preserve falsey
  // primaries while independently retiring their already acquired resources.
  const partialHost = reset(); partialHost.addFails = true;
  assert.equal(initSnapshotData(config()), null); const partialWorker = workers.at(-1);
  assert.equal(partialWorker.closed, 1); assert.equal(partialHost.removed, 1); assert.equal(partialHost.listeners.size, 0);
  assert(contains(state.graphWorkerFailure, false));
  reset(); let slot;
  Object.defineProperty(state, 'disposeSnapshotData', { configurable: true, get() { return slot; }, set(value) {
    slot = value; if (typeof value === 'function') throw undefined;
  } });
  const beforeSetter = workers.length;
  assert.equal(initSnapshotData(config()), null); assert.equal(workers.length, beforeSetter);
  assert.equal(slot, null); assert(contains(state.graphWorkerFailure, undefined));

  // Accessor configuration cannot start a native constructor or lose its
  // original admitted state through a later getter invocation.
  reset(); let configReads = 0; const passive = config();
  Object.defineProperty(passive, 'snapshot', { get() { configReads++; return 'rewritten'; } });
  const beforeConfig = workers.length;
  assert.equal(initSnapshotData(passive), null); assert.equal(workers.length, beforeConfig); assert.equal(configReads, 0);
  assert.match(state.graphWorkerError, /passive/);

  // A falsey progress-inspection failure remains failure evidence; stale
  // notifications cannot restore readiness or publish over the replacement.
  reset(); const broken = initSnapshotData(config()), brokenWorker = workers.at(-1);
  brokenWorker.onmessage({ data: { protocol: MAP_DATA_PROTOCOL, snapshot: 'source:a', kind: 'init', get event() { throw false; } } });
  assert.equal(state.graphWorkerReady, false); assert(contains(state.graphWorkerFailure, false)); assert.equal(brokenWorker.closed, 1);
  const fresh = initSnapshotData(config('source:fresh')); assert(fresh);
  brokenWorker.progress(); assert.equal(state.graphWorkerClient, fresh); assert.equal(state.graphWorkerReady, true);
  assert.notEqual(broken, fresh); state.disposeSnapshotData();
} finally {
  if (typeof state.disposeSnapshotData === 'function') try { state.disposeSnapshotData(); } catch { /* exact pending inventory remains observable */ }
  for (const key of Reflect.ownKeys(state)) delete state[key];
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}
console.log('Actual snapshot session synchronous, stale publication and original cleanup controls authored.');
