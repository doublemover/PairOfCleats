import { coerceNonNegativeInt } from '../number-coerce.js';

export const FILE_PROGRESS_HEARTBEAT_DEFAULT_MS = 30000;
export const FILE_STALL_SNAPSHOT_DEFAULT_MS = 30000;
export const FILE_STALL_ABORT_DEFAULT_MS = 10 * 60 * 1000;
export const FILE_STALL_ABORT_MIN_MS = 60 * 1000;
export const FILE_STALL_ABORT_CONFIG_MIN_MS = 1000;
export const FILE_STALL_SOFT_KICK_DEFAULT_MS = 2 * 60 * 1000;
export const FILE_STALL_SOFT_KICK_MIN_MS = 1000;
export const FILE_STALL_SOFT_KICK_COOLDOWN_DEFAULT_MS = 30 * 1000;
export const FILE_STALL_SOFT_KICK_MAX_ATTEMPTS_DEFAULT = 2;

const clampDurationMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const coerceOptionalNonNegativeInt = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = coerceNonNegativeInt(value);
  return parsed == null ? null : parsed;
};

const resolveOptionalNonNegativeIntFromValues = (...values) => {
  for (const value of values) {
    const parsed = coerceOptionalNonNegativeInt(value);
    if (parsed != null) return parsed;
  }
  return null;
};

export const resolveStage1WatchdogSourceConfig = (runtime) => {
  const indexingStage1 = runtime?.indexingConfig?.stage1 && typeof runtime.indexingConfig.stage1 === 'object'
    ? runtime.indexingConfig.stage1
    : {};
  const rawWatchdog = indexingStage1?.watchdog && typeof indexingStage1.watchdog === 'object'
    ? indexingStage1.watchdog
    : {};
  const processingWatchdog = rawWatchdog?.stages?.processing && typeof rawWatchdog.stages.processing === 'object'
    ? rawWatchdog.stages.processing
    : {};
  const queueWatchdog = runtime?.stage1Queues?.watchdog && typeof runtime.stage1Queues.watchdog === 'object'
    ? runtime.stage1Queues.watchdog
    : {};
  return {
    indexingStage1,
    rawWatchdog,
    processingWatchdog,
    queueWatchdog
  };
};

export const resolveStage1StallAbortTimeoutMs = (runtime, watchdogConfig = null) => {
  const config = runtime?.stage1Queues?.watchdog || {};
  const configured = coerceOptionalNonNegativeInt(
    config.stallAbortMs ?? config.stallTimeoutMs
  );
  if (configured === 0) return 0;
  if (configured != null) return Math.max(FILE_STALL_ABORT_MIN_MS, configured);
  const hardTimeoutMs = Number(watchdogConfig?.hardTimeoutMs);
  if (Number.isFinite(hardTimeoutMs) && hardTimeoutMs > 0) {
    return Math.max(FILE_STALL_ABORT_MIN_MS, Math.floor(hardTimeoutMs * 2));
  }
  return FILE_STALL_ABORT_DEFAULT_MS;
};

export const resolveStage1StallSoftKickTimeoutMs = ({
  configuredSoftKickMs = null,
  stallAbortMs = 0
} = {}) => {
  if (configuredSoftKickMs === 0) return 0;
  const normalizedAbortMs = Number(stallAbortMs);
  const hasAbortThreshold = Number.isFinite(normalizedAbortMs) && normalizedAbortMs > 0;
  const configured = coerceOptionalNonNegativeInt(configuredSoftKickMs);
  if (!hasAbortThreshold && configured == null) return 0;
  let candidateMs = configured != null
    ? Math.max(FILE_STALL_SOFT_KICK_MIN_MS, configured)
    : (hasAbortThreshold
      ? Math.max(FILE_STALL_SOFT_KICK_MIN_MS, Math.floor(normalizedAbortMs * 0.5))
      : FILE_STALL_SOFT_KICK_DEFAULT_MS);
  if (hasAbortThreshold) {
    const maxAllowedMs = Math.max(1, Math.floor(normalizedAbortMs) - 1000);
    candidateMs = Math.min(candidateMs, maxAllowedMs);
  }
  return Math.max(0, Math.floor(candidateMs));
};

export const resolveStage1HangPolicy = (runtime, watchdogConfig = null) => {
  const {
    indexingStage1,
    rawWatchdog,
    processingWatchdog,
    queueWatchdog
  } = resolveStage1WatchdogSourceConfig(runtime);

  const progressHeartbeatMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.progressHeartbeatMs,
    processingWatchdog.heartbeatMs,
    rawWatchdog.progressHeartbeatMs,
    rawWatchdog.heartbeatMs,
    rawWatchdog.processingHeartbeatMs,
    indexingStage1.progressHeartbeatMs,
    queueWatchdog.progressHeartbeatMs
  ) ?? FILE_PROGRESS_HEARTBEAT_DEFAULT_MS;

  const stallSnapshotMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.stallSnapshotMs,
    processingWatchdog.snapshotMs,
    rawWatchdog.stallSnapshotMs,
    rawWatchdog.snapshotMs,
    rawWatchdog.processingSnapshotMs,
    indexingStage1.stallSnapshotMs,
    queueWatchdog.stallSnapshotMs
  ) ?? FILE_STALL_SNAPSHOT_DEFAULT_MS;

  const configuredStallAbortMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.stallAbortMs,
    processingWatchdog.stallTimeoutMs,
    processingWatchdog.stuckThresholdMs,
    rawWatchdog.stallAbortMs,
    rawWatchdog.stallTimeoutMs,
    rawWatchdog.stuckThresholdMs,
    indexingStage1.stallAbortMs,
    queueWatchdog.stallAbortMs,
    queueWatchdog.stallTimeoutMs
  );
  const stallAbortMs = configuredStallAbortMs === 0
    ? 0
    : (configuredStallAbortMs != null
      ? Math.max(FILE_STALL_ABORT_CONFIG_MIN_MS, configuredStallAbortMs)
      : resolveStage1StallAbortTimeoutMs(runtime, watchdogConfig));

  const configuredSoftKickMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.stallSoftKickMs,
    processingWatchdog.softKickMs,
    processingWatchdog.stuckSoftKickMs,
    rawWatchdog.stallSoftKickMs,
    rawWatchdog.softKickMs,
    rawWatchdog.stuckSoftKickMs,
    indexingStage1.stallSoftKickMs
  );
  const stallSoftKickMs = resolveStage1StallSoftKickTimeoutMs({
    configuredSoftKickMs,
    stallAbortMs
  });

  const stallSoftKickCooldownMs = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.softKickCooldownMs,
    rawWatchdog.softKickCooldownMs,
    indexingStage1.softKickCooldownMs
  ) ?? FILE_STALL_SOFT_KICK_COOLDOWN_DEFAULT_MS;

  const configuredSoftKickMaxAttempts = resolveOptionalNonNegativeIntFromValues(
    processingWatchdog.softKickMaxAttempts,
    rawWatchdog.softKickMaxAttempts,
    indexingStage1.softKickMaxAttempts
  );
  const stallSoftKickMaxAttempts = configuredSoftKickMaxAttempts == null
    ? FILE_STALL_SOFT_KICK_MAX_ATTEMPTS_DEFAULT
    : Math.max(0, Math.floor(configuredSoftKickMaxAttempts));

  return {
    progressHeartbeatMs,
    stallSnapshotMs,
    stallAbortMs,
    stallSoftKickMs,
    stallSoftKickCooldownMs,
    stallSoftKickMaxAttempts
  };
};

export const resolveStage1StallAction = ({
  idleMs = 0,
  hardAbortMs = 0,
  softKickMs = 0,
  softKickAttempts = 0,
  softKickMaxAttempts = 0,
  softKickInFlight = false,
  lastSoftKickAtMs = 0,
  softKickCooldownMs = 0,
  nowMs = Date.now()
} = {}) => {
  const safeIdleMs = clampDurationMs(idleMs);
  const hardThresholdMs = Number(hardAbortMs);
  if (Number.isFinite(hardThresholdMs) && hardThresholdMs > 0 && safeIdleMs >= hardThresholdMs) {
    return { action: 'abort', idleMs: safeIdleMs };
  }
  const softThresholdMs = Number(softKickMs);
  const maxAttempts = Math.max(0, Math.floor(Number(softKickMaxAttempts) || 0));
  if (!Number.isFinite(softThresholdMs) || softThresholdMs <= 0 || maxAttempts <= 0) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_disabled' };
  }
  if (softKickInFlight) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_in_flight' };
  }
  const attempts = Math.max(0, Math.floor(Number(softKickAttempts) || 0));
  if (attempts >= maxAttempts) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_attempts_exhausted' };
  }
  if (safeIdleMs < softThresholdMs) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'below_soft_kick_threshold' };
  }
  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const safeLastSoftKickAtMs = Number.isFinite(Number(lastSoftKickAtMs))
    ? Number(lastSoftKickAtMs)
    : 0;
  const cooldownMs = Math.max(0, Math.floor(Number(softKickCooldownMs) || 0));
  if (cooldownMs > 0 && safeLastSoftKickAtMs > 0 && safeNowMs - safeLastSoftKickAtMs < cooldownMs) {
    return { action: 'none', idleMs: safeIdleMs, reason: 'soft_kick_cooldown' };
  }
  return { action: 'soft-kick', idleMs: safeIdleMs };
};
