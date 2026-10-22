import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { addStorageFailureContext } from './operation-error.js';

const sessions = new WeakSet();
export const isStorageDirectorySession = session => Boolean(session) && sessions.has(session);
export const getStorageDirectorySession = error => {
  try { const session = error?.storageDirectorySession; return isStorageDirectorySession(session) ? session : null; }
  catch { return null; }
};
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const captureObservation = error => {
  try {
    const observe = error?.cacheOwnershipReleased;
    if (error?.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

/** Own only the actual opened directory, admitted reads and original close.
 * The caller supplies path authority and enumeration limits. This owner grants
 * no filesystem mutation, parent discovery or lease namespace authority.
 */
export const withStorageDirectory = async (directory, action) => {
  if (typeof action !== 'function') throw new TypeError('Storage directory requires its enumeration callback.');
  const handle = await fs.opendir(directory);
  let primary = null, closeMethod = null, closeCaptureError = null, readMethod = null;
  let accepting = true, closed = false, closing = null, overflow = false;
  const inflight = new Set(), readFailures = [], observers = [], observed = new WeakSet();
  const observeFailure = value => {
    const error = asError(value);
    if (observed.has(error)) return error;
    observed.add(error);
    const observe = captureObservation(error);
    if (observe) { if (observers.length < 128) observers.push(observe); else overflow = true; }
    return error;
  };
  try {
    closeMethod = handle.close;
    if (typeof closeMethod !== 'function') throw new TypeError('Storage directory has no original close owner.');
  } catch (error) { closeCaptureError = observeFailure(error); }
  const isSettled = () => closed && !overflow && observers.every(observe => observe());
  const closeOwner = async () => {
    if (!closing) closing = (async () => {
      await Promise.allSettled([...inflight]);
      if (closed) return [];
      try {
        if (closeCaptureError) throw closeCaptureError;
        await closeMethod.call(handle);
        closed = true;
        return [];
      } catch (error) { return [observeFailure(error)]; }
    })().finally(() => { closing = null; });
    return closing;
  };
  const retainFailure = failures => {
    const pending = Object.assign(new AggregateError(failures, 'Storage directory closure remains unconfirmed.',
      failures.length ? { cause: failures[0] } : undefined), {
      code: 'ERR_STORAGE_DIRECTORY_CLOSE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    });
    return addStorageFailureContext(primary || failures[0] || pending, { storageDirectorySession: session }, pending,
      { nonEnumerable: ['storageDirectorySession'] });
  };
  const resourceId = `storage-directory:${randomUUID()}`;
  const session = Object.freeze({ resourceId, isSettled, releaseAfterClose: async () => {
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
