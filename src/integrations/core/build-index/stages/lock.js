import { acquireIndexLock } from '../../../../index/build/lock.js';
import { getEnvConfig } from '../../../../shared/env.js';
import { parseNonNegativeInt } from './phase-failures.js';

const DEFAULT_BUILD_INDEX_LOCK_WAIT_MS = 15000;
const DEFAULT_BUILD_INDEX_LOCK_POLL_MS = 250;
const ENV_CONFIG = getEnvConfig();

const BUILD_INDEX_LOCK_WAIT_MS = parseNonNegativeInt(
  ENV_CONFIG.buildIndexLockWaitMs,
  DEFAULT_BUILD_INDEX_LOCK_WAIT_MS
);
const BUILD_INDEX_LOCK_POLL_MS = Math.max(
  1,
  parseNonNegativeInt(
    ENV_CONFIG.buildIndexLockPollMs,
    DEFAULT_BUILD_INDEX_LOCK_POLL_MS
  )
);

/**
 * Acquire the build/index global lock using environment-configured wait/poll.
 *
 * Transition semantics:
 * 1. Wait for lock ownership before any promotion/current pointer mutation.
 * 2. Throw if lock cannot be acquired so the caller fails before state writes.
 * 3. Callers must always release the returned lock in `finally`.
 *
 * @param {{repoCacheRoot:string,log:(line:string)=>void}} input
 * @returns {Promise<{release:()=>Promise<void>}>}
 */
export const acquireBuildIndexLock = async ({ repoCacheRoot, log }) => {
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: BUILD_INDEX_LOCK_WAIT_MS,
    pollMs: BUILD_INDEX_LOCK_POLL_MS,
    log
  });
  if (lock) return lock;
  if (BUILD_INDEX_LOCK_WAIT_MS > 0) {
    log(`[build] Index lock unavailable after waiting ${BUILD_INDEX_LOCK_WAIT_MS}ms.`);
  }
  throw new Error('Index lock unavailable.');
};
