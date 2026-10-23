import { observeEmbeddingOwnership as observePending } from '../embedding-cache-lifetime.js';

const captureResource = (resource, name, required = false) => {
  let method = null, captureError = null, captureFailed = false, released = !resource;
  const blockers = new Map();
  try {
    method = resource?.[name];
    if (resource && typeof method !== 'function') {
      if (required || method != null) throw new TypeError(`ONNX resource has no ${name} method.`);
      released = true;
    }
  } catch (error) { captureError = error; captureFailed = true; }
  return {
    get released() { return released; },
    async release() {
      if (released) return;
      if (captureFailed) throw captureError;
      for (const [error, observe] of blockers) if (!observe()) throw error;
      try {
        const confirmed = await Reflect.apply(method, resource, []);
        if (confirmed === false) throw Object.assign(new Error(`ONNX ${name} was explicitly unconfirmed.`), { code: 'ERR_ONNX_RESOURCE_UNCONFIRMED' });
      }
      catch (error) {
        const observe = observePending(error);
        if (observe && !blockers.has(error)) blockers.set(error, observe);
        throw error;
      }
      released = true;
    }
  };
};

/** Own exact cleanup methods. A retry never repeats a successful child release
 * or obtains a replacement method from a mutated native object. */
export const createOnnxResourceOwner = ({ session, tokenizer, qualificationSlot = null,
  qualificationLease = null, primaryError = null, owner = null, tensorScopes = new Set() }) => {
  const native = captureResource(session, 'release', true);
  // Some supported tokenizers contain only JS state and expose no dispose.
  const tokens = captureResource(tokenizer, 'dispose');
  const capacity = captureResource(qualificationSlot, 'release', true);
  const observers = new Map();
  const operationObservers = new Map();
  const retain = error => {
    if (observers.has(error)) return;
    const observe = observePending(error);
    if (observe) observers.set(error, observe);
  };
  const primaryObserver = observePending(primaryError);
  if (primaryObserver) operationObservers.set(primaryError, primaryObserver);
  let flight = null, settled = false, tensorReleaseStarted = false;
  const settlementObservers = new Set();
  const sessionOwner = owner || Object.freeze({ session, tokenizer, qualificationSlot });
  const failure = failures => {
    const primary = primaryError ?? failures[0];
    const errors = primaryError == null ? [...failures] : [primaryError, ...failures];
    let message = 'ONNX resource cleanup remains pending.';
    try { if (typeof primary?.message === 'string') message = primary.message; } catch {}
    const error = new AggregateError(errors, message, { cause: primary });
    if (primary && (typeof primary === 'object' || typeof primary === 'function')) {
      const reserved = new Set(['cause', 'errors', 'message', 'stack', 'cleanupErrors', 'cleanupFailureCount',
        'cacheOwnershipPending', 'cacheOwnershipReleased', 'qualificationLease', 'onnxSessionOwner', 'onnxResourceOwner']);
      const descriptors = Object.getOwnPropertyDescriptors(primary);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (!reserved.has(key)) Object.defineProperty(error, key, descriptors[key]);
      }
      if (!Object.hasOwn(error, 'name')) {
        try { if (typeof primary.name === 'string') error.name = primary.name; } catch {}
      }
    }
    if (!Object.hasOwn(error, 'code')) error.code = 'ERR_ONNX_RESOURCE_PENDING';
    Object.defineProperties(error, {
      cleanupErrors: { value: Object.freeze(failures.filter(value => value !== primary)) },
      cleanupFailureCount: { value: failures.length },
      cacheOwnershipPending: { get: () => !settled },
      cacheOwnershipReleased: { value: () => settled },
      qualificationLease: { value: qualificationLease },
      onnxSessionOwner: { value: sessionOwner },
      onnxResourceOwner: { value: resourceOwner }
    });
    return error;
  };
  const release = () => {
    if (settled) return Promise.resolve(true);
    if (flight) return flight;
    flight = Promise.resolve().then(async () => {
      const failures = [];
      const retryTensors = tensorReleaseStarted; tensorReleaseStarted = true;
      for (const scope of tensorScopes) {
        try { await scope.close({ retry: retryTensors }); }
        catch (error) { failures.push(error); }
        if (!scope.pending) tensorScopes.delete(scope);
      }
      // A pending native run or output disposal keeps its session/tokenizer and
      // qualification capacity alive. Preserve the original scope for retry.
      if (tensorScopes.size) throw failure(failures);
      for (const [error, observe] of operationObservers) if (!observe()) failures.push(error);
      if (failures.length) throw failure(failures);
      // Attempt every independent native resource in reverse acquisition order.
      for (const resource of [native, tokens]) {
        try { await resource.release(); }
        catch (error) { failures.push(error); retain(error); }
      }
      if (!failures.length && [...observers.values()].every(observe => observe())) {
        try { await capacity.release(); }
        catch (error) { failures.push(error); retain(error); }
      }
      settled = native.released && tokens.released && capacity.released
        && [...observers.values(), ...operationObservers.values()].every(observe => observe());
      if (!settled) throw failure(failures);
      for (const observe of settlementObservers) {
        try { observe(); } catch { /* Observers cannot undo confirmed native settlement. */ }
      }
      settlementObservers.clear();
      return true;
    }).finally(() => { flight = null; });
    return flight;
  };
  const resourceOwner = Object.freeze({ release, retainOperationFailure: error => {
    if (settled) throw new Error('Released ONNX owner cannot acquire operation failures.');
    const observe = observePending(error);
    if (observe && !operationObservers.has(error)) operationObservers.set(error, observe);
  }, onSettled: observe => {
    if (typeof observe !== 'function') throw new TypeError('ONNX settlement observer must be a function.');
    if (settled) observe(); else settlementObservers.add(observe);
    return () => settlementObservers.delete(observe);
  }, get settled() { return settled; },
  get pending() { return !settled; } });
  return resourceOwner;
};

/** Preserve the original failure and exact failed owners without mutating any
 * original cause, including frozen errors and nonenumerable capabilities. */
export const releaseOnnxResources = async options => {
  const owner = options.resourceOwner || createOnnxResourceOwner(options);
  try { await owner.release(); }
  catch (error) { return error; }
  return options.primaryError ?? null;
};
