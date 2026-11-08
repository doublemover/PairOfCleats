const snapshots = new WeakMap(), details = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const reserved = new Set(['cause', 'errors', 'message', 'name', 'code', 'stack', 'cleanupErrors',
  'embeddingCacheOwner', 'cacheOwnershipPending', 'cacheOwnershipReleased', 'embeddingCacheInspectionErrors']);

/** Capture diagnostics once, before cleanup. Descriptor inspection skips lazy
 * stack and preserves the receiver of unrelated accessors without invoking them.
 * Original diagnostic failures remain independent work, never close authority.
 */
export const captureEmbeddingCacheFailure = (primary, observeOwnership) => {
  if (objectLike(primary) && snapshots.has(primary)) {
    const captured = snapshots.get(primary); captured.refresh(); return captured;
  }
  const fields = new Map(), descriptors = new Map(), observations = new Map(), inspections = [];
  let overflow = false;
  const observe = error => {
    if (observations.has(error)) return;
    const original = observeOwnership(error);
    if (original) observations.set(error, original);
  };
  const remember = error => {
    if (inspections.includes(error)) return;
    if (inspections.length === 64) { overflow = true; return; }
    inspections.push(error); observe(error);
  };
  const refresh = () => { observe(primary); for (const error of inspections) observe(error); };
  const captured = Object.freeze({ primary, refresh,
    get inspectionErrors() { return Object.freeze([...inspections]); },
    get hasOwnership() { return overflow || observations.size > 0; },
    released: () => !overflow && [...observations.values()].every(check => check()),
    inspectionsReleased: () => !overflow && inspections.every(error => !observations.has(error) || observations.get(error)()),
    get message() { return typeof fields.get('message') === 'string' ? fields.get('message') : 'Embedding resource cleanup remains pending.'; }
  });
  details.set(captured, { fields, descriptors, remember });
  if (objectLike(primary)) snapshots.set(primary, captured);
  refresh();
  if (!objectLike(primary)) return captured;
  for (const key of ['message', 'name', 'code']) {
    try { fields.set(key, Reflect.get(primary, key)); } catch (error) { remember(error); }
    if (key !== 'message') {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(primary, key);
        if (descriptor) descriptors.set(key, descriptor);
      } catch (error) { remember(error); }
    }
  }
  let keys;
  try { keys = Reflect.ownKeys(primary); } catch (error) { remember(error); return captured; }
  let count = 0;
  for (const key of keys) {
    if (reserved.has(key)) continue;
    if (++count > 128) { overflow = true; break; }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(primary, key);
      if (descriptor) descriptors.set(key, descriptor);
    } catch (error) { remember(error); }
  }
  return captured;
};

export const projectEmbeddingCacheFailure = (target, captured) => {
  const { fields, descriptors, remember } = details.get(captured);
  for (const [key, descriptor] of descriptors) {
    if (key === 'name' || key === 'code') continue;
    const projected = { ...descriptor };
    const getter = descriptor.get, setter = descriptor.set;
    if (typeof getter === 'function') projected.get = () => {
      try { return getter.call(captured.primary); } catch (error) { remember(error); throw error; }
    };
    if (typeof setter === 'function') projected.set = value => {
      try { return setter.call(captured.primary, value); } catch (error) { remember(error); throw error; }
    };
    Object.defineProperty(target, key, projected);
  }
  for (const key of ['name', 'code']) {
    const value = fields.get(key);
    const descriptor = descriptors.get(key);
    if (value !== undefined) Object.defineProperty(target, key, descriptor && Object.hasOwn(descriptor, 'value')
      ? { ...descriptor, value } : { value, configurable: true, writable: true });
  }
  Object.defineProperty(target, 'embeddingCacheInspectionErrors', { get: () => captured.inspectionErrors });
};
