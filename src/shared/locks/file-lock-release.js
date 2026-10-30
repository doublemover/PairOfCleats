import { addStorageFailureContext } from '../storage/operation-error.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { getPublishedFileLockReleaseObservation, isFileLockPublicationFailureFor,
  getFileLockReleaseFailureObservation, recordFileLockReleaseWrapperFailure,
  retainPublishedFileLockPrerequisite } from './file-lock-producer-observations.js';

const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const createLockReleaseFailureError = ({
  lock,
  cause,
  releaseResult,
  workerError,
  workerObservation = null,
  workerContext = null,
  releaseAttempted = true,
  releaseFailed = false
}) => {
  const error = new Error('[file-lock] lock release remains unconfirmed.', releaseFailed ? { cause } : undefined);
  Object.assign(error, { code: 'ERR_FILE_LOCK_RELEASE_FAILED', causeCode: '',
    releaseResult: releaseResult === undefined ? null : releaseResult, workerError, releaseAttempted });
  // This pure context owner captures independent original observations before
  // code/name/path diagnostics can replace them. It does not witness metadata
  // removal or authorize another release call on an arbitrary lock.
  const published = getPublishedFileLockReleaseObservation(lock);
  // An exact same-owner publication failure already represents this owner's
  // observations. Capture additional worker/inspection errors separately from
  // the owner's private predicate so it cannot feed back into itself later.
  const previous = getFileLockReleaseFailureObservation(cause, lock);
  let failure = previous ? addStorageFailureContext(error, {
    cacheOwnershipPending: true, cacheOwnershipReleased: previous
  }) : releaseFailed && !isFileLockPublicationFailureFor(cause, lock)
    ? addStorageFailureContext(error, {}, cause, { secondaryPresent: true }) : error;
  const restoreCause = () => {
    if (releaseFailed) Object.defineProperty(failure, 'cause', { value: cause, writable: true, configurable: true });
    else delete failure.cause;
  };
  restoreCause();
  if (objectLike(workerError) && !isFileLockPublicationFailureFor(workerError, lock)
    && (workerObservation || workerError !== cause)) {
    failure = addStorageFailureContext(failure, {}, workerContext || (workerObservation ? workerObservation.retain() : workerError),
      { secondaryPresent: true });
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
  const resultCode = !releaseAttempted ? 'RELEASE_NOT_ATTEMPTED'
    : releaseResult === false ? 'RELEASE_RETURNED_FALSE' : 'RELEASE_THROW';
  const detailCode = causeCode || resultCode || 'UNKNOWN';
  const message = [
    `[file-lock] lock release failed for "${lockPath}"`,
    `cause=${detailCode}`
  ].join(' ');
  Object.assign(failure, { message, lockPath, causeCode });
  const independent = Object.getOwnPropertyDescriptor(failure, 'cacheOwnershipReleased')?.value;
  if (published) {
    const session = published.fileLockPublicationSession, isSettled = session.isSettled;
    const resourcesSettled = published.cacheOwnershipReleased;
    failure = addStorageFailureContext(failure, { ...published,
      cacheOwnershipReleased: () => isSettled.call(session) === true && resourcesSettled.call(published) === true
    }, null, {
      nonEnumerable: ['fileLockPublicationSession', 'containedFileSession', 'containedFileSessions'] });
    restoreCause();
    // Return newly observed worker/inspection prerequisites to the same owner
    // before another explicit metadata retry. Both identities are private.
    recordFileLockReleaseWrapperFailure(failure, lock, typeof independent === 'function' ? independent : () => true);
  }
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
  const workerError = Object.hasOwn(options, 'workerError') ? options.workerError : null;
  const previousWorker = getFileLockReleaseFailureObservation(workerError, lock);
  const ownWorkerFailure = isFileLockPublicationFailureFor(workerError, lock);
  const workerValue = previousWorker ? Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: previousWorker })
    : ownWorkerFailure ? getPublishedFileLockReleaseObservation(lock) : workerError;
  const workerObservation = objectLike(workerError)
    ? observeStorageResource(workerValue, { phase: 'file-lock-worker' }) : null;
  if (!lock) {
    throw new TypeError('releaseFileLockOrThrow requires a lock with a release() function.');
  }
  if (workerObservation) {
    if (!ownWorkerFailure) retainPublishedFileLockPrerequisite(lock, Object.freeze({ cacheOwnershipPending: true,
      cacheOwnershipReleased: workerObservation.isSettled }));
    try { workerObservation.requireSettled(); }
    catch (pending) {
      throw createLockReleaseFailureError({ lock, cause: null, releaseResult: null, workerError,
        workerObservation, workerContext: pending, releaseAttempted: false });
    }
  }
  let releaseOptions;
  try { releaseOptions = options.releaseOptions; }
  catch (cause) {
    throw createLockReleaseFailureError({ lock, cause, releaseResult: null, workerError,
      workerObservation, releaseAttempted: false, releaseFailed: true });
  }
  let release;
  try { release = lock.release; }
  catch (cause) {
    throw createLockReleaseFailureError({ lock, cause, releaseResult: null, workerError,
      workerObservation, releaseAttempted: false, releaseFailed: true });
  }
  if (typeof release !== 'function') {
    const cause = new TypeError('releaseFileLockOrThrow requires a lock with a release() function.');
    if (getPublishedFileLockReleaseObservation(lock)) throw createLockReleaseFailureError({ lock, cause,
      releaseResult: null, workerError, workerObservation, releaseAttempted: false, releaseFailed: true });
    throw cause;
  }
  if (workerObservation) {
    try { workerObservation.requireSettled(); }
    catch (pending) {
      throw createLockReleaseFailureError({ lock, cause: null, releaseResult: null, workerError,
        workerObservation, workerContext: pending, releaseAttempted: false });
    }
  }
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
      workerObservation,
      releaseFailed
    });
  }
  return true;
};
