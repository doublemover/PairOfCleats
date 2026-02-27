import { acquireFileLock } from '../../src/shared/locks/file-lock.js';

/**
 * Execute callback under a cooperative lock file derived from a directory key.
 *
 * @template T
 * @param {string} lockDir
 * @param {() => Promise<T>} callback
 * @param {{
 *  pollMs?:number,
 *  staleMs?:number,
 *  maxWaitMs?:number,
 *  timeoutMessage?:string
 * }} [options]
 * @returns {Promise<T>}
 */
export const withDirectoryLock = async (
  lockDir,
  callback,
  {
    pollMs = 120,
    staleMs = 15 * 60 * 1000,
    maxWaitMs = 20 * 60 * 1000,
    timeoutMessage = `Timed out waiting for lock at ${lockDir}`
  } = {}
) => {
  const lockPath = `${lockDir}.json`;
  const lock = await acquireFileLock({
    lockPath,
    waitMs: maxWaitMs,
    pollMs,
    staleMs,
    timeoutBehavior: 'throw',
    timeoutMessage,
    forceStaleCleanup: false
  });
  if (!lock) {
    throw new Error(timeoutMessage);
  }
  try {
    return await callback();
  } finally {
    await lock.release({ force: false });
  }
};
