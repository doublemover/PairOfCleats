import assert from 'node:assert/strict';
import { createHoverFrame } from '../../src/map/isometric/client/hover-frame.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual hover/resource owners; inert original callback and slot counters only.
const baseline = new Set(getPendingSceneResourceOwners()), fixtures = [], finish = [];
const caught = invoke => { try { invoke(); } catch (error) { return error; } assert.fail('expected retained exact callback failure'); };
const owners = () => getPendingSceneResourceOwners().filter(owner => !baseline.has(owner));
const make = () => {
  const value = { picks: [], clears: 0, current: true };
  value.options = { pick: pointer => { value.picks.push(pointer); return value.pick?.(pointer); },
    clear: () => { value.clears++; return value.clear?.(); }, isCurrent: () => value.current };
  value.hover = createHoverFrame(value.options); fixtures.push(value); return value;
};
try {
  const normal = make(); for (let index = 0; index < 10; index++) normal.hover.move({ clientX: index, clientY: 2 });
  normal.hover.frame(); assert.deepEqual(normal.picks, [{ clientX: 9, clientY: 2 }]); assert(Object.isFrozen(normal.picks[0]));
  assert.equal(normal.hover.frame(), false); normal.hover.invalidate(); assert.equal(normal.hover.frame(), true);
  normal.options.pick = normal.options.clear = normal.options.isCurrent = () => assert.fail('replacement callbacks are not original hover authority');
  normal.hover.leave(); normal.hover.dispose(); const clearCount = normal.clears;
  normal.hover.dispose(); normal.hover.startDrag(); normal.hover.endDrag(); normal.hover.leave(); normal.hover.move({ clientX: 1, clientY: 2 });
  normal.hover.invalidate(); assert.equal(normal.hover.frame(), false); assert.equal(normal.clears, clearCount);

  // The exact controls/renderer prerequisite revokes every old callback, even
  // if those public slots later temporarily point back to the old values.
  const old = make(); const dispose = () => {}, renderer = {}, state = { disposeControls: dispose, renderer, hovered: 'original' };
  const hover = createHoverFrame({ isCurrent: () => state.disposeControls === dispose && state.renderer === renderer,
    pick() { assert.fail('revoked old pick cannot inspect new scene'); }, clear() { state.hovered = null; } });
  hover.move({ clientX: 1, clientY: 1 }); state.disposeControls = () => {}; state.renderer = {}; state.hovered = 'new scene';
  assert.equal(hover.frame(), false); Object.assign(state, { disposeControls: dispose, renderer });
  hover.leave(); hover.dispose(); assert.equal(state.hovered, 'new scene', 'latched old revocation cannot clear replacement hover'); old.hover.dispose();

  const active = make(); let during, activeFailure;
  active.pick = () => { activeFailure = caught(() => active.hover.dispose()); during = active.clears; };
  active.hover.move({ clientX: 1, clientY: 2 }); assert.equal(active.hover.frame(), false);
  assert.equal(during, 0); assert.equal(activeFailure.sceneOwnershipReleased(), false);
  const activeOwner = owners().find(owner => owner.label === 'hover frame callbacks'); assert(activeOwner);
  activeOwner.release(); assert.equal(active.clears, 1); assert.equal(activeFailure.sceneOwnershipReleased(), true);

  const changedDuringRead = make(); const event = { get clientX() { changedDuringRead.current = false; return 1; }, clientY: 2 };
  changedDuringRead.hover.move(event); changedDuringRead.current = true; assert.equal(changedDuringRead.hover.frame(), false);
  changedDuringRead.hover.dispose(); assert.equal(changedDuringRead.picks.length, 0); assert.equal(changedDuringRead.clears, 0);

  let settled = false, inspections = 0; finish.push(() => { settled = true; });
  const originalWork = Object.defineProperty(new Error('original hover pick work'), 'cacheOwnershipReleased', { configurable: true,
    get() { inspections++; return function() { assert.equal(this, originalWork); return settled; }; } });
  const pending = make(); pending.pick = () => { throw originalWork; }; pending.hover.move({ clientX: 1, clientY: 2 });
  assert.equal(caught(() => pending.hover.frame()), originalWork); const workFailure = caught(() => pending.hover.dispose());
  const workOwner = owners().find(owner => owner.label === 'hover frame callbacks'); assert(workOwner);
  Object.defineProperty(originalWork, 'cacheOwnershipReleased', { value: () => true }); caught(() => workOwner.release());
  assert.equal(pending.clears, 0); assert.equal(inspections, 1); settled = true; workOwner.release();
  assert.equal(pending.clears, 1); assert.equal(workFailure.sceneOwnershipReleased(), true);

  for (const primary of [undefined, null, false, 0, '']) {
    const failing = make(); failing.clear = () => { throw primary; };
    const failure = caught(() => failing.hover.dispose()); assert.equal(failure.cause, primary); assert.equal(failing.clears, 1);
    const exact = owners().find(owner => owner.label === 'hover frame callbacks'); assert(exact);
    assert.equal(caught(() => failing.hover.dispose()), failure); exact.release(); failing.hover.dispose(); assert.equal(failing.clears, 1,
      'explicit callback retirement does not retry its one-shot failed clear operation');
  }
  const reentrant = make(); let inner, innerPending;
  reentrant.clear = () => { inner = caught(() => reentrant.hover.dispose()); innerPending = inner.sceneOwnershipReleased(); };
  reentrant.hover.dispose(); assert.equal(innerPending, false); assert.equal(inner.sceneOwnershipReleased(), true); assert.equal(reentrant.clears, 1);

  // Unknown work remains unconfirmed; neither copied public ownership fields
  // nor a similar callback may authorize clear or reconcile that exact owner.
  const unknown = Object.freeze(Object.assign(new Error('unknown original hover work'), { cacheOwnershipPending: true,
    sceneResourceOwner: { release() { assert.fail('public owner is not an original hover capability'); } } }));
  const blocked = make(); blocked.pick = () => { throw unknown; }; blocked.hover.move({ clientX: 1, clientY: 2 });
  assert.equal(caught(() => blocked.hover.frame()), unknown); const blockedFailure = caught(() => blocked.hover.dispose());
  const blockedOwner = owners().find(owner => owner.label === 'hover frame callbacks'); caught(() => blockedOwner.release());
  assert.equal(blocked.clears, 0); assert.equal(blockedFailure.sceneOwnershipReleased(), false);
} finally {
  for (const done of finish) done();
  for (const value of fixtures) { value.clear = null; try { value.hover.dispose(); } catch {} }
  for (const owner of owners()) { try { await owner.releaseAsync(); } catch {} }
}
console.log('Original hover callback/source membership, reentrant retirement and unknown-work controls authored; execution deferred.');
