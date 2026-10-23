import { captureSceneResource, preserveSceneCleanupFailures } from '../../src/map/isometric/client/scene-retirement.js';

const notRunning = error => error !== null && typeof error === 'object'
  && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ERR_SERVER_NOT_RUNNING';

/** The exact listener, startup acquisition and accepted handlers own pins. */
export const createMapPreviewLifetime = ({ controller, detach = () => {} }) => {
  const resources = [], requests = new Set();
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
    try { controller.abort(); } catch (error) { errors.push(error); }
    try { detach(); } catch (error) { errors.push(error); }
    await startup;
    if (serverOwner) try { await serverOwner.retireAsync(); } catch (error) { errors.push(error); }
    await Promise.all([...requests].map(entry => entry.done));
    for (const resource of resources) try { await resource.retireAsync(); } catch (error) { errors.push(error); }
    const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
  };
  const resourceOwner = captureSceneResource({ dispose: perform }, 'original map preview lifetime', 'dispose', [], { required: true });
  const adopt = (resource, label, method = 'dispose', args = []) => {
    if (startupDone) throw new Error('Preview resources must be acquired inside original startup.');
    const owner = captureSceneResource(resource, label, method, args, { required: true });
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
    serverOwner = captureSceneResource(native, 'original map preview listener', 'dispose', [], { required: true });
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
  return Object.freeze({ adopt, ownServer, close, resourceOwner,
    finishStartup() { if (!startupDone) { startupDone = true; finishStartup(); } },
    get retired() { return retired; }, get serverOwner() { return serverOwner; },
    owners: () => Object.freeze([...resources]),
    request(action) {
      if (retired) return Promise.reject(new DOMException('Map preview retired.', 'AbortError'));
      let finish;
      const entry = { done: new Promise(resolve => { finish = resolve; }) }; requests.add(entry);
      return Promise.resolve().then(() => { controller.signal.throwIfAborted(); return action(); })
        .finally(() => { requests.delete(entry); finish(); });
    }
  });
};
