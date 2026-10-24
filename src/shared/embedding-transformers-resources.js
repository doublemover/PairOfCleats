import { getEmbeddingCacheLeaseOwner, getEmbeddingFailureProvenance } from './embedding-cache-lifetime.js';
import { captureEmbeddingFailureDiagnostics, projectEmbeddingFailureDiagnostics } from './embedding-failure-diagnostics.js';

const pendingResources = new Set();
const failureProvenance = new WeakMap();
const resourceProducers = new WeakMap();
/** Bind only an actual constructor's resource to its existing reconciliation
 * owner. Copied error fields and causal members never establish this relation. */
export const bindTransformersResourceProducer = (resource, owner) => {
  if (!objectLike(resource) || !objectLike(owner) || resourceProducers.has(resource)) throw new Error('Transformers resource already has a producer or is invalid.');
  resourceProducers.set(resource, owner);
};
export const getTransformersFailureProvenance = error => objectLike(error) ? failureProvenance.get(error) || null : null;
export const trackPendingTransformersOwner = owner => {
  if (owner.pending) pendingResources.add(owner); else pendingResources.delete(owner);
};
const objectLike = value => value && (typeof value === 'object' || typeof value === 'function');
export const transformersCleanupFailure = (owner, errors, { primaryError, hasPrimary = false } = {}) => {
  const causes = hasPrimary ? [primaryError, ...errors] : [...errors], first = hasPrimary ? primaryError : causes[0];
  const captured = causes.map(captureEmbeddingFailureDiagnostics), primary = captured[0] || captureEmbeddingFailureDiagnostics(first);
  const failure = new AggregateError([...causes, ...captured.flatMap(value => value.inspectionErrors)], primary.message, { cause: first });
  projectEmbeddingFailureDiagnostics(failure, primary, ['cleanupErrors', 'transformersResourceOwner', 'cacheOwnershipPending', 'cacheOwnershipReleased']);
  if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_TRANSFORMERS_RESOURCE_PENDING';
  const released = () => !owner.pending && captured.every(value => value.released());
  Object.defineProperties(failure, { cleanupErrors: { value: Object.freeze([...errors]) }, transformersResourceOwner: { value: owner },
    cacheOwnershipPending: { get: () => !released() }, cacheOwnershipReleased: { value: released } });
  failureProvenance.set(failure, Object.freeze({ owner,
    get children() { return Object.freeze([...new Set([...causes, ...captured.flatMap(value => value.inspectionErrors)])]); } }));
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
    const captured = captureEmbeddingFailureDiagnostics(error);
    const producer = resourceProducers.get(resource), cacheOwner = getEmbeddingCacheLeaseOwner(resource);
    const reconciles = Boolean(producer && getTransformersFailureProvenance(error)?.owner === producer
      || cacheOwner && getEmbeddingFailureProvenance(error)?.owner === cacheOwner);
    if (captured.hasOwnership && !blockers.has(error)) blockers.set(error, { observe: captured.released,
      inspectionsReleased: captured.inspectionsReleased, reconciles });
  };
  const close = ({ retry = false } = {}) => {
    if (closed) return Promise.resolve(true);
    if (flight) return flight;
    if (lastError && !retry) return Promise.reject(lastError);
    flight = Promise.resolve().then(async () => {
      if (captureFailed) throw captureError;
      for (const [error, entry] of blockers) if (!entry.inspectionsReleased() || !entry.reconciles && !entry.observe()) throw error;
      if (!disposed) {
        const confirmed = method ? await method.call(resource) : undefined;
        if (confirmed === false) throw Object.assign(new Error('Transformers resource disposal was explicitly unconfirmed.'),
          { code: 'ERR_TRANSFORMERS_RESOURCE_UNCONFIRMED' });
        disposed = true;
      }
      for (const [error, entry] of blockers) if (!entry.observe()) throw error;
      closed = true; pendingResources.delete(owner); return true;
    }).catch(error => {
      record(error); pendingResources.add(owner);
      lastError = lastError !== null && error === lastError ? error : transformersCleanupFailure(owner, [error]);
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
    const captured = captureEmbeddingFailureDiagnostics(error);
    if (captured.hasOwnership && !blockers.has(error)) blockers.set(error, captured.released);
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
