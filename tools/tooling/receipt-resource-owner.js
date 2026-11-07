import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { addStorageFailureContext, readStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const sessions = new WeakSet(), failureOwners = new WeakMap();
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
export const isToolReceiptResourceSession = session => Boolean(session) && sessions.has(session);
export const getToolReceiptResourceSession = error => error !== null && ['object', 'function'].includes(typeof error)
  ? failureOwners.get(error) || null : null;

export const assertToolReceiptFailureSettled = error => {
  const session = getToolReceiptResourceSession(error);
  if (session && !session.isSettled()) throw error;
  let observe, marker;
  try { observe = error?.cacheOwnershipReleased; marker = error?.cacheOwnershipPending; }
  catch (inspection) { throw addStorageFailureContext(error, {}, inspection, { secondaryPresent: true }); }
  if (marker !== true && typeof observe !== 'function') return;
  let settled = false;
  try { settled = typeof observe === 'function' && observe.call(error) === true; }
  catch (inspection) { throw addStorageFailureContext(error, {}, inspection, { secondaryPresent: true }); }
  if (!settled) throw error;
};

/** Synchronous receipt APIs retain their actual Dir or exact temporary cleanup
 * callback. This owner cannot create a lease, discover a parent or replay work.
 */
export const createReceiptResourceOwner = ({ close = null, closeRequired = false, cleanup = null, context = {} } = {}) => {
  let closed = !closeRequired, cleaned = cleanup === null, overflow = false, settling = false, session;
  const errors = [], observers = [], observed = new WeakSet(), contexts = new Set(), contextObservations = new WeakSet();
  const rememberContext = error => {
    if (!readStorageFailureContext(error) || contexts.has(error)) return;
    if (contexts.size === 128) { overflow = true; return; }
    contexts.add(error);
  };
  const record = value => {
    const first = asError(value), queue = [first];
    while (queue.length) {
      const error = asError(queue.pop()); rememberContext(error);
      if (failureOwners.get(error) === session || observed.has(error)) continue;
      if (errors.length === 128) { overflow = true; break; }
      observed.add(error);
      errors.push(error);
      const retainObserver = observe => { if (observers.length < 128) observers.push(observe); else overflow = true; };
      const inspection = value => { retainObserver(() => false); queue.push(value); };
      let observe, marker;
      try { observe = error.cacheOwnershipReleased; } catch (value) { inspection(value); }
      try { marker = error.cacheOwnershipPending; } catch (value) { inspection(value); }
      if (marker === true || typeof observe === 'function') retainObserver(() => {
        try { return typeof observe === 'function' && observe.call(error) === true; }
        catch (value) { record(value); return false; }
      });
    }
    return first;
  };
  const originalResourcesSettled = () => {
    for (const error of contexts) {
      const context = readStorageFailureContext(error);
      if (!context.complete) overflow = true;
      for (const inspection of context.inspectionErrors) {
        if (observed.has(inspection)) continue;
        observed.add(inspection);
        if (errors.length < 128) errors.push(inspection); else overflow = true;
      }
      for (const observation of context.inspectionObservations) {
        if (failureOwners.get(observation.error) === session || contextObservations.has(observation)) continue;
        contextObservations.add(observation);
        if (observers.length < 128) observers.push(observation.observe); else overflow = true;
      }
    }
    return !overflow && observers.every(observe => observe());
  };
  const isSettled = () => closed && cleaned && originalResourcesSettled();
  const brand = error => {
    const observe = Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased')?.value;
    Object.defineProperties(error, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
      cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
    failureOwners.set(error, session); return error;
  };
  const failure = () => {
    const pending = brand(Object.assign(new AggregateError([...errors], 'Tool receipt resource settlement remains unconfirmed.'), {
      code: 'ERR_TOOL_RECEIPT_RESOURCE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    }));
    const error = brand(addStorageFailureContext(errors[0] || pending, { ...context, toolReceiptResourceSession: session }, pending,
      { nonEnumerable: ['toolReceiptResourceSession'] }));
    rememberContext(error); return error;
  };
  const settle = () => {
    if (settling) {
      const error = Object.assign(new Error('Tool receipt settlement cannot reenter its original close.'), {
        cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
      });
      throw brand(error);
    }
    settling = true;
    try {
      // Prepare original diagnostics before either native close or removal:
      // a failing message getter can introduce an independent native owner.
      if (errors.length) failure();
      if (!originalResourcesSettled()) throw failure();
      if (!closed) {
        try {
          if (typeof close !== 'function') throw new Error('Original receipt directory close owner is unavailable.');
          const result = close();
          if (result === false) throw new Error('Receipt directory close explicitly remained unconfirmed.');
          if (result !== undefined) throw Object.assign(new Error('Receipt directory close returned unknown synchronous evidence.'), {
            cacheOwnershipPending: true
          });
          closed = true;
        } catch (value) { record(value); throw failure(); }
      }
      if (!originalResourcesSettled()) throw failure();
      if (!cleaned) {
        try {
          const result = cleanup();
          if (result === false) throw new Error('Receipt temporary cleanup explicitly remained unconfirmed.');
          if (result !== undefined) throw Object.assign(new Error('Receipt cleanup returned unknown synchronous evidence.'), {
            cacheOwnershipPending: true
          });
          cleaned = true;
        } catch (value) { record(value); throw failure(); }
      }
      if (!isSettled()) throw failure();
      return { resourceId: session.resourceId, settled: true, pending: false };
    } finally { settling = false; }
  };
  session = Object.freeze({ resourceId: `tool-receipt-resource:${randomUUID()}`, isSettled, releaseAfterClose: settle });
  sessions.add(session);
  return Object.freeze({ record, failure, settle, session });
};

export const withToolReceiptDirectory = (directory, action) => {
  const actual = fs.opendirSync(directory);
  let originalClose, captureFailed = false, captureError;
  try { originalClose = actual.closeSync; if (typeof originalClose !== 'function') throw new TypeError('Receipt directory close is unavailable.'); }
  catch (error) { captureFailed = true; captureError = error; }
  const owner = createReceiptResourceOwner({ closeRequired: true,
    close: typeof originalClose === 'function' ? () => originalClose.call(actual) : null });
  let failed = false, result, accepting = true;
  try {
    if (captureFailed) throw captureError;
    const originalRead = actual.readSync;
    if (typeof originalRead !== 'function') throw new TypeError('Receipt directory read is unavailable.');
    result = action(Object.freeze({ readSync: () => {
      if (!accepting) throw new Error('Tool receipt directory read scope has closed.');
      try { return originalRead.call(actual); }
      catch (value) { throw owner.record(value); }
    } }));
  } catch (value) { failed = true; owner.record(value); }
  finally { accepting = false; }
  owner.settle();
  if (failed) throw owner.failure();
  return result;
};
