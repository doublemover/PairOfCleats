import { captureSceneResource, preserveSceneCleanupFailures } from '../../src/map/isometric/client/scene-retirement.js';
import { createSceneWorkPrerequisites } from '../../src/map/isometric/client/scene-work-prerequisites.js';

const notRunning = error => error !== null && typeof error === 'object'
  && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ERR_SERVER_NOT_RUNNING';

/** The exact listener, startup acquisition and accepted handlers own pins. */
export const createMapPreviewLifetime = ({ controller, detach = () => {} }) => {
  const resources = [], listeners = [], requests = new Set();
  const abort = controller.abort, signal = controller.signal;
  const prerequisites = createSceneWorkPrerequisites('Original preview acquisition or callback work remains pending.');
  let retired = false, startupDone = false, finishStartup, serverOwner = null, closeFlight = null, cleanupStarted = false;
  const startup = new Promise(resolve => { finishStartup = resolve; });
  const startupWork = Object.freeze(Object.defineProperty(new Error('Original preview acquisition has not returned.'),
    'sceneOwnershipReleased', { value: () => startupDone }));
  const pinWork = Object.freeze(Object.defineProperty(new Error('Original preview listener or accepted handlers still own pinned data.'),
    'sceneOwnershipReleased', { value: () => retired && startupDone && requests.size === 0 && (!serverOwner || !serverOwner.pending) }));
  const perform = async () => {
    retired = true;
    if (cleanupStarted) return;
    cleanupStarted = true;
    const errors = [];
    try { Reflect.apply(abort, controller, []); } catch (error) { errors.push(error); prerequisites.retain(error); }
    try { detach(); } catch (error) { errors.push(error); prerequisites.retain(error); }
    await startup;
    for (const listener of listeners) try { await listener.retireAsync(); } catch (error) { errors.push(error); }
    if (serverOwner) try { await serverOwner.retireAsync(); } catch (error) { errors.push(error); }
    await Promise.all([...requests].map(entry => entry.done));
    for (const resource of resources) try { await resource.retireAsync(); } catch (error) { errors.push(error); }
    const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
  };
  const resourceOwner = captureSceneResource({ dispose: perform }, 'original map preview lifetime', 'dispose', [], { required: true });
  const adopt = (resource, label, method = 'dispose', args = []) => {
    if (startupDone) throw new Error('Preview resources must be acquired inside original startup.');
    const owner = prerequisites.attach(captureSceneResource(resource, label, method, args, { required: true }));
    owner.retainFailure(pinWork); resources.push(owner); owner.assertCaptured(); return owner;
  };
  const ownServer = server => {
    if (startupDone || serverOwner) throw new Error('Preview owns one original listener acquisition.');
    let close, disconnect, captureFailed = false, captureError, listenerClosed = false, disconnected = false, nativeActive = 0;
    const nativeWork = Object.freeze(Object.defineProperty(new Error('Original preview listener close has not returned.'),
      'sceneOwnershipReleased', { value: () => nativeActive === 0 }));
    try {
      close = server.close; disconnect = server.closeAllConnections;
      if (typeof close !== 'function' || typeof disconnect !== 'function') throw new TypeError('Preview requires original listener close and connection cancellation methods.');
    } catch (error) { captureFailed = true; captureError = error; }
    const native = { async dispose() {
      if (captureFailed) throw captureError;
      nativeActive++;
      try {
        const errors = [];
        let closing = null;
        if (!listenerClosed) closing = new Promise((resolve, reject) => {
          let delivered = false;
          const completed = error => {
            if (delivered) return; delivered = true;
            try {
              if (error != null && !notRunning(error)) { reject(error); return; }
              listenerClosed = true; resolve();
            } catch (inspection) { reject(preserveSceneCleanupFailures(error, [inspection], { hasPrimary: error != null, forceAggregate: true })); }
          };
          try { Reflect.apply(close, server, [completed]); } catch (error) { reject(error); }
        });
        if (!disconnected) try { Reflect.apply(disconnect, server, []); disconnected = true; } catch (error) { errors.push(error); }
        if (closing) try { await closing; } catch (error) { errors.push(error); }
        const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
      } finally { nativeActive--; }
    } };
    serverOwner = prerequisites.attach(captureSceneResource(native, 'original map preview listener', 'dispose', [], { required: true }));
    serverOwner.retainFailure(startupWork);
    serverOwner.retainFailure(nativeWork);
    if (captureFailed) { serverOwner.retainFailure(captureError); throw captureError; }
    return serverOwner;
  };
  const close = () => {
    retired = true;
    if (!closeFlight) closeFlight = Promise.resolve().then(() => resourceOwner.retireAsync());
    return closeFlight;
  };
  const listen = (target, name, callback, { add = 'addEventListener', remove = 'removeEventListener', options } = {}) => {
    if (startupDone || retired) throw new DOMException('Original preview registration retired.', 'AbortError');
    let originalAdd, originalRemove, entered = false, active = 1;
    const work = Object.freeze(Object.defineProperty(new Error('Original preview listener registration or callback has not returned.'),
      'sceneOwnershipReleased', { value: () => active === 0 }));
    const listener = function(...args) {
      if (retired) return;
      active++;
      try { return Reflect.apply(callback, this, args); }
      catch (error) { prerequisites.retain(error); throw error; }
      finally { active--; }
    };
    const owner = prerequisites.attach(captureSceneResource({ dispose() {
      if (!entered) return;
      active++;
      try { return Reflect.apply(originalRemove, target, [name, listener, options]); }
      finally { active--; }
    } }, `original map preview ${name} subscription`, 'dispose', [], { required: true }));
    owner.retainFailure(startupWork); owner.retainFailure(work); listeners.push(owner);
    const assertCurrent = () => { if (retired) throw new DOMException('Original preview registration retired.', 'AbortError'); };
    try {
      originalRemove = target[remove]; assertCurrent();
      originalAdd = target[add]; assertCurrent();
      if (typeof originalAdd !== 'function' || typeof originalRemove !== 'function') throw new TypeError('Preview requires original subscription registration and removal methods.');
      entered = true;
      Reflect.apply(originalAdd, target, options === undefined ? [name, listener] : [name, listener, options]);
      assertCurrent();
      return owner;
    } catch (error) { prerequisites.retain(error); throw error; }
    finally { active--; }
  };
  return Object.freeze({ adopt, ownServer, close, listen, resourceOwner,
    retainFailure: error => prerequisites.retain(error),
    finishStartup() { if (!startupDone) { startupDone = true; finishStartup(); } },
    get retired() { return retired; }, get serverOwner() { return serverOwner; },
    owners: () => Object.freeze([...resources]),
    listenerOwners: () => Object.freeze([...listeners]),
    request(action) {
      if (retired) return Promise.reject(new DOMException('Map preview retired.', 'AbortError'));
      let finish;
      const entry = { done: new Promise(resolve => { finish = resolve; }) }; requests.add(entry);
      return Promise.resolve().then(() => { signal.throwIfAborted(); return action(); })
        .finally(() => { requests.delete(entry); finish(); });
    }
  });
};
