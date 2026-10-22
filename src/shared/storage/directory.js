import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { addStorageFailureContext, readStorageFailureContext } from './operation-error.js';

const sessions = new WeakSet();
const failureOwners = new WeakMap();
const sealOwnershipObservation = error => {
  const observe = Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased')?.value;
  Object.defineProperties(error, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
    cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
  return error;
};
export const isStorageDirectorySession = session => Boolean(session) && sessions.has(session);
export const getStorageDirectorySession = error => {
  if (error && typeof error === 'object' && failureOwners.has(error)) return failureOwners.get(error);
  try { const session = Object.getOwnPropertyDescriptor(error, 'storageDirectorySession')?.value; return isStorageDirectorySession(session) ? session : null; }
  catch { return null; }
};
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
const captureObservation = (error, retainInspection) => {
  try {
    const observe = error?.cacheOwnershipReleased;
    if (error?.cacheOwnershipPending !== true && typeof observe !== 'function') return { observe: null };
    return { observe: () => {
      try { return typeof observe === 'function' && observe.call(error) === true; }
      catch (inspectionError) { retainInspection(inspectionError); return false; }
    } };
  } catch (inspectionError) { return { observe: () => false, inspectionFailed: true, inspectionError }; }
};

/** Own only the actual opened directory, admitted reads and original close.
 * The caller supplies path authority and enumeration limits. This owner grants
 * no filesystem mutation, parent discovery or lease namespace authority.
 */
export const withStorageDirectory = async (directory, action) => {
  if (typeof action !== 'function') throw new TypeError('Storage directory requires its enumeration callback.');
  const handle = await fs.opendir(directory);
  let primary = null, closeMethod = null, closeCaptureError = null, readMethod = null, session = null;
  let accepting = true, closed = false, closing = null, overflow = false;
  const inflight = new Set(), readFailures = [], inspectionFailures = [], observers = [], observed = new WeakSet();
  const contexts = new Set(), contextObservations = new WeakSet();
  const retainInspection = value => {
    const error = asError(value);
    if (observed.has(error)) return;
    if (inspectionFailures.length === 64) { overflow = true; return; }
    inspectionFailures.push(error); observeFailure(error);
  };
  const rememberContext = error => {
    if (!readStorageFailureContext(error) || contexts.has(error)) return;
    if (contexts.size === 128) { overflow = true; return; }
    contexts.add(error);
  };
  const observeFailure = value => {
    const error = asError(value);
    const queue = [error];
    while (queue.length) {
      const current = asError(queue.pop());
      rememberContext(current);
      if (session && failureOwners.get(current) === session || observed.has(current)) continue;
      observed.add(current);
      const captured = captureObservation(current, retainInspection);
      if (captured.observe) { if (observers.length < 128) observers.push(captured.observe); else overflow = true; }
      if (captured.inspectionFailed) {
        if (inspectionFailures.length < 64) {
          const failure = asError(captured.inspectionError); inspectionFailures.push(failure); queue.push(failure);
        } else overflow = true;
      }
    }
    return error;
  };
  try {
    closeMethod = handle.close;
    if (typeof closeMethod !== 'function') throw new TypeError('Storage directory has no original close owner.');
  } catch (error) { closeCaptureError = observeFailure(error); }
  const originalResourcesSettled = () => {
    for (const error of contexts) {
      const context = readStorageFailureContext(error);
      if (!context.complete) overflow = true;
      for (const inspection of context.inspectionErrors) {
        if (observed.has(inspection)) continue;
        observed.add(inspection);
        if (inspectionFailures.length < 64) inspectionFailures.push(inspection); else overflow = true;
      }
      for (const observation of context.inspectionObservations) {
        if (failureOwners.get(observation.error) === session || contextObservations.has(observation)) continue;
        contextObservations.add(observation);
        if (observers.length < 128) observers.push(observation.observe); else overflow = true;
      }
    }
    return !overflow && observers.every(observe => observe());
  };
  const isSettled = () => closed && originalResourcesSettled();
  const closeOwner = async () => {
    if (!closing) closing = (async () => {
      await Promise.allSettled([...inflight]);
      if (closed) return [];
      try {
        if (!originalResourcesSettled()) throw new Error('Original storage directory work prohibits native close.');
        if (closeCaptureError) throw closeCaptureError;
        const result = await closeMethod.call(handle);
        if (result === false) throw new Error('Storage directory close explicitly remained unconfirmed.');
        closed = true;
        return [];
      } catch (error) { return [observeFailure(error)]; }
    })().finally(() => { closing = null; });
    return closing;
  };
  const retainFailure = failures => {
    const diagnostics = [...failures, ...inspectionFailures.filter(error => !failures.includes(error))];
    const pending = sealOwnershipObservation(Object.assign(new AggregateError(diagnostics, 'Storage directory closure remains unconfirmed.',
      failures.length ? { cause: failures[0] } : undefined), {
      code: 'ERR_STORAGE_DIRECTORY_CLOSE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    }));
    failureOwners.set(pending, session);
    const failure = addStorageFailureContext(primary || failures[0] || pending, { storageDirectorySession: session }, pending,
      { nonEnumerable: ['storageDirectorySession'] });
    sealOwnershipObservation(failure); failureOwners.set(failure, session); rememberContext(failure);
    return failure;
  };
  const resourceId = `storage-directory:${randomUUID()}`;
  session = Object.freeze({ resourceId, isSettled, releaseAfterClose: async () => {
    const failures = await closeOwner();
    if (failures.length || !isSettled()) throw retainFailure(failures);
    return { resourceId, settled: true, pending: false };
  } });
  sessions.add(session);
  const reader = Object.freeze({ read: () => {
    if (!accepting) return Promise.reject(new Error('Storage directory read scope has closed.'));
    const reading = Promise.resolve().then(() => readMethod.call(handle));
    inflight.add(reading);
    reading.then(() => inflight.delete(reading), value => {
      inflight.delete(reading);
      const error = observeFailure(value);
      if (readFailures.length < 128) readFailures.push(error); else overflow = true;
    });
    return reading;
  } });
  try {
    if (closeCaptureError) throw closeCaptureError;
    readMethod = handle.read;
    if (typeof readMethod !== 'function') throw new TypeError('Storage directory has no original read owner.');
    return await action(reader);
  } catch (value) { primary = observeFailure(value); throw primary; }
  finally {
    accepting = false;
    const closeFailures = await closeOwner();
    const failures = [...closeFailures, ...readFailures.filter(error => error !== primary && !closeFailures.includes(error))];
    if (closeFailures.length || !isSettled()) throw retainFailure(failures);
    if (failures.length) {
      const combined = primary ? [primary, ...failures] : failures;
      throw combined.slice(1).reduce((error, secondary) => addStorageFailureContext(error, {}, secondary), combined[0]);
    }
  }
};
