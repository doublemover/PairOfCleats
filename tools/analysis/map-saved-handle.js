/** Attempt-scoped descriptor lifetime. Reconciliation calls only the original
 * handle's captured close method; it never reopens a path or closes a raw fd. */
export const createSavedMapHandleOwner = handle => {
  let owned = handle, originalClose = null, captureError = null, captureFailed = false, closed = false, flight = null, lastError = null;
  try { originalClose = handle.close; } catch(error) { captureError = error; captureFailed = true; }
  handle = null;
  const settled = Object.freeze({ settled: true, pending: false });
  const close = () => {
    if (closed) return Promise.resolve(settled);
    if (flight) return flight;
    const current = owned, method = originalClose;
    flight = Promise.resolve().then(() => { if(captureFailed)throw captureError;return Reflect.apply(method, current, []); }).then(() => {
      closed = true; owned = null; originalClose = null;
      return settled;
    }, error => { lastError = error; throw error; }).finally(() => { flight = null; });
    return flight;
  };
  return Object.freeze({ kind: 'saved-map-file-handle', get pending() { return !closed; },
    get closed() { return closed; }, get lastError() { return lastError; }, close });
};

const describeFailure = error => {
  if (typeof error === 'string') return error.slice(0, 512);
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    if (descriptor && typeof descriptor.value === 'string') return descriptor.value.slice(0, 512);
  } catch {}
  return 'Unreported resource failure';
};

const pendingObserver = error => {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

export const savedMapHandleCloseFailure = ({ owner, closeError, hasPrimary = false, primaryError }) => {
  const errors = hasPrimary ? [primaryError, closeError] : [closeError];
  const failure = new AggregateError(errors, hasPrimary
    ? `Saved map admission failed: ${describeFailure(primaryError)}; descriptor close failed: ${describeFailure(closeError)}`
    : `Saved map descriptor close failed: ${describeFailure(closeError)}`,
  { cause: hasPrimary ? primaryError : closeError });
  const observers = errors.map(pendingObserver).filter(Boolean);
  const released = () => owner.closed && observers.every(observe => observe());
  // Preserve exact original causes, including frozen errors and cancellation
  // reasons, without attaching properties to or replacing those originals.
  if (hasPrimary && primaryError && typeof primaryError === 'object') {
    const descriptors = Object.getOwnPropertyDescriptors(primaryError);
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'primaryError', 'cleanupErrors',
      'mapSavedHandle', 'cacheOwnershipPending', 'cacheOwnershipReleased']);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    }
    if (!Object.hasOwn(failure, 'name')) {
      try { if (typeof primaryError.name === 'string') failure.name = primaryError.name; } catch {}
    }
  }
  if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_MAP_SAVED_HANDLE_CLOSE';
  Object.defineProperties(failure, {
    primaryError: { value: hasPrimary ? primaryError : null },
    cleanupErrors: { value: Object.freeze([closeError]) },
    mapSavedHandle: { value: owner },
    cacheOwnershipPending: { get: () => !released() },
    cacheOwnershipReleased: { value: released }
  });
  return failure;
};
