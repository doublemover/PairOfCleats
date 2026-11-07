import { captureSceneResource } from './scene-retirement.js';

/** The render loop owns the frame boundary; pointer delivery owns only the most
 * recent coordinates. Idle frames do no picking until an explicit invalidation. */
export const createHoverFrame = ({ pick, clear, isCurrent = () => true }) => {
  let pointer = null, dirty = false, dragging = false, disposed = false, revoked = false;
  let active = 0, cleanupStarted = false, cleaning = false;
  const work = Object.freeze(Object.defineProperty(new Error('Original hover callback has not returned.'),
    'sceneOwnershipReleased', { value: () => active === 0 }));
  const cleanupWork = Object.freeze(Object.defineProperty(new Error('Original hover cleanup has not returned.'),
    'sceneOwnershipReleased', { value: () => !cleaning }));
  const resource = { dispose() {
    if (cleanupStarted) return;
    cleanupStarted = true; cleaning = true;
    try { if (!revoked && isCurrent() === true) clear(); }
    finally { cleaning = false; }
  } };
  const owner = captureSceneResource(resource, 'hover frame callbacks', 'dispose', [], { required: true });
  const current = () => {
    if (disposed || revoked) return false;
    try {
      const accepted = isCurrent() === true;
      if (disposed || revoked || !accepted) { revoked = true; pointer = null; dirty = false; dragging = false; return false; }
      return true;
    } catch (error) { revoked = true; owner.retainFailure(error); throw error; }
  };
  const invoke = (callback, absent = undefined) => {
    if (!current()) return absent;
    active++; owner.retainFailure(work);
    try { return callback(); }
    catch (error) { owner.retainFailure(error); throw error; }
    finally { active--; }
  };
  return Object.freeze({
    move: event => invoke(() => {
      const next = Object.freeze({ clientX: event.clientX, clientY: event.clientY });
      if (current()) { pointer = next; dirty = true; }
    }),
    invalidate: () => invoke(() => { if (pointer) dirty = true; }),
    startDrag: () => invoke(() => { dragging = true; dirty = false; clear(); }),
    endDrag: () => invoke(() => { dragging = false; if (pointer) dirty = true; }),
    leave: () => invoke(() => { pointer = null; dirty = false; dragging = false; clear(); }),
    frame: () => invoke(() => {
      if (dragging || !pointer || !dirty) return false;
      dirty = false; pick(pointer); return current();
    }, false),
    dispose() {
      disposed = true; pointer = null; dirty = false; dragging = false;
      if (cleaning) throw cleanupWork;
      return owner.retire();
    }
  });
};
