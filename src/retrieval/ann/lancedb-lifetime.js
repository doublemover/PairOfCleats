/** Own only the exact native object and close method observed at acquisition. */
export const createLanceDbResourceOwner = (resource, kind) => {
  let owned = resource, method = null, captureError = null, captureFailed = false;
  let closed = false, flight = null, lastError = null;
  try {
    method = resource.close;
    if (typeof method !== 'function') method = resource.closeSync;
    if (typeof method !== 'function') throw new TypeError(`LanceDB ${kind} has no close method.`);
  } catch (error) { captureError = error; captureFailed = true; }
  resource = null;
  const settled = Object.freeze({ settled: true, pending: false });
  const close = () => {
    if (closed) return Promise.resolve(settled);
    if (flight) return flight;
    flight = Promise.resolve().then(() => {
      if (captureFailed) throw captureError;
      return Reflect.apply(method, owned, []);
    }).then(() => {
      closed = true; owned = null; method = null;
      return settled;
    }, error => { lastError = error; throw error; }).finally(() => { flight = null; });
    return flight;
  };
  return Object.freeze({ kind, get pending() { return !closed; }, get closed() { return closed; },
    get lastError() { return lastError; }, close });
};

const pendingObserver = error => {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

/** Preserve frozen primary errors, nonenumerable reconciliation capabilities,
 * and nested pending ownership without changing the original error objects. */
export const lanceDbCloseFailure = ({ owner, cleanupErrors, hasPrimary = false, primaryError }) => {
  const errors = hasPrimary ? [primaryError, ...cleanupErrors] : [...cleanupErrors];
  const failure = new AggregateError(errors, 'LanceDB native cleanup remains pending.',
    { cause: hasPrimary ? primaryError : cleanupErrors[0] });
  const observers = errors.map(pendingObserver).filter(Boolean);
  const released = () => !owner.pending && observers.every(observe => observe());
  if (hasPrimary && primaryError && typeof primaryError === 'object') {
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'primaryError', 'cleanupErrors',
      'lanceDbOwner', 'cacheOwnershipPending', 'cacheOwnershipReleased']);
    const descriptors = Object.getOwnPropertyDescriptors(primaryError);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    }
    if (!Object.hasOwn(failure, 'name')) {
      try { if (typeof primaryError.name === 'string') failure.name = primaryError.name; } catch {}
    }
  }
  if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_LANCEDB_CLOSE';
  Object.defineProperties(failure, {
    primaryError: { value: hasPrimary ? primaryError : null },
    cleanupErrors: { value: Object.freeze([...cleanupErrors]) },
    lanceDbOwner: { value: owner },
    cacheOwnershipPending: { get: () => !released() },
    cacheOwnershipReleased: { value: released }
  });
  return failure;
};

export const withLanceDbCleanupFailure = (primaryError, cleanupError) => lanceDbCloseFailure({
  owner: cleanupError.lanceDbOwner, cleanupErrors: [cleanupError], hasPrimary: true, primaryError
});
