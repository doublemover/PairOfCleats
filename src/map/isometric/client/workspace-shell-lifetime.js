import { captureSceneResource, preserveSceneCleanupFailures } from './scene-retirement.js';
import { createSceneWorkPrerequisites } from './scene-work-prerequisites.js';

/** The shell owns original publications, subscriptions and child capabilities.
 * Shared DOM restoration is permitted only by its original publication token. */
export const createViewerShellLifetime = state => {
  const resources = [], restorers = [], publications = [], failures = [], logicalErrors = [];
  const prerequisites = createSceneWorkPrerequisites('Original viewer shell work remains pending.');
  let shell, retired = false, restoreShared = false, active = 0, closeFlight = null, cleaning = false;
  let idleResolve = null;
  const work = Object.freeze(Object.defineProperty(new Error('Original viewer shell construction or callback has not returned.'),
    'sceneOwnershipReleased', { value: () => active === 0 }));
  const retain = error => prerequisites.retain(error);
  const current = () => !retired && state.viewerShell === shell;
  const assertCurrent = () => { if (!current()) throw new Error('Viewer shell lost its original publication authority.'); };
  const leave = () => { if (--active === 0) { idleResolve?.(); idleResolve = null; } };
  const invoke = callback => {
    active++;
    try { if (!current()) return; return callback(); }
    catch (error) { retain(error); throw error; }
    finally { leave(); }
  };
  const step = callback => {
    assertCurrent(); const value = callback(); assertCurrent(); return value;
  };
  const wrap = callback => function(...args) { return invoke(() => Reflect.apply(callback, this, args)); };
  const nativeWork = label => {
    let running = 0;
    return {
      observation: Object.freeze(Object.defineProperty(new Error(`${label} original cleanup has not returned.`),
        'sceneOwnershipReleased', { value: () => running === 0 })),
      invoke(callback) {
        running++; let asynchronous = false;
        try {
          const result = callback();
          if (result instanceof Promise) {
            const flight = Reflect.apply(Promise.prototype.then, result, [value => { running--; return value; }, error => { running--; throw error; }]);
            asynchronous = true; return flight;
          }
          return result;
        } finally { if (!asynchronous) running--; }
      }
    };
  };
  const resource = (value, label, method = 'dispose') => {
    active++;
    try {
      const native = nativeWork(label), captured = { originalResource: value, get dispose() {
        const original = value[method];
        if (typeof original !== 'function') throw new TypeError(`${label} has no original ${method} method.`);
        return () => native.invoke(() => Reflect.apply(original, value, []));
      } };
      const cap = prerequisites.attach(captureSceneResource(captured, label, 'dispose', [], { required: true }));
      cap.retainFailure(work); cap.retainFailure(native.observation); resources.push(cap); return cap;
    } catch (error) { retain(error); owner.retainFailure(error); throw error; }
    finally { leave(); }
  };
  const undo = callback => {
    const native = nativeWork('Viewer shell restoration');
    const owner = prerequisites.attach(captureSceneResource({ dispose: () => native.invoke(callback) }, 'original viewer shell restoration', 'dispose', [], { required: true }));
    owner.retainFailure(work); owner.retainFailure(native.observation); restorers.push(owner); return owner;
  };
  const publish = (name, value) => {
    if (retired) throw new Error('Viewer shell publication retired.');
    const original = state[name];
    if (retired) throw new Error('Viewer shell publication retired.');
    const descriptor = Object.getOwnPropertyDescriptor(state, name);
    if (retired) throw new Error('Viewer shell publication retired.');
    const native = nativeWork(`Viewer shell ${name} publication`);
    const cap = prerequisites.attach(captureSceneResource({ dispose: () => native.invoke(() => {
      if (state[name] !== value) return;
      if (descriptor && !Object.hasOwn(descriptor, 'value')) {
        if (typeof descriptor.set !== 'function') throw new TypeError(`Original shell ${name} publication cannot be restored.`);
        return Reflect.apply(descriptor.set, state, [original]);
      }
      if (descriptor) Object.defineProperty(state, name, descriptor);
      else if (!Reflect.deleteProperty(state, name)) throw new TypeError(`Original shell ${name} publication cannot be revoked.`);
    }) }, `original viewer shell ${name} publication`, 'dispose', [], { required: true }));
    cap.retainFailure(work); cap.retainFailure(native.observation); publications.push(cap);
    state[name] = value;
    if (name === 'viewerShell') shell = value;
    assertCurrent();
  };
  const revoke = () => {
    if (retired) return;
    retired = true;
    try { restoreShared = state.viewerShell === shell; }
    catch (error) { failures.push(error); logicalErrors.push(error); retain(error); }
  };
  const cleanup = async () => {
    if (active) await new Promise(resolve => { idleResolve = resolve; });
    cleaning = true;
    const errors = logicalErrors.splice(0);
    try {
      await Promise.all([...resources, ...[...restorers].reverse()].map(async cap => {
        try { await cap.retireAsync(); } catch (error) { errors.push(error); }
      }));
      // Keep publication proof until every shared-DOM undo has been attempted.
      // A failed child retains this retired publication until explicit child
      // reconciliation; a future parent retry cannot adopt a sibling shell.
      if (![...resources, ...restorers].some(cap => cap.pending)) {
        for (const cap of [...publications].reverse()) try { await cap.retireAsync(); } catch (error) { errors.push(error); }
      }
      const failure = preserveSceneCleanupFailures(null, errors);
      if (failure) throw failure;
    } finally { cleaning = false; }
  };
  const owner = captureSceneResource({ dispose: cleanup }, 'original viewer shell lifetime', 'dispose', [], { required: true });
  const dispose = () => {
    revoke();
    if (!closeFlight) {
      closeFlight = Promise.resolve().then(() => owner.retireAsync());
      closeFlight.catch(error => { failures.push(error); });
    }
    return closeFlight;
  };
  const listen = (target, name, callback, options) => {
    step(() => {
      const remove = step(() => target.removeEventListener), add = step(() => target.addEventListener);
      if (typeof add !== 'function' || typeof remove !== 'function') throw new TypeError('Viewer shell requires original subscription methods.');
      const listener = wrap(callback);
      resource({ dispose: () => Reflect.apply(remove, target, [name, listener, options]) }, `original viewer shell ${name} subscription`);
      Reflect.apply(add, target, [name, listener, options]);
    });
  };
  const adoptRetired = cap => {
    const closing = cap.retireAsync();
    if (cap.pending && cap.lastError) owner.retainFailure(cap.lastError);
    closing.catch(error => { failures.push(error); owner.retainFailure(error); });
  };
  return Object.freeze({ invoke, step, wrap, resource, undo, publish, listen, dispose, retain, owner, adoptRetired, isCurrent: current,
    canRestore: () => restoreShared && state.viewerShell === shell,
    get retired() { return retired; },
    get pendingOwners() { return Object.freeze([owner, ...resources, ...restorers, ...publications].filter(cap => cap.pending)); },
    get failures() { return Object.freeze([...failures]); },
    construct(value, callback) {
      shell = value; active++;
      try { publish('viewerShell', value); return step(callback); }
      catch (primary) {
        retain(primary); revoke();
        const errors = [];
        // Retain a synchronous pending capability with the exact construction
        // failure; its asynchronous cleanup still waits for this stack to leave.
        try { owner.retire(); } catch (error) { errors.push(error); }
        dispose();
        throw preserveSceneCleanupFailures(primary, errors, { hasPrimary: true, forceAggregate: true });
      } finally { leave(); }
    },
    get cleaning() { return cleaning; }
  });
};
