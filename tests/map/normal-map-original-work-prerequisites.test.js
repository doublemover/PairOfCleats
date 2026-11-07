import assert from 'node:assert/strict';
import { createNormalMapOwner, retireNormalMapState } from '../../src/map/isometric/client/normal-map-owner.js';
import { captureScenePrerequisiteProducer, getPendingSceneResourceOwners, preserveSceneCleanupFailures } from '../../src/map/isometric/client/scene-retirement.js';

// Actual normal-map/native capabilities and private original producers, inert
// disposal counters only. No Three, loader/network, native/GPU or host execution.
const baseline = new Set(getPendingSceneResourceOwners()), finish = [], textures = [];
const leaf = Object.freeze(new Error('original frozen texture leaf'));
const closeFailure = Object.freeze(new AggregateError([leaf], 'original frozen texture close', { cause: leaf }));
const failed = invoke => { try { invoke(); assert.fail('expected retained original work'); } catch (error) {
  assert.equal(error.sceneOwnershipPending, true); return error;
} };
const texture = dispose => {
  const value = { calls: 0, refusing: true, dispose() { this.calls++; if (dispose) return dispose.call(this); if (this.refusing) throw closeFailure; } };
  textures.push(value); return value;
};
const managerFor = value => { const manager = createNormalMapOwner({ isCurrent: () => true, configure() {} }); manager.track(value); return manager; };
const pairFor = (value, manager) => ({ primitive: getPendingSceneResourceOwners().find(owner => owner.resource === value), guarded: manager.pendingOwners[0] });
const releasePair = pair => { pair.primitive.release(); pair.guarded.release(); };
const observer = (message, channels = ['cache']) => {
  const flag = { settled: false }; finish.push(() => { flag.settled = true; });
  const original = new Error(message);
  for (const channel of channels) Object.defineProperty(original, `${channel}OwnershipReleased`, { value() { assert.equal(this, original); return flag.settled; } });
  return { original: Object.freeze(original), flag };
};
try {
  // A privately known original resource failure may receive its first cache
  // channel later. Its own scene closure is the only delegated observation.
  const first = texture(), manager = managerFor(first);
  const known = failed(() => retireNormalMapState(manager)), pair = pairFor(first, manager);
  let cacheSettled = false, replaced = false, reads = 0; finish.push(() => { cacheSettled = true; });
  const originalCache = function() { assert.equal(this, known); return cacheSettled; };
  Object.defineProperty(known, 'cacheOwnershipReleased', { get() { reads++; return replaced ? () => true : originalCache; } });
  assert(captureScenePrerequisiteProducer(known, [pair.guarded]));
  const retained = failed(() => manager.fail(known)); assert.equal(first.calls, 1);
  replaced = true; first.refusing = false;
  first.dispose = () => assert.fail('keep the texture original native method');
  failed(() => pair.primitive.release()); failed(() => pair.guarded.release());
  assert.equal(first.calls, 1); assert.equal(reads, 1, 'a replacement observer cannot replace the original captured cache function');
  cacheSettled = true; releasePair(pair); assert.equal(first.calls, 2); assert.equal(retained.sceneOwnershipReleased(), true);
  releasePair(pair); assert.equal(first.calls, 2);
  assert.equal(closeFailure.cause, leaf); assert.deepEqual(closeFailure.errors, [leaf]);

  // Newly observed work after successful physical closure delays confirmation
  // without re-invoking either successful native disposal or the closed guard.
  const later = observer('later original loading work');
  const lateFailure = failed(() => manager.fail(later.original));
  failed(() => pair.primitive.release()); failed(() => pair.guarded.release()); assert.equal(first.calls, 2);
  later.flag.settled = true; releasePair(pair); assert.equal(first.calls, 2); assert.equal(lateFailure.sceneOwnershipReleased(), true);

  const fulfilled = texture(); fulfilled.refusing = false; const fulfilledManager = managerFor(fulfilled);
  fulfilledManager.dispose(); assert.equal(fulfilled.calls, 1);
  const originallyPlain = { message: 'initially absent original work evidence' };
  const originalComposition = preserveSceneCleanupFailures(originallyPlain, [], { hasPrimary: true, forceAggregate: true });
  assert.equal(originalComposition.sceneOwnershipReleased(), true);
  let firstEvidence = false; finish.push(() => { firstEvidence = true; });
  Object.defineProperty(originallyPlain, 'cacheOwnershipReleased', { value() { assert.equal(this, originallyPlain); return firstEvidence; } });
  failed(() => fulfilledManager.fail(originalComposition)); const fulfilledPair = pairFor(fulfilled, fulfilledManager);
  assert.equal(originalComposition.sceneOwnershipReleased(), false, 'an owned aggregate retains the stable predicate of an originally absent channel after its first admission');
  failed(() => fulfilledPair.primitive.release()); assert.equal(fulfilled.calls, 1);
  firstEvidence = true; releasePair(fulfilledPair); assert.equal(fulfilled.calls, 1);

  // A known aggregate still has its own independent cache and diagnostic work.
  const composedTexture = texture(), composedManager = managerFor(composedTexture);
  const own = failed(() => composedManager.dispose()), composedPair = pairFor(composedTexture, composedManager);
  const diagnostic = observer('independent original diagnostic scene/cache work', ['scene', 'cache']);
  let aggregateCache = false, messageReads = 0; finish.push(() => { aggregateCache = true; });
  const composed = preserveSceneCleanupFailures(own, [leaf], { hasPrimary: true, forceAggregate: true });
  Object.defineProperties(composed, { message: { get() { messageReads++; throw diagnostic.original; } },
    cacheOwnershipReleased: { value() { assert.equal(this, composed); return aggregateCache; } } });
  const composedFailure = failed(() => composedManager.fail(composed)); composedTexture.refusing = false;
  failed(() => composedPair.primitive.release()); assert.equal(composedTexture.calls, 1);
  diagnostic.flag.settled = true; failed(() => composedPair.primitive.release()); assert.equal(composedTexture.calls, 1);
  aggregateCache = true; releasePair(composedPair); assert.equal(composedTexture.calls, 2); assert.equal(messageReads, 1);
  assert.equal(composedFailure.sceneOwnershipReleased(), true, 'exact private constituents avoid a local self-observer cycle without dropping independent work');

  // A privately produced composition containing known local and unknown work
  // cannot use its known constituent as authority for the independent blocker.
  const mixedTexture = texture(), mixedManager = managerFor(mixedTexture);
  const mixedKnown = failed(() => mixedManager.dispose()), mixedPair = pairFor(mixedTexture, mixedManager);
  const unknown = Object.freeze(Object.assign(new Error('unknown original native settlement'), { cacheOwnershipPending: true }));
  const mixed = preserveSceneCleanupFailures(mixedKnown, [unknown], { hasPrimary: true, forceAggregate: true });
  failed(() => mixedManager.fail(mixed)); mixedTexture.refusing = false;
  failed(() => mixedPair.primitive.release()); failed(() => mixedPair.guarded.release()); assert.equal(mixedTexture.calls, 1);

  // Public cause/owner fields and copied exact closure callbacks prove no local
  // producer identity. The independent unknown channel remains authoritative.
  const copiedTexture = texture(), copiedManager = managerFor(copiedTexture);
  const copiedKnown = failed(() => copiedManager.dispose()), copiedPair = pairFor(copiedTexture, copiedManager);
  const copied = Object.freeze(Object.defineProperties(new AggregateError([copiedKnown], 'copied known wrapper', { cause: copiedKnown }), {
    sceneResourceOwners: { value: copiedKnown.sceneResourceOwners }, sceneResourceOwner: { value: copiedKnown.sceneResourceOwner },
    sceneOwnershipReleased: { value: copiedKnown.sceneOwnershipReleased }, cacheOwnershipPending: { value: true }
  }));
  assert.equal(captureScenePrerequisiteProducer(copied, [copiedPair.primitive, copiedPair.guarded]), null);
  failed(() => copiedManager.fail(copied)); copiedTexture.refusing = false;
  failed(() => copiedPair.primitive.release()); failed(() => copiedPair.guarded.release()); assert.equal(copiedTexture.calls, 1);

  // Even an identical function used in both channels cannot let private scene
  // delegation remove the independent cache channel of a genuine composition.
  const aliasTexture = texture(), aliasManager = managerFor(aliasTexture);
  const aliasKnown = failed(() => aliasManager.dispose()), aliasPair = pairFor(aliasTexture, aliasManager);
  const alias = preserveSceneCleanupFailures(aliasKnown, [leaf], { hasPrimary: true, forceAggregate: true });
  Object.defineProperty(alias, 'cacheOwnershipReleased', { value: alias.sceneOwnershipReleased });
  failed(() => aliasManager.fail(alias)); aliasTexture.refusing = false;
  failed(() => aliasPair.primitive.release()); assert.equal(aliasTexture.calls, 1);

  // A throwing ownership getter remains unknown even after the separately
  // thrown diagnostic settles; a known wrapper never erases that distinction.
  const inspectTexture = texture(), inspectManager = managerFor(inspectTexture);
  const inspectKnown = failed(() => inspectManager.dispose()), inspectPair = pairFor(inspectTexture, inspectManager);
  const inspection = observer('ownership capture diagnostic');
  Object.defineProperty(inspectKnown, 'cacheOwnershipReleased', { get() { throw inspection.original; } });
  failed(() => inspectManager.fail(inspectKnown)); inspection.flag.settled = true; inspectTexture.refusing = false;
  failed(() => inspectPair.primitive.release()); assert.equal(inspectTexture.calls, 1);

  const boundedTexture = texture(), boundedManager = managerFor(boundedTexture);
  const boundedKnown = failed(() => boundedManager.dispose()), boundedPair = pairFor(boundedTexture, boundedManager);
  const beyond = preserveSceneCleanupFailures(boundedKnown, new Array(257).fill(leaf), { hasPrimary: true, forceAggregate: true });
  failed(() => boundedManager.fail(beyond)); boundedTexture.refusing = false;
  failed(() => boundedPair.primitive.release()); assert.equal(boundedTexture.calls, 1,
    'prerequisite link overflow is unconfirmed instead of dropping an unexamined original observation');

  // A successful native promise which later awaits original work retains that
  // fulfillment and must not call the native disposer again on reconciliation.
  let resolve; const nativePromise = new Promise(done => { resolve = done; }); finish.push(resolve);
  const asynchronous = texture(() => nativePromise), asyncManager = managerFor(asynchronous);
  failed(() => asyncManager.dispose()); const asyncPair = pairFor(asynchronous, asyncManager);
  const asyncWork = observer('original work observed during native close');
  const asyncFailure = failed(() => asyncManager.fail(asyncWork.original)); resolve(); await new Promise(setImmediate);
  await assert.rejects(asyncPair.primitive.releaseAsync(), error => error.sceneOwnershipPending === true);
  assert.equal(asynchronous.calls, 1); asyncWork.flag.settled = true;
  await asyncPair.primitive.releaseAsync(); await asyncPair.guarded.releaseAsync();
  assert.equal(asynchronous.calls, 1); assert.equal(asyncFailure.sceneOwnershipReleased(), true);

  // Foreign original producers stay foreign. Reconciliation never calls the
  // sibling's native disposer on behalf of the local texture.
  const foreignTexture = texture(), foreignManager = managerFor(foreignTexture);
  const foreignFailure = failed(() => foreignManager.dispose()), foreignPair = pairFor(foreignTexture, foreignManager);
  const localTexture = texture(); localTexture.refusing = false;
  const localManager = createNormalMapOwner({ isCurrent: () => true, configure() { throw foreignFailure; } });
  localManager.track(localTexture); failed(() => localManager.accept(localTexture)); const localPair = pairFor(localTexture, localManager);
  failed(() => localPair.primitive.release()); assert.equal(localTexture.calls, 0); assert.equal(foreignTexture.calls, 1);
  foreignTexture.refusing = false; releasePair(foreignPair); releasePair(localPair);
  assert.equal(localTexture.calls, 1); assert.equal(foreignTexture.calls, 2);
} finally {
  for (const complete of finish) complete(); for (const value of textures) value.refusing = false;
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
  // Unknown/copy/alias/throwing-inspection negatives intentionally remain scoped
  // and pending. These are inert objects, never real native allocations.
}
console.log('Normal-map exact original prerequisite/native retry/private producer controls authored; execution deferred.');
