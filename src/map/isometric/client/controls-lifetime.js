import { captureSceneResource, preserveSceneCleanupFailures } from './scene-retirement.js';
import { createSceneWorkPrerequisites } from './scene-work-prerequisites.js';
import { retainSceneDisposerFailure } from './rendering/scene-disposer-guard.js';

const previousOwners = new WeakMap();
const priorOutcome = value => {
  if (value === undefined) return;
  if (value && typeof value === 'object'
    && Object.getOwnPropertyDescriptor(value, 'settled')?.value === true
    && Object.getOwnPropertyDescriptor(value, 'pending')?.value === false) return;
  throw Object.assign(new Error('Previous controls closure was not confirmed.', { cause: value }), { sceneOwnershipPending: true });
};
export const retirePreviousControls = state => {
  const previous = state.disposeControls;
  if (previous == null) return;
  if (typeof previous !== 'function') throw new TypeError('Previous controls has no original disposer.');
  let callbacks = previousOwners.get(state);
  if (!callbacks) { callbacks = new WeakMap(); previousOwners.set(state, callbacks); }
  let owner = callbacks.get(previous);
  if (!owner) {
    owner = captureSceneResource({ dispose: () => {
      const value = Reflect.apply(previous, state, []);
      try { if (value instanceof Promise) return Reflect.apply(Promise.prototype.then, value, [priorOutcome]); }
      catch (primary) { throw Object.assign(new AggregateError([primary], 'Previous controls outcome inspection remains unconfirmed.', { cause: primary }),
        { sceneOwnershipPending: true, previousControlsOutcome: value }); }
      return priorOutcome(value);
    } }, 'previous original controls callback', 'dispose', [], { required: true });
    callbacks.set(previous, owner);
  }
  return owner.retire();
};

/** One controls construction owns original callbacks, subscriptions and child
 * capabilities. Public state/error fields never supply sibling close authority. */
export const createControlsLifetime = state => {
  const renderer = state.renderer, scene = state.scene, originalSceneDispose = state.disposeScene;
  const resources = [], publications = new Map(), detachers = [], logicalErrors = [];
  let disposed = false, active = 0, cleaning = false, cleanupStarted = false, terminalFlight = null;
  const work = Object.freeze(Object.defineProperty(new Error('Original controls construction or callback has not returned.'),
    'sceneOwnershipReleased', { value: () => active === 0 }));
  const cleanupWork = Object.freeze(Object.defineProperty(new Error('Original controls cleanup has not returned.'),
    'sceneOwnershipReleased', { value: () => !cleaning }));
  const prerequisites = createSceneWorkPrerequisites('Original controls work remains pending.');
  const cleanup = { dispose() {
    if (cleanupStarted) return;
    cleanupStarted = true; cleaning = true;
    try {
      const errors = [...logicalErrors];
      for (const resource of resources) try { resource.retire(); } catch (error) { errors.push(error); }
      const failure = preserveSceneCleanupFailures(null, errors);
      if (failure) throw failure;
    } finally { cleaning = false; }
  } };
  const owner = prerequisites.attach(captureSceneResource(cleanup, 'original controls lifetime', 'dispose', [], { required: true }));
  prerequisites.retain(work);
  // Only the original scene producer's private guard can accept this work.
  retainSceneDisposerFailure(originalSceneDispose, work);
  const owns = () => state.disposeControls === dispose && state.renderer === renderer && state.scene === scene;
  const canClear = () => state.renderer === renderer && state.scene === scene
    && (state.disposeControls === dispose || (disposed && state.disposeControls == null));
  const current = () => !disposed && owns();
  const assertCurrent = () => { if (!current()) throw new Error('Controls acquisition lost its original publication authority.'); };
  const retain = error => { prerequisites.retain(error); retainSceneDisposerFailure(originalSceneDispose, error); };
  const revoke = () => {
    if (disposed) return;
    disposed = true;
    for (const callback of detachers) try { callback(); } catch (error) { logicalErrors.push(error); retain(error); }
    for (const [name, value] of publications) try { if (state[name] === value) state[name] = null; }
    catch (error) { logicalErrors.push(error); retain(error); }
  };
  const dispose = () => {
    revoke(); prerequisites.refresh();
    if (cleaning) throw cleanupWork;
    if (active) { owner.retainFailure(work); throw work; }
    try { return owner.retire(); }
    catch (error) { retainSceneDisposerFailure(originalSceneDispose, error); throw error; }
  };
  const invoke = callback => {
    try { if (!current()) return undefined; } catch (error) { retain(error); throw error; }
    active++;
    try { const result = callback(); return current() ? result : undefined; }
    catch (error) { retain(error); throw error; }
    finally { active--; }
  };
  const wrap = callback => function(...args) { return invoke(() => Reflect.apply(callback, this, args)); };
  const adopt = (resource, label, methods = [], values = []) => {
    active++;
    try {
      const cap = prerequisites.attach(captureSceneResource(resource, label, 'dispose', [], { required: true }));
      resources.push(cap); cap.assertCaptured(); assertCurrent();
      const facade = {};
      for (const name of methods) {
        assertCurrent();
        const original = resource[name];
        assertCurrent();
        if (typeof original !== 'function') throw new TypeError(`${label} has no original ${name} method.`);
        facade[name] = wrap((...args) => Reflect.apply(original, resource, args));
      }
      for (const name of values) {
        assertCurrent(); const value = resource[name]; assertCurrent(); facade[name] = value;
      }
      return Object.freeze(facade);
    } catch (primary) { retain(primary); throw primary; }
    finally { active--; }
  };
  const listen = (target, name, callback, options) => {
    active++;
    try {
      assertCurrent(); const add = target.addEventListener; assertCurrent();
      const remove = target.removeEventListener; assertCurrent();
      if (typeof add !== 'function' || typeof remove !== 'function') throw new TypeError('Controls require original listener registration/removal methods.');
      const listener = wrap(callback), resource = { dispose: () => Reflect.apply(remove, target, [name, listener, options]) };
      adopt(resource, `original controls ${name} listener`);
      assertCurrent(); Reflect.apply(add, target, [name, listener, options]); assertCurrent();
    } catch (primary) { retain(primary); throw primary; }
    finally { active--; }
  };
  const publish = (name, callback) => {
    active++;
    try {
      if (!current()) throw new Error('Controls publication lost its original owner.');
      const original = wrap(callback); publications.set(name, original); state[name] = original; assertCurrent(); return original;
    } catch (primary) { retain(primary); throw primary; }
    finally { active--; }
  };
  const shutdownScene = () => {
    revoke();
    if (!terminalFlight) {
      const sceneOwner = typeof originalSceneDispose === 'function'
        ? captureSceneResource({ dispose: () => Reflect.apply(originalSceneDispose, state, []) }, 'controls original pagehide scene') : null;
      terminalFlight = Promise.resolve().then(async () => {
        const errors = [];
        try { dispose(); } catch (error) { errors.push(error); }
        if (sceneOwner) try { await sceneOwner.retireAsync(); } catch (error) { errors.push(error); }
        return Object.freeze({ pending: owner.pending || sceneOwner?.pending === true, errors: Object.freeze(errors) });
      });
    }
    return terminalFlight;
  };
  const failedConstruction = primary => {
    retain(primary);
    const errors = []; try { dispose(); } catch (error) { errors.push(error); }
    return preserveSceneCleanupFailures(primary, errors, { hasPrimary: true, forceAggregate: true });
  };
  const construct = callback => {
    try {
      const result = invoke(callback);
      if (!current()) throw new Error('Controls construction lost its original publication authority.');
      return result;
    }
    catch (primary) { throw failedConstruction(primary); }
  };
  try {
    // Publication itself may install, throw or reenter the newly issued
    // disposer. Its original stack is work even before current() can be true.
    active++;
    try { publications.set('disposeControls', dispose); state.disposeControls = dispose; }
    finally { active--; }
    if (!current()) throw new Error('Controls initial disposer publication lost its original authority.');
  } catch (primary) { throw failedConstruction(primary); }
  return Object.freeze({ dispose, revoke, invoke, wrap, adopt, listen, publish, shutdownScene, owns, canClear, current, construct,
    get disposed() { return disposed; }, onDetach: callback => { detachers.push(callback); }
  });
};
