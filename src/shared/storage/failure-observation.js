import { addStorageFailureContext, readStorageFailureContext } from './operation-error.js';

const retainedFailures = new WeakSet();
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
export const isStorageObservationFailure = value => value !== null && ['object', 'function'].includes(typeof value)
  && retainedFailures.has(value);

/** Internal owner-local aggregation only: no close, retry, path or metadata
 * authority. Adapters exclude only their own privately branded aggregate.
 * Original callbacks/receivers and late context inspections remain captured.
 */
export const createStorageObservationLedger = ({ isOwnFailure = () => false } = {}) => {
  const observers = [], inspections = [], pending = [], contexts = new Set();
  const observed = new WeakSet(), queued = new WeakSet(), contextObservations = new WeakSet();
  let overflow = false, draining = false, checking = false, reentered = false;
  const rememberContext = error => {
    if (!readStorageFailureContext(error) || contexts.has(error)) return;
    if (contexts.size === 128) { overflow = true; return; }
    contexts.add(error);
  };
  const enqueue = error => {
    if (queued.has(error) || observed.has(error)) return;
    if (pending.length === 128) { overflow = true; return; }
    queued.add(error); pending.push(error);
  };
  const retainInspection = value => {
    const error = asError(value);
    if (observed.has(error) || queued.has(error)) return;
    if (inspections.length === 64) { overflow = true; return; }
    inspections.push(error); enqueue(error); drain();
  };
  const addObserver = observe => {
    if (observers.length === 128) { overflow = true; return; }
    observers.push(observe);
  };
  const capture = error => {
    let original, marker;
    try { original = error.cacheOwnershipReleased; marker = error.cacheOwnershipPending; }
    catch (inspection) { addObserver(() => false); retainInspection(inspection); return; }
    if (marker !== true && typeof original !== 'function') return;
    addObserver(() => {
      try { return typeof original === 'function' && original.call(error) === true; }
      catch (inspection) { retainInspection(inspection); return false; }
    });
  };
  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      while (pending.length) {
        const error = pending.pop(); queued.delete(error);
        rememberContext(error);
        if (observed.has(error)) continue;
        observed.add(error);
        if (!isOwnFailure(error)) capture(error);
      }
    } finally { draining = false; }
  };
  const remember = value => {
    const error = asError(value);
    // An owner can acquire new context after its aggregate was first seen.
    rememberContext(error); enqueue(error); drain(); return error;
  };
  const refreshContexts = () => {
    for (const error of contexts) {
      const context = readStorageFailureContext(error);
      if (!context.complete) overflow = true;
      for (const inspection of context.inspectionErrors) {
        if (observed.has(inspection)) continue;
        observed.add(inspection);
        if (inspections.length < 64) inspections.push(inspection); else overflow = true;
      }
      for (const observation of context.inspectionObservations) {
        if (isOwnFailure(observation.error) || contextObservations.has(observation)) continue;
        contextObservations.add(observation); addObserver(observation.observe);
      }
    }
  };
  const isSettled = () => {
    if (checking || draining) { reentered = true; return false; }
    checking = true; reentered = false;
    try {
      refreshContexts();
      if (overflow) return false;
      // Include guards and late contexts discovered during callbacks without
      // replaying an already checked observer in this same bounded pass.
      let index = 0;
      do {
        for (; index < observers.length; index += 1) {
          let settled;
          try { settled = observers[index]() === true; }
          catch (inspection) { retainInspection(inspection); settled = false; }
          if (!settled || overflow || reentered) return false;
        }
        refreshContexts();
      } while (index < observers.length && !overflow && !reentered);
      return !overflow && !reentered;
    } finally { checking = false; }
  };
  const requireSettled = () => {
    if (!isSettled()) throw Object.freeze(Object.assign(new Error('Original storage resource observations remain pending.'), {
      code: 'ERR_STORAGE_RESOURCE_OBSERVATION_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    }));
  };
  return Object.freeze({ remember, isSettled, requireSettled,
    markIncomplete() { overflow = true; },
    snapshot: () => Object.freeze({ complete: !overflow, observerCount: observers.length,
      contextCount: contexts.size, inspectionErrors: Object.freeze([...inspections]) }) });
};

/** Classification never settles a resource. Capture the actual original
 * observation before inspecting report fields or returning an ordinary diagnostic.
 */
export const observeStorageResource = (value, { phase = 'storage-failure', phaseField = 'storageFailurePhase' } = {}) => {
  const primary = asError(value), inspections = [];
  let original, marker, unreadable = false;
  try { original = primary.cacheOwnershipReleased; } catch (error) { unreadable = true; inspections.push(error); }
  try { marker = primary.cacheOwnershipPending; } catch (error) { unreadable = true; inspections.push(error); }
  const observed = unreadable || marker === true || typeof original === 'function';
  const originalSettled = () => !unreadable && (!observed || typeof original === 'function' && original.call(primary) === true);
  const retain = (inspection, { inspectionPresent = false, inspectionPrimary = false } = {}) => {
    const fields = { [phaseField]: phase,
      ...(observed ? { cacheOwnershipPending: true, cacheOwnershipReleased: originalSettled } : {}) };
    const first = inspectionPrimary && inspectionPresent ? asError(inspection) : primary;
    const candidate = inspectionPrimary ? primary : inspection;
    const secondary = inspectionPresent && candidate !== first ? candidate : Object.freeze(Object.assign(
      new Error('Original resource observation remains retained.'), {
        cacheOwnershipPending: observed, cacheOwnershipReleased: originalSettled
      }));
    let failure = addStorageFailureContext(first, fields, secondary, { secondaryPresent: true });
    for (const error of inspections) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
    const observe = Object.getOwnPropertyDescriptor(failure, 'cacheOwnershipReleased')?.value;
    Object.defineProperties(failure, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
      cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
    retainedFailures.add(failure); return failure;
  };
  const requireSettled = () => {
    if (unreadable) throw retain();
    let confirmed;
    try { confirmed = originalSettled(); }
    catch (inspection) { throw retain(inspection, { inspectionPresent: true }); }
    if (!confirmed) throw retain();
  };
  const read = field => {
    requireSettled(); let result;
    try { result = primary[field]; }
    catch (inspection) { throw retain(inspection, { inspectionPresent: true }); }
    requireSettled(); return result;
  };
  /** Keep a typed producer error and its exact cause while carrying the same
   * original observer/inspection prerequisites across a diagnostic boundary.
   * This grants no retry, native-close or metadata-release authority.
   */
  const wrap = (failure, { inspection, inspectionPresent = false } = {}) => {
    const context = retain(inspection, { inspectionPresent });
    const captured = Object.getOwnPropertyDescriptor(context, 'cacheOwnershipReleased').value;
    const wrapped = addStorageFailureContext(failure, { storageFailureObservation: context,
      cacheOwnershipPending: true, cacheOwnershipReleased: () => captured.call(context) === true }, null,
    { nonEnumerable: ['storageFailureObservation'] });
    const observe = Object.getOwnPropertyDescriptor(wrapped, 'cacheOwnershipReleased').value;
    Object.defineProperties(wrapped, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
      cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
    retainedFailures.add(wrapped);
    return wrapped;
  };
  // Observation only, for an existing owner that must retain these original
  // prerequisites before another native operation. It grants no release proof.
  return Object.freeze({ primary, retain, wrap, requireSettled, read, isSettled: originalSettled,
    hasResourceObservation: observed });
};

/** A report is safe only after the original resource observation is confirmed.
 * Strings are projected without coercing arbitrary diagnostic objects.
 */
export const describeStorageFailure = (value, { phase = 'storage-failure',
  defaultCode = 'ERR_STORAGE', defaultMessage = 'Storage observation failed.' } = {}) => {
  const observation = observeStorageResource(value, { phase });
  const code = observation.read('code'), message = observation.read('message');
  return { code: typeof code === 'string' && code ? code : defaultCode,
    message: typeof message === 'string' ? message : defaultMessage };
};

