import {
  releaseFileLockOrThrow,
  removeLockFileSyncIfOwned
} from '../shared/locks/file-lock.js';
import { attachCleanupSignalHandlers } from '../shared/process-signals.js';
import { requiresLockResourceSettlement } from '../shared/locks/file-lock-info.js';
import { isOwnedBuildCleanupTimeout, runBuildCleanupWithTimeout } from './build/cleanup-timeout.js';

export function createLockReleaseHandle({
  lock,
  lockPath = lock?.lockPath,
  releaseLabel,
  releaseTimeoutMs = undefined,
  log = () => {}
}) {
  let released = false;
  let signalCleaned = false;
  let releaseOperation = null;
  const releaseDeadlineOwner = {};
  const handlers = [];
  const cleanupSync = () => {
    if (released) return;
    if (requiresLockResourceSettlement(lock.payload)) return;
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
  // process exit only for process-scoped locks. Resource fences require explicit
  // settled-owner release and survive an unhandled exit or forced parent death.
  registerHandler('exit', cleanupSync);

  const publicLock = {
    lockPath,
    payload: lock.payload,
    get signalCleaned() {
      return signalCleaned;
    },
    set signalCleaned(value) {
      signalCleaned = value;
    },
    _onSignalCleanup: () => {
      if (released) return;
      released = true;
      signalCleaned = true;
      detachHandlers();
    },
    release: async () => {
      if (!released) {
        if (signalCleaned === true) {
          released = true;
        } else {
          if (!releaseOperation) {
            const operation = Promise.resolve().then(() => releaseFileLockOrThrow(lock));
            releaseOperation = operation;
            operation.then(() => {
              released = true;
              detachHandlers();
            }, () => {
              if (releaseOperation === operation) releaseOperation = null;
            });
          }
          const operation = releaseOperation;
          try {
            await runBuildCleanupWithTimeout({
              label: releaseLabel,
              cleanup: () => operation,
              deadlineOwner: releaseDeadlineOwner,
              ...(releaseTimeoutMs === undefined ? {} : { timeoutMs: releaseTimeoutMs }),
              log,
              swallowTimeout: false
            });
          } catch (error) {
            if (isOwnedBuildCleanupTimeout(error, releaseDeadlineOwner) && error.cacheOwnershipPending === true) {
              // This exact deadline observes only our metadata removal promise.
              // It says nothing about an independent child/native resource.
              error.cacheOwnershipReleased = () => released;
            }
            throw error;
          }
        }
      }
      detachHandlers();
      return true;
    }
  };
  return publicLock;
}

export function attachLockSignalCleanup(
  lock,
  {
    signals = null,
    preserveDefaultTermination = true,
    reemitSignal = null
  } = {}
) {
  if (!lock?.lockPath || !lock?.payload) return () => {};
  const cleanupSync = () => {
    if (requiresLockResourceSettlement(lock.payload)) return;
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
