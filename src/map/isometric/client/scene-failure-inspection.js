import { captureSceneOwnershipObservation } from './scene-ownership-observation.js';

const snapshots = new WeakMap(), details = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const core = ['message', 'name', 'code', 'sceneResourceOwner', 'sceneResourceOwners',
  'rendererTransactionCommitted', 'rendererTransactionStamp', 'rendererTransactionPhase', 'rendererTransactionCleanupFailed'];
const skipped = new Set(['cause', 'errors', 'stack', ...core, 'sceneInspectionErrors', 'sceneInspectionOverflow',
  'sceneOwnershipPending', 'sceneOwnershipReleased', 'cacheOwnershipPending', 'cacheOwnershipReleased']);

/** Diagnostic projection is observational: inspect each original field once,
 * skip lazy Error stack before descriptor access, and retain exact inspection
 * errors with their independent original ownership. Never coerce error objects. */
export const captureSceneFailure = primary => {
  if (objectLike(primary) && snapshots.has(primary)) {
    const captured = snapshots.get(primary); captured.refresh(); return captured;
  }
  const fields = new Map(), descriptors = new Map(), observers = new Map(), inspectionErrors = [], observedInspections = new Map();
  let overflow = false, owners = [];
  const refresh = () => {
    const pending = [primary, ...inspectionErrors], visited = new Set();
    while (pending.length) {
      const error = pending.pop();
      if (visited.has(error)) continue; visited.add(error);
      if (visited.size > 128) { overflow = true; break; }
      const captured = captureSceneOwnershipObservation(error);
      if (captured.observe) observers.set(error, captured);
      const prior = observedInspections.get(error) || 0;
      for (const value of captured.inspectionErrors.slice(prior)) { inspectionErrors.push(value); pending.push(value); }
      observedInspections.set(error, captured.inspectionErrors.length);
    }
  };
  const remember = error => { inspectionErrors.push(error); refresh(); };
  const captured = Object.freeze({ primary, refresh,
    get inspectionErrors() { return Object.freeze([...inspectionErrors]); },
    get overflow() { return overflow; },
    get hasOwnership() { return overflow || observers.size > 0; },
    released: () => !overflow && [...observers.values()].every(record => record.observe()),
    releasedExcept: method => !overflow && [...observers].every(([error, record]) =>
      error === primary ? record.observeExcept(method) : record.observe()),
    get owners() { return Object.freeze([...owners]); },
    get hasMessage() { return typeof fields.get('message') === 'string' && fields.get('message').length > 0; },
    get message() { return typeof fields.get('message') === 'string' ? fields.get('message') : 'Scene resource retirement remains pending.'; }
  });
  details.set(captured, { fields, descriptors });
  if (objectLike(primary)) snapshots.set(primary, captured);
  refresh();
  if (!objectLike(primary)) return captured;
  for (const key of core) {
    try { fields.set(key, Reflect.get(primary, key)); } catch (error) { remember(error); }
  }
  try {
    const multiple = fields.get('sceneResourceOwners'), single = fields.get('sceneResourceOwner');
    owners = Array.isArray(multiple) ? Array.prototype.slice.call(multiple) : objectLike(single) ? [single] : [];
  } catch (error) { remember(error); }
  let keys;
  try { keys = Reflect.ownKeys(primary); } catch (error) { remember(error); return captured; }
  for (const key of keys) {
    if (skipped.has(key)) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(primary, key);
      if (descriptor) descriptors.set(key, descriptor);
    } catch (error) { remember(error); }
  }
  return captured;
};

export const observeSceneFailureOwnership = error => {
  const captured = captureSceneFailure(error);
  return captured.hasOwnership ? captured.released : null;
};

export const projectSceneFailure = (failure, captured, reserved = new Set()) => {
  const { fields, descriptors } = details.get(captured);
  for (const [key, descriptor] of descriptors) if (!reserved.has(key)) Object.defineProperty(failure, key, descriptor);
  for (const [key, value] of fields) {
    if (key !== 'message' && !reserved.has(key) && value !== undefined) {
      Object.defineProperty(failure, key, { value, configurable: true, writable: true });
    }
  }
};
