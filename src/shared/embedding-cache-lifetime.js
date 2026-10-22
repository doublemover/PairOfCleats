const objectLike = value => value && (typeof value === 'object' || typeof value === 'function');

/** Capture the original observer and receiver. A marker without an observer is
 * unknown ownership, never evidence that a native child has settled. */
export const observeEmbeddingOwnership = error => {
  if (!objectLike(error)) return null;
  try {
    const observer = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observer !== 'function') return null;
    return () => { try { return typeof observer === 'function' && observer.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

const copyFailure = (primary, errors) => {
  let message = 'Embedding resource cleanup remains pending.';
  try { if (typeof primary?.message === 'string') message = primary.message; } catch {}
  const failure = new AggregateError(errors, message, { cause: primary });
  if (objectLike(primary)) {
    const descriptors = Object.getOwnPropertyDescriptors(primary);
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'cleanupErrors', 'embeddingCacheOwner',
      'cacheOwnershipPending', 'cacheOwnershipReleased']);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    }
    if (!Object.hasOwn(failure, 'name')) {
      try { if (typeof primary.name === 'string') failure.name = primary.name; } catch {}
    }
  }
  return failure;
};

/** Preserve immutable primary and cleanup errors, including both original
 * pending observers. This does not adopt or attempt any native resource. */
export const preserveEmbeddingCleanupFailure = (primary, cleanup) => {
  const failure = copyFailure(primary, [primary, cleanup]);
  const observers = [primary, cleanup].map(observeEmbeddingOwnership).filter(Boolean);
  const released = () => observers.every(observe => observe());
  Object.defineProperties(failure, { cleanupErrors: { value: Object.freeze([cleanup]) },
    cacheOwnershipPending: { get: () => !released() }, cacheOwnershipReleased: { value: released } });
  return failure;
};

/** Shared outer cache bookkeeping. A fulfilled captured dispose method is the
 * existing adapter/pipeline contract; unresolved child observers still retain
 * the entry. Only explicit reconciliation retries a previously failed close. */
export const createEmbeddingCacheLifetime = ({ cache, kind }) => {
  const retired = new Set();
  const receipt = entry => Object.freeze({ settled: entry.closed, pending: !entry.closed, references: entry.references });
  const recordFailure = (entry, error) => {
    const observe = observeEmbeddingOwnership(error);
    if (observe && !entry.pendingFailures.has(error)) entry.pendingFailures.set(error, observe);
  };
  const pendingFailure = entry => {
    for (const [error, observe] of entry.pendingFailures) if (!observe()) return error;
    return null;
  };
  const detach = entry => {
    if (cache.get(entry.key) === entry) cache.delete(entry.key);
    entry.cacheOwned = false; clearTimeout(entry.retentionTimer);
    entry.retired = true;
    if (!entry.closed) retired.add(entry);
  };
  const waitForReferences = entry => {
    if (!entry.waiting) {
      entry.waiting = new Promise((resolve, reject) => { entry.resolveWaiting = resolve; entry.rejectWaiting = reject; });
      entry.waiting.catch(() => {});
    }
    return entry.waiting;
  };
  const settleWaiting = (entry, error, value) => {
    if (!entry.waiting) return;
    if (error) entry.rejectWaiting(error); else entry.resolveWaiting(value);
    entry.waiting = null; entry.resolveWaiting = null; entry.rejectWaiting = null;
  };
  const retainFailure = (entry, error) => {
    if (error === entry.releaseError) return error;
    const failure = copyFailure(error, [error]);
    if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_EMBEDDING_CACHE_RESOURCE_PENDING';
    Object.defineProperties(failure, { embeddingCacheOwner: { value: entry.owner },
      cacheOwnershipPending: { get: () => !entry.closed }, cacheOwnershipReleased: { value: () => entry.closed } });
    return failure;
  };
  const retire = (entry, { retry = false } = {}) => {
    detach(entry);
    if (entry.closed) return Promise.resolve(receipt(entry));
    if (entry.references) return waitForReferences(entry);
    if (entry.releasing) return entry.releasing;
    if (entry.releaseError && !retry) return Promise.reject(entry.releaseError);
    entry.releasing = Promise.resolve().then(async () => {
      // A rejected startup cannot be replaced with a fresh pipeline/adapter.
      // Its original pending child observer remains authoritative.
      try { await entry.promise; } catch (error) { recordFailure(entry, error); }
      if (entry.resource && !entry.disposeCompleted) {
        if (entry.disposeCaptureFailed) throw entry.disposeError;
        if (entry.dispose) await entry.dispose.call(entry.resource);
        entry.disposeCompleted = true;
      }
      const pending = pendingFailure(entry);
      if (pending) throw pending;
      entry.closed = true; retired.delete(entry);
      const value = receipt(entry); settleWaiting(entry, null, value);
      return value;
    }).catch(error => {
      recordFailure(entry, error);
      entry.releaseError = retainFailure(entry, error);
      settleWaiting(entry, entry.releaseError);
      throw entry.releaseError;
    }).finally(() => { entry.releasing = null; });
    entry.releasing.catch(() => {});
    return entry.releasing;
  };
  const adopt = entry => {
    Object.assign(entry, { retired: false, closed: false, releasing: null, releaseError: null, waiting: null,
      startup: 'pending', resource: null, dispose: null, disposeError: null, disposeCaptureFailed: false, disposeCompleted: false, pendingFailures: new Map() });
    entry.owner = Object.freeze({ kind, get pending() { return !entry.closed; },
      get references() { return entry.references; }, get startup() { return entry.startup; },
      get resource() { return entry.resource; }, get lastError() { return entry.releaseError; },
      release: () => retire(entry, { retry: true }) });
    return entry;
  };
  const loaded = (entry, resource) => {
    entry.resource = resource; entry.startup = 'fulfilled';
    try { const dispose = resource?.dispose; entry.dispose = typeof dispose === 'function' ? dispose : null; }
    catch (error) { entry.disposeCaptureFailed = true; entry.disposeError = error; throw error; }
    return resource;
  };
  const failed = (entry, error) => {
    entry.startup = 'rejected'; recordFailure(entry, error); detach(entry);
    return error;
  };
  const createReference = (entry, operations) => ({ entry, operations, released: false, releasing: null });
  const releaseReference = (reference, { retry = false } = {}) => {
    const entry = reference.entry;
    if (reference.releasing) return reference.releasing;
    if (reference.released) return (entry.references || entry.cacheOwned) && !entry.retired
      ? Promise.resolve(receipt(entry)) : retire(entry, { retry });
    reference.releasing = Promise.allSettled([...reference.operations]).then(() => {
      reference.released = true; entry.references--;
      if (entry.references || (entry.cacheOwned && !entry.retired)) return receipt(entry);
      return retire(entry, { retry });
    }).finally(() => { reference.releasing = null; });
    reference.releasing.catch(() => {});
    return reference.releasing;
  };
  return Object.freeze({ adopt, loaded, failed, retire, createReference, releaseReference, recordFailure, retainFailure,
    retiredOwners: () => Object.freeze([...retired].map(entry => entry.owner)),
    retireAll: () => {
      const entries = new Set([...cache.values(), ...retired]);
      return [...entries].map(entry => retire(entry));
    } });
};
