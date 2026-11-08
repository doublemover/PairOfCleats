import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';

const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const originalResources = new WeakMap();

/** One resident picker retains exact returned resources and original methods.
 * Retirement revokes publication before invoking either independent disposer. */
export const createPickingResourceOwner = ({ state, createIndex, createFence, readDevicePixelRatio, isCurrent = () => true }) => {
  const records = new WeakMap(), retired = new Set(), captured = new Set();
  const identity = Object.freeze({});
  let request = 0;
  const capture = (resource, kind) => {
    if (!objectLike(resource)) throw new TypeError(`Resident pick ${kind} acquisition returned no resource.`);
    let record = records.get(resource);
    if (!record) {
      let original = originalResources.get(resource);
      if (!original) {
        original = { owner: captureSceneResource(resource, `resident pick ${kind}`, 'dispose', [], { required: true }), active: 0, methods: new Map(), claim: null };
        original.work = Object.freeze(Object.defineProperty(new Error('Original resident picking work has not returned.'),
          'sceneOwnershipReleased', { value: () => original.active === 0 }));
        originalResources.set(resource, original);
      }
      record = { resource, original, owner: original.owner, generation: 0, methods: original.methods,
        enter() { original.active++; original.owner.retainFailure(original.work); }, leave() { original.active--; } };
      records.set(resource, record);
    }
    captured.add(record);
    record.owner.assertCaptured();
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
  const detach = (index, fence) => {
    if (index !== undefined && state.pickIndex === index) {
      state.pickIndex = null; state.pickIndexSource = null; state.pickIndexRevision = null;
    }
    if (fence !== undefined && state.pickFence === fence) state.pickFence = null;
  };
  const close = (resources, primary, hasPrimary = false) => {
    const errors = [];
    for (const record of new Set(resources.filter(Boolean))) retired.add(record);
    // A prior failed owner reports its original retained failure. This is not
    // an implicit native retry; explicit reconciliation uses its existing cap.
    for (const record of [...retired]) {
      try { record.owner.retire(); if (!record.owner.pending) { retired.delete(record); captured.delete(record); } }
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
  const detachCaptured = () => {
    request++;
    for (const record of captured) {
      if (record.original.claim !== null && record.original.claim !== identity) continue;
      if (state.pickIndex === record.resource) detach(record.resource, undefined);
      if (state.pickFence === record.resource) detach(undefined, record.resource);
    }
  };
  const retireCaptured = () => {
    detachCaptured();
    return close([...captured].filter(record => record.original.claim === null || record.original.claim === identity));
  };
  const cancelCaptured = () => {
    if (isCurrent() !== true) return;
    for (const record of captured) {
      if (record.original.claim !== identity || state.pickFence !== record.resource || !record.owner.pending || record.owner.lastError) continue;
      record.enter();
      try {
        const callable = method(record, 'cancel');
        if (isCurrent() !== true || record.original.claim !== identity || state.pickFence !== record.resource) return;
        if (!record.owner.pending || record.owner.lastError) throw record.owner.lastError || new Error('Original pick cancellation lost its resource lifetime.');
        return Reflect.apply(callable, record.resource, []);
      } catch (error) { record.owner.retainFailure(error); throw error; }
      finally { record.leave(); }
    }
  };
  const pick = (raycaster, pointer, fallbackTargets) => {
    const token = ++request, source = state.sourceIndex?.snapshot, revision = state.geometryRevision || 0;
    const scene = state.scene, renderer = state.renderer, resources = [], acquired = [], entered = [];
    const current = () => token === request && state.sourceIndex?.snapshot === source
      && (state.geometryRevision || 0) === revision && state.scene === scene && state.renderer === renderer && isCurrent() === true;
    let index = null, fence = null, originalSlots = null, hasOriginalWork = true;
    const originalCurrent = () => current() && state.pickIndex === index?.resource && state.pickFence === fence?.resource;
    const invoke = (record, name, ...args) => {
      const callable = method(record, name);
      if (!originalCurrent()) return undefined;
      if (!record.owner.pending || record.owner.lastError) throw record.owner.lastError || new Error('Original picking operation lost its resource lifetime.');
      return Reflect.apply(callable, record.resource, args);
    };
    const owned = record => record && record.generation <= token && (record.original.claim === null || record.original.claim === identity);
    const detachOriginal = () => detach(owned(index) ? index.resource : undefined, owned(fence) ? fence.resource : undefined);
    const detachAcquired = () => detach(acquired.includes(index) && owned(index) ? index.resource : undefined,
      acquired.includes(fence) && owned(fence) ? fence.resource : undefined);
    const claim = record => {
      if (retired.has(record) || !record.owner.pending || record.owner.lastError) throw record.owner.lastError || new Error('A retired picking resource cannot be acquired again.');
      record.generation = Math.max(token, record.generation);
      record.original.claim = identity;
      return record;
    };
    try {
      if (!current()) return [];
      for (const record of captured) if (!record.owner.pending) { captured.delete(record); retired.delete(record); }
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
        if (!index.owner.pending || index.owner.lastError) throw index.owner.lastError || new Error('Returned picking index closed during original callback capture.');
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
        method(fence, 'capture'); method(fence, 'accept'); method(fence, 'cancel');
        if (!fence.owner.pending || fence.owner.lastError) throw fence.owner.lastError || new Error('Returned picking fence closed during original callback capture.');
        if (!current()) { detachAcquired(); hasOriginalWork = false; close(acquired.filter(owned)); return []; }
        state.pickFence = fence.resource;
      }
      method(fence, 'cancel');
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
  return Object.freeze({ pick, retire, cancelCaptured, detachCaptured, retireCaptured });
};
