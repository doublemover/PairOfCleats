import { observeEmbeddingOwnership as pendingObserver } from '../../shared/embedding-cache-lifetime.js';

const failureOwners=new WeakMap();

export const captureCrossEncoderResource = (resource, methodName, { optional = false } = {}) => {
  let owned = resource, method = null, captureError = null, captureFailed = false, closed = false, disposed = false, flight = null;
  const blockers=new Map();
  const retainFailure=error=>{const observe=pendingObserver(error);if(observe&&!blockers.has(error))blockers.set(error,observe);};
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
    flight = Promise.resolve().then(async () => {
      if (captureFailed) throw captureError;
      for(const [error,observe] of blockers)if(!observe())throw error;
      if(!disposed){
        const result=await Reflect.apply(method, owned, []);
        if(result===false)throw Object.assign(new Error('Local cross-encoder resource close was explicitly unconfirmed.'),
          {code:'ERR_LOCAL_RERANKER_RESOURCE_UNCONFIRMED'});
        disposed=true;
      }
      for(const [error,observe] of blockers)if(!observe())throw error;
      closed = true; owned = null; method = null; return Object.freeze({ settled: true, pending: false });
    }).catch(error=>{retainFailure(error);throw error;})
      .finally(() => { flight = null; });
    return flight;
  };
  return Object.freeze({ get pending() { return !closed; }, retainFailure, close });
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
  failureOwners.set(failure,owner);
  return failure;
};

export const createCrossEncoderTensorScope = ({ pendingTensors, pendingTensorOwners = new Map() }) => {
  const resources = new Map(),blockers=new Map();
  const owner = Object.freeze({ kind: 'local-cross-encoder-tensors',
    get pending() { return [...resources.values()].some(resource => resource.pending)||[...blockers.values()].some(observe=>!observe()); },
    retainFailure:error=>{
      const observe=pendingObserver(error);if(observe&&!blockers.has(error))blockers.set(error,observe);
      for(const resource of resources.values())resource.retainFailure(error);
    },
    add: tensor => {
      if (!resources.has(tensor)) {
        const resource = pendingTensorOwners.get(tensor) || captureCrossEncoderResource(tensor, 'dispose');
        resources.set(tensor, resource); pendingTensorOwners.set(tensor, resource);
        for(const error of blockers.keys())resource.retainFailure(error);
      }
      return tensor;
    },
    close: async () => {
      const failures = [];
      for(const [error,observe] of blockers)if(!observe())failures.push(error);
      if(failures.length){
        for(const tensor of resources.keys())pendingTensors.add(tensor);
        throw crossEncoderCleanupFailure({owner,cleanupErrors:failures});
      }
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
      let storageFailure,hasStorageFailure=false;
      flight = (async () => {
        await queue.close();
        const failures = [];
        for (const [tensor, resource] of pendingTensorOwners) {
          try { await resource.close(); pendingTensorOwners.delete(tensor); pendingTensors.delete(tensor); }
          catch (error) { failures.push(error); retainFailure(error); }
        }
        if (pendingTensors.size && !failures.length) failures.push(new Error('A local cross-encoder tensor has no confirmed captured disposal.'));
        const unresolved = [...blockers].filter(([, observe]) => !observe()).map(([error]) => error);
        if(unresolved.length)throw crossEncoderCleanupFailure({owner,cleanupErrors:[...failures,...unresolved],
          properties:{storageSession:{value:sessionLease}}});
        // Failed tensor disposal keeps its original inference session alive.
        if (!pendingTensors.size && !pendingTensorOwners.size) {
          for (const resource of [session, tokenizer]) {
            if (!resource) continue;
            try { await resource.close(); } catch (error) { failures.push(error); retainFailure(error); }
          }
        }
        if (failures.length) throw crossEncoderCleanupFailure({ owner, cleanupErrors: failures,
          properties: { storageSession: { value: sessionLease } } });
        await artifact?.close();
        if (!storageClosed) {
          let confirmed;
          try{confirmed=await sessionLease.releaseAfterSettlement({ resourceId: sessionLease.resourceId, settled: true, pending: false });}
          catch(error){hasStorageFailure=true;storageFailure=error;throw error;}
          if (confirmed !== true) throw Object.assign(new Error('Local cross-encoder storage release was not confirmed.'),
            { code: 'ERR_LOCAL_RERANKER_STORAGE_UNCONFIRMED' });
          storageClosed = true;
        }
        return Object.freeze({ resourceId: sessionLease.resourceId, settled: true, pending: false });
      })().catch(error => {
        flight = null;
        if (failureOwners.get(error) === owner) throw error;
        // The exact storage-session release is itself retried below; retaining
        // its observer as a prerequisite would prevent that same retry.
        if (!hasStorageFailure||error !== storageFailure) retainFailure(error);
        throw crossEncoderCleanupFailure({ owner, cleanupErrors: [error], properties: { storageSession: { value: sessionLease } } });
      });
      return flight;
    }
  };
  return Object.freeze(owner);
};
