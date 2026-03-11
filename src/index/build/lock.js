import path from 'node:path';
import {
  acquireFileLock,
  releaseFileLockOrThrow,
  readLockInfo,
  removeLockFileSyncIfOwned
} from '../../shared/locks/file-lock.js';
import { runBuildCleanupWithTimeout } from './cleanup-timeout.js';

const DEFAULT_STALE_MS = 30 * 60 * 1000;

/**
 * Acquire a repo-scoped index lock to prevent concurrent writes.
 * @param {{repoCacheRoot:string,waitMs?:number,pollMs?:number,staleMs?:number,log?:(msg:string)=>void}} input
 * @returns {Promise<{lockPath:string,release:()=>Promise<void>}|null>}
 */
export async function acquireIndexLock({
  repoCacheRoot,
  waitMs = 0,
  pollMs = 1000,
  staleMs = DEFAULT_STALE_MS,
  log = () => {}
}) {
  const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');
  const lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
    metadata: { scope: 'index' },
    onStale: ({ reason, pid }) => {
      if (reason === 'dead-pid' && Number.isFinite(pid)) {
        log(`Removed stale index lock at ${lockPath} (pid ${pid} not running).`);
        return;
      }
      log(`Removed stale index lock at ${lockPath}.`);
    }
  });
  if (!lock) {
    const detailInfo = await readLockInfo(lockPath);
    const detail = detailInfo?.pid ? ` (pid ${detailInfo.pid})` : '';
    log(`Index lock held, skipping build${detail}.`);
    return null;
  }

  let released = false;
  let signalCleaned = false;
  const handlers = [];
  const cleanupSync = () => {
    if (released) return;
    removeLockFileSyncIfOwned(lockPath, lock.payload);
    released = true;
  };
  const registerHandler = (event, handler) => {
    process.once(event, handler);
    handlers.push({ event, handler });
  };
  const detachHandlers = () => {
    for (const entry of handlers) {
      process.off(entry.event, entry.handler);
    }
    handlers.length = 0;
  };
  // Keep library behavior non-authoritative for process lifetime: cleanup on
  // process exit, but do not install signal handlers that force termination.
  registerHandler('exit', cleanupSync);

  const publicLock = {
    lockPath,
    payload: lock.payload,
    signalCleaned: false,
    release: async () => {
      if (!released) {
        if (signalCleaned || publicLock.signalCleaned === true) {
          released = true;
          return true;
        }
        await runBuildCleanupWithTimeout({
          label: 'index-lock.release',
          cleanup: () => releaseFileLockOrThrow(lock),
          log,
          swallowTimeout: false
        });
        released = true;
      }
      detachHandlers();
      return true;
    }
  };
  return publicLock;
}

/**
 * Attach deterministic signal cleanup for an owned index lock without making
 * the low-level lock helper authoritative over process signal ownership.
 *
 * Callers that own process lifecycle can opt in so SIGINT/SIGTERM remove the
 * current lock file synchronously before higher-level abort/exit handling runs.
 *
 * @param {{lockPath?:string,payload?:object}} lock
 * @param {{signals?:string[]}} [options]
 * @returns {() => void}
 */
export function attachIndexLockSignalCleanup(lock, { signals = null } = {}) {
  if (!lock?.lockPath || !lock?.payload) return () => {};
  const events = Array.isArray(signals) && signals.length > 0
    ? signals
    : ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  let detached = false;
  const handlers = [];
  const cleanupSync = () => {
    const removed = removeLockFileSyncIfOwned(lock.lockPath, lock.payload);
    if (removed) {
      lock.signalCleaned = true;
    }
  };
  for (const event of events) {
    const handler = () => cleanupSync();
    process.once(event, handler);
    handlers.push({ event, handler });
  }
  return () => {
    if (detached) return;
    detached = true;
    for (const { event, handler } of handlers) {
      process.off(event, handler);
    }
  };
}
