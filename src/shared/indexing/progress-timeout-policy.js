const DEFAULT_POLICY_VERSION = '1.1.0';
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

export const PROGRESS_TIMEOUT_OUTCOMES = Object.freeze({
  continueWait: 'continue_wait',
  extendBudget: 'extend_budget',
  hardAbort: 'hard_abort',
  degradeOptional: 'degrade_optional'
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

const toOutcomeDecision = ({
  timedOut,
  timeoutClass = null,
  candidateTimeoutClass = null,
  outcome = PROGRESS_TIMEOUT_OUTCOMES.continueWait,
  decisionReason = 'healthy_progress',
  budget,
  observedProgress,
  extensionBudgetMs = null,
  trace = {}
}) => ({
  timedOut: Boolean(timedOut),
  timeoutClass: timedOut ? timeoutClass : null,
  candidateTimeoutClass: timedOut ? timeoutClass : candidateTimeoutClass,
  outcome,
  decisionReason,
  budget,
  effectiveBudgetMs: Number.isFinite(Number(extensionBudgetMs))
    ? Math.max(Number(budget?.budgetMs) || 0, Math.floor(Number(extensionBudgetMs)))
    : Number(budget?.budgetMs) || 0,
  budgetExtensionMs: Number.isFinite(Number(extensionBudgetMs))
    ? Math.max(0, Math.floor(Number(extensionBudgetMs) - Number(budget?.budgetMs || 0)))
    : 0,
  observedProgress,
  trace: {
    policyVersion: PROGRESS_TIMEOUT_POLICY_VERSION,
    ...(trace && typeof trace === 'object' ? trace : {})
  }
});

const resolveExtensionBudgetMs = ({ budget, stallAgeMs = null } = {}) => {
  const budgetMs = Math.max(1, toPositiveInt(budget?.budgetMs, budget?.baseTimeoutMs));
  const maxTimeoutMs = Math.max(budgetMs, toPositiveInt(budget?.maxTimeoutMs, budgetMs));
  const progressSlopeScore = clamp01(budget?.basis?.progressSlopeScore);
  const activeBatchCount = toNonNegativeInt(budget?.basis?.activeBatchCount);
  const completedUnits = toNonNegativeInt(budget?.basis?.completedUnits);
  const totalUnits = toNonNegativeInt(budget?.basis?.totalUnits);
  const repoTier = String(budget?.repoTier || 'unknown');
  const heavyLanguageCount = Array.isArray(budget?.basis?.languages)
    ? budget.basis.languages.filter((languageId) => HEAVY_LANGUAGE_IDS.has(languageId)).length
    : 0;
  const budgetHeadroomMs = Math.max(0, maxTimeoutMs - budgetMs);
  const progressRatio = totalUnits > 0 ? clamp01(completedUnits / Math.max(1, totalUnits)) : 0;
  const extensionEligible = budgetHeadroomMs > 0 && (
    progressSlopeScore >= 0.12
    || (completedUnits > 0 && (activeBatchCount > 0 || repoTier === 'large' || repoTier === 'xlarge'))
    || progressRatio >= 0.05
  );
  if (!extensionEligible) {
    return {
      eligible: false,
      budgetHeadroomMs,
      extensionBudgetMs: budgetMs,
      progressSlopeScore,
      progressRatio,
      heavyLanguageCount
    };
  }
  let multiplier = 1 + Math.min(0.75, progressSlopeScore * 0.9);
  if (activeBatchCount > 0) multiplier += Math.min(0.2, activeBatchCount * 0.03);
  if (repoTier === 'large') multiplier += 0.1;
  if (repoTier === 'xlarge') multiplier += 0.18;
  if (heavyLanguageCount > 0) multiplier += Math.min(0.12, heavyLanguageCount * 0.03);
  if (progressRatio >= 0.4) multiplier += 0.05;
  const extensionBudgetMs = Math.max(
    budgetMs,
    Math.min(maxTimeoutMs, Math.round(budgetMs * multiplier))
  );
  const extensionSuppressesAbort = Number.isFinite(stallAgeMs)
    ? stallAgeMs < extensionBudgetMs
    : extensionBudgetMs > budgetMs;
  return {
    eligible: true,
    budgetHeadroomMs,
    extensionBudgetMs,
    extensionSuppressesAbort,
    progressSlopeScore,
    progressRatio,
    heavyLanguageCount
  };
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
  wallClockElapsedMs = null,
  optionalPhase = false,
  blockedClass = null,
  blockedReason = null
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
  const traceBase = {
    phase: String(resolvedBudget.phase || 'unknown'),
    queueExpected: Boolean(queueExpected),
    byteProgressExpected: Boolean(byteProgressExpected),
    optionalPhase: Boolean(optionalPhase),
    blockedClass: blockedClass ? String(blockedClass) : null,
    blockedReason: blockedReason ? String(blockedReason) : null,
    thresholds: {
      baseTimeoutMs: Number(resolvedBudget.baseTimeoutMs) || budgetMs,
      budgetMs,
      maxTimeoutMs: Number(resolvedBudget.maxTimeoutMs) || budgetMs,
      wallClockCapMs: Number(resolvedBudget.wallClockCapMs) || null
    },
    basis: resolvedBudget.basis || {}
  };

  if (externalToolTimedOut) {
    return toOutcomeDecision({
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.externalToolTimeout,
      outcome: optionalPhase ? PROGRESS_TIMEOUT_OUTCOMES.degradeOptional : PROGRESS_TIMEOUT_OUTCOMES.hardAbort,
      decisionReason: blockedReason || 'external_tool_timeout',
      budget: resolvedBudget,
      observedProgress,
      trace: {
        ...traceBase,
        terminal: true
      }
    });
  }
  if (parserBatchTimedOut) {
    return toOutcomeDecision({
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.parserBatchTimeout,
      outcome: optionalPhase ? PROGRESS_TIMEOUT_OUTCOMES.degradeOptional : PROGRESS_TIMEOUT_OUTCOMES.hardAbort,
      decisionReason: blockedReason || 'parser_batch_timeout',
      budget: resolvedBudget,
      observedProgress,
      trace: {
        ...traceBase,
        terminal: true
      }
    });
  }
  if (
    Number.isFinite(Number(resolvedBudget.wallClockCapMs))
    && Number(resolvedBudget.wallClockCapMs) > 0
    && Number.isFinite(observedProgress.wallClockElapsedMs)
    && observedProgress.wallClockElapsedMs >= Number(resolvedBudget.wallClockCapMs)
  ) {
    return toOutcomeDecision({
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.globalWallClockCap,
      outcome: PROGRESS_TIMEOUT_OUTCOMES.hardAbort,
      decisionReason: 'wall_clock_cap_reached',
      budget: resolvedBudget,
      observedProgress,
      trace: {
        ...traceBase,
        terminal: true
      }
    });
  }
  if (
    Number.isFinite(observedProgress.repoElapsedMs)
    && observedProgress.repoElapsedMs >= budgetMs
  ) {
    return toOutcomeDecision({
      timedOut: true,
      timeoutClass: PROGRESS_TIMEOUT_CLASSES.repoBudgetExhaustion,
      outcome: PROGRESS_TIMEOUT_OUTCOMES.hardAbort,
      decisionReason: blockedReason || 'repo_budget_exhausted',
      budget: resolvedBudget,
      observedProgress,
      trace: {
        ...traceBase,
        terminal: true
      }
    });
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

  const livenessSignals = {
    heartbeatAllowsLiveness,
    queueAllowsLiveness,
    byteAllowsLiveness,
    heartbeatStalled,
    queueStalled,
    byteStalled
  };

  if (queueExpected && queueStalled && !heartbeatAllowsLiveness && !byteAllowsLiveness) {
    const candidateTimeoutClass = PROGRESS_TIMEOUT_CLASSES.noQueueMovement;
    const stallAgeMs = observedProgress.queueMovementAgeMs;
    const extension = resolveExtensionBudgetMs({ budget: resolvedBudget, stallAgeMs });
    if (extension.extensionSuppressesAbort) {
      return toOutcomeDecision({
        timedOut: false,
        candidateTimeoutClass,
        outcome: PROGRESS_TIMEOUT_OUTCOMES.extendBudget,
        decisionReason: blockedReason || 'queue_progress_extension',
        budget: resolvedBudget,
        observedProgress,
        extensionBudgetMs: extension.extensionBudgetMs,
        trace: {
          ...traceBase,
          livenessSignals,
          extension
        }
      });
    }
    return toOutcomeDecision({
      timedOut: true,
      timeoutClass: candidateTimeoutClass,
      outcome: optionalPhase ? PROGRESS_TIMEOUT_OUTCOMES.degradeOptional : PROGRESS_TIMEOUT_OUTCOMES.hardAbort,
      decisionReason: blockedReason || 'queue_progress_stalled',
      budget: resolvedBudget,
      observedProgress,
      trace: {
        ...traceBase,
        livenessSignals,
        extension
      }
    });
  }
  if (byteProgressExpected && byteStalled && !heartbeatAllowsLiveness && !queueAllowsLiveness) {
    const candidateTimeoutClass = PROGRESS_TIMEOUT_CLASSES.noByteProgress;
    const stallAgeMs = observedProgress.byteProgressAgeMs;
    const extension = resolveExtensionBudgetMs({ budget: resolvedBudget, stallAgeMs });
    if (extension.extensionSuppressesAbort) {
      return toOutcomeDecision({
        timedOut: false,
        candidateTimeoutClass,
        outcome: PROGRESS_TIMEOUT_OUTCOMES.extendBudget,
        decisionReason: blockedReason || 'byte_progress_extension',
        budget: resolvedBudget,
        observedProgress,
        extensionBudgetMs: extension.extensionBudgetMs,
        trace: {
          ...traceBase,
          livenessSignals,
          extension
        }
      });
    }
    return toOutcomeDecision({
      timedOut: true,
      timeoutClass: candidateTimeoutClass,
      outcome: optionalPhase ? PROGRESS_TIMEOUT_OUTCOMES.degradeOptional : PROGRESS_TIMEOUT_OUTCOMES.hardAbort,
      decisionReason: blockedReason || 'byte_progress_stalled',
      budget: resolvedBudget,
      observedProgress,
      trace: {
        ...traceBase,
        livenessSignals,
        extension
      }
    });
  }
  if (heartbeatStalled && !queueAllowsLiveness && !byteAllowsLiveness) {
    const candidateTimeoutClass = PROGRESS_TIMEOUT_CLASSES.noHeartbeat;
    const stallAgeMs = observedProgress.heartbeatAgeMs;
    const extension = resolveExtensionBudgetMs({ budget: resolvedBudget, stallAgeMs });
    if (extension.extensionSuppressesAbort) {
      return toOutcomeDecision({
        timedOut: false,
        candidateTimeoutClass,
        outcome: PROGRESS_TIMEOUT_OUTCOMES.extendBudget,
        decisionReason: blockedReason || 'heartbeat_progress_extension',
        budget: resolvedBudget,
        observedProgress,
        extensionBudgetMs: extension.extensionBudgetMs,
        trace: {
          ...traceBase,
          livenessSignals,
          extension
        }
      });
    }
    return toOutcomeDecision({
      timedOut: true,
      timeoutClass: candidateTimeoutClass,
      outcome: optionalPhase ? PROGRESS_TIMEOUT_OUTCOMES.degradeOptional : PROGRESS_TIMEOUT_OUTCOMES.hardAbort,
      decisionReason: blockedReason || 'heartbeat_stalled',
      budget: resolvedBudget,
      observedProgress,
      trace: {
        ...traceBase,
        livenessSignals,
        extension
      }
    });
  }
  return toOutcomeDecision({
    timedOut: false,
    outcome: PROGRESS_TIMEOUT_OUTCOMES.continueWait,
    decisionReason: 'healthy_progress',
    budget: resolvedBudget,
    observedProgress,
    trace: {
      ...traceBase,
      livenessSignals
    }
  });
};
