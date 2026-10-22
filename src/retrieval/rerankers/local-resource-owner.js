const pendingObserver = error => {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

export const captureCrossEncoderResource = (resource, methodName, { optional = false } = {}) => {
  let owned = resource, method = null, captureError = null, captureFailed = false, closed = false, flight = null;
  try {
    method = resource[methodName];
    if (typeof method !== 'function') {
      if (!optional || method != null) throw new TypeError(`Local cross-encoder resource has no ${methodName} method.`);
      closed = true; owned = null;
    }
  } catch (error) { captureFailed = true; captureError = error; }
  resource = null;
  const close = () => {
    if (closed) return Promise.resolve(Object.freeze({ settled: true, pending: false }));
    if (flight) return flight;
    flight = Promise.resolve().then(() => {
      if (captureFailed) throw captureError;
      return Reflect.apply(method, owned, []);
    }).then(() => { closed = true; owned = null; method = null; return Object.freeze({ settled: true, pending: false }); })
      .finally(() => { flight = null; });
    return flight;
  };
  return Object.freeze({ get pending() { return !closed; }, close });
};

export const crossEncoderCleanupFailure = ({ owner, cleanupErrors = [], hasPrimary = false, primaryError, properties = {} }) => {
  const errors = hasPrimary ? [primaryError, ...cleanupErrors] : [...cleanupErrors];
  const failure = new AggregateError(errors, 'Local cross-encoder cleanup remains pending.',
    { cause: hasPrimary ? primaryError : cleanupErrors[0] });
  const observers = errors.map(pendingObserver).filter(Boolean);
  const released = () => !owner.pending && observers.every(observe => observe());
  if (hasPrimary && primaryError && (typeof primaryError === 'object' || typeof primaryError === 'function')) {
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'primaryError', 'cleanupErrors',
      'rerankerOwner', 'cacheOwnershipPending', 'cacheOwnershipReleased', ...Reflect.ownKeys(properties)]);
    const descriptors = Object.getOwnPropertyDescriptors(primaryError);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    }
    if (!Object.hasOwn(failure, 'name')) {
      try { if (typeof primaryError.name === 'string') failure.name = primaryError.name; } catch {}
    }
  }
  if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_LOCAL_RERANKER_CLEANUP';
  Object.defineProperties(failure, {
    primaryError: { value: hasPrimary ? primaryError : null },
    cleanupErrors: { value: Object.freeze([...cleanupErrors]) },
    rerankerOwner: { value: owner },
    cacheOwnershipPending: { get: () => !released() },
    cacheOwnershipReleased: { value: released },
    ...properties
  });
  return failure;
};

export const createCrossEncoderTensorScope = ({ pendingTensors, pendingTensorOwners = new Map() }) => {
  const resources = new Map();
  const owner = Object.freeze({ kind: 'local-cross-encoder-tensors',
    get pending() { return [...resources.values()].some(resource => resource.pending); },
    add: tensor => {
      if (!resources.has(tensor)) {
        const resource = pendingTensorOwners.get(tensor) || captureCrossEncoderResource(tensor, 'dispose');
        resources.set(tensor, resource); pendingTensorOwners.set(tensor, resource);
      }
      return tensor;
    },
    close: async () => {
      const failures = [];
      for (const [tensor, resource] of [...resources].reverse()) {
        try { await resource.close(); pendingTensors.delete(tensor); pendingTensorOwners.delete(tensor); }
        catch (error) { pendingTensors.add(tensor); failures.push(error); }
      }
      if (failures.length) throw crossEncoderCleanupFailure({ owner, cleanupErrors: failures });
      return Object.freeze({ settled: true, pending: false });
    }
  });
  return owner;
};

/** This adapter owns its existing queue, artifact lease and storage session.
 * No alternate namespace, runtime, acquisition or implicit source authority. */
export const createCrossEncoderSessionOwner = ({ queue, sessionLease }) => {
  const pendingTensors = new Set(), pendingTensorOwners = new Map(), blockers = new Map();
  let artifact = null, session = null, tokenizer = null, nativeSession = null, nativeTokenizer = null;
  let storageClosed = false, stopped = false, flight = null;
  const retainFailure = error => {
    if (!blockers.has(error)) {
      const observer = pendingObserver(error);
      if (observer) blockers.set(error, observer);
    }
  };
  const owner = {
    kind: 'local-cross-encoder-session', resourceId: sessionLease.resourceId,
    queue, sessionLease, get session() { return nativeSession; }, get tokenizer() { return nativeTokenizer; }, pendingTensors, pendingTensorOwners,
    get pending() { return !storageClosed; }, get stopped() { return stopped; },
    retainFailure: error => { stopped = true; retainFailure(error); },
    adoptArtifact: value => {
      if (stopped || artifact) throw new Error('Local cross-encoder artifact owner is already selected or closed.');
      artifact = captureCrossEncoderResource(value, 'release');
    },
    adoptSession: value => {
      if (stopped || session) throw new Error('Local cross-encoder session owner is already selected or closed.');
      nativeSession = value; session = captureCrossEncoderResource(value, 'release');
    },
    // The pinned Transformers JS tokenizer does not require dispose when absent;
    // an observed method/getter is captured, awaited and retained on failure.
    adoptTokenizer: value => {
      if (stopped || tokenizer) throw new Error('Local cross-encoder tokenizer owner is already selected or closed.');
      nativeTokenizer = value; tokenizer = captureCrossEncoderResource(value, 'dispose', { optional: true });
    },
    close: () => {
      stopped = true;
      if (flight) return flight;
      flight = (async () => {
        await queue.close();
        const failures = [];
        for (const [tensor, resource] of pendingTensorOwners) {
          try { await resource.close(); pendingTensorOwners.delete(tensor); pendingTensors.delete(tensor); }
          catch (error) { failures.push(error); retainFailure(error); }
        }
        if (pendingTensors.size && !failures.length) failures.push(new Error('A local cross-encoder tensor has no confirmed captured disposal.'));
        // Failed tensor disposal keeps its original inference session alive.
        if (!pendingTensors.size && !pendingTensorOwners.size) {
          for (const resource of [session, tokenizer]) {
            if (!resource) continue;
            try { await resource.close(); } catch (error) { failures.push(error); retainFailure(error); }
          }
        }
        if (failures.length) throw crossEncoderCleanupFailure({ owner, cleanupErrors: failures,
          properties: { storageSession: { value: sessionLease } } });
        const unresolved = [...blockers].filter(([, observe]) => !observe()).map(([error]) => error);
        if (unresolved.length) throw crossEncoderCleanupFailure({ owner, cleanupErrors: unresolved,
          properties: { storageSession: { value: sessionLease } } });
        await artifact?.close();
        if (!storageClosed) {
          const confirmed = await sessionLease.releaseAfterSettlement({ resourceId: sessionLease.resourceId, settled: true, pending: false });
          if (confirmed !== true) throw Object.assign(new Error('Local cross-encoder storage release was not confirmed.'),
            { code: 'ERR_LOCAL_RERANKER_STORAGE_UNCONFIRMED' });
          storageClosed = true;
        }
        return Object.freeze({ resourceId: sessionLease.resourceId, settled: true, pending: false });
      })().catch(error => {
        flight = null;
        if (error?.rerankerOwner === owner) throw error;
        // The exact storage-session release is itself retried below; retaining
        // its observer as a prerequisite would prevent that same retry.
        if (error?.storageSession !== sessionLease) retainFailure(error);
        throw crossEncoderCleanupFailure({ owner, cleanupErrors: [error], properties: { storageSession: { value: sessionLease } } });
      });
      return flight;
    }
  };
  return Object.freeze(owner);
};
