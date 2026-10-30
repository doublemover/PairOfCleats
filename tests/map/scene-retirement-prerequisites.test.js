import assert from 'node:assert/strict';
import { captureSceneResource, preserveSceneCleanupFailures, getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';
import { createSceneDisposerGuard, retainSceneDisposerFailure } from '../../src/map/isometric/client/rendering/scene-disposer-guard.js';
import { enterSourceRendererFallback } from '../../src/map/isometric/client/rendering/failure-state.js';

// Exact actual resource/fallback owners with inert native counters only.
const baseline = new Set(getPendingSceneResourceOwners()), complete = [];
const rejected = invoke => { try { invoke(); assert.fail('expected original prerequisite'); } catch (error) {
  assert.equal(error.sceneOwnershipPending, true); return error;
} };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); complete.push(resolve); return { promise, resolve }; };
let sceneSettled = false, cacheSettled = false, extraSettled = false, copiedSettled = false, lateSettled = false, fallbackSettled = false;
try {
  const child = Object.freeze(Object.defineProperties(new Error('original independent scene/cache work'), {
    sceneOwnershipReleased: { value() { assert.equal(this, child); return sceneSettled; } },
    cacheOwnershipReleased: { value() { assert.equal(this, child); return cacheSettled; } }
  }));
  const native = { calls: 0, dispose() { this.calls++; if (this.calls === 1) throw child; } };
  const owner = captureSceneResource(native, 'original dual prerequisite');
  const original = rejected(() => owner.retire()); assert.equal(native.calls, 1);
  owner.retainFailure(original); rejected(() => owner.release()); assert.equal(native.calls, 1);
  sceneSettled = true; rejected(() => owner.release()); assert.equal(native.calls, 1);
  cacheSettled = true;
  Object.defineProperty(original, 'cacheOwnershipReleased', { value() { assert.equal(this, original); return extraSettled; } });
  owner.retainFailure(original); rejected(() => owner.release()); assert.equal(native.calls, 1,
    'private original producer proof cannot discard an independently attached cache observation');
  extraSettled = true; owner.release(); assert.equal(native.calls, 2); assert.equal(original.sceneOwnershipReleased(), true);
  owner.release(); assert.equal(native.calls, 2);

  const ordinary = Object.freeze(new Error('ordinary original failed native close'));
  const composedNative = { calls: 0, dispose() { this.calls++; if (this.calls === 1) throw ordinary; } };
  const composedOwner = captureSceneResource(composedNative, 'private composition original owner');
  const known = rejected(() => composedOwner.retire());
  let independentSettled = false; complete.push(() => { independentSettled = true; });
  const independent = Object.freeze(Object.defineProperty(new Error('independent mixed prerequisite'), 'cacheOwnershipReleased', {
    value() { assert.equal(this, independent); return independentSettled; }
  }));
  const composed = preserveSceneCleanupFailures(known, [independent], { hasPrimary: true, forceAggregate: true });
  composedOwner.retainFailure(composed); rejected(() => composedOwner.release()); assert.equal(composedNative.calls, 1);
  independentSettled = true; composedOwner.release(); assert.equal(composedNative.calls, 2);
  assert.equal(composed.sceneOwnershipReleased(), true, 'original owned composition does not create a self-observer cycle');

  const copiedNative = { calls: 0, dispose() { this.calls++; } }, copiedOwner = captureSceneResource(copiedNative, 'copied owner negative');
  const copied = Object.freeze(Object.defineProperties(new AggregateError([known, independent], 'copied causal lookalike'), {
    sceneResourceOwner: { value: copiedOwner }, sceneResourceOwners: { value: [copiedOwner] },
    sceneOwnershipReleased: { value: () => true }, cacheOwnershipReleased: { value: () => copiedSettled }
  }));
  copiedOwner.retainFailure(copied); rejected(() => copiedOwner.retire()); assert.equal(copiedNative.calls, 0);
  copiedSettled = true; copiedOwner.release(); assert.equal(copiedNative.calls, 1);

  const gate = deferred(); let asyncCalls = 0;
  const asynchronous = captureSceneResource({ dispose() { asyncCalls++; return gate.promise; } }, 'successful native close late original work');
  const waiting = asynchronous.retireAsync();
  const late = Object.freeze(Object.defineProperty(new Error('independent accepted native work'), 'cacheOwnershipReleased', {
    value() { assert.equal(this, late); return lateSettled; }
  }));
  asynchronous.retainFailure(late); gate.resolve();
  await assert.rejects(waiting, error => error.sceneOwnershipPending === true);
  rejected(() => asynchronous.release()); assert.equal(asyncCalls, 1);
  lateSettled = true; await asynchronous.releaseAsync(); assert.equal(asyncCalls, 1,
    'fulfilled original native disposal is remembered through pending-work reconciliation');

  const sharedGate = deferred(); let sharedCalls = 0;
  const shared = captureSceneResource({ dispose() { sharedCalls++; return sharedGate.promise; } }, 'joined original async close');
  const first = shared.retireAsync(), second = shared.retireAsync(); sharedGate.resolve();
  assert.equal(await first, await second); assert.equal(sharedCalls, 1);

  const source = {}, scene = {}, renderer = {}, summary = { textContent: '', append() {} };
  const fallbackNative = { calls: 0, dispose() { this.calls++; } }, fallbackOwner = captureSceneResource(fallbackNative, 'actual fallback prerequisite target');
  const fallbackPrimary = Object.freeze(Object.defineProperty(new Error('original enhancement native work'), 'cacheOwnershipReleased', {
    value() { assert.equal(this, fallbackPrimary); return fallbackSettled; }
  }));
  const state = { sourceIndex: source, scene, renderer };
  const originalDisposer = createSceneDisposerGuard({ receiver: state, beforeDispose: fallbackOwner.assertReady,
    retainFailure: fallbackOwner.retainFailure, dispose() { assert.equal(this, state); fallbackOwner.retire(); } });
  state.disposeScene = originalDisposer;
  const failure = await enterSourceRendererFallback({ state, summary, retry: {}, error: fallbackPrimary });
  assert.equal(state.rendererCapabilities.backend, 'source-only'); assert.equal(failure.cause, fallbackPrimary);
  assert.equal(fallbackNative.calls, 0); assert.throws(() => originalDisposer(), error => error === fallbackPrimary);
  const lookalike = () => originalDisposer(); lookalike.retainFailure = () => assert.fail('public properties are not original guard proof');
  assert.equal(retainSceneDisposerFailure(lookalike, fallbackPrimary), false);
  fallbackSettled = true;
  for (const retained of getPendingSceneResourceOwners()) if (!baseline.has(retained)) await retained.releaseAsync();
  assert.equal(fallbackNative.calls, 1); assert.equal(failure.sceneOwnershipReleased(), true);

  let previousCalls = 0, siblingCalls = 0;
  const replacement = { sourceIndex: {}, scene: {}, renderer: {}, disposeScene() { previousCalls++; } };
  const sibling = () => { siblingCalls++; };
  const replacingSummary = { textContent: '', append() {
    replacement.scene = {}; replacement.renderer = {}; replacement.disposeScene = sibling;
    replacement.rendererFailure = independent; this.textContent = 'new source status';
  } };
  await enterSourceRendererFallback({ state: replacement, summary: replacingSummary, retry: {}, error: ordinary });
  assert.equal(previousCalls, 1); assert.equal(siblingCalls, 0); assert.equal(replacement.disposeScene, sibling);
  assert.equal(replacement.rendererFailure, independent); assert.equal(replacingSummary.textContent, 'new source status');

  const unknown = Object.freeze(Object.assign(new Error('unknown original native settlement'), { cacheOwnershipPending: true }));
  const unknownNative = { calls: 0, dispose() { this.calls++; if (this.calls === 1) throw unknown; } };
  const unknownOwner = captureSceneResource(unknownNative, 'unknown original prerequisite retained');
  rejected(() => unknownOwner.retire()); rejected(() => unknownOwner.release()); assert.equal(unknownNative.calls, 1);
  assert.equal(unknownOwner.pending, true, 'unknown native work remains retained rather than qualified as safe to retry');
} finally {
  sceneSettled = true; cacheSettled = true; extraSettled = true; copiedSettled = true; lateSettled = true; fallbackSettled = true;
  for (const finish of complete) finish();
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
}
console.log('Scene native retry prerequisites/private composition/unknown/copy/dual/fallback controls authored; execution deferred.');
