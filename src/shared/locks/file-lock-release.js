const createLockReleaseFailureError = ({
  lockPath,
  cause = null,
  releaseResult,
  workerError = null
}) => {
  const causeCode = String(cause?.code || cause?.name || '');
  const resultCode = releaseResult === false ? 'RELEASE_RETURNED_FALSE' : 'RELEASE_THROW';
  const detailCode = causeCode || resultCode || 'UNKNOWN';
  const message = [
    `[file-lock] lock release failed for "${lockPath}"`,
    `cause=${detailCode}`
  ].join(' ');
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = 'ERR_FILE_LOCK_RELEASE_FAILED';
  error.lockPath = lockPath;
  error.causeCode = causeCode;
  error.releaseResult = releaseResult === undefined ? null : releaseResult;
  error.workerError = workerError || null;
  return error;
};

export const releaseFileLockOrThrow = async (
  lock,
  { workerError = null, releaseOptions = undefined } = {}
) => {
  if (!lock || typeof lock.release !== 'function') {
    throw new TypeError('releaseFileLockOrThrow requires a lock with a release() function.');
  }
  let releaseResult = null;
  let releaseError = null;
  try {
    releaseResult = await lock.release(releaseOptions);
  } catch (error) {
    releaseError = error;
  }
  if (releaseError || releaseResult !== true) {
    throw createLockReleaseFailureError({
      lockPath: typeof lock.lockPath === 'string' ? lock.lockPath : '<unknown-lock>',
      cause: releaseError,
      releaseResult,
      workerError
    });
  }
  return true;
};
