import assert from 'node:assert/strict';
import { createControlsLifetime, retirePreviousControls } from '../../src/map/isometric/client/controls-lifetime.js';
import { captureSceneResource, preserveSceneCleanupFailures, getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';
import { createSceneDisposerGuard } from '../../src/map/isometric/client/rendering/scene-disposer-guard.js';
import { createSceneWorkPrerequisites } from '../../src/map/isometric/client/scene-work-prerequisites.js';

// Actual controls/resource/scene-guard owners, inert original method counters.
const baseline = new Set(getPendingSceneResourceOwners()), finish = [], values = [];
const caught = invoke => { try { invoke(); } catch (error) { return error; } assert.fail('expected retained original failure'); };
const pending = () => getPendingSceneResourceOwners().filter(owner => !baseline.has(owner));
class Surface {
  events = new Map(); removed = 0;
  addEventListener(name, callback) { this.events.set(name, callback); this.onAdd?.(); }
  removeEventListener(name, callback) { this.removed++; this.onRemove?.(); if (this.events.get(name) === callback) this.events.delete(name); }
}
const make = () => {
  const value = { sceneCalls: 0 }, state = { renderer: {}, scene: {} };
  const sceneOwner = captureSceneResource({ dispose() { value.sceneCalls++; } }, 'controls fixture original scene');
  state.disposeScene = createSceneDisposerGuard({ receiver: state, dispose: () => sceneOwner.retire(),
    beforeDispose: sceneOwner.assertReady, retainFailure: sceneOwner.retainFailure });
  value.state = state; value.sceneOwner = sceneOwner; value.originalScene = state.disposeScene;
  value.lifetime = createControlsLifetime(state); values.push(value); return value;
};
try {
  const normal = make(), native = { calls: 0, pings: 0, dispose() { this.calls++; }, ping() { this.pings++; } };
  let facade; normal.lifetime.construct(() => { facade = normal.lifetime.adopt(native, 'controls fixture native', ['ping']); });
  native.dispose = native.ping = () => assert.fail('original acquisition methods cannot be replaced'); facade.ping(); normal.lifetime.dispose(); normal.lifetime.dispose();
  assert.equal(native.calls, 1); assert.equal(native.pings, 1); assert.equal(normal.state.disposeControls, null); normal.originalScene(); assert.equal(normal.sceneCalls, 1);
  facade.ping(); assert.equal(native.pings, 1, 'retained original child facade cannot invoke a disposed native resource');

  const childNames = ['dispose', 'first', 'second', 'keys', 'meta'];
  for (const [stop, name] of childNames.entries()) for (const mode of ['dispose', 'replace']) {
    const originalOwner = make(), reads = []; let closes = 0, siblingDispose, workError;
    const resource = {};
    for (const field of childNames) Object.defineProperty(resource, field, { get() {
      reads.push(field);
      if (field === name) {
        if (mode === 'dispose') workError = caught(originalOwner.lifetime.dispose);
        else { siblingDispose = () => {}; originalOwner.state.disposeControls = siblingDispose; }
      }
      if (field === 'dispose') return () => { closes++; };
      return field === 'keys' || field === 'meta' ? {} : () => assert.fail('revoked acquisition cannot invoke child methods');
    } });
    const failure = caught(() => originalOwner.lifetime.construct(() => {
      originalOwner.lifetime.adopt(resource, 'controls fixture getter authority', ['first', 'second'], ['keys', 'meta']);
      assert.fail('revoked acquisition cannot continue construction');
    }));
    assert.match(failure.cause.message, /acquisition lost/); assert.deepEqual(reads, childNames.slice(0, stop + 1));
    assert.equal(closes, 1, 'original captured child is still retired after its getter revokes construction');
    if (mode === 'replace') assert.equal(originalOwner.state.disposeControls, siblingDispose);
    else assert.equal(workError.sceneOwnershipReleased(), true);
  }

  for (const stop of ['addEventListener', 'removeEventListener']) {
    const originalOwner = make(), target = new Surface(), reads = []; let adds = 0;
    for (const field of ['addEventListener', 'removeEventListener']) Object.defineProperty(target, field, { get() {
      reads.push(field);
      if (field === stop) originalOwner.lifetime.revoke();
      return field === 'addEventListener' ? () => { adds++; } : Surface.prototype.removeEventListener;
    } });
    caught(() => originalOwner.lifetime.construct(() => originalOwner.lifetime.listen(target, 'getter', () => {})));
    assert.deepEqual(reads, stop === 'addEventListener' ? ['addEventListener'] : ['addEventListener', 'removeEventListener']);
    assert.equal(adds, 0); assert.equal(target.removed, 0);
  }
  const registrationOwner = make(), registered = new Surface(), neverRegistered = new Surface();
  let siblingPublication = () => {};
  registered.onAdd = () => { registrationOwner.state.disposeControls = siblingPublication; };
  caught(() => registrationOwner.lifetime.construct(() => {
    registrationOwner.lifetime.listen(registered, 'first', () => {});
    registrationOwner.lifetime.listen(neverRegistered, 'second', () => {});
  }));
  assert.equal(registered.removed, 1); assert.equal(registered.events.size, 0); assert.equal(neverRegistered.removed, 0);
  assert.equal(neverRegistered.events.size, 0); assert.equal(registrationOwner.state.disposeControls, siblingPublication);

  const facadeOwner = make(); let nativeClosed = 0, facadeCalls = 0, duringFacade;
  const guardedChild = { dispose() { nativeClosed++; }, operate() {
    facadeCalls++; duringFacade = caught(facadeOwner.lifetime.dispose); assert.equal(nativeClosed, 0);
  } };
  let originalFacade; facadeOwner.lifetime.construct(() => { originalFacade = facadeOwner.lifetime.adopt(guardedChild, 'controls fixture active facade', ['operate']); });
  originalFacade.operate(); assert.equal(duringFacade.sceneOwnershipReleased(), true); assert.equal(nativeClosed, 0);
  originalFacade.operate(); assert.equal(facadeCalls, 1); facadeOwner.lifetime.dispose(); assert.equal(nativeClosed, 1);

  const setterOwner = make(); let setterCloses = 0, setterValue, setterWork;
  setterOwner.lifetime.construct(() => setterOwner.lifetime.adopt({ dispose() { setterCloses++; } }, 'controls fixture publication stack'));
  Object.defineProperty(setterOwner.state, 'originalPublication', { get: () => setterValue, set(value) {
    setterValue = value;
    if (value) { setterWork = caught(setterOwner.lifetime.dispose); assert.equal(setterCloses, 0); }
  } });
  caught(() => setterOwner.lifetime.publish('originalPublication', () => {}));
  assert.equal(setterValue, null); assert.equal(setterCloses, 0); assert.equal(setterWork.sceneOwnershipReleased(), true);
  setterOwner.lifetime.dispose(); assert.equal(setterCloses, 1);

  let refuse = true; finish.push(() => { refuse = false; });
  const original = Object.freeze(new Error('first original controls child close'));
  const broken = make(), first = { calls: 0, dispose() { this.calls++; if (refuse) throw original; } }, second = { calls: 0, dispose() { this.calls++; } }, surface = new Surface();
  broken.lifetime.construct(() => { broken.lifetime.adopt(first, 'controls fixture failed child'); broken.lifetime.adopt(second, 'controls fixture independent child');
    broken.lifetime.listen(surface, 'sample', () => assert.fail('retired listener cannot run')); });
  const callback = surface.events.get('sample'), failure = caught(broken.lifetime.dispose);
  assert.equal(first.calls, 1); assert.equal(second.calls, 1); assert.equal(surface.removed, 1); assert.equal(surface.events.size, 0);
  caught(broken.lifetime.dispose); caught(broken.originalScene); callback(); assert.equal(first.calls, 1); assert.equal(broken.sceneCalls, 0,
    'actual original scene guard cannot close its renderer scope before controls child confirmation');
  refuse = false; pending().find(owner => owner.resource === first).release();
  pending().find(owner => owner.label === 'original controls lifetime').release(); broken.originalScene();
  assert.equal(first.calls, 2); assert.equal(second.calls, 1); assert.equal(broken.sceneCalls, 1); assert.equal(failure.sceneOwnershipReleased(), true);

  const reentry = make(), sibling = { calls: 0, dispose() { this.calls++; } }; let newer, obsolete;
  const replacing = { calls: 0, dispose() { this.calls++; newer = createControlsLifetime(reentry.state);
    newer.construct(() => { newer.adopt(sibling, 'controls fixture sibling'); newer.publish('invalidateHover', () => {}); }); } };
  reentry.lifetime.construct(() => { reentry.lifetime.adopt(replacing, 'controls fixture replacing child'); obsolete = reentry.lifetime.publish('invalidateHover', () => assert.fail('old published callback cannot revive')); });
  reentry.lifetime.dispose(); obsolete(); assert.equal(reentry.state.disposeControls, newer.dispose); assert.equal(sibling.calls, 0); assert.equal(replacing.calls, 1); newer.dispose();

  const revokedReturn = make();
  const visible = revokedReturn.lifetime.wrap(() => { revokedReturn.lifetime.revoke(); return true; });
  assert.equal(visible(), undefined, 'a callback revoked before its return cannot authorize later scheduling'); revokedReturn.lifetime.dispose();

  for (const primary of [undefined, null, false, 0, '']) {
    const partial = make(), acquired = { calls: 0, dispose() { this.calls++; } }, target = new Surface(); target.onAdd = () => { throw primary; };
    const result = caught(() => partial.lifetime.construct(() => { partial.lifetime.adopt(acquired, 'controls fixture partial child'); partial.lifetime.listen(target, 'partial', () => {}); }));
    assert.equal(result.cause, primary); assert.equal(acquired.calls, 1); assert.equal(target.removed, 1); assert.equal(target.events.size, 0); assert.equal(partial.state.disposeControls, null);
  }
  const active = make(), child = { calls: 0, dispose() { this.calls++; } }; let during, stackError;
  active.lifetime.construct(() => active.lifetime.adopt(child, 'controls fixture active child'));
  active.lifetime.invoke(() => { stackError = caught(active.lifetime.dispose); during = stackError.sceneOwnershipReleased(); caught(active.originalScene); assert.equal(child.calls, 0); });
  assert.equal(during, false); assert.equal(stackError.sceneOwnershipReleased(), true); assert.equal(child.calls, 0);
  active.lifetime.dispose(); active.originalScene(); assert.equal(child.calls, 1); assert.equal(active.sceneCalls, 1);

  const badCapture = make(); let captureReads = 0;
  const inaccessible = Object.defineProperty({}, 'dispose', { get() { captureReads++; throw false; } });
  const captureFailure = caught(() => badCapture.lifetime.construct(() => badCapture.lifetime.adopt(inaccessible, 'controls fixture inaccessible original')));
  assert.equal(captureFailure.cause.cause, false); assert.equal(captureReads, 1); assert.equal(badCapture.state.disposeControls, null);
  caught(() => pending().find(owner => owner.resource === inaccessible).release()); assert.equal(captureReads, 1);

  // The actual shared prerequisite walker delegates only its original local
  // producer closure, preserving mixed independent observations and diagnostics.
  let independent = false; finish.push(() => { independent = true; });
  const local = { calls: 0, dispose() { this.calls++; if (this.calls === 1) throw original; } }, cap = captureSceneResource(local, 'controls fixture known local');
  const known = caught(cap.retire), extra = Object.freeze(Object.defineProperty(new Error('independent mixed work'), 'cacheOwnershipReleased', { value: () => independent }));
  const scope = createSceneWorkPrerequisites('controls fixture mixed work', [cap]);
  scope.retain(preserveSceneCleanupFailures(known, [extra], { hasPrimary: true, forceAggregate: true })); caught(cap.release); assert.equal(local.calls, 1);
  const late = { calls: 0, dispose() { this.calls++; } }, lateCap = scope.attach(captureSceneResource(late, 'controls fixture late child'));
  caught(lateCap.retire); assert.equal(late.calls, 0); independent = true; cap.release(); lateCap.release(); assert.deepEqual([local.calls, late.calls], [2, 1]);

  let nativeWork = false; finish.push(() => { nativeWork = true; }); let reads = 0;
  const inspection = Object.freeze(Object.defineProperty({}, 'cacheOwnershipReleased', { value: () => nativeWork }));
  const primary = Object.freeze(Object.defineProperty({}, 'message', { get() { reads++; throw inspection; } }));
  const inspected = make(), held = { calls: 0, dispose() { this.calls++; } };
  const inspectedError = caught(() => inspected.lifetime.construct(() => { inspected.lifetime.adopt(held, 'controls fixture inspected child'); throw primary; }));
  assert.equal(inspectedError.cause, primary); assert.equal(held.calls, 0); assert.equal(reads, 1);
  const heldCap = pending().find(owner => owner.resource === held); caught(heldCap.release); nativeWork = true; heldCap.release();
  pending().filter(owner => owner.label === 'original controls lifetime').at(-1).release(); assert.equal(held.calls, 1); assert.equal(reads, 1);

  const terminal = make(); let terminalPromise, siblingSceneCalls = 0;
  terminal.lifetime.invoke(() => { terminalPromise = terminal.lifetime.shutdownScene(); assert.equal(terminal.sceneCalls, 0); });
  terminal.state.disposeScene = () => { siblingSceneCalls++; }; const terminalOutcome = await terminalPromise;
  assert.equal(terminalOutcome.pending, false); assert.equal(terminal.sceneCalls, 1); assert.equal(siblingSceneCalls, 0, 'pagehide captures original scene before deferred terminal cleanup');

  let complete; const priorFlight = new Promise(resolve => { complete = resolve; }); finish.push(complete); let priorCalls = 0;
  const priorState = { disposeControls() { priorCalls++; return priorFlight; } };
  caught(() => retirePreviousControls(priorState)); caught(() => retirePreviousControls(priorState)); assert.equal(priorCalls, 1);
  const priorCap = pending().find(owner => owner.label === 'previous original controls callback'); const waiting = priorCap.releaseAsync(); complete(); await waiting;
  retirePreviousControls(priorState); assert.equal(priorCalls, 1, 'fulfilled original prior disposer is joined, not invoked again');

  const sharedCallback = function() { this.calls++; }, priorA = { calls: 0, disposeControls: sharedCallback }, priorB = { calls: 0, disposeControls: sharedCallback };
  retirePreviousControls(priorA); retirePreviousControls(priorB); assert.deepEqual([priorA.calls, priorB.calls], [1, 1],
    'same callback identity on another original receiver is not prior closure authority');

  const unknown = Object.freeze(Object.assign(new Error('unknown original constructor work'), { cacheOwnershipPending: true,
    sceneResourceOwner: { release() { assert.fail('lookalike owner is not captured construction authority'); } } }));
  const blocked = make(), unknownChild = { calls: 0, dispose() { this.calls++; } };
  const blockedError = caught(() => blocked.lifetime.construct(() => { blocked.lifetime.adopt(unknownChild, 'controls fixture unknown child'); throw unknown; }));
  caught(() => pending().find(owner => owner.resource === unknownChild).release()); assert.equal(unknownChild.calls, 0); assert.equal(blockedError.sceneOwnershipReleased(), false);
} finally {
  for (const done of finish) done();
  for (const value of values) { try { value.lifetime.dispose(); } catch {} }
  for (const owner of pending()) { try { await owner.releaseAsync(); } catch {} }
}
console.log('Actual controls original acquisition/teardown/guard/prerequisite controls authored; execution deferred.');
