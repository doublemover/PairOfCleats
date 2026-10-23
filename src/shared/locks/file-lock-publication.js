import fs from 'node:fs/promises';
import path from 'node:path';

// Process-local ownership of actual open publication descriptors. This is not
// another filesystem lock/lease namespace and cannot identify another process.
const publications = new Map();
const sessions = new WeakSet();
const failureOwners = new WeakMap();
const keyFor = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
export const isFileLockPublicationPending = file => Boolean(file) && Boolean(publications.get(keyFor(file))?.size);
export const isFileLockPublicationSession = session => Boolean(session) && sessions.has(session);
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const captureObservation = (error, retainInspection) => {
  if (!objectLike(error)) return { observe: null };
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return { observe: null };
    return { observe: () => {
      try { return typeof observe === 'function' && observe.call(error) === true; }
      catch (inspectionError) { retainInspection(inspectionError); return false; }
    } };
  } catch (inspectionError) { return { observe: () => false, inspectionFailed: true, inspectionError }; }
};
const identityOf = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mode: stat.mode, nlink: stat.nlink,
  mtime: String(stat.mtimeNs ?? stat.mtimeMs), ctime: String(stat.ctimeNs ?? stat.ctimeMs),
  birthtime: String(stat.birthtimeNs ?? stat.birthtimeMs) });
const regular = stat => stat.isFile() && !stat.isSymbolicLink() && stat.ino !== 0n && stat.nlink === 1n;
const sameObject = (left, right) => left.dev === right.dev && left.ino === right.ino && left.birthtime === right.birthtime;
const sameIdentity = (left, right) => sameObject(left, right)
  && ['size', 'mode', 'nlink', 'mtime', 'ctime'].every(field => left[field] === right[field]);

/** Complete one already-exclusive publication. Failure never retries a known
 * failed write/close or removes its pathname automatically. The exact original
 * owner can explicitly close and roll back only its sealed original metadata.
 */
export const publishFileLock = async ({ handle, lockPath, payload, contents, diagnostics, readInfo }) => {
  const key = keyFor(lockPath), token = {};
  const active = publications.get(key) || new Set();
  active.add(token); publications.set(key, active);
  const forget = () => { active.delete(token); if (!active.size && publications.get(key) === active) publications.delete(key); };
  const lockId = payload.lockId, resourceId = `file-lock-publication:${lockId}`;
  const initialFailures = [], retryFailures = [], inspectionFailures = [], observers = [], observed = new WeakSet();
  let primary, hasPrimary = false, closeMethod = null, statMethod = null, writeMethod = null;
  let primaryMessage = 'File lock publication or exact rollback remains unconfirmed.';
  const primaryDescriptors = [], excludedFields = new Set(['cause', 'errors', 'message', 'stack',
    'cacheOwnershipPending', 'cacheOwnershipReleased', 'fileLockPublicationSession', 'fileLockPublication', 'fileLockPublicationErrors']);
  let closeCaptureFailure, closeCaptureFailed = false;
  let original = null, snapshot = null, closed = false, removed = false, closing = null, reconciling = null, overflow = false;
  const remember = value => {
    const pending = [value];
    while (pending.length) {
      const error = pending.pop();
      // Only this exact privately produced outward error is already represented
      // by the original independent observations. Its own settlement predicate
      // depends on close/removal and cannot gate that same close.
      if (objectLike(error) && failureOwners.get(error) === session) continue;
      if (!objectLike(error) || observed.has(error)) continue;
      observed.add(error);
      const captured = captureObservation(error, retainInspection);
      if (captured.observe) { if (observers.length < 128) observers.push(captured.observe); else overflow = true; }
      if (captured.inspectionFailed) {
        if (inspectionFailures.length < 64) {
          inspectionFailures.push(captured.inspectionError);
          pending.push(captured.inspectionError);
        } else overflow = true;
      }
    }
  };
  const retainInspection = value => {
    if (objectLike(value) && observed.has(value)) return;
    if (inspectionFailures.length < 64) inspectionFailures.push(value); else overflow = true;
    remember(value);
  };
  const fail = value => {
    remember(value);
    initialFailures.push(value);
    if (!hasPrimary) {
      hasPrimary = true; primary = value;
      if (objectLike(value)) {
        try {
          for (const field of Reflect.ownKeys(value)) {
            if (excludedFields.has(field)) continue;
            if (primaryDescriptors.length === 128) { overflow = true; break; }
            try {
              const descriptor = Object.getOwnPropertyDescriptor(value, field);
              if (descriptor) primaryDescriptors.push([field, descriptor]);
            } catch (inspectionError) { retainInspection(inspectionError); }
          }
        } catch (inspectionError) { retainInspection(inspectionError); }
      }
      try {
        const message = objectLike(value) ? value.message : null;
        if (typeof message === 'string') primaryMessage = message;
      } catch (inspectionError) {
        retainInspection(inspectionError);
      }
    }
  };
  const originalResourcesSettled = () => {
    if (overflow) return false;
    for (let index = 0; index < observers.length; index += 1) if (!observers[index]()) return false;
    return !overflow;
  };
  const resourcesSettled = () => closed && originalResourcesSettled();
  const isSettled = () => removed && resourcesSettled();
  const closeOriginal = async () => {
    if (closed) return;
    if (closeCaptureFailed) throw closeCaptureFailure;
    if (!closing) closing = Promise.resolve().then(async () => {
      if (!originalResourcesSettled()) throw new Error('Original file lock publication work prohibits native descriptor close.');
      const result = await closeMethod.call(handle);
      if (result !== undefined) throw new Error('Original file lock descriptor close did not confirm its standard void result.');
      closed = true;
    }).finally(() => { closing = null; });
    return closing;
  };
  const retainFailure = latest => {
    const errors = [...initialFailures, ...inspectionFailures, ...retryFailures];
    if (!errors.length) errors.push(latest);
    const failure = new AggregateError(errors, primaryMessage, hasPrimary ? { cause: primary } : { cause: latest });
    if (objectLike(primary)) {
      try {
        for (const [field, captured] of primaryDescriptors) {
          const descriptor = { ...captured }, getter = descriptor.get, setter = descriptor.set;
          if (typeof getter === 'function') descriptor.get = () => {
            try { return getter.call(primary); }
            catch (inspectionError) { retainInspection(inspectionError); throw inspectionError; }
          };
          if (typeof setter === 'function') descriptor.set = value => {
            try { return setter.call(primary, value); }
            catch (inspectionError) { retainInspection(inspectionError); throw inspectionError; }
          };
          Object.defineProperty(failure, field, descriptor);
        }
      } catch (copyError) {
        retainInspection(copyError);
        failure.errors.push(copyError);
      }
    }
    if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_FILE_LOCK_PUBLICATION_PENDING';
    Object.defineProperties(failure, {
      cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: isSettled },
      fileLockPublicationSession: { value: session }, fileLockPublicationErrors: { value: Object.freeze([...failure.errors]) },
      fileLockPublication: { value: Object.freeze({ lockPath, lockId,
        descriptorCloseObserved: closed, identitySealed: Boolean(snapshot), metadataRemoved: removed, state: 'publication-failed' }) }
    });
    failureOwners.set(failure, session);
    return failure;
  };
  const currentOwned = async (expected, retainOriginalFailure = false) => {
    let stat;
    try { stat = await fs.lstat(lockPath, { bigint: true }); }
    catch (error) {
      if (!retainOriginalFailure) { if (error?.code === 'ENOENT') return null; throw error; }
      remember(error);
      if (!originalResourcesSettled()) throw error;
      let code;
      try { code = error?.code; }
      catch (inspectionError) { retainInspection(inspectionError); throw error; }
      if (!originalResourcesSettled()) throw error;
      if (code === 'ENOENT') return null;
      throw error;
    }
    if (!expected || !regular(stat) || !sameIdentity(identityOf(stat), expected)) {
      throw new Error('File lock metadata identity changed or was not sealed; existing evidence is preserved.');
    }
    return stat;
  };
  const session = Object.freeze({ resourceId, lockPath, isSettled, releaseAfterClose: async () => {
    if (!reconciling) reconciling = (async () => {
      if (isSettled()) { forget(); return { resourceId, settled: true, pending: false }; }
      await closeOriginal();
      if (!resourcesSettled()) throw new Error('Original file lock publication resource observation remains pending.');
      const current = removed ? null : await currentOwned(snapshot, true);
      if (!resourcesSettled()) throw new Error('Original file lock work changed during rollback identity inspection.');
      if (current) {
        const removal = await fs.rm(lockPath, { force: false });
        if (removal !== undefined) throw new Error('Original file lock metadata removal did not confirm its standard void result.');
      }
      removed = true;
      if (!isSettled()) throw new Error('Original file lock work remains unconfirmed after rollback removal.');
      forget();
      return { resourceId, settled: true, pending: false };
    })().finally(() => { reconciling = null; });
    try { return await reconciling; }
    catch (value) {
      remember(value);
      if (retryFailures.length === 64) retryFailures.shift();
      retryFailures.push(value);
      throw retainFailure(value);
    }
  } });
  sessions.add(session);
  try {
    try {
      closeMethod = handle.close;
      if (typeof closeMethod !== 'function') throw new TypeError('File lock publication has no original descriptor close owner.');
    } catch (value) { closeCaptureFailed = true; closeCaptureFailure = value; throw value; }
    statMethod = handle.stat;
    if (typeof statMethod !== 'function') throw new TypeError('File lock publication has no descriptor identity owner.');
    writeMethod = handle.writeFile;
    if (typeof writeMethod !== 'function') throw new TypeError('File lock publication has no original write owner.');
    const before = await statMethod.call(handle, { bigint: true });
    if (!regular(before)) throw new Error('File lock publication requires a known singly linked regular descriptor.');
    original = identityOf(before);
    snapshot = original;
    const named = await fs.lstat(lockPath, { bigint: true });
    if (!regular(named) || !sameIdentity(identityOf(named), original)) throw new Error('File lock pathname changed before publication.');
    await writeMethod.call(handle, contents);
  } catch (value) { fail(value); }
  // This is a new observation of the original descriptor after its write
  // attempt, not a retry of an identity operation that already failed.
  if (original) {
    try {
      const after = await statMethod.call(handle, { bigint: true });
      if (!regular(after) || !sameObject(identityOf(after), original)) throw new Error('File lock descriptor identity changed during publication.');
      snapshot = identityOf(after);
    } catch (value) { snapshot = null; fail(value); }
  }
  try { await closeOriginal(); } catch (value) { if (!closeCaptureFailed) fail(value); }
  if (!hasPrimary && !resourcesSettled()) fail(new Error('File lock publication retains an independent resource owner.'));
  if (!hasPrimary) {
    try {
      const published = await fs.lstat(lockPath, { bigint: true });
      const final = identityOf(published);
      // Last-write timestamps can be committed at descriptor close. Establish
      // the successful immutable metadata snapshot only after confirmed close.
      if (!regular(published) || !sameObject(final, original) || final.size !== BigInt(Buffer.byteLength(contents))
        || final.mode !== snapshot.mode) throw new Error('File lock publication pathname or byte extent changed before admission.');
      snapshot = final;
    } catch (value) { fail(value); }
  }
  if (hasPrimary) throw retainFailure(primary);
  forget();
  let released = false, releasing = null;
  return { lockPath, payload, diagnostics, release: async (_options = {}) => {
    if (released) return false;
    if (!releasing) releasing = (async () => {
      if (!await currentOwned(snapshot)) return false;
      const info = await readInfo(lockPath);
      if (!info || info.lockId !== lockId) return false;
      if (!await currentOwned(snapshot)) return false;
      const removal = await fs.rm(lockPath, { force: false });
      if (removal !== undefined) throw new Error('Original file lock release did not confirm its standard void result.');
      released = true;
      return true;
    })().finally(() => { releasing = null; });
    return releasing;
  } };
};
