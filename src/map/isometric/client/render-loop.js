import { captureSceneResource, preserveSceneCleanupFailures } from './scene-retirement.js';
import { createSceneWorkPrerequisites } from './scene-work-prerequisites.js';

/** Exact original RAF handles/callbacks remain owned after failed cancellation.
 * A delivered callback cannot clear or render a newer request's slot. */
export const createRenderLoop = ({ render, visible = () => true,
  request = requestAnimationFrame, cancel = cancelAnimationFrame }) => {
  let pending = null, retired = false, dirty = false, continuous = false, active = 0, cleaning = false, cleanupStarted = false;
  const records = new Set(), prerequisites = createSceneWorkPrerequisites('Original render-loop work remains pending.');
  const work = Object.freeze(Object.defineProperty(new Error('Original render-loop callback has not returned.'),
    'sceneOwnershipReleased', { value: () => active === 0 }));
  const cleanupWork = Object.freeze(Object.defineProperty(new Error('Original render-loop cleanup has not returned.'),
    'sceneOwnershipReleased', { value: () => !cleaning }));
  const resource = { dispose() {
    if (cleanupStarted) return;
    cleanupStarted = true; cleaning = true;
    try {
      const errors = [];
      for (const record of records) try { record.owner.retire(); } catch (error) { errors.push(error); }
      const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
    } finally { cleaning = false; }
  } };
  const owner = prerequisites.attach(captureSceneResource(resource, 'original render loop', 'dispose', [], { required: true }));
  owner.retainFailure(work);
  const invoke = callback => {
    if (retired) return;
    active++;
    try { return callback(); }
    catch (error) { retired = true; pending = null; prerequisites.retain(error); throw error; }
    finally { active--; }
  };
  const finish = record => {
    try { record.owner.retire(); if (!record.owner.pending) { records.delete(record); prerequisites.detach(record.owner); } }
    catch (error) { return { failed: true, error }; }
    return { failed: false };
  };
  const delivered = (record, time) => {
    record.delivered = true;
    const original = pending === record;
    if (original) pending = null;
    if (record.requesting) { record.synchronous = true; return; }
    if (!original || retired) { finish(record); return; }
    let primary, failed = false;
    try { invoke(() => {
      if (!original || retired || visible() !== true || retired) { continuous = false; return; }
      record.executing++; dirty = false;
      try { const next = render(time, { continuous }); if (retired) return; continuous = next === true; if (continuous) dirty = true; }
      finally { record.executing--; }
      schedule();
    }); } catch (error) { primary = error; failed = true; }
    const cleanup = finish(record);
    // A stale queued delivery has no new publication or retry authority. Its
    // retained cleanup error stays in the exact existing resource inventory.
    const failure = preserveSceneCleanupFailures(primary, cleanup.failed ? [cleanup.error] : [], { hasPrimary: failed });
    if (failure) throw failure;
  };
  const schedule = () => {
    if (retired || pending !== null || !dirty || visible() !== true || retired || pending !== null) return;
    const record = { id: null, idKnown: false, requesting: true, synchronous: false, delivered: false, cancelled: false, cancelling: false, executing: 0, owner: null };
    const nativeWork = Object.freeze(Object.defineProperty(new Error('Original RAF request or callback has not returned.'),
      'sceneOwnershipReleased', { value: () => !record.requesting && !record.cancelling && record.executing === 0 }));
    const unknown = Object.freeze(Object.defineProperty(new Error('Original RAF request returned no exact handle or delivered callback.'),
      'sceneOwnershipReleased', { value: () => !record.requesting && (record.idKnown || record.delivered) }));
    const native = { dispose() {
      if (record.requesting || record.cancelling || record.executing) throw nativeWork;
      if (record.delivered || record.cancelled) return;
      if (!record.idKnown) throw unknown;
      record.cancelling = true;
      try {
        const result = cancel(record.id);
        if (result !== undefined) {
          prerequisites.retain(result);
          throw Object.assign(new Error('Original RAF cancellation returned no confirmed void outcome.', { cause: result }), { sceneOwnershipPending: true });
        }
        record.cancelled = true;
      } finally { record.cancelling = false; }
    } };
    record.owner = prerequisites.attach(captureSceneResource(native, 'original RAF request', 'dispose', [], { required: true }));
    record.owner.retainFailure(nativeWork); records.add(record); pending = record;
    try {
      const handle = request(time => delivered(record, time));
      if (!Number.isSafeInteger(handle) || handle < 0) throw new Error('RAF request returned no exact integer handle.', { cause: handle });
      record.id = handle; record.idKnown = true;
      if (record.synchronous) throw new Error('RAF callback delivered before original request acquisition returned.');
    } finally { record.requesting = false; }
  };
  return Object.freeze({
    invalidate: () => invoke(() => { dirty = true; schedule(); }),
    visibilityChanged: () => invoke(() => {
      const original = pending; pending = null; continuous = false; dirty = true;
      if (original) { original.owner.retire(); if (!original.owner.pending) { records.delete(original); prerequisites.detach(original.owner); } }
      schedule();
    }),
    dispose() {
      retired = true; pending = null; prerequisites.refresh();
      if (cleaning) throw cleanupWork;
      if (active) { owner.retainFailure(work); throw work; }
      return owner.retire();
    }
  });
};
