import assert from 'node:assert/strict';
import { createViewportInputOwner } from '../../src/map/isometric/client/input-ownership.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual viewport owner and resource inventory; inert original DOM methods and
// callbacks. No browser, renderer, native listener or GPU execution.
class Surface {
  events = new Map(); adds = []; removes = [];
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback); this.adds.push({ name, callback }); this.onAdd?.(name, callback);
  }
  removeEventListener(name, callback) {
    this.removes.push({ name, callback }); const result = this.onRemove?.(name, callback);
    if (result?.then) return result.then(() => { this.events.get(name)?.delete(callback); });
    this.events.get(name)?.delete(callback); return result;
  }
  fire(name, event = {}) {
    event.target ??= this; event.preventDefault ??= () => { event.prevented = true; };
    for (const callback of [...this.events.get(name) || []]) callback(event);
    return event;
  }
}
const baseline = new Set(getPendingSceneResourceOwners()), fixtures = [], finish = [];
const caught = callback => { try { callback(); } catch (error) { return error; } assert.fail('expected retained original failure'); };
const pending = () => getPendingSceneResourceOwners().filter(owner => !baseline.has(owner));
const create = (configure = () => {}) => {
  const value = { window: new Surface(), document: new Surface(), viewport: new Surface(), canvas: new Surface(),
    cancellations: 0, invalidations: 0, shortcuts: 0, current: true };
  value.surfaces = [value.window, value.document, value.viewport, value.canvas];
  value.document.activeElement = value.viewport;
  value.viewport.focus = () => value.document.fire('focusin', { target: value.viewport });
  value.options = { ...value, cancelMotion: () => { value.cancellations++; return value.cancel?.(); },
    invalidate: () => { value.invalidations++; return value.invalidate?.(); },
    shortcut: event => { value.shortcuts++; return value.shortcut?.(event) || false; }, isCurrent: () => value.current };
  configure(value); fixtures.push(value);
  value.owner = createViewportInputOwner(value.options); return value;
};
const listeners = value => value.surfaces.reduce((sum, surface) => sum + [...surface.events.values()].reduce((size, items) => size + items.size, 0), 0);
try {
  const original = create(), issued = original.surfaces.flatMap(surface => surface.adds.map(row => ({ surface, ...row })));
  for (const surface of original.surfaces) surface.removeEventListener = () => assert.fail('replacement method cannot remove an original subscription');
  original.window.fire('keydown', { target: original.viewport, code: 'KeyW' }); assert.equal(original.owner.keys.KeyW, true);
  original.owner.dispose(); original.owner.dispose(); assert.equal(listeners(original), 0); assert.equal(original.owner.keys.KeyW, undefined);
  assert.equal(original.surfaces.reduce((sum, surface) => sum + surface.removes.length, 0), issued.length);
  const retiredCounts = [original.cancellations, original.invalidations, original.shortcuts];
  for (const { callback } of issued) callback({ target: original.viewport, relatedTarget: null, code: 'KeyW', preventDefault() { assert.fail('retired callback cannot claim event'); } });
  original.owner.reset(); assert.deepEqual([original.cancellations, original.invalidations, original.shortcuts], retiredCounts);

  // Every original subscription is attempted despite callback and removal
  // failures; already completed removals and reset callbacks are not repeated.
  let ready = false; finish.push(() => { ready = true; });
  const callbackFailure = Object.freeze(new Error('original reset callback'));
  const removalFailure = Object.freeze(Object.defineProperty(new Error('original keydown removal work'), 'cacheOwnershipReleased', { value: () => ready }));
  const broken = create(value => {
    value.cancel = () => { throw callbackFailure; };
    value.window.onRemove = name => { if (name === 'keydown' && !ready) throw removalFailure; };
  });
  const failed = caught(() => broken.owner.dispose()); assert.equal(failed.sceneOwnershipReleased(), false);
  assert.equal(broken.invalidations, 1); assert.equal(broken.surfaces.reduce((sum, surface) => sum + surface.removes.length, 0), 9);
  const affected = pending(), subscription = affected.find(owner => owner.label === 'viewport input keydown listener');
  const outer = affected.find(owner => owner.label === 'viewport input subscriptions');
  assert(subscription && outer); const removals = broken.window.removes.length;
  caught(() => subscription.release()); caught(() => outer.release()); caught(() => broken.owner.dispose());
  assert.equal(broken.window.removes.length, removals, 'original pending work gates explicit and ordinary removal retry');
  ready = true; subscription.release(); outer.release(); broken.owner.dispose();
  assert.equal(broken.window.removes.length, removals + 1); assert.equal(broken.cancellations, 1); assert.equal(broken.invalidations, 1);
  assert.equal(failed.sceneOwnershipReleased(), true); assert.equal(listeners(broken), 0);

  // An original callback can revoke the owner during a shortcut. Physical
  // removal waits for that accepted stack; key/default-action writes stop now.
  const active = create(); let inCallback, activeFailure;
  active.shortcut = () => { activeFailure = caught(() => active.owner.dispose()); inCallback = listeners(active); return false; };
  active.window.fire('keydown', { target: active.viewport, code: 'KeyW', preventDefault() { assert.fail('revoked original callback cannot claim default action'); } });
  assert.equal(inCallback, 9); assert.equal(active.owner.keys.KeyW, undefined); assert.equal(activeFailure.sceneOwnershipReleased(), false);
  const activeOuter = pending().find(owner => owner.label === 'viewport input subscriptions'); assert(activeOuter);
  activeOuter.release(); assert.equal(listeners(active), 0); assert.equal(activeFailure.sceneOwnershipReleased(), true);

  const stale = create(); const callbacks = stale.window.adds.map(row => row.callback); stale.owner.keys.KeyW = true; stale.current = false;
  stale.window.fire('keyup', { code: 'KeyW' }); assert.equal(stale.owner.keys.KeyW, undefined); const before = stale.invalidations;
  stale.current = true; for (const callback of callbacks) callback({ target: stale.viewport, code: 'KeyD', preventDefault() { assert.fail('revoked prerequisite cannot reacquire keyboard'); } });
  assert.equal(stale.invalidations, before); assert.equal(stale.owner.keys.KeyD, undefined); stale.owner.dispose();
  const duringDefault = create(); duringDefault.window.fire('keydown', { target: duringDefault.viewport, code: 'KeyD', preventDefault() { duringDefault.current = false; } });
  assert.equal(duringDefault.owner.keys.KeyD, undefined); duringDefault.owner.dispose();

  // Partial registration is captured before add can throw. Independent listener
  // removals survive falsey primaries without needing a returned public owner.
  for (const primary of [undefined, null, false, 0, '']) {
    let partial;
    const failure = caught(() => create(value => { partial = value; value.document.onAdd = name => { if (name === 'visibilitychange') throw primary; }; }));
    assert.equal(failure.cause, primary); assert.equal(listeners(partial), 0); assert.equal(partial.cancellations, 1); assert.equal(partial.invalidations, 1);
  }
  let settleRegistration = false, settleCache = false, cacheReads = 0;
  finish.push(() => { settleRegistration = true; settleCache = true; });
  const registrationWork = Object.defineProperties(new Error('original registration work'), {
    sceneOwnershipReleased: { value: () => settleRegistration },
    cacheOwnershipReleased: { configurable: true, get() { cacheReads++; return function() { assert.equal(this, registrationWork); return settleCache; }; } }
  });
  let partialPending;
  const registrationFailure = caught(() => create(value => { partialPending = value; value.document.onAdd = () => { throw registrationWork; }; }));
  assert.equal(registrationFailure.cause, registrationWork); assert.equal(partialPending.surfaces.flatMap(surface => surface.removes).length, 0);
  const registrationOwner = pending().find(owner => owner.label === 'viewport input subscriptions'); caught(() => registrationOwner.release());
  Object.defineProperty(registrationWork, 'cacheOwnershipReleased', { value: () => true });
  settleRegistration = true; caught(() => registrationOwner.release()); assert.equal(partialPending.surfaces.flatMap(surface => surface.removes).length, 0);
  settleCache = true; registrationOwner.release(); assert.equal(listeners(partialPending), 0); assert.equal(cacheReads, 1);
  assert.equal(registrationFailure.sceneOwnershipReleased(), true, 'both independently captured original channels must settle');

  // Reentrant cleanup receives a standalone original stack observation; it
  // cannot publish parent closure while a native remover remains on the stack.
  let reentrant, innerFailure, duringRemoval;
  const reentry = create(value => { value.window.onRemove = name => { if (name !== 'keydown' || reentrant) return;
    reentrant = true; innerFailure = caught(() => value.owner.dispose()); duringRemoval = innerFailure.sceneOwnershipReleased(); }; });
  reentry.owner.dispose(); assert.equal(duringRemoval, false); assert.equal(innerFailure.sceneOwnershipReleased(), true); assert.equal(listeners(reentry), 0);

  let complete; const flight = new Promise(resolve => { complete = resolve; }); finish.push(complete);
  const asynchronous = create(value => { value.canvas.onRemove = name => name === 'pointercancel' ? flight : undefined; });
  const asyncFailure = caught(() => asynchronous.owner.dispose());
  const asyncChild = pending().find(owner => owner.label === 'viewport input pointercancel listener');
  const asyncParent = pending().find(owner => owner.label === 'viewport input subscriptions');
  const started = asynchronous.canvas.removes.length; const waiting = asyncChild.releaseAsync(); complete(); await waiting; asyncParent.release();
  assert.equal(asynchronous.canvas.removes.length, started, 'fulfilled original async removal is joined and never repeated'); assert.equal(asyncFailure.sceneOwnershipReleased(), true);

  // Reported owner/callback fields cannot reconcile an unrelated unknown
  // prerequisite or authorize retry before its original observation is true.
  const unknown = Object.freeze(Object.assign(new Error('unknown registration work'), { cacheOwnershipPending: true,
    sceneResourceOwner: { release() { assert.fail('lookalike public owner is not a remover capability'); } } }));
  let blocked;
  const unknownFailure = caught(() => create(value => { blocked = value; value.viewport.onAdd = () => { throw unknown; }; }));
  const unknownOwner = pending().find(owner => owner.label === 'viewport input subscriptions');
  caught(() => unknownOwner.release()); assert.equal(blocked.surfaces.flatMap(surface => surface.removes).length, 0); assert.equal(unknownFailure.sceneOwnershipReleased(), false);
} finally {
  for (const done of finish) done();
  for (const value of fixtures) { value.cancel = null; for (const surface of value.surfaces) surface.onRemove = null;
    try { value.owner?.dispose(); } catch {} }
  for (const owner of pending()) { try { await owner.releaseAsync(); } catch {} }
}
console.log('Viewport original callbacks/subscriptions, partial acquisition and independent retirement controls authored; execution deferred.');
