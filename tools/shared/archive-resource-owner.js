import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createError, ERROR_CODES } from '../../src/shared/error-codes.js';
import { isFileLockPublicationSession } from '../../src/shared/locks/file-lock-publication.js';

const sessions = new WeakSet(), failureSessions = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
export const isArchiveExtractionSession = session => objectLike(session) && sessions.has(session);
export const getArchiveExtractionSession = error => {
  if (!objectLike(error)) return null;
  if (failureSessions.has(error)) return failureSessions.get(error);
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'archiveExtractionSession');
    return isArchiveExtractionSession(descriptor?.value) ? descriptor.value : null;
  } catch { return null; }
};
export const archiveStreamError = value => value instanceof Error ? value
  : new Error('Archive operation failed.', { cause: value });
const exactReceipt = (receipt, resourceId) => receipt && typeof receipt === 'object' && !Array.isArray(receipt)
  && Object.keys(receipt).sort().join(',') === 'pending,resourceId,settled' && receipt.resourceId === resourceId
  && receipt.settled === true && receipt.pending === false;

/** Own actual archive descriptors, not stream.destroy()/iterator acknowledgments.
 * Native methods are captured at admission and known close failures are retried
 * only through the actual returned capability, after admitted I/O drains.
 */
export const createArchiveResourceOwner = destination => {
  const resourceId = `archive-extraction:${randomUUID()}`;
  const descriptors = [], active = new Set(), errors = [], observers = [], observed = new WeakSet(), children = new Set();
  let primary, hasFailure = false, message = 'Archive extraction or resource cleanup failed.';
  let stopped = false, overflow = false, cleaned = false, cleanup = null, closing = null, reconciling = null;
  let cleanupFailure, cleanupFailed = false;
  let recoveryContext = null;
  const record = value => {
    const queue = [value];
    while (queue.length) {
      const error = queue.pop();
      // Only our exact privately branded outward error is already represented
      // by the original observations. Its own isSettled predicate depends on
      // descriptor close and must never become a close prerequisite itself.
      if (objectLike(error) && failureSessions.get(error) === session) continue;
      if (objectLike(error) && observed.has(error)) continue;
      if (objectLike(error)) observed.add(error);
      if (errors.length < 128) errors.push(error); else { overflow = true; break; }
      if (!hasFailure) {
        hasFailure = true; primary = error;
        try { const original = objectLike(error) ? error.message : null; if (typeof original === 'string') message = original; }
        catch (inspectionError) { queue.push(inspectionError); }
      }
      if (!objectLike(error)) continue;
      const child = getArchiveExtractionSession(error);
      if (child && child !== session) children.add(child);
      try {
        const publication = Object.getOwnPropertyDescriptor(error, 'fileLockPublicationSession')?.value;
        if (isFileLockPublicationSession(publication)) children.add(publication);
      } catch (inspectionError) { observers.push(() => false); queue.push(inspectionError); }
      try {
        const observe = error.cacheOwnershipReleased;
        if (error.cacheOwnershipPending === true || typeof observe === 'function') {
          observers.push(() => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } });
        }
      } catch (inspectionError) { observers.push(() => false); queue.push(inspectionError); }
    }
  };
  const originalResourcesSettled = () => !overflow && [...children].every(child => child.isSettled())
    && observers.every(observe => observe());
  const nativeSettled = () => active.size === 0 && descriptors.every(owner => owner.closed) && originalResourcesSettled();
  const isSettled = () => cleaned && nativeSettled();
  const track = work => {
    if (stopped) return Promise.reject(new Error('Archive I/O admission has stopped.'));
    let promise;
    try { promise = Promise.resolve(work()); } catch (value) { promise = Promise.reject(value); }
    const tracked = promise.catch(value => { record(value); throw value; }).finally(() => active.delete(tracked));
    active.add(tracked);
    tracked.catch(() => {});
    return tracked;
  };
  const drain = async () => {
    while (active.size) await Promise.allSettled([...active]);
  };
  const closeOne = async (owner, retry = false) => {
    if (owner.closed || owner.attempted && !retry) return;
    if (owner.closing) return owner.closing;
    owner.attempted = true;
    owner.closing = (async () => {
      await drain();
      if (!originalResourcesSettled()) throw new Error('Original archive resource observations prohibit descriptor close.');
      if (owner.captureFailed) throw owner.captureFailure;
      const result = await owner.close.call(owner.handle);
      if (result === false) throw new Error('Archive descriptor close explicitly remained unconfirmed.');
      owner.closed = true;
    })().catch(value => { record(value); throw value; }).finally(() => { owner.closing = null; });
    return owner.closing;
  };
  const closeAll = async retry => {
    if (!closing) closing = Promise.allSettled(descriptors.map(owner => closeOne(owner, retry))).finally(() => { closing = null; });
    return closing;
  };
  const failure = () => {
    const result = new AggregateError(errors, message, { cause: primary });
    if (objectLike(primary)) {
      try {
        for (const field of Reflect.ownKeys(primary)) {
          if (['cause', 'errors', 'message', 'stack', 'cacheOwnershipPending', 'cacheOwnershipReleased',
            'archiveExtractionSession', 'archiveResourceErrors', 'cleanupError', 'recoveryPath'].includes(field)
            || field === 'recovery' && recoveryContext) continue;
          const descriptor = Object.getOwnPropertyDescriptor(primary, field);
          if (descriptor) Object.defineProperty(result, field, descriptor);
        }
      } catch (inspectionError) { record(inspectionError); result.errors.push(inspectionError); }
    }
    if (!Object.hasOwn(result, 'code')) result.code = 'ERR_ARCHIVE_RESOURCE_PENDING';
    Object.defineProperties(result, {
      cacheOwnershipPending: { value: !isSettled() }, cacheOwnershipReleased: { value: isSettled },
      archiveExtractionSession: { value: session }, archiveResourceErrors: { value: Object.freeze([...result.errors]) },
      recoveryPath: { value: destination, enumerable: true },
      ...(recoveryContext ? { recovery: { value: recoveryContext, enumerable: true } } : {}),
      ...(cleanupFailed ? { cleanupError: { value: cleanupFailure, enumerable: true } } : {})
    });
    failureSessions.set(result, session);
    return result;
  };
  const cleanupOwned = async () => {
    if (cleaned) return;
    if (!nativeSettled()) throw new Error('Archive native/resource settlement remains unconfirmed.');
    try {
      if (typeof cleanup !== 'function') throw new Error('Archive destination cleanup has no original owner.');
      await cleanup(); cleaned = true;
    } catch (value) { cleanupFailed = true; cleanupFailure = value; record(value); throw value; }
  };
  const session = Object.freeze({ resourceId, destination, isSettled, releaseAfterClose: async () => {
    if (!reconciling) reconciling = (async () => {
      stopped = true;
      for (const child of children) {
        try {
          const receipt = await child.releaseAfterClose();
          if (!exactReceipt(receipt, child.resourceId) || !child.isSettled()) throw new Error('Original nested archive owner remains unsettled.');
        } catch (value) { record(value); }
      }
      await drain();
      await closeAll(true);
      await cleanupOwned();
      return { resourceId, settled: true, pending: false };
    })().finally(() => { reconciling = null; });
    try { return await reconciling; }
    catch (value) { record(value); throw failure(); }
  } });
  sessions.add(session);
  const open = async (file, flags, mode) => {
    const handle = await track(() => fs.open(file, flags, mode));
    const owner = { handle, closed: false, attempted: false, closing: null, captureFailed: false };
    descriptors.push(owner);
    try {
      owner.close = handle.close;
      if (typeof owner.close !== 'function') throw new TypeError('Archive descriptor has no original close owner.');
    } catch (value) { owner.captureFailed = true; owner.captureFailure = value; record(value); throw value; }
    try {
      for (const method of ['read', 'write', 'stat']) {
        owner[method] = handle[method];
        if (typeof owner[method] !== 'function') throw new TypeError(`Archive descriptor has no original ${method} owner.`);
      }
    } catch (value) { record(value); throw value; }
    return owner;
  };
  const read = (owner, ...args) => track(() => owner.read.call(owner.handle, ...args));
  const write = (owner, buffer) => track(async () => {
    let offset = 0;
    while (offset < buffer.length) {
      const result = await owner.write.call(owner.handle, buffer, offset, buffer.length - offset, null);
      if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten <= 0 || result.bytesWritten > buffer.length - offset) {
        throw new Error('Archive output descriptor made no valid write progress.');
      }
      offset += result.bytesWritten;
    }
  });
  const range = async function* (owner, start, end) {
    let position = start;
    while (position < end) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, end - position));
      const result = await read(owner, buffer, 0, buffer.length, position);
      if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > buffer.length) throw new Error('Archive input descriptor returned an invalid byte count.');
      if (!result.bytesRead) return;
      position += result.bytesRead;
      yield buffer.subarray(0, result.bytesRead);
    }
  };
  return { session, record, open, read, write, range, closeOne, drain,
    stat: owner => track(() => owner.stat.call(owner.handle, { bigint: true })),
    setCleanup: callback => { cleanup = callback; },
    setRecoveryContext: context => { recoveryContext = Object.freeze({ ...context }); },
    finish: async ({ cleanupOnSuccess = false } = {}) => {
      stopped = true;
      await drain();
      await closeAll(false);
      if ((hasFailure || cleanupOnSuccess) && nativeSettled()) { try { await cleanupOwned(); } catch {} }
      if (hasFailure || !nativeSettled()) {
        if (!hasFailure) record(new Error('Archive resource closure remains unconfirmed.'));
        throw failure();
      }
    }
  };
};

export const removeOwnedArchiveDirectory = async (destination, owned) => {
  let current;
  try { current = await fs.lstat(destination, { bigint: true }); }
  catch (value) { if (value?.code === 'ENOENT') return; throw value; }
  if (!owned || !owned.isDirectory() || owned.isSymbolicLink() || owned.ino === 0n
    || !current.isDirectory() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino) {
    throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `Archive cleanup refused changed destination: ${destination}`);
  }
  const result = await fs.rm(destination, { recursive: true, force: false });
  if (result === false) throw new Error('Archive destination removal explicitly remained unconfirmed.');
};

/** Actual outer archive consumers retain their private transaction while an
 * extraction/independent resource is pending, and expose exact nested retry.
 */
export const runArchiveTransaction = async (destination, owned, work, cleanupExtra = async () => {}) => {
  const owner = createArchiveResourceOwner(destination);
  owner.setCleanup(async () => { await cleanupExtra(); await removeOwnedArchiveDirectory(destination, owned); });
  let result;
  try { result = await work(); } catch (value) { owner.record(value); }
  await owner.finish({ cleanupOnSuccess: true });
  return result;
};
