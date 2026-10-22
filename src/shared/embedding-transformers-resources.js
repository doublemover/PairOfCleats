import { observeEmbeddingOwnership } from './embedding-cache-lifetime.js';

const pendingResources = new Set();
export const trackPendingTransformersOwner = owner => {
  if (owner.pending) pendingResources.add(owner); else pendingResources.delete(owner);
};
const objectLike = value => value && (typeof value === 'object' || typeof value === 'function');
const describe = error => { try { return error?.message || 'Transformers resource cleanup remains pending.'; } catch { return 'Transformers resource cleanup remains pending.'; } };

export const transformersCleanupFailure = (owner, errors, { primaryError, hasPrimary = false } = {}) => {
  const causes = hasPrimary ? [primaryError, ...errors] : [...errors], first = hasPrimary ? primaryError : causes[0];
  const failure = new AggregateError(causes, describe(first), { cause: first });
  if (objectLike(first)) {
    const descriptors = Object.getOwnPropertyDescriptors(first);
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'cleanupErrors', 'transformersResourceOwner',
      'cacheOwnershipPending', 'cacheOwnershipReleased']);
    for (const key of Reflect.ownKeys(descriptors)) if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    if (!Object.hasOwn(failure, 'name')) { try { if (typeof first.name === 'string') failure.name = first.name; } catch {} }
  }
  if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_TRANSFORMERS_RESOURCE_PENDING';
  const observers = causes.map(observeEmbeddingOwnership).filter(Boolean);
  const released = () => !owner.pending && observers.every(observe => observe());
  Object.defineProperties(failure, { cleanupErrors: { value: Object.freeze([...errors]) }, transformersResourceOwner: { value: owner },
    cacheOwnershipPending: { get: () => !released() }, cacheOwnershipReleased: { value: released } });
  return failure;
};

/** Optional disposal matches upstream JS tokenizer/tensor fixtures. Observed
 * methods and getters belong to this exact resource and are captured once. */
export const captureTransformersResource = (resource, role = 'transformers resource') => {
  let method = null, captureError, captureFailed = false, closed = false, disposed = false, flight = null, lastError = null;
  const blockers = new Map();
  try {
    const dispose = resource?.dispose;
    if (dispose != null && typeof dispose !== 'function') throw new TypeError('Transformers resource dispose must be a function when present.');
    method = typeof dispose === 'function' ? dispose : null;
  }
  catch (error) { captureFailed = true; captureError = error; }
  const record = error => {
    const observe = observeEmbeddingOwnership(error);
    if (observe && !blockers.has(error)) blockers.set(error, observe);
  };
  const close = ({ retry = false } = {}) => {
    if (closed) return Promise.resolve(true);
    if (flight) return flight;
    if (lastError && !retry) return Promise.reject(lastError);
    flight = Promise.resolve().then(async () => {
      if (captureFailed) throw captureError;
      if (!disposed) {
        const confirmed = method ? await method.call(resource) : undefined;
        if (confirmed === false) throw Object.assign(new Error('Transformers resource disposal was explicitly unconfirmed.'),
          { code: 'ERR_TRANSFORMERS_RESOURCE_UNCONFIRMED' });
        disposed = true;
      }
      for (const [error, observe] of blockers) if (!observe()) throw error;
      closed = true; pendingResources.delete(owner); return true;
    }).catch(error => {
      record(error); pendingResources.add(owner);
      lastError = error === lastError ? error : transformersCleanupFailure(owner, [error]);
      throw lastError;
    }).finally(() => { flight = null; });
    flight.catch(() => {}); return flight;
  };
  const owner = Object.freeze({ role, resource, get pending() { return !closed; }, get lastError() { return lastError; },
    retire: () => close(), release: () => close({ retry: true }) });
  return owner;
};

/** One existing acquisition or operation scope, never a model/cache factory. */
export const createTransformersResourceScope = (kind = 'transformers resources', { drainFailuresBeforeResources = false } = {}) => {
  const resources = new Map(), blockers = new Map();
  let flight = null, lastError = null, closed = false;
  const retainFailure = error => {
    const observe = observeEmbeddingOwnership(error);
    if (observe && !blockers.has(error)) blockers.set(error, observe);
  };
  const close = ({ retry = false } = {}) => {
    if (closed) return Promise.resolve(true);
    if (flight) return flight;
    if (lastError && !retry) return Promise.reject(lastError);
    flight = Promise.resolve().then(async () => {
      const errors = [];
      if (drainFailuresBeforeResources) {
        for (const [error, observe] of blockers) if (!observe()) errors.push(error);
        if (errors.length) throw transformersCleanupFailure(scope, errors);
      }
      for (const owner of [...resources.values()].reverse()) {
        try { if (retry) await owner.release(); else await owner.retire(); } catch (error) { errors.push(error); }
      }
      for (const [error, observe] of blockers) if (!observe()) errors.push(error);
      if (errors.length) throw transformersCleanupFailure(scope, errors);
      closed = true; pendingResources.delete(scope); return true;
    }).catch(error => { lastError = error; pendingResources.add(scope); throw error; }).finally(() => { flight = null; });
    flight.catch(() => {}); return flight;
  };
  const scope = Object.freeze({ kind, get pending() { return !closed; }, get lastError() { return lastError; },
    get resources() { return Object.freeze([...resources.values()]); }, owns: resource => resources.has(resource), retainFailure,
    adopt: (resource, role) => {
      if (closed || lastError || flight) throw new Error('Transformers resource scope no longer admits resources.');
      if (!resources.has(resource)) resources.set(resource, captureTransformersResource(resource, role));
      return resource;
    }, close, release: () => close({ retry: true }) });
  return scope;
};

export const getPendingTransformersResourceOwners = () => Object.freeze([...pendingResources]);
