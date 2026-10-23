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
  requiresLockResourceSettlement,
  resolveLockPid
} from './file-lock-info.js';
import {
  isProcessAlive,
  removeLockFileIfOwned
} from './file-lock-owner.js';
import { incrementStaleRemoveOwnerFailedForceSucceededMetric } from './file-lock-metrics.js';
import { resolvePositiveStaleMs } from './file-lock-timing.js';
import { isFileLockPublicationPending } from './file-lock-publication.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { addStorageFailureContext } from '../storage/operation-error.js';

const readFailureCode = error => {
  const observation = observeStorageResource(error, { phase: 'file-lock-stale-classification' });
  observation.requireSettled();
  let code;
  try { code = observation.primary.code; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return typeof code === 'string' ? code : '';
};

export const isBenignStaleRemovalRace = (error) => {
  const code = readFailureCode(error).toUpperCase();
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
  const observation = observeStorageResource(cause, { phase: 'file-lock-stale-removal' });
  let code = '', name = '', inspection, inspectionPresent = false;
  try {
    const originalCode = observation.primary.code;
    if (typeof originalCode === 'string') code = originalCode;
    if (!code) { const originalName = observation.primary.name; if (typeof originalName === 'string') name = originalName; }
  } catch (value) { inspection = value; inspectionPresent = true; }
  const message = [
    `[file-lock] stale lock cleanup failed for "${lockPath}"`,
    `phase=${phase}`,
    `cause=${code || name || 'UNKNOWN'}`
  ].join(' ');
  const error = new Error(message, { cause });
  error.code = 'ERR_FILE_LOCK_STALE_REMOVE_FAILED';
  error.lockPath = lockPath;
  error.phase = phase;
  error.pid = Number.isFinite(pid) ? pid : null;
  error.stale = Boolean(stale);
  error.causeCode = code;
  error.lockInfo = info && typeof info === 'object' ? info : null;
  const original = inspectionPresent ? observation.retain(inspection, { inspectionPresent: true }) : observation.retain();
  const failure = addStorageFailureContext(error, {}, original, { secondaryPresent: true });
  Object.defineProperty(failure, 'cause', { value: cause, writable: true, configurable: true });
  return failure;
};

export const isStructuredStaleRemovalFailureError = (error) => (
  readFailureCode(error) === 'ERR_FILE_LOCK_STALE_REMOVE_FAILED'
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
  } catch (error) {
    observeStorageResource(error, { phase: 'file-lock-stale' }).requireSettled();
    return false;
  }
};

export const removeStaleLockFile = async ({
  lockPath,
  info,
  staleMs
}) => {
  if (isFileLockPublicationPending(lockPath) || requiresLockResourceSettlement(info)) return { removed: false, removalMode: 'owner' };
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
  if (isFileLockPublicationPending(lockPath) || requiresLockResourceSettlement(info)) return {
    pid: resolveLockPid(info), alive: null, stale: false, staleCleanup: false, shouldCleanup: false
  };
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
