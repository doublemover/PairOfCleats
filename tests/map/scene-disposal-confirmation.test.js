import assert from 'node:assert/strict';
import { captureSceneResource, observeSceneOwnership, getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Inert captured resource boundaries only. No scene, renderer, host or GPU.
const baseline = new Set(getPendingSceneResourceOwners());
let confirmed = false, syncCalls = 0;
const sync = captureSceneResource({ dispose() { syncCalls++; return confirmed; } }, 'inert false-result scene child');
try {
  assert.throws(() => sync.retire(), error => error.code === 'ERR_MAP_SCENE_DISPOSAL_UNCONFIRMED'
    && error.sceneOwnershipPending === true);
  assert.throws(() => sync.retire()); assert.equal(syncCalls, 1, 'ordinary retirement does not retry a known failed close');
  confirmed = true; sync.release(); sync.retire(); assert.equal(syncCalls, 2); assert.equal(sync.pending, false);

  let complete, asyncCalls = 0;
  const async = captureSceneResource({ dispose() { asyncCalls++; return new Promise(resolve => { complete = resolve; }); } }, 'inert async false-result scene child');
  const pending = (() => { try { async.retire(); assert.fail('expected unsettled child'); } catch (error) { return error; } })();
  assert.equal(pending.sceneOwnershipPending, true); complete(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(async.pending, true); assert.equal(async.lastError.code, 'ERR_MAP_SCENE_DISPOSAL_UNCONFIRMED');
  assert.throws(() => async.retire()); assert.equal(asyncCalls, 1);
  assert.throws(() => async.release()); assert.equal(asyncCalls, 2); complete(undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(async.pending, false); assert.equal(pending.sceneOwnershipReleased(), true);

  let sceneSettled = false, cacheSettled = false, replaced = false, sceneReads = 0, cacheReads = 0;
  const original = Object.freeze(Object.defineProperties(new Error('independent original scene and cache observers'), {
    sceneOwnershipReleased: { get() { sceneReads++; return replaced ? () => true : function () { assert.equal(this, original); return sceneSettled; }; } },
    cacheOwnershipReleased: { get() { cacheReads++; return replaced ? () => true : function () { assert.equal(this, original); return cacheSettled; }; } }
  }));
  const first = observeSceneOwnership(original); replaced = true;
  assert.equal(observeSceneOwnership(original), first); assert.equal(first(), false);
  sceneSettled = true; assert.equal(first(), false); cacheSettled = true; assert.equal(first(), true);
  assert.equal(sceneReads, 1); assert.equal(cacheReads, 1);
  const attached = new Error('an absent owner can attach its first actual observer later');
  assert.equal(observeSceneOwnership(attached), null);
  Object.defineProperty(attached, 'sceneOwnershipReleased', { value: () => false });
  assert.equal(observeSceneOwnership(attached)(), false);
  const secondChannel = new Error('a second original ownership channel may attach later');
  Object.defineProperty(secondChannel, 'sceneOwnershipReleased', { value: () => true });
  const firstChannel = observeSceneOwnership(secondChannel); assert.equal(firstChannel(), true);
  Object.defineProperty(secondChannel, 'cacheOwnershipReleased', { value: () => false });
  assert.equal(observeSceneOwnership(secondChannel), firstChannel); assert.equal(firstChannel(), false,
    'capturing the original scene observer does not treat an absent cache channel as settled');

  let requiredReads = 0;
  const absent = {};
  Object.defineProperty(absent, 'dispose', { configurable: true, get() { requiredReads++; return undefined; } });
  const required = captureSceneResource(absent, 'required inert texture', 'dispose', [], { required: true });
  assert.throws(() => required.retire(), error => error.cause instanceof TypeError && error.sceneOwnershipPending === true);
  Object.defineProperty(absent, 'dispose', { value() { assert.fail('a later method cannot replace an uncaptured original disposer'); } });
  assert.throws(() => required.release()); assert.equal(requiredReads, 1); assert.equal(required.pending, true,
    'an inaccessible original close owner remains explicitly retained, not qualified as released');
} finally {
  confirmed = true;
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { owner.release(); } catch {} }
}
console.log('Scene explicit false-result/original dual observation controls authored; execution deferred.');
