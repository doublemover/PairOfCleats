import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import { addStorageFailureContext } from './operation-error.js';
import { observeStorageResource, createStorageObservationLedger } from './failure-observation.js';

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
/** Own only the actual opened directory, admitted reads and original close.
 * The caller supplies path authority and enumeration limits. This owner grants
 * no filesystem mutation, parent discovery or lease namespace authority.
 */
export const withStorageDirectory = async (directory, action) => {
  if (typeof action !== 'function') throw new TypeError('Storage directory requires its enumeration callback.');
  const handle = await fs.opendir(directory);
  let primary = null, closeMethod = null, closeCaptureError = null, readMethod = null, session = null;
  let accepting = true, closed = false, closing = null;
  const inflight = new Set(), readFailures = [];
  const observations = createStorageObservationLedger({ isOwnFailure: error => Boolean(session && failureOwners.get(error) === session) });
  const observeFailure = observations.remember, originalResourcesSettled = observations.isSettled;
  try {
    closeMethod = handle.close;
    if (typeof closeMethod !== 'function') throw new TypeError('Storage directory has no original close owner.');
  } catch (error) { closeCaptureError = observeFailure(error); }
  const isSettled = () => closed && originalResourcesSettled();
  const closeOwner = async () => {
    if (!closing) closing = (async () => {
      await Promise.allSettled([...inflight]);
      if (closed) return [];
      try {
        if (!originalResourcesSettled()) throw new Error('Original storage directory work prohibits native close.');
        if (closeCaptureError) throw closeCaptureError;
        const result = await closeMethod.call(handle);
        if (result !== undefined) throw new Error('Storage directory close did not confirm its standard void result.');
        closed = true;
        return [];
      } catch (error) { return [observeFailure(error)]; }
    })().finally(() => { closing = null; });
    return closing;
  };
  const retainFailure = failures => {
    const diagnostics = [...failures, ...observations.snapshot().inspectionErrors.filter(error => !failures.includes(error))];
    const pending = sealOwnershipObservation(Object.assign(new AggregateError(diagnostics, 'Storage directory closure remains unconfirmed.',
      failures.length ? { cause: failures[0] } : undefined), {
      code: 'ERR_STORAGE_DIRECTORY_CLOSE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    }));
    failureOwners.set(pending, session);
    const failure = addStorageFailureContext(primary || failures[0] || pending, { storageDirectorySession: session }, pending,
      { nonEnumerable: ['storageDirectorySession'] });
    sealOwnershipObservation(failure); failureOwners.set(failure, session); observations.remember(failure);
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
      if (readFailures.length < 128) readFailures.push(error); else observations.markIncomplete();
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

/** Synchronous counterpart for command selection before process launch. The
 * exact Dir object, original methods and original resource observations survive
 * failed inspection. Recovery closes only; it never resumes enumeration. */
export const withStorageDirectorySync = (directory, action) => {
  if (typeof action !== 'function') throw new TypeError('Storage directory requires its synchronous enumeration callback.');
  const handle = fsSync.opendirSync(directory);
  const resourceId = `storage-directory:${randomUUID()}`;
  let accepting = true, closed = false, overflow = false, primary = null, closeMethod = null, readMethod = null;
  let captureFailed = false, session;
  const errors = [], guards = [], seen = new WeakSet();
  const record = value => {
    const error = asError(value);
    if (failureOwners.get(error) === session || seen.has(error)) return error;
    seen.add(error);
    if (errors.length === 128) { overflow = true; return error; }
    errors.push(error); primary ||= error;
    const retained = observeStorageResource(error, { phase: 'storage-directory-sync' }).retain();
    guards.push(Object.getOwnPropertyDescriptor(retained, 'cacheOwnershipReleased').value);
    return error;
  };
  const resourcesSettled = () => !overflow && guards.every(observe => observe() === true);
  const isSettled = () => closed && resourcesSettled();
  const close = () => {
    if (closed) return;
    if (!resourcesSettled()) throw new Error('Original storage directory work prohibits native close.');
    if (captureFailed) throw new Error('Storage directory original close method is unknown.');
    const result = closeMethod.call(handle);
    if (result !== undefined) throw new Error('Storage directory close did not confirm its standard void result.');
    closed = true;
  };
  const retainFailure = () => {
    const pending = sealOwnershipObservation(Object.assign(new AggregateError(errors, 'Storage directory closure remains unconfirmed.',
      primary ? { cause: primary } : undefined), {
      code: 'ERR_STORAGE_DIRECTORY_CLOSE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    }));
    failureOwners.set(pending, session);
    const failure = addStorageFailureContext(primary || pending, { storageDirectorySession: session }, pending,
      { nonEnumerable: ['storageDirectorySession'], forceAggregate: true });
    sealOwnershipObservation(failure); failureOwners.set(failure, session);
    return failure;
  };
  const release = () => {
    try { close(); } catch (error) { record(error); throw retainFailure(); }
    if (!isSettled()) throw retainFailure();
    return { resourceId, settled: true, pending: false };
  };
  session = Object.freeze({ resourceId, isSettled, releaseAfterCloseSync: release, releaseAfterClose: async () => release() });
  sessions.add(session);
  try {
    closeMethod = handle.closeSync;
    if (typeof closeMethod !== 'function') throw new TypeError('Storage directory has no original synchronous close owner.');
  } catch (error) { captureFailed = true; record(error); }
  const reader = Object.freeze({ read: () => {
    if (!accepting) throw new Error('Storage directory read scope has closed.');
    try { return readMethod.call(handle); } catch (error) { record(error); throw error; }
  } });
  let result;
  try {
    if (captureFailed) throw primary;
    readMethod = handle.readSync;
    if (typeof readMethod !== 'function') throw new TypeError('Storage directory has no original synchronous read owner.');
    result = action(reader);
  } catch (error) { record(error); }
  accepting = false;
  try { close(); } catch (error) { record(error); }
  if (!isSettled()) throw retainFailure();
  if (errors.length) throw errors.slice(1).reduce((failure, error) => addStorageFailureContext(failure, {}, error,
    { forceAggregate: true }), errors[0]);
  return result;
};
