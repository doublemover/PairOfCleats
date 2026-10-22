const createLockReleaseFailureError = ({
  lockPath,
  cause,
  releaseResult,
  workerError,
  releaseFailed = false
}) => {
  let causeCode = '';
  try { causeCode = String(cause?.code || cause?.name || ''); } catch {}
  const resultCode = releaseResult === false ? 'RELEASE_RETURNED_FALSE' : 'RELEASE_THROW';
  const detailCode = causeCode || resultCode || 'UNKNOWN';
  const message = [
    `[file-lock] lock release failed for "${lockPath}"`,
    `cause=${detailCode}`
  ].join(' ');
  const error = new Error(message, releaseFailed ? { cause } : undefined);
  error.code = 'ERR_FILE_LOCK_RELEASE_FAILED';
  error.lockPath = lockPath;
  error.causeCode = causeCode;
  error.releaseResult = releaseResult === undefined ? null : releaseResult;
  error.workerError = workerError;
  return error;
};

export const releaseFileLockOrThrow = async (
  lock,
  options = {}
) => {
  const { releaseOptions = undefined } = options;
  const workerError = Object.hasOwn(options, 'workerError') ? options.workerError : null;
  if (!lock || typeof lock.release !== 'function') {
    throw new TypeError('releaseFileLockOrThrow requires a lock with a release() function.');
  }
  let releaseResult = null;
  let releaseError = null;
  let releaseFailed = false;
  try {
    releaseResult = await lock.release(releaseOptions);
  } catch (error) {
    releaseFailed = true;
    releaseError = error;
  }
  if (releaseFailed || releaseResult !== true) {
    throw createLockReleaseFailureError({
      lockPath: typeof lock.lockPath === 'string' ? lock.lockPath : '<unknown-lock>',
      cause: releaseError,
      releaseResult,
      workerError,
      releaseFailed
    });
  }
  return true;
};
