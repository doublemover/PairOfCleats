/** Decorate a new error without mutating frozen original causes or discarding
 * their nonenumerable resource reconciliation capabilities. */
export const preserveRerankerFailure = (primary, properties = {}) => {
  let message = 'Reranker operation failed';
  try { message = String(primary?.message || primary); } catch {}
  const failure = new Error(message, { cause: primary });
  const reserved = new Set(['cause', 'message', 'stack', ...Reflect.ownKeys(properties)]);
  if (primary && (typeof primary === 'object' || typeof primary === 'function')) {
    const descriptors = Object.getOwnPropertyDescriptors(primary);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    }
    if (!Object.hasOwn(failure, 'name')) {
      try { if (typeof primary.name === 'string') failure.name = primary.name; } catch {}
    }
  }
  Object.defineProperties(failure, properties);
  return failure;
};

const releaseObserver = error => {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

/** Work completion and resource release are separate observations. A late
 * rejection keeps its exact cause and original pending observer after timeout. */
export const trackRerankerWork = work => {
  let settled = false, observeReleased = null;
  const released = () => settled && (!observeReleased || observeReleased());
  const receipt = (hasError, error) => {
    const value = { settled: true, get pending() { return !released(); } };
    if (hasError) {
      let message = 'Reranker operation failed', code = null;
      try { message = String(error?.message || error); code = error?.code || null; } catch {}
      value.error = Object.freeze({ code, message });
      Object.defineProperty(value, 'primaryError', { value: error });
    }
    Object.defineProperty(value, 'cacheOwnershipReleased', { value: released });
    return Object.freeze(value);
  };
  const promise = work.then(() => { settled = true; return receipt(false); }, error => {
    observeReleased = releaseObserver(error); settled = true;
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
