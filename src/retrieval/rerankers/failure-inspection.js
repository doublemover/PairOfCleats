import { observeEmbeddingOwnership } from '../../shared/embedding-cache-lifetime.js';

const snapshots = new WeakMap(), details = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const projected = new Set(['cause', 'errors', 'message', 'name', 'code', 'stack', 'rerankerOwner',
  'onnxSessionOwner', 'cacheOwnershipPending', 'cacheOwnershipReleased', 'rerankerInspectionErrors']);

/** Snapshot diagnostic fields before cleanup can discard their original owner.
 * Never request an Error's lazy stack descriptor or coerce an arbitrary object.
 * A diagnostic inspection failure is independent evidence, not a replacement
 * operation failure and not permission to discard its release observer. */
export const captureRerankerFailure = primary => {
  if (objectLike(primary) && snapshots.has(primary)) {
    const captured = snapshots.get(primary);
    captured.refresh();
    return captured;
  }
  const inspectionErrors = [], observers = new Map(), descriptors = new Map(), fields = new Map();
  const observe = error => {
    if (observers.has(error)) return;
    const observer = observeEmbeddingOwnership(error);
    if (observer) observers.set(error, observer);
  };
  const remember = error => { inspectionErrors.push(error); observe(error); };
  const refresh = () => { observe(primary); for (const error of inspectionErrors) observe(error); };
  const captured = Object.freeze({
    primary,
    get inspectionErrors() { return Object.freeze([...inspectionErrors]); },
    get hasOwnership() { return observers.size > 0; },
    released: () => [...observers.values()].every(observer => observer()), refresh,
    get message() {
      const message = fields.get('message');
      if (typeof message === 'string') return message;
      return objectLike(primary) ? 'Reranker operation failed' : String(primary);
    },
    get code() { return fields.get('code'); },
    get name() { return fields.get('name'); },
    get nativeOwner() { return fields.get('rerankerOwner') || fields.get('onnxSessionOwner') || primary; }
  });
  details.set(captured, { descriptors, fields });
  if (objectLike(primary)) snapshots.set(primary, captured);
  refresh();
  if (!objectLike(primary)) return captured;
  for (const key of ['message', 'name', 'code', 'rerankerOwner', 'onnxSessionOwner']) {
    try { fields.set(key, Reflect.get(primary, key)); } catch (error) { remember(error); }
  }
  let keys;
  try { keys = Reflect.ownKeys(primary); } catch (error) { remember(error); return captured; }
  for (const key of keys) {
    if (projected.has(key)) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(primary, key);
      if (descriptor) descriptors.set(key, descriptor);
    } catch (error) { remember(error); }
  }
  return captured;
};

export const observeRerankerFailureOwnership = error => {
  const captured = captureRerankerFailure(error);
  return captured.hasOwnership ? captured.released : null;
};

/** Copy already captured descriptors; projected accessors become stable values.
 * Wrapper-owned cause/errors/ownership metadata remain the caller's authority. */
export const projectRerankerFailure = (failure, captured, reserved = new Set()) => {
  const { descriptors, fields } = details.get(captured);
  for (const [key, descriptor] of descriptors) {
    if (!reserved.has(key)) Object.defineProperty(failure, key, descriptor);
  }
  for (const key of ['name', 'code', 'rerankerOwner', 'onnxSessionOwner']) {
    if (!reserved.has(key) && fields.has(key)) {
      const value = fields.get(key);
      if (value !== undefined) Object.defineProperty(failure, key, { value, configurable: true, writable: true });
    }
  }
};
