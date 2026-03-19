const DEFAULT_POLICY_VERSION = '1.0.0';
const DEFAULT_BASE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TIMEOUT_MS = 30 * 60 * 1000;

const HEAVY_LANGUAGE_IDS = new Set([
  'c',
  'cpp',
  'cmake',
  'csharp',
  'go',
  'java',
  'kotlin',
  'protobuf',
  'proto',
  'python',
  'ruby',
  'rust',
  'scala',
  'sql',
  'starlark',
  'swift'
]);

export const PROGRESS_TIMEOUT_POLICY_VERSION = DEFAULT_POLICY_VERSION;

export const PROGRESS_TIMEOUT_CLASSES = Object.freeze({
  noHeartbeat: 'no_heartbeat',
  noQueueMovement: 'no_queue_movement',
  noByteProgress: 'no_byte_progress',
  externalToolTimeout: 'external_tool_timeout',
  parserBatchTimeout: 'parser_batch_timeout',
  repoBudgetExhaustion: 'repo_budget_exhaustion',
  globalWallClockCap: 'global_wall_clock_cap'
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const toPositiveInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const toNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

const normalizeLanguages = (value) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
)).sort((left, right) => left.localeCompare(right));

export const resolveProgressTimeoutRepoTier = ({
  repoFileCount = 0,
  scheduledFileCount = 0
} = {}) => {
  const effectiveCount = Math.max(
    toNonNegativeInt(repoFileCount),
    toNonNegativeInt(scheduledFileCount)
  );
  if (effectiveCount >= 50_000) return 'xlarge';
  if (effectiveCount >= 10_000) return 'large';
  if (effectiveCount >= 2_000) return 'medium';
  return effectiveCount > 0 ? 'small' : 'unknown';
};

export const resolveProgressSlopeScore = ({
  completedUnits = 0,
  totalUnits = 0,
  elapsedMs = 0
} = {}) => {
  const completed = toNonNegativeInt(completedUnits);
  const total = toNonNegativeInt(totalUnits);
  const elapsed = toPositiveInt(elapsedMs);
  if (!elapsed || !total || completed <= 0) return 0;
  const progressRatio = clamp01(completed / Math.max(1, total));
  const unitsPerMinute = completed / Math.max(1, elapsed / 60_000);
  const normalizedRate = clamp01(unitsPerMinute / 25);
  return clamp01((progressRatio * 0.45) + (normalizedRate * 0.55));
};

export const buildProgressTimeoutBudget = ({
  phase = 'unknown',
  baseTimeoutMs = DEFAULT_BASE_TIMEOUT_MS,
  maxTimeoutMs = null,
  repoFileCount = 0,
  scheduledFileCount = 0,
  activeBatchCount = 0,
  languages = [],
  completedUnits = 0,
  totalUnits = 0,
  elapsedMs = 0,
  wallClockCapMs = null,
  policyVersion = DEFAULT_POLICY_VERSION
} = {}) => {
  const normalizedBaseTimeoutMs = Math.max(1, toPositiveInt(baseTimeoutMs, DEFAULT_BASE_TIMEOUT_MS));
  const normalizedMaxTimeoutMs = Math.max(
    normalizedBaseTimeoutMs,
    toPositiveInt(maxTimeoutMs, Math.max(normalizedBaseTimeoutMs, DEFAULT_MAX_TIMEOUT_MS))
  );
  const normalizedLanguages = normalizeLanguages(languages);
  const repoTier = resolveProgressTimeoutRepoTier({ repoFileCount, scheduledFileCount });
  const progressSlopeScore = resolveProgressSlopeScore({
    completedUnits,
    totalUnits,
    elapsedMs
  });

  let multiplier = 1;
  if (repoTier === 'medium') multiplier += 0.2;
  else if (repoTier === 'large') multiplier += 0.55;
  else if (repoTier === 'xlarge') multiplier += 0.95;

  const heavyLanguageCount = normalizedLanguages.filter((languageId) => HEAVY_LANGUAGE_IDS.has(languageId)).length;
  multiplier += Math.min(0.5, heavyLanguageCount * 0.08);

  const activeBatches = toNonNegativeInt(activeBatchCount);
  if (activeBatches > 1) {
    multiplier += Math.min(0.35, Math.log2(activeBatches + 1) * 0.08);
  }

  if (toNonNegativeInt(totalUnits) >= 1_000) {
    multiplier += 0.1;
  }
  if (toNonNegativeInt(totalUnits) >= 10_000) {
    multiplier += 0.15;
  }

  if (progressSlopeScore > 0) {
    multiplier += Math.min(0.35, progressSlopeScore * 0.25);
  }

  const budgetMs = Math.max(
    normalizedBaseTimeoutMs,
    Math.min(normalizedMaxTimeoutMs, Math.round(normalizedBaseTimeoutMs * multiplier))
  );
  return {
    schemaVersion: policyVersion,
    phase: String(phase || 'unknown'),
    repoTier,
    baseTimeoutMs: normalizedBaseTimeoutMs,
    maxTimeoutMs: normalizedMaxTimeoutMs,
    budgetMs,
    wallClockCapMs: toPositiveInt(wallClockCapMs, 0) || null,
    basis: {
      repoFileCount: toNonNegativeInt(repoFileCount),
      scheduledFileCount: toNonNegativeInt(scheduledFileCount),
      activeBatchCount: activeBatches,
      languages: normalizedLanguages,
      completedUnits: toNonNegativeInt(completedUnits),
      totalUnits: toNonNegativeInt(totalUnits),
      elapsedMs: toNonNegativeInt(elapsedMs),
      progressSlopeScore
    }
  };
};

const normalizeAgeMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const evaluateProgressTimeout = ({
  budget = null,
  heartbeatAgeMs = null,
  queueMovementAgeMs = null,
  byteProgressAgeMs = null,
  queueExpected = false,
  byteProgressExpected = false,
  externalToolTimedOut = false,
  parserBatchTimedOut = false,
  repoElapsedMs = null,
  wallClockElapsedMs = null
} = {}) => {
  const resolvedBudget = budget && typeof budget === 'object'
    ? budget
    : buildProgressTimeoutBudget();
  const budgetMs = Math.max(1, toPositiveInt(resolvedBudget.budgetMs, resolvedBudget.baseTimeoutMs));
  const observedProgress = {
    heartbeatAgeMs: normalizeAgeMs(heartbeatAgeMs),
    queueMovementAgeMs: normalizeAgeMs(queueMovementAgeMs),
    byteProgressAgeMs: normalizeAgeMs(byteProgressAgeMs),
    repoElapsedMs: normalizeAgeMs(repoElapsedMs),
    wallClockElapsedMs: normalizeAgeMs(wallClockElapsedMs)
  };

  if (externalToolTimedOut) {
    return {
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.externalToolTimeout,
      budget: resolvedBudget,
      observedProgress
    };
  }
  if (parserBatchTimedOut) {
    return {
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.parserBatchTimeout,
      budget: resolvedBudget,
      observedProgress
    };
  }
  if (
    Number.isFinite(Number(resolvedBudget.wallClockCapMs))
    && Number(resolvedBudget.wallClockCapMs) > 0
    && Number.isFinite(observedProgress.wallClockElapsedMs)
    && observedProgress.wallClockElapsedMs >= Number(resolvedBudget.wallClockCapMs)
  ) {
    return {
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.globalWallClockCap,
      budget: resolvedBudget,
      observedProgress
    };
  }
  if (
    Number.isFinite(observedProgress.repoElapsedMs)
    && observedProgress.repoElapsedMs >= budgetMs
  ) {
    return {
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.repoBudgetExhaustion,
      budget: resolvedBudget,
      observedProgress
    };
  }

  const heartbeatStalled = Number.isFinite(observedProgress.heartbeatAgeMs)
    && observedProgress.heartbeatAgeMs >= budgetMs;
  const queueStalled = Number.isFinite(observedProgress.queueMovementAgeMs)
    && observedProgress.queueMovementAgeMs >= budgetMs;
  const byteStalled = Number.isFinite(observedProgress.byteProgressAgeMs)
    && observedProgress.byteProgressAgeMs >= budgetMs;
  const heartbeatAllowsLiveness = Number.isFinite(observedProgress.heartbeatAgeMs)
    && observedProgress.heartbeatAgeMs < budgetMs;
  const byteAllowsLiveness = byteProgressExpected
    && Number.isFinite(observedProgress.byteProgressAgeMs)
    && observedProgress.byteProgressAgeMs < budgetMs;
  const queueAllowsLiveness = queueExpected
    && Number.isFinite(observedProgress.queueMovementAgeMs)
    && observedProgress.queueMovementAgeMs < budgetMs;

  if (queueExpected && queueStalled && !heartbeatAllowsLiveness && !byteAllowsLiveness) {
    return {
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.noQueueMovement,
      budget: resolvedBudget,
      observedProgress
    };
  }
  if (byteProgressExpected && byteStalled && !heartbeatAllowsLiveness && !queueAllowsLiveness) {
    return {
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.noByteProgress,
      budget: resolvedBudget,
      observedProgress
    };
  }
  if (heartbeatStalled && !queueAllowsLiveness && !byteAllowsLiveness) {
    return {
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.noHeartbeat,
      budget: resolvedBudget,
      observedProgress
    };
  }
  return {
    timedOut: false,
    timeoutClass: null,
    budget: resolvedBudget,
    observedProgress
  };
};
