import path from 'node:path';
import {
  acquireFileLock,
  readLockInfo,
  removeLockFileSyncIfOwned
} from '../../shared/locks/file-lock.js';

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
  registerHandler('exit', cleanupSync);
  registerHandler('SIGINT', () => {
    cleanupSync();
    process.exit(130);
  });
  registerHandler('SIGTERM', () => {
    cleanupSync();
    process.exit(143);
  });
  if (process.platform === 'win32') {
    registerHandler('SIGBREAK', () => {
      cleanupSync();
      process.exit(1);
    });
  }

  return {
    lockPath,
    release: async () => {
      if (!released) {
        await lock.release();
        released = true;
      }
      detachHandlers();
    }
  };
}
