import { captureSceneResource, preserveSceneCleanupFailures } from './scene-retirement.js';

export const createViewportInputOwner = ({ viewport, canvas, window, document, cancelMotion, shortcut, invalidate, isCurrent = () => true }) => {
  const keys = Object.create(null), removers = [];
  let focused = false, disposed = false, revoked = false, active = 0, cleanupStarted = false, cleaning = false;
  const clearKeys = () => { for (const code of Object.keys(keys)) delete keys[code]; };
  const work = Object.freeze(Object.defineProperty(new Error('Original viewport input callback has not returned.'),
    'sceneOwnershipReleased', { value: () => active === 0 }));
  const cleanupWork = Object.freeze(Object.defineProperty(new Error('Original viewport input cleanup has not returned.'),
    'sceneOwnershipReleased', { value: () => !cleaning }));
  const cleanup = { dispose() {
    if (cleanupStarted) return;
    cleanupStarted = true; cleaning = true; focused = false;
    try {
      const errors = [], attempt = callback => { try { callback(); } catch (error) { errors.push(error); } };
      attempt(clearKeys); attempt(cancelMotion); attempt(invalidate);
      for (const remover of removers) attempt(() => remover.retire());
      const failure = preserveSceneCleanupFailures(null, errors);
      if (failure) throw failure;
    } finally { cleaning = false; }
  } };
  const owner = captureSceneResource(cleanup, 'viewport input subscriptions', 'dispose', [], { required: true });
  const current = () => {
    if (disposed || revoked) return false;
    try {
      const accepted = isCurrent() === true;
      if (disposed || revoked || !accepted) { revoked = true; clearKeys(); return false; }
      return true;
    } catch (error) { revoked = true; owner.retainFailure(error); throw error; }
  };
  const invoke = callback => {
    if (!current()) return;
    active++; owner.retainFailure(work);
    try { return callback(); }
    catch (error) { owner.retainFailure(error); throw error; }
    finally { active--; }
  };
  const dispose = () => { disposed = true; if (cleaning) throw cleanupWork; return owner.retire(); };
  const owns = target => target === viewport || target === canvas;
  const listen = (target, name, callback) => {
    const add = target.addEventListener, remove = target.removeEventListener;
    if (typeof add !== 'function' || typeof remove !== 'function') throw new TypeError('Viewport input requires original listener registration and removal methods.');
    const listener = event => invoke(() => callback(event));
    const resource = { dispose: () => Reflect.apply(remove, target, [name, listener]) };
    // Retain the original remover before registration: an add callback can
    // install its listener and then throw or reenter logical retirement.
    removers.push(captureSceneResource(resource, `viewport input ${name} listener`, 'dispose', [], { required: true }));
    Reflect.apply(add, target, [name, listener]);
  };
  const reset = () => {
    clearKeys();
    if (!current()) return;
    cancelMotion();
    if (current()) invalidate();
  };
  try {
    listen(viewport, 'pointerdown', event => {
      if (!owns(event.target)) return;
      viewport.focus({ preventScroll: true });
    });
    listen(document, 'focusin', event => {
      focused = owns(event.target);
      if (!focused) reset();
    });
    listen(viewport, 'focusout', event => {
      if (!owns(event.relatedTarget)) { focused = false; reset(); }
    });
    listen(window, 'blur', () => { focused = false; reset(); });
    listen(document, 'visibilitychange', () => { if (document.hidden) { focused = false; reset(); } });
    for (const event of ['pointercancel', 'lostpointercapture']) listen(canvas, event, reset);
    listen(window, 'keydown', event => {
      if (!focused || !owns(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const code = event.code, handled = shortcut(event);
      if (!current()) return;
      if (handled) { event.preventDefault(); return; }
      if (!['KeyW','KeyA','KeyS','KeyD'].includes(code)) return;
      event.preventDefault();
      if (!current()) return;
      keys[code] = true; invalidate();
    });
    // Key release always retires ownership, including after focus transfer/blur.
    listen(window, 'keyup', event => { const code = event.code; if (!current()) return; delete keys[code]; invalidate(); });
    focused = owns(document.activeElement);
    return Object.freeze({ keys, reset: () => invoke(reset), dispose });
  } catch (primary) {
    disposed = true; owner.retainFailure(primary);
    const errors = []; try { owner.retire(); } catch (error) { errors.push(error); }
    throw preserveSceneCleanupFailures(primary, errors, { hasPrimary: true, forceAggregate: true });
  }
};
