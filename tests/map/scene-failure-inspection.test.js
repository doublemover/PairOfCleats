import assert from 'node:assert/strict';
import { captureSceneFailure } from '../../src/map/isometric/client/scene-failure-inspection.js';
import { captureSceneResource, preserveSceneCleanupFailures, observeSceneOwnership,
  getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';
import { createSceneConstructionOwner } from '../../src/map/isometric/client/rendering/scene-construction-owner.js';
import { enterSourceRendererFallback, describeRendererFailure } from '../../src/map/isometric/client/rendering/failure-state.js';

// Original actual owner/fallback boundaries with inert resources only.
// No browser, Three, native/driver, renderer host, child or GPU execution.
const baseline = new Set(getPendingSceneResourceOwners());
let sceneSettled = false, cacheSettled = false, constructionSettled = false, fallbackSettled = false, nativeCloseAllowed = false;
try {
  let sceneReads = 0, cacheReads = 0, replaced = false;
  const diagnostic = Object.freeze(Object.defineProperties(new Error('independent diagnostic scene/cache owner'), {
    sceneOwnershipReleased: { get() { sceneReads++; return replaced ? () => true : function () { assert.equal(this, diagnostic); return sceneSettled; }; } },
    cacheOwnershipReleased: { get() { cacheReads++; return replaced ? () => true : function () { assert.equal(this, diagnostic); return cacheSettled; }; } }
  }));
  let messageReads = 0, nameReads = 0, codeReads = 0, ownerReads = 0;
  const primary = new Error('lazy stack must not be requested');
  Object.defineProperties(primary, {
    message: { get() { messageReads++; throw diagnostic; } },
    name: { get() { nameReads++; return 'OriginalSceneFailure'; } },
    code: { get() { codeReads++; return 'CONTROLLED_ORIGINAL_SCENE'; } },
    sceneResourceOwners: { get() { ownerReads++; throw undefined; } }
  });
  const cleanup = Object.freeze(new Error('independent actual cleanup failure'));
  const combined = preserveSceneCleanupFailures(primary, [cleanup], { hasPrimary: true, forceAggregate: true });
  assert.equal(combined.cause, primary); assert.deepEqual(combined.errors, [primary, cleanup, diagnostic, undefined]);
  assert.deepEqual(combined.sceneInspectionErrors, [diagnostic, undefined]);
  assert.deepEqual(combined.sceneCleanupErrors, [cleanup]); assert.equal(combined.code, 'CONTROLLED_ORIGINAL_SCENE');
  assert.equal(combined.name, 'OriginalSceneFailure'); assert.equal(combined.sceneOwnershipPending, true);
  assert.equal(describeRendererFailure(primary), 'Renderer operation failed.');
  observeSceneOwnership(primary); captureSceneFailure(primary);
  assert.deepEqual([messageReads, nameReads, codeReads, ownerReads, sceneReads, cacheReads], [1, 1, 1, 1, 1, 1]);
  replaced = true; sceneSettled = true; assert.equal(combined.sceneOwnershipReleased(), false);
  cacheSettled = true; assert.equal(combined.sceneOwnershipReleased(), true);

  let descriptorSettled = false, stackDescriptors = 0, extraDescriptors = 0;
  const descriptorFailure = Object.freeze(Object.defineProperty(new Error('descriptor inspection original owner'), 'sceneOwnershipReleased', {
    value() { assert.equal(this, descriptorFailure); return descriptorSettled; }
  }));
  const proxy = new Proxy({ message: 'proxy failure', stack: 'never inspect', extra: 1 }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'stack') { stackDescriptors++; throw new Error('lazy stack descriptor requested'); }
      if (key === 'extra') { extraDescriptors++; throw descriptorFailure; }
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const proxyFailure = preserveSceneCleanupFailures(proxy, [], { hasPrimary: true, forceAggregate: true });
  assert.equal(proxyFailure.cause, proxy); assert.deepEqual(proxyFailure.sceneInspectionErrors, [descriptorFailure]);
  assert.equal(proxyFailure.sceneOwnershipReleased(), false); assert.equal(stackDescriptors, 0); assert.equal(extraDescriptors, 1);
  describeRendererFailure(proxy); preserveSceneCleanupFailures(proxy, [cleanup]);
  assert.equal(stackDescriptors, 0); assert.equal(extraDescriptors, 1);
  descriptorSettled = true; assert.equal(proxyFailure.sceneOwnershipReleased(), true);

  for (const value of [undefined, null, false, 0, '']) {
    const original = Object.freeze(Object.defineProperty({}, 'message', { get() { throw value; } }));
    const failed = preserveSceneCleanupFailures(original, [], { hasPrimary: true, forceAggregate: true });
    assert.equal(failed.cause, original); assert.deepEqual(failed.sceneInspectionErrors, [value]);
    const unknown = Object.freeze(Object.defineProperty(new Error('unknown original ownership inspection'), 'sceneOwnershipReleased', {
      get() { throw value; }
    }));
    const unknownFailure = preserveSceneCleanupFailures(unknown, [], { hasPrimary: true, forceAggregate: true });
    assert.equal(unknownFailure.cause, unknown); assert.deepEqual(unknownFailure.sceneInspectionErrors, [value]);
    assert.equal(unknownFailure.sceneOwnershipReleased(), false, 'unknown original function capture remains unconfirmed');
  }
  const deepest = Object.freeze(new Error('nested exact scene cause'));
  const nested = Object.freeze(new AggregateError([deepest], 'nested original aggregate', { cause: deepest }));
  const nestedFailure = preserveSceneCleanupFailures(nested, [cleanup]);
  assert.equal(nestedFailure.cause, nested); assert.deepEqual(nestedFailure.errors, [nested, cleanup]);
  assert.equal(nested.cause, deepest); assert.deepEqual(nested.errors, [deepest]);

  // Actual partial construction gates captured children on the diagnostic's
  // original native-work observation before any child disposal is attempted.
  const work = Object.freeze(Object.defineProperty(new Error('construction diagnostic work'), 'cacheOwnershipReleased', {
    value() { assert.equal(this, work); return constructionSettled; }
  }));
  const constructionPrimary = new Error('unread lazy stack');
  Object.defineProperty(constructionPrimary, 'message', { get() { throw work; } });
  const construction = createSceneConstructionOwner();
  const first = { calls: 0, dispose() { this.calls++; } }, second = { calls: 0, dispose() { this.calls++; } };
  construction.capture(first, 'first original construction child'); construction.capture(second, 'second original construction child');
  construction.retainFailure(constructionPrimary);
  assert.throws(() => construction.retire(), error => error.sceneOwnershipPending === true);
  assert.equal(first.calls, 0); assert.equal(second.calls, 0);
  first.dispose = () => assert.fail('original captured construction disposer remains selected');
  constructionSettled = true;
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) owner.release();
  construction.retire(); assert.equal(first.calls, 1); assert.equal(second.calls, 1);

  // Actual source fallback must display a throwing diagnostic once and retain
  // the original operation plus its independently captured native close error.
  let fallbackMessageReads = 0;
  const fallbackWork = Object.freeze(Object.defineProperty(new Error('fallback diagnostic work'), 'cacheOwnershipReleased', {
    value() { assert.equal(this, fallbackWork); return fallbackSettled; }
  }));
  const fallbackPrimary = new Error('unread fallback lazy stack');
  Object.defineProperty(fallbackPrimary, 'message', { get() { fallbackMessageReads++; throw fallbackWork; } });
  const native = { calls: 0, dispose() { this.calls++; if (!nativeCloseAllowed) throw cleanup; } };
  const nativeOwner = captureSceneResource(native, 'fallback original native resource');
  const state = { sourceIndex: {}, remoteSource: null, scene: {}, renderer: {}, disposeScene() { nativeOwner.retire(); } };
  const summary = { textContent: '', append() {} };
  const fallback = await enterSourceRendererFallback({ state, summary, retry: {}, error: fallbackPrimary });
  assert.equal(state.rendererCapabilities.backend, 'source-only'); assert.equal(state.rendererFailure, fallback);
  assert.equal(fallback.cause, fallbackPrimary); assert.equal(fallback.sceneOwnershipReleased(), false);
  assert.equal(fallbackMessageReads, 1); assert.match(summary.textContent, /Renderer operation failed/);
  assert.equal(native.calls, 0, 'original diagnostic native work gates the captured cleanup callback');
  fallbackSettled = true; assert.equal(fallback.sceneOwnershipReleased(), false);
  for (const owner of fallback.sceneResourceOwners) await assert.rejects(owner.releaseAsync(), error => error.sceneOwnershipPending === true);
  assert.equal(native.calls, 1, 'explicit callback reconciliation preserves its independently observed native close failure');
  nativeCloseAllowed = true; nativeOwner.release(); assert.equal(native.calls, 2);
  for (const owner of fallback.sceneResourceOwners) await owner.releaseAsync();
  assert.equal(fallback.sceneOwnershipReleased(), true);
} finally {
  sceneSettled = true; cacheSettled = true; constructionSettled = true; fallbackSettled = true; nativeCloseAllowed = true;
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { owner.release(); } catch {} }
}
{
  let reads = 0, released = false;
  const diagnostic = Object.freeze(Object.defineProperty(new Error('late diagnostic resource'),
    'cacheOwnershipReleased', { value: () => released }));
  const original = Object.freeze(Object.defineProperties({}, {
    message: { get() { reads++; throw diagnostic; } },
    name: { get() { reads++; return 'OriginalFailure'; } }
  }));
  const passive = captureSceneFailure(original, { diagnostics: false });
  assert.equal(reads, 0); assert.equal(passive.released(), true);
  const active = captureSceneFailure(original);
  assert.equal(active, passive); assert.equal(reads, 2);
  assert.deepEqual(active.inspectionErrors, [diagnostic]); assert.equal(active.released(), false);
  captureSceneFailure(original); assert.equal(reads, 2, 'upgrading capture inspects diagnostics only once');
  released = true; assert.equal(active.released(), true);
}
console.log('Map diagnostic, lazy-stack, passive-upgrade, proxy, falsey and independent ownership controls passed.');
