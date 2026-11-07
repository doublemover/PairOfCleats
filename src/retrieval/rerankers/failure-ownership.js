import { captureRerankerFailure, projectRerankerFailure } from './failure-inspection.js';

/** Decorate a new error without mutating frozen original causes or discarding
 * their nonenumerable resource reconciliation capabilities. */
export const preserveRerankerFailure = (primary, properties = {}) => {
  const captured = captureRerankerFailure(primary);
  const failure = new Error(captured.message, { cause: primary });
  const suppliedObserver = properties.cacheOwnershipReleased?.value;
  const suppliedOwnership = Object.hasOwn(properties, 'cacheOwnershipPending') || Object.hasOwn(properties, 'cacheOwnershipReleased');
  const released = () => {
    if (!captured.released()) return false;
    try { return !suppliedOwnership || typeof suppliedObserver === 'function' && Reflect.apply(suppliedObserver, failure, []) === true; }
    catch { return false; }
  };
  const ownership = captured.hasOwnership || suppliedOwnership ? {
    cacheOwnershipPending: { get: () => !released() }, cacheOwnershipReleased: { value: released }
  } : {};
  const reserved = new Set(['cause', 'errors', 'message', 'stack', 'rerankerInspectionErrors',
    ...Reflect.ownKeys(properties), ...Reflect.ownKeys(ownership)]);
  projectRerankerFailure(failure, captured, reserved);
  Object.defineProperties(failure, { ...properties, ...ownership,
    rerankerInspectionErrors: { value: captured.inspectionErrors } });
  return failure;
};

/** Work completion and resource release are separate observations. A late
 * rejection keeps its exact cause and original pending observer after timeout. */
export const trackRerankerWork = work => {
  let settled = false, observeReleased = null;
  const released = () => settled && (!observeReleased || observeReleased());
  const receipt = (hasError, error) => {
    const value = { settled: true, get pending() { return !released(); } };
    if (hasError) {
      const captured = captureRerankerFailure(error);
      value.error = Object.freeze({ code: typeof captured.code === 'string' ? captured.code : null, message: captured.message });
      Object.defineProperties(value, { primaryError: { value: error },
        rerankerInspectionErrors: { value: captured.inspectionErrors } });
    }
    Object.defineProperty(value, 'cacheOwnershipReleased', { value: released });
    return Object.freeze(value);
  };
  const promise = work.then(() => { settled = true; return receipt(false); }, error => {
    const captured = captureRerankerFailure(error);
    observeReleased = captured.hasOwnership ? captured.released : null; settled = true;
    return receipt(true, error);
  });
  return Object.freeze({ promise, released, get settled() { return settled; }, get pending() { return !released(); } });
};

export const pendingRerankerWorkFailure = (error, adapter, tracked) => preserveRerankerFailure(error, {
  cacheOwnershipPending: { get: () => tracked.pending },
  cacheOwnershipReleased: { value: tracked.released },
  rerankerOwner: { value: adapter },
  rerankerSettlement: { value: tracked.promise }
});
