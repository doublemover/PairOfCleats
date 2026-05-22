import fs from 'node:fs/promises';
import {
  BENIGN_STALE_REMOVAL_RACE_CODES,
  DEFAULT_FILE_LOCK_STALE_MS
} from './file-lock-constants.js';
import {
  buildOwnerFromLockInfo,
  isInvalidLockInfo,
  isStableStaleSnapshot,
  readLockInfo,
  readLockSnapshot,
  resolveLockPid
} from './file-lock-info.js';
import {
  isProcessAlive,
  removeLockFileIfOwned
} from './file-lock-owner.js';
import { incrementStaleRemoveOwnerFailedForceSucceededMetric } from './file-lock-metrics.js';
import { resolvePositiveStaleMs } from './file-lock-timing.js';

export const isBenignStaleRemovalRace = (error) => {
  const code = String(error?.code || '').toUpperCase();
  return BENIGN_STALE_REMOVAL_RACE_CODES.has(code);
};

export const createStaleRemovalFailureError = ({
  lockPath,
  info,
  pid,
  stale,
  cause,
  phase = 'stale_remove'
}) => {
  const message = [
    `[file-lock] stale lock cleanup failed for "${lockPath}"`,
    `phase=${phase}`,
    `cause=${String(cause?.code || cause?.name || 'UNKNOWN')}`
  ].join(' ');
  const error = new Error(message, { cause });
  error.code = 'ERR_FILE_LOCK_STALE_REMOVE_FAILED';
  error.lockPath = lockPath;
  error.phase = phase;
  error.pid = Number.isFinite(pid) ? pid : null;
  error.stale = Boolean(stale);
  error.causeCode = String(cause?.code || '');
  error.lockInfo = info && typeof info === 'object' ? info : null;
  return error;
};

export const isStructuredStaleRemovalFailureError = (error) => (
  error?.code === 'ERR_FILE_LOCK_STALE_REMOVE_FAILED'
);

export const isLockStale = async (lockPath, staleMs = DEFAULT_FILE_LOCK_STALE_MS) => {
  const maxAge = resolvePositiveStaleMs(staleMs);
  try {
    const info = await readLockInfo(lockPath);
    if (info?.startedAt) {
      const startedAt = Date.parse(info.startedAt);
      if (Number.isFinite(startedAt) && Date.now() - startedAt > maxAge) return true;
    }
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > maxAge;
  } catch {
    return false;
  }
};

export const removeStaleLockFile = async ({
  lockPath,
  info,
  staleMs
}) => {
  const staleOwner = buildOwnerFromLockInfo(info);
  if (!staleOwner) {
    return {
      removed: await removeLockFileIfOwned(lockPath, null, {
        force: true,
        swallowErrors: false
      }),
      removalMode: 'force'
    };
  }
  const before = await readLockSnapshot(lockPath, staleMs);
  const removedByOwner = await removeLockFileIfOwned(lockPath, staleOwner, {
    swallowErrors: false
  });
  if (removedByOwner) {
    return {
      removed: true,
      removalMode: 'owner'
    };
  }
  if (!before.exists) {
    return {
      removed: true,
      removalMode: 'owner'
    };
  }
  const after = await readLockSnapshot(lockPath, staleMs);
  if (!isStableStaleSnapshot(before, after)) {
    return {
      removed: false,
      removalMode: 'owner'
    };
  }
  const forceRemoved = await removeLockFileIfOwned(lockPath, null, {
    force: true,
    swallowErrors: false
  });
  if (forceRemoved) {
    incrementStaleRemoveOwnerFailedForceSucceededMetric();
  }
  return {
    removed: forceRemoved,
    removalMode: forceRemoved ? 'owner-fallback-force' : 'owner'
  };
};

export const shouldCleanupStaleLock = async ({
  lockPath,
  info,
  staleMs,
  forceStaleCleanup,
  invalidLockGraceMs
}) => {
  const pid = resolveLockPid(info);
  const alive = pid ? isProcessAlive(pid) : false;
  const invalidLock = isInvalidLockInfo(info);
  let invalidLockGraceElapsed = false;
  if (invalidLock) {
    const snapshot = await readLockSnapshot(lockPath, staleMs);
    invalidLockGraceElapsed = snapshot.exists && snapshot.ageMs >= invalidLockGraceMs;
  }
  const stale = await isLockStale(lockPath, staleMs);
  const staleCleanup = invalidLockGraceElapsed
    || (stale && (forceStaleCleanup || !pid || (pid && !alive)));
  return {
    pid,
    alive,
    stale,
    staleCleanup,
    shouldCleanup: Boolean((pid && !alive) || staleCleanup)
  };
};
