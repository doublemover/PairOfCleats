import { addStorageFailureContext } from '../storage/operation-error.js';

const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const createLockReleaseFailureError = ({
  lock,
  cause,
  releaseResult,
  workerError,
  releaseFailed = false
}) => {
  const error = new Error('[file-lock] lock release remains unconfirmed.', releaseFailed ? { cause } : undefined);
  Object.assign(error, { code: 'ERR_FILE_LOCK_RELEASE_FAILED', causeCode: '',
    releaseResult: releaseResult === undefined ? null : releaseResult, workerError });
  // This pure context owner captures independent original observations before
  // code/name/path diagnostics can replace them. It does not witness metadata
  // removal or authorize another release call on an arbitrary lock.
  let failure = releaseFailed
    ? addStorageFailureContext(error, {}, cause, { secondaryPresent: true }) : error;
  const restoreCause = () => {
    if (releaseFailed) Object.defineProperty(failure, 'cause', { value: cause, writable: true, configurable: true });
    else delete failure.cause;
  };
  restoreCause();
  if (objectLike(workerError) && workerError !== cause) {
    failure = addStorageFailureContext(failure, {}, workerError, { secondaryPresent: true });
    restoreCause();
  }
  const retainInspection = inspection => {
    failure = addStorageFailureContext(failure, {}, inspection, { secondaryPresent: true });
    restoreCause();
  };
  let causeCode = '', lockPath = '<unknown-lock>';
  if (releaseFailed && objectLike(cause)) {
    try {
      const code = cause.code;
      if (typeof code === 'string' && code) causeCode = code;
      else { const name = cause.name; if (typeof name === 'string') causeCode = name; }
    } catch (inspection) { retainInspection(inspection); }
  }
  try { const value = lock.lockPath; if (typeof value === 'string') lockPath = value; }
  catch (inspection) { retainInspection(inspection); }
  const resultCode = releaseResult === false ? 'RELEASE_RETURNED_FALSE' : 'RELEASE_THROW';
  const detailCode = causeCode || resultCode || 'UNKNOWN';
  const message = [
    `[file-lock] lock release failed for "${lockPath}"`,
    `cause=${detailCode}`
  ].join(' ');
  Object.assign(failure, { message, lockPath, causeCode });
  // Original native observers stay captured even if a report consumer replaces
  // public diagnostics. Inspection history remains in the existing composer.
  for (const field of ['cacheOwnershipPending', 'cacheOwnershipReleased']) {
    const descriptor = Object.getOwnPropertyDescriptor(failure, field);
    if (descriptor) Object.defineProperty(failure, field, { ...descriptor, configurable: false,
      ...('value' in descriptor ? { writable: false } : {}) });
  }
  return failure;
};

export const releaseFileLockOrThrow = async (
  lock,
  options = {}
) => {
  const { releaseOptions = undefined } = options;
  const workerError = Object.hasOwn(options, 'workerError') ? options.workerError : null;
  if (!lock) {
    throw new TypeError('releaseFileLockOrThrow requires a lock with a release() function.');
  }
  let release;
  try { release = lock.release; }
  catch (cause) {
    throw createLockReleaseFailureError({ lock, cause, releaseResult: null, workerError, releaseFailed: true });
  }
  if (typeof release !== 'function') throw new TypeError('releaseFileLockOrThrow requires a lock with a release() function.');
  let releaseResult = null;
  let releaseError = null;
  let releaseFailed = false;
  try {
    releaseResult = await release.call(lock, releaseOptions);
  } catch (error) {
    releaseFailed = true;
    releaseError = error;
  }
  if (releaseFailed || releaseResult !== true) {
    throw createLockReleaseFailureError({
      lock,
      cause: releaseError,
      releaseResult,
      workerError,
      releaseFailed
    });
  }
  return true;
};
