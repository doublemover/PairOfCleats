import { randomUUID } from 'node:crypto';
import { runWithTimeout } from '../../shared/promise-timeout.js';

const pending = new Set(), failures = new WeakMap();
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const observation = error => {
  if (!error) return null;
  try {
    const method = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof method !== 'function') return null;
    return () => { try { return typeof method === 'function' && method.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

export const isPendingPdfExtractionFailure = error => {
  const session = failures.get(error);
  return Boolean(session && !session.isSettled());
};
export const getPendingPdfExtractionOwners = () => Object.freeze([...pending]);

/** Own actual destroy promises independently of the bounded caller wait. */
export const createPdfExtractionLifetime = () => {
  const resources = new Map(), observers = new Map();
  const resourceId = `pdf-extraction:${randomUUID()}`;
  let operationSettled = false, retiring = false, overflow = false, firstFailure = null;
  const isSettled = () => operationSettled && !overflow && [...resources.values()].every(owner => owner.closed)
    && [...observers.values()].every(check => check());
  const update = () => { if (isSettled()) pending.delete(session); };
  const observe = error => {
    if (!error || failures.get(error) === session || observers.has(error)) return;
    const check = observation(error);
    if (check) { if (observers.size < 128) observers.set(error, check); else overflow = true; }
  };
  const start = (owner, retry) => {
    if (owner.closed) return Promise.resolve();
    if (owner.flight) return owner.flight;
    if (owner.failure && !retry) return Promise.reject(owner.failure);
    owner.flight = Promise.resolve().then(() => {
      if (owner.captureError) throw owner.captureError;
      return owner.destroy.call(owner.resource);
    }).then(() => { owner.closed = true; update(); }, value => {
      owner.failure = asError(value); observe(owner.failure); throw owner.failure;
    }).finally(() => { owner.flight = null; });
    owner.flight.catch(() => {});
    return owner.flight;
  };
  const adopt = (resource, { required = true } = {}) => {
    if (!resource || resources.has(resource)) return;
    const owner = { resource, destroy: null, captureError: null, closed: false, flight: null, failure: null };
    resources.set(resource, owner);
    try {
      owner.destroy = resource.destroy;
      // Current PDFDocumentProxy exposes no destroy method; the acquired
      // loading task owns that transport. Older/independent proxies may have one.
      if (owner.destroy == null && !required) owner.closed = true;
      else if (typeof owner.destroy !== 'function') throw new TypeError('PDF resource has no original destruction owner.');
    } catch (value) { owner.captureError = asError(value); }
    if (retiring) { pending.add(session); start(owner, false).catch(() => {}); }
  };
  const dispose = async ({ retry = false } = {}) => {
    retiring = true; pending.add(session);
    const results = await Promise.allSettled([...resources.values()].map(owner =>
      runWithTimeout(() => start(owner, retry), { timeoutMs: 2000 })));
    update();
    return results.filter(result => result.status === 'rejected').map(result => asError(result.reason));
  };
  const retain = (primary, cleanupErrors = []) => {
    const operationError = primary ? asError(primary) : firstFailure;
    const errors = [...(operationError ? [operationError] : []), ...cleanupErrors.map(asError)];
    const first = errors[0] || new Error('PDF extraction resource settlement remains unconfirmed.');
    firstFailure ||= first;
    for (const error of errors) observe(error);
    let message = 'PDF extraction or disposal failed.';
    try { if (typeof first.message === 'string') message = first.message; } catch {}
    const failure = new AggregateError(errors.length ? errors : [first], message, { cause: first });
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'cleanupErrors',
      'cacheOwnershipPending', 'cacheOwnershipReleased', 'pdfExtractionSession']);
    const descriptors = Object.getOwnPropertyDescriptors(first);
    for (const key of Reflect.ownKeys(descriptors)) if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    Object.defineProperties(failure, { cleanupErrors: { value: Object.freeze([...cleanupErrors]) },
      cacheOwnershipPending: { get: () => !isSettled() }, cacheOwnershipReleased: { value: isSettled },
      pdfExtractionSession: { value: session } });
    failures.set(failure, session);
    if (!isSettled()) pending.add(session);
    return failure;
  };
  const session = Object.freeze({ resourceId, isSettled, releaseAfterClose: async () => {
    const errors = await dispose({ retry: true });
    if (errors.length || !isSettled()) throw retain(null, errors);
    return { resourceId, settled: true, pending: false };
  } });
  return Object.freeze({ adopt, observe, dispose, retain, isSettled,
    finishOperation: () => { operationSettled = true; update(); } });
};
