import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';

const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** One resident picker retains exact returned resources and original methods.
 * Retirement revokes publication before invoking either independent disposer. */
export const createPickingResourceOwner = ({ state, createIndex, createFence, readDevicePixelRatio }) => {
  const records = new WeakMap(), retired = new Set();
  let request = 0;
  const capture = (resource, kind) => {
    if (!objectLike(resource)) throw new TypeError(`Resident pick ${kind} acquisition returned no resource.`);
    let record = records.get(resource);
    if (!record) {
      const owner = captureSceneResource(resource, `resident pick ${kind}`, 'dispose', [], { required: true });
      let active = 0;
      const work = Object.freeze(Object.defineProperty(new Error('Original resident picking work has not returned.'),
        'sceneOwnershipReleased', { value: () => active === 0 }));
      record = { resource, owner, generation: 0, methods: new Map(),
        enter() { active++; owner.retainFailure(work); }, leave() { active--; } };
      records.set(resource, record);
    }
    return record;
  };
  const method = (record, name) => {
    if (!record.methods.has(name)) {
      try {
        const callable = record.resource[name];
        if (typeof callable !== 'function') throw new TypeError(`Resident picker has no original ${name} method.`);
        record.methods.set(name, { callable });
      } catch (error) { record.methods.set(name, { error }); record.owner.retainFailure(error); }
    }
    const original = record.methods.get(name);
    if (Object.hasOwn(original, 'error')) throw original.error;
    return original.callable;
  };
  const invoke = (record, name, ...args) => method(record, name).apply(record.resource, args);
  const detach = (index, fence) => {
    if (state.pickIndex === index) {
      state.pickIndex = null; state.pickIndexSource = null; state.pickIndexRevision = null;
    }
    if (state.pickFence === fence) state.pickFence = null;
  };
  const close = (resources, primary, hasPrimary = false) => {
    const errors = [];
    for (const record of new Set(resources.filter(Boolean))) retired.add(record);
    // A prior failed owner reports its original retained failure. This is not
    // an implicit native retry; explicit reconciliation uses its existing cap.
    for (const record of [...retired]) {
      try { record.owner.retire(); if (!record.owner.pending) retired.delete(record); }
      catch (error) { errors.push(error); }
    }
    const failure = preserveSceneCleanupFailures(primary, errors, { hasPrimary });
    if (failure) throw failure;
  };
  const snapshot = () => {
    const index = state.pickIndex, fence = state.pickFence, resources = [], errors = [];
    // Capture both original capabilities before running either native method.
    for (const [resource, kind] of [[index, 'index'], [fence, 'fence']]) {
      if (resource === null || resource === undefined) continue;
      try { resources.push(capture(resource, kind)); } catch (error) { errors.push(error); }
    }
    return { index, fence, resources, errors };
  };
  const retire = () => {
    request++;
    const original = snapshot();
    detach(original.index, original.fence);
    const primary = preserveSceneCleanupFailures(null, original.errors);
    return close(original.resources, primary, original.errors.length > 0);
  };
  const pick = (raycaster, pointer, fallbackTargets) => {
    const token = ++request, source = state.sourceIndex?.snapshot, revision = state.geometryRevision || 0;
    const scene = state.scene, renderer = state.renderer, resources = [], acquired = [], entered = [];
    const current = () => token === request && state.sourceIndex?.snapshot === source
      && (state.geometryRevision || 0) === revision && state.scene === scene && state.renderer === renderer;
    let index = null, fence = null, originalSlots = null, hasOriginalWork = true;
    const originalCurrent = () => current() && state.pickIndex === index?.resource && state.pickFence === fence?.resource;
    const owned = record => record && record.generation <= token;
    const detachOriginal = () => detach(owned(index) ? index.resource : undefined, owned(fence) ? fence.resource : undefined);
    const detachAcquired = () => detach(acquired.includes(index) && owned(index) ? index.resource : undefined,
      acquired.includes(fence) && owned(fence) ? fence.resource : undefined);
    const claim = record => {
      if (retired.has(record) || !record.owner.pending) throw record.owner.lastError || new Error('A retired picking resource cannot be acquired again.');
      record.generation = Math.max(token, record.generation);
      return record;
    };
    try {
      const original = snapshot(); originalSlots = original; resources.push(...original.resources);
      index = resources.find(record => record.resource === original.index) || null;
      fence = resources.find(record => record.resource === original.fence) || null;
      if (original.errors.length) throw preserveSceneCleanupFailures(null, original.errors);
      if (!current()) return [];
      index = original.index == null ? null : claim(capture(original.index, 'index'));
      fence = original.fence == null ? null : claim(capture(original.fence, 'fence'));
      if (!state.pickIndex || state.pickIndexSource !== source || state.pickIndexRevision !== revision) {
        const previous = state.pickIndex;
        if (previous !== null && previous !== undefined) {
          const previousRecord = capture(previous, 'index');
          if (state.pickIndex === previous) {
            state.pickIndex = null; state.pickIndexSource = null; state.pickIndexRevision = null;
          }
          hasOriginalWork = false; close([previousRecord]); hasOriginalWork = true;
          if (!current()) return [];
        }
        const meshes = fallbackTargets();
        if (!current()) return [];
        index = claim(capture(createIndex({ THREE: state.THREE, meshes }), 'index')); resources.push(index); acquired.push(index);
        // Capture operation callbacks at acquisition, before later mutations.
        method(index, 'query'); method(index, 'intersect');
        if (!current()) { hasOriginalWork = false; close(acquired.filter(owned)); return []; }
        state.pickIndex = index.resource; state.pickIndexSource = source; state.pickIndexRevision = revision;
      }
      if (!state.pickFence) {
        const getViewport = state.getViewport;
        if (typeof getViewport !== 'function') throw new TypeError('Resident picker has no original viewport reader.');
        fence = claim(capture(createFence(() => {
          const viewport = getViewport.call(state);
          return { source: state.sourceIndex?.snapshot, geometry: state.geometryRevision || 0,
            camera: state.cameraRevision || 0, width: viewport.width, height: viewport.height, dpr: readDevicePixelRatio() };
        }), 'fence')); resources.push(fence); acquired.push(fence);
        method(fence, 'capture'); method(fence, 'accept');
        if (!current()) { detachAcquired(); hasOriginalWork = false; close(acquired.filter(owned)); return []; }
        state.pickFence = fence.resource;
      }
      if (!originalCurrent()) return [];
      for (const record of new Set([index, fence])) { record.enter(); entered.push(record); }
      const stamp = invoke(fence, 'capture', pointer);
      if (!originalCurrent()) return [];
      const candidates = invoke(index, 'query', raycaster.ray);
      if (!originalCurrent()) return [];
      const result = invoke(index, 'intersect', raycaster, candidates);
      if (!originalCurrent()) return [];
      const hits = result.hits, metrics = result.metrics;
      if (!originalCurrent()) return [];
      const accepted = invoke(fence, 'accept', stamp, hits);
      if (!originalCurrent()) return [];
      state.pickMetrics = metrics;
      return accepted || [];
    } catch (primary) {
      // A physical cleanup failure is not new work on an independent fence.
      // User operation/inspection failures still gate every captured resource.
      if (hasOriginalWork) for (const record of resources.filter(owned)) record.owner.retainFailure(primary);
      // Leave accepted original work before attempting its actual cleanup.
      for (const record of entered.splice(0)) record.leave();
      detachOriginal();
      if (token === request && originalSlots) {
        // Malformed non-resource slots carry no capability. Clear only their
        // exact original value while this invocation still owns publication.
        if (!index && state.pickIndex === originalSlots.index) {
          state.pickIndex = null; state.pickIndexSource = null; state.pickIndexRevision = null;
        }
        if (!fence && state.pickFence === originalSlots.fence) state.pickFence = null;
      }
      return close(resources.filter(owned), primary, true);
    } finally { for (const record of entered) record.leave(); }
  };
  return Object.freeze({ pick, retire });
};
