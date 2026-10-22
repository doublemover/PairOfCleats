const describe = error => {
  try { return typeof error?.message === 'string' ? error.message : 'ONNX cache resource cleanup remains pending.'; }
  catch { return 'ONNX cache resource cleanup remains pending.'; }
};

const observePending = error => {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const observer = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observer !== 'function') return null;
    return () => { try { return typeof observer === 'function' && observer.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

const retainedFailure = (error, owner) => {
  const observe = observePending(error);
  const failure = new AggregateError([error], describe(error), { cause: error });
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'cacheOwnershipPending', 'cacheOwnershipReleased', 'onnxCacheOwner', 'retirementError']);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    }
    if (!Object.hasOwn(failure, 'name')) {
      try { if (typeof error.name === 'string') failure.name = error.name; } catch {}
    }
  }
  if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_ONNX_CACHE_RESOURCE_PENDING';
  const released = () => !owner.pending && (!observe || observe());
  Object.defineProperties(failure, { retirementError: { value: error }, onnxCacheOwner: { value: owner },
    cacheOwnershipPending: { get: () => !released() }, cacheOwnershipReleased: { value: released } });
  return failure;
};

/** Retirement belongs to the existing cache. Only explicit reconciliation may
 * retry a previously observed failure; no native acquisition occurs here. */
export const createOnnxCacheLifetime = cache => {
  const retired = new Set();
  const receipt = entry => Object.freeze({ settled: entry.closed === true, pending: entry.closed !== true,
    references: entry.references });
  const confirmClosed = entry => {
    if (entry.references || entry.queueDrained !== true || entry.startupState === 'pending'
      || entry.resourceOwner?.settled !== true) return false;
    entry.closed = true; retired.delete(entry);
    return true;
  };
  const releaseResources = (entry, { retry = false } = {}) => {
    if (confirmClosed(entry)) return Promise.resolve(receipt(entry));
    if (entry.references) return Promise.resolve(receipt(entry));
    if (entry.releasing) return entry.releasing;
    const observedFailure = entry.releaseError;
    if (observedFailure && !retry && entry.resourceOwner?.settled !== true) return Promise.reject(observedFailure);
    entry.releasing = Promise.resolve().then(async () => {
      await entry.queue.onIdle();
      entry.queueDrained = true;
      // Initialization may itself create a pending cleanup owner. Await its
      // actual outcome, then retain that same owner rather than synthesizing an
      // empty success from the rejected startup promise.
      try { await entry.promise; } catch {}
      if (confirmClosed(entry)) return receipt(entry);
      if (entry.releaseError && (!retry || entry.releaseError !== observedFailure)) throw entry.releaseError;
      if (!entry.resourceOwner) {
        const missing = new Error('ONNX startup has no observed native resource owner.');
        missing.code = 'ERR_ONNX_RESOURCE_UNOBSERVED';
        Object.defineProperty(missing, 'startupError', { value: entry.startupError });
        throw missing;
      }
      const confirmed = await entry.resourceOwner.release();
      if (confirmed !== true || !confirmClosed(entry)) throw Object.assign(new Error('ONNX resource release was not confirmed.'),
        { code: 'ERR_ONNX_RESOURCE_UNCONFIRMED' });
      return receipt(entry);
    }).catch(error => {
      entry.releaseError = error === entry.releaseError ? error : retainedFailure(error, entry.cacheOwner);
      throw entry.releaseError;
    }).finally(() => { entry.releasing = null; });
    // Fire-and-forget cache/finalizer retirement observes the rejection, while
    // the strong retired set and exact error remain available to the caller.
    entry.releasing.catch(() => {});
    return entry.releasing;
  };
  const retire = (key, entry, options) => {
    if (cache.get(key) === entry) cache.delete(key);
    entry.retired = true; retired.add(entry);
    const work = releaseResources(entry, options);
    work.catch(() => {});
    return work;
  };
  const adopt = entry => {
    entry.startupState = 'pending'; entry.resourceOwner = null; entry.startupError = null;
    entry.closed = false; entry.queueDrained = false; entry.releaseError = null; entry.releasing = null;
    entry.cacheOwner = Object.freeze({ kind: 'onnx-session-cache-entry',
      get pending() { return !entry.closed; }, get startup() { return entry.startupState; },
      get references() { return entry.references; }, get lastError() { return entry.releaseError; },
      get resourceOwner() { return entry.resourceOwner; }, release: () => retire(entry.key, entry, { retry: true }) });
    return entry;
  };
  const observeResourceOwner = (entry, owner) => {
    if (entry.resourceOwner && entry.resourceOwner !== owner) throw new Error('ONNX cache resource owner cannot be replaced.');
    entry.resourceOwner = owner;
    owner.onSettled?.(() => {
      if (!entry.retired || confirmClosed(entry) || entry.references) return;
      // Resource settlement is not queue/accepted-work settlement. This path
      // only acknowledges an already released owner after its original queue
      // drains; it never retries native disposal in the background.
      releaseResources(entry).catch(() => {});
    });
  };
  const startupFailed = (entry, error) => {
    entry.startupState = 'rejected';
    if (observePending(error)) {
      entry.releaseError = retainedFailure(error, entry.cacheOwner);
      entry.startupError = entry.releaseError;
    } else entry.startupError = error;
    retire(entry.key, entry);
    return entry.startupError;
  };
  const createReference = (entry, operations) => ({ entry, operations, released: false, releasing: null });
  const retireReleasedReference = (reference, options) => reference.entry.references && !reference.entry.retired
    ? Promise.resolve(receipt(reference.entry)) : retire(reference.entry.key, reference.entry, options);
  const releaseReference = (reference, { retry = false } = {}) => {
    if (reference.releasing) return reference.releasing;
    if (reference.released) return retireReleasedReference(reference, { retry });
    reference.releasing = Promise.allSettled([...reference.operations]).then(() => {
      reference.released = true;
      reference.entry.references--;
      return retireReleasedReference(reference, { retry });
    }).finally(() => { reference.releasing = null; });
    reference.releasing.catch(() => {});
    return reference.releasing;
  };
  return Object.freeze({ adopt, retire, createReference, releaseReference, observeResourceOwner, startupFailed,
    startupLoaded: entry => { entry.startupState = 'fulfilled'; },
    retiredOwners: () => Object.freeze([...retired].map(entry => entry.cacheOwner)) });
};
