import assert from 'node:assert/strict';
import { createRenderLoop } from '../../src/map/isometric/client/render-loop.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual render/resource owners with inert original RAF request/delivery/cancel.
const baseline = new Set(getPendingSceneResourceOwners()), fixtures = [], finish = [];
const pending = () => getPendingSceneResourceOwners().filter(owner => !baseline.has(owner));
const caught = invoke => { try { invoke(); } catch (error) { return error; } assert.fail('expected retained original RAF failure'); };
const make = () => {
  const value = { callbacks: new Map(), issued: new Map(), cancellations: [], frames: [], next: 0, visible: true };
  value.options = { visible: () => value.visible,
    request: callback => { const id = ++value.next; value.callbacks.set(id, callback); value.issued.set(id, callback); value.request?.(id, callback);
      return Object.hasOwn(value, 'handle') ? value.handle : id; },
    cancel: id => { value.cancellations.push(id); const result = value.cancel?.(id); if (result !== undefined) return result; value.callbacks.delete(id); },
    render: (time, context) => { value.frames.push({ time, ...context }); return value.render?.() || false; } };
  value.loop = createRenderLoop(value.options);
  value.deliver = id => { value.callbacks.delete(id); return value.issued.get(id)(id * 16); };
  fixtures.push(value); return value;
};
try {
  const normal = make(); normal.loop.invalidate(); normal.loop.invalidate(); assert.equal(normal.callbacks.size, 1);
  normal.options.request = normal.options.cancel = normal.options.render = () => assert.fail('replacement fields are not original loop callbacks');
  normal.deliver(1); assert.equal(normal.frames.length, 1); assert.equal(normal.callbacks.size, 0);
  normal.loop.invalidate(); normal.visible = false; normal.loop.visibilityChanged(); assert.equal(normal.callbacks.size, 0); assert.deepEqual(normal.cancellations, [2]);
  normal.visible = true; normal.loop.visibilityChanged(); normal.deliver(3); assert.equal(normal.frames.at(-1).continuous, false); normal.loop.dispose();

  let ready = false, reads = 0; finish.push(() => { ready = true; });
  const original = Object.defineProperty(new Error('original failed native cancellation'), 'cacheOwnershipReleased', { configurable: true,
    get() { reads++; return function() { assert.equal(this, original); return ready; }; } });
  const failed = make(); failed.cancel = () => { if (!ready) throw original; }; failed.loop.invalidate();
  const failure = caught(failed.loop.dispose); assert.equal(failed.cancellations.length, 1); caught(failed.loop.dispose);
  const child = pending().find(owner => owner.label === 'original RAF request'), outer = pending().find(owner => owner.label === 'original render loop');
  Object.defineProperty(original, 'cacheOwnershipReleased', { value: () => true }); caught(child.release); caught(outer.release);
  assert.equal(failed.cancellations.length, 1); assert.equal(reads, 1); ready = true; child.release(); outer.release();
  assert.deepEqual(failed.cancellations, [1, 1]); assert.equal(failure.sceneOwnershipReleased(), true);
  failed.deliver(1); assert.equal(failed.frames.length, 0, 'retired original callback cannot render after exact cancellation reconciliation');

  const deliveredAfterFailure = make(); let refusing = true; finish.push(() => { refusing = false; });
  deliveredAfterFailure.cancel = () => { if (refusing) throw new Error('unconfirmed original cancellation'); };
  deliveredAfterFailure.loop.invalidate(); const observed = caught(deliveredAfterFailure.loop.dispose);
  const deliveredChild = pending().find(owner => owner.label === 'original RAF request'), deliveredOuter = pending().find(owner => owner.label === 'original render loop');
  deliveredAfterFailure.deliver(1); assert.equal(deliveredAfterFailure.frames.length, 0); deliveredChild.release(); deliveredOuter.release();
  assert.equal(deliveredAfterFailure.cancellations.length, 1, 'actual original callback delivery closes its exact queue record without repeating failed cancel');
  assert.equal(observed.sceneOwnershipReleased(), true);

  const requestFailure = Object.freeze(Object.assign(new Error('original request threw after queuing'), { frameHandle: 1,
    sceneResourceOwner: { release() { assert.fail('reported owner/handle fields cannot authorize a cancel'); } } }));
  const partial = make(); partial.request = () => { throw requestFailure; };
  assert.equal(caught(partial.loop.invalidate), requestFailure); const partialFailure = caught(partial.loop.dispose);
  const partialChild = pending().find(owner => owner.label === 'original RAF request'), partialOuter = pending().find(owner => owner.label === 'original render loop');
  caught(partialChild.release); assert.equal(partial.cancellations.length, 0);
  partial.deliver(1); partialChild.release(); partialOuter.release(); assert.equal(partial.cancellations.length, 0);
  assert.equal(partialFailure.sceneOwnershipReleased(), true, 'unknown request settlement requires its original delivery, not a thrown handle/code');

  for (const handle of [undefined, null, false, -1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = make(); invalid.handle = handle; caught(invalid.loop.invalidate); caught(invalid.loop.dispose);
    const invalidChild = pending().find(owner => owner.label === 'original RAF request'), invalidOuter = pending().find(owner => owner.label === 'original render loop');
    caught(invalidChild.release); assert.equal(invalid.cancellations.length, 0); invalid.deliver(1); invalidChild.release(); invalidOuter.release();
    assert.equal(invalid.cancellations.length, 0); assert.equal(invalid.frames.length, 0);
  }
  const synchronous = make(); synchronous.request = (_id, callback) => callback(0); caught(synchronous.loop.invalidate);
  synchronous.loop.dispose(); assert.equal(synchronous.frames.length, 0); assert.equal(synchronous.cancellations.length, 0,
    'an original synchronous delivery is retained as acquisition failure without an unowned native render');

  const active = make(); let activeFailure, during;
  active.render = () => { activeFailure = caught(active.loop.dispose); during = activeFailure.sceneOwnershipReleased(); return false; };
  active.loop.invalidate(); active.deliver(1); assert.equal(during, false); assert.equal(activeFailure.sceneOwnershipReleased(), true);
  assert.equal(active.cancellations.length, 0); pending().find(owner => owner.label === 'original render loop').release();

  // Stale deliveries cannot clear a later pending slot, reset its continuous
  // observation, submit a render, or schedule an additional request.
  const stale = make(); stale.loop.invalidate(); stale.loop.visibilityChanged(); assert.deepEqual(stale.cancellations, [1]);
  stale.deliver(1); assert.equal(stale.callbacks.size, 1); assert(stale.callbacks.has(2)); assert.equal(stale.frames.length, 0);
  stale.deliver(2); assert.equal(stale.frames.length, 1); stale.loop.dispose();
  const reentrant = make(); reentrant.loop.invalidate(); let once = false;
  reentrant.cancel = id => { if (!once) { once = true; reentrant.loop.invalidate(); reentrant.deliver(id); } };
  reentrant.loop.visibilityChanged(); assert.equal(reentrant.frames.length, 0); assert.equal(reentrant.callbacks.size, 1); assert(reentrant.callbacks.has(2));
  reentrant.deliver(2); reentrant.loop.dispose();

  for (const primary of [undefined, null, false, 0, '']) {
    const thrown = make(); thrown.render = () => { throw primary; }; thrown.loop.invalidate();
    const error = caught(() => thrown.deliver(1)); assert.equal(error.cause, primary); assert.equal(thrown.cancellations.length, 0); thrown.loop.dispose();
  }
  let inspectedReady = false, messageReads = 0; finish.push(() => { inspectedReady = true; });
  const inspection = Object.freeze(Object.defineProperty({}, 'cacheOwnershipReleased', { value: () => inspectedReady }));
  const primary = Object.freeze(Object.defineProperty({}, 'message', { get() { messageReads++; throw inspection; } }));
  const inspected = make(); inspected.render = () => { throw primary; }; inspected.loop.invalidate();
  const inspectedFailure = caught(() => inspected.deliver(1)); assert.equal(inspectedFailure.cause, primary); assert.equal(messageReads, 1);
  caught(inspected.loop.dispose); const inspectedChild = pending().find(owner => owner.label === 'original RAF request'); caught(inspectedChild.release);
  inspectedReady = true; inspectedChild.release(); pending().find(owner => owner.label === 'original render loop').release(); assert.equal(inspected.cancellations.length, 0); assert.equal(messageReads, 1);

  // Unknown original work cannot borrow copied owners, function identity, error
  // handles, or an unsupported cancellation return as a native settlement proof.
  const unknown = Object.freeze(Object.assign(new Error('unknown original cancel work'), { sceneOwnershipPending: true,
    sceneResourceOwner: { release() { assert.fail('unrelated public owner cannot reconcile original native cancellation'); } } }));
  const blocked = make(); blocked.cancel = () => { throw unknown; }; blocked.loop.invalidate(); const blockedFailure = caught(blocked.loop.dispose);
  const blockedChild = pending().find(owner => owner.label === 'original RAF request'); caught(blockedChild.release); assert.equal(blocked.cancellations.length, 1);
  assert.equal(blockedFailure.sceneOwnershipReleased(), false);
  const unconfirmed = make(); unconfirmed.cancel = () => false; unconfirmed.loop.invalidate(); const unconfirmedFailure = caught(unconfirmed.loop.dispose);
  assert.equal(unconfirmedFailure.sceneOwnershipReleased(), false); assert.equal(unconfirmed.cancellations.length, 1);
} finally {
  for (const done of finish) done();
  for (const value of fixtures) { value.cancel = null; try { value.loop.dispose(); } catch {} }
  for (const owner of pending()) { try { await owner.releaseAsync(); } catch {} }
}
console.log('Actual original RAF acquisition/delivery/cancellation/retirement controls authored; execution deferred.');
