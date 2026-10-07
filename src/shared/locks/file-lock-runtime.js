export {
  DEFAULT_FILE_LOCK_WAIT_MS,
  DEFAULT_FILE_LOCK_POLL_MS,
  DEFAULT_FILE_LOCK_STALE_MS
} from './file-lock-constants.js';

export {
  sleepWithAbort,
  toNonNegativeNumber,
  toPositiveNumber,
  resolveInvalidLockReclaimGraceMs
} from './file-lock-timing.js';

export {
  getFileLockRuntimeMetrics,
  incrementParentMissingRetriesMetric,
  safeInvokeHook,
  resetFileLockRuntimeMetricsForTests
} from './file-lock-metrics.js';

export {
  createLockId,
  createLockPayload,
  readLockInfo,
  readLockInfoSync,
  resolveLockPid
} from './file-lock-info.js';

export {
  isProcessAlive,
  removeLockFileSyncIfOwned
} from './file-lock-owner.js';

export {
  createStaleRemovalFailureError,
  isBenignStaleRemovalRace,
  isLockStale,
  isStructuredStaleRemovalFailureError,
  removeStaleLockFile,
  shouldCleanupStaleLock
} from './file-lock-stale.js';

export {
  releaseFileLockOrThrow
} from './file-lock-release.js';
