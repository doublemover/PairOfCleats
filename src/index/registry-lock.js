import path from 'node:path';
import {
  acquireFileLock,
  readLockInfo,
  releaseFileLockOrThrow,
  removeLockFileSyncIfOwned
} from '../shared/locks/file-lock.js';
import { attachCleanupSignalHandlers } from '../shared/process-signals.js';
import { runBuildCleanupWithTimeout } from './build/cleanup-timeout.js';

const DEFAULT_STALE_MS = 30 * 60 * 1000;

const resolveDomainName = (domain) => {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!normalized) {
    throw new TypeError('domain is required for registry locks.');
  }
  return normalized;
};

export const resolveRegistryLockPath = (repoCacheRoot, domain) => (
  path.join(repoCacheRoot, 'locks', `${resolveDomainName(domain)}.lock`)
);

export async function acquireRegistryLock({
  repoCacheRoot,
  domain,
  waitMs = 0,
  pollMs = 1000,
  staleMs = DEFAULT_STALE_MS,
  metadata = null,
  log = () => {}
}) {
  const normalizedDomain = resolveDomainName(domain);
  const lockPath = resolveRegistryLockPath(repoCacheRoot, normalizedDomain);
  const lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
    metadata: {
      scope: normalizedDomain,
      ...(metadata && typeof metadata === 'object' ? metadata : {})
    },
    onStale: ({ reason, pid }) => {
      if (reason === 'dead-pid' && Number.isFinite(pid)) {
        log(`Removed stale ${normalizedDomain} lock at ${lockPath} (pid ${pid} not running).`);
        return;
      }
      log(`Removed stale ${normalizedDomain} lock at ${lockPath}.`);
    }
  });
  if (!lock) {
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

  const publicLock = {
    lockPath,
    payload: lock.payload,
    signalCleaned: false,
    _onSignalCleanup: () => {
      if (released) return;
      released = true;
      publicLock.signalCleaned = true;
      detachHandlers();
    },
    release: async () => {
      if (!released) {
        if (publicLock.signalCleaned === true) {
          released = true;
        } else {
          await runBuildCleanupWithTimeout({
            label: `${normalizedDomain}-lock.release`,
            cleanup: () => releaseFileLockOrThrow(lock),
            log,
            swallowTimeout: false
          });
          released = true;
        }
      }
      detachHandlers();
      return true;
    }
  };
  return publicLock;
}

export async function readRegistryLockInfo(repoCacheRoot, domain) {
  return await readLockInfo(resolveRegistryLockPath(repoCacheRoot, domain));
}

export function attachRegistryLockSignalCleanup(
  lock,
  {
    signals = null,
    preserveDefaultTermination = true,
    reemitSignal = null
  } = {}
) {
  if (!lock?.lockPath || !lock?.payload) return () => {};
  const cleanupSync = () => {
    const removed = removeLockFileSyncIfOwned(lock.lockPath, lock.payload);
    if (removed) {
      lock.signalCleaned = true;
      lock._onSignalCleanup?.();
    }
  };
  return attachCleanupSignalHandlers({
    cleanup: cleanupSync,
    signals,
    preserveDefaultTermination,
    reemitSignal
  });
}
