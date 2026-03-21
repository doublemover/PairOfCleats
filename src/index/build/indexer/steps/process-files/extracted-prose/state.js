import { normalizeExtractedProseLowYieldBailoutConfig } from '../../../../../chunking/formats/document-common.js';
import { sortEntriesByOrderIndex } from '../ordering.js';
import {
  EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS,
  EXTRACTED_PROSE_LOW_YIELD_SKIP_REASON,
  buildExtractedProseLowYieldCohort,
  createEmptyCohortStats,
  resolveWarmupEntryFamily
} from './cohorts.js';
import {
  buildCohortEvidenceSummary,
  buildExtractedProseRepoFingerprint,
  buildFamilyEvidenceSummary,
  hasMeaningfulCohortEvidence,
  normalizeRepoFingerprint
} from './fingerprint.js';
import {
  buildExtractedProseLowYieldHistory,
  normalizeLowYieldHistory,
  normalizeLowYieldCohortStats
} from './history.js';
import {
  buildWarmupFamilyOrderIndices,
  expandWarmupSampleForUnsampledHighValueCohorts,
  selectWarmupEntries
} from './sampling.js';

const toIsoTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
};

const classifyEstimatedRecallLoss = (ratio) => {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  if (ratio <= 0.05) return 'low';
  if (ratio <= 0.15) return 'moderate';
  if (ratio <= 0.3) return 'high';
  return 'severe';
};

const classifyEstimatedRecallLossConfidence = ({
  strategyMismatchRiskCount = 0,
  suppressedCohorts = []
} = {}) => {
  if (Math.max(0, Math.floor(Number(strategyMismatchRiskCount) || 0)) > 0) return 'low';
  const normalizedSuppressed = Array.isArray(suppressedCohorts) ? suppressedCohorts : [];
  if (!normalizedSuppressed.length) return null;
  const allGenuineLowYield = normalizedSuppressed.every(
    (cohortState) => cohortState?.suppressionClass === 'genuine-low-yield'
  );
  return allGenuineLowYield ? 'high' : 'medium';
};

const buildSuppressedCohortRecallLossEstimates = ({
  suppressedCohorts = [],
  repoFingerprint = null
} = {}) => {
  const normalizedFingerprint = normalizeRepoFingerprint(repoFingerprint);
  return (Array.isArray(suppressedCohorts) ? suppressedCohorts : []).map((cohortState) => {
    const key = String(cohortState?.key || '');
    const repoFiles = Math.max(0, Math.floor(Number(normalizedFingerprint?.cohortCounts?.[key]) || 0));
    const warmupFiles = Math.max(0, Math.floor(Number(cohortState?.warmupFiles) || 0));
    const estimatedSuppressedFiles = Math.max(0, repoFiles - warmupFiles);
    const estimatedRecallLossRatio = normalizedFingerprint.totalEntries > 0
      ? estimatedSuppressedFiles / normalizedFingerprint.totalEntries
      : 0;
    return {
      key,
      suppressionClass: cohortState?.suppressionClass || null,
      expectedYieldClass: typeof cohortState?.expectedYieldClass === 'string'
        ? cohortState.expectedYieldClass
        : 'uncertain',
      warmupFiles,
      sampledFiles: Math.max(0, Math.floor(Number(cohortState?.sampledFiles) || 0)),
      sampledObservedFiles: Math.max(0, Math.floor(Number(cohortState?.sampledObservedFiles) || 0)),
      sampledYieldedFiles: Math.max(0, Math.floor(Number(cohortState?.sampledYieldedFiles) || 0)),
      sampledChunkCount: Math.max(0, Math.floor(Number(cohortState?.sampledChunkCount) || 0)),
      repoFiles,
      estimatedSuppressedFiles,
      estimatedRecallLossRatio: Number.isFinite(estimatedRecallLossRatio) ? estimatedRecallLossRatio : 0
    };
  });
};

const resolveExtractedProseLowYieldBailoutConfig = (runtime) => {
  const extractedProseConfig = runtime?.indexingConfig?.extractedProse
    && typeof runtime.indexingConfig.extractedProse === 'object'
    ? runtime.indexingConfig.extractedProse
    : {};
  return normalizeExtractedProseLowYieldBailoutConfig(extractedProseConfig.lowYieldBailout);
};

export const buildExtractedProseLowYieldBailoutState = ({
  mode,
  runtime,
  entries,
  history = null
}) => {
  if (mode !== 'extracted-prose') return null;
  const config = resolveExtractedProseLowYieldBailoutConfig(runtime);
  const normalizedHistory = normalizeLowYieldHistory(history);
  const sortedEntries = sortEntriesByOrderIndex(entries);
  const historyMinObservedFiles = Math.max(
    1,
    Math.min(Math.floor(config.historyMinObservedFiles), Math.max(1, sortedEntries.length))
  );
  const historyEligible = Boolean(
    normalizedHistory
    && config.enabled !== false
    && normalizedHistory.builds >= Math.max(1, Math.floor(config.historyMinBuilds))
    && normalizedHistory.observedFiles >= historyMinObservedFiles
  );
  const disableForYieldHistory = Boolean(
    historyEligible
    && config.disableWhenHistoryHasYield !== false
    && normalizedHistory.yieldedFiles > 0
  );
  const repoFingerprint = buildExtractedProseRepoFingerprint(sortedEntries);
  if (disableForYieldHistory) {
    return {
      enabled: false,
      config,
      warmupWindowSize: 0,
      warmupSampleSize: 0,
      sampledOrderIndices: new Set(),
      observedOrderIndices: new Set(),
      observedSamples: 0,
      yieldedSamples: 0,
      sampledChunkCount: 0,
      decisionMade: true,
      triggered: false,
      decisionAtOrderIndex: null,
      decisionAtMs: null,
      skippedFiles: 0,
      history: {
        disabledForYieldHistory: true,
        yieldedFiles: normalizedHistory.yieldedFiles,
        observedFiles: normalizedHistory.observedFiles,
        builds: normalizedHistory.builds,
        families: normalizedHistory.families || {},
        cohorts: normalizedHistory.cohorts || {},
        fingerprint: normalizedHistory.fingerprint || null
      }
    };
  }
  const baseWarmupSampleSize = Math.max(
    1,
    Math.min(sortedEntries.length, Math.floor(config.warmupSampleSize))
  );
  let warmupSampleSize = baseWarmupSampleSize;
  let historySummary = null;
  const shouldReduceWarmupForHistory = Boolean(
    historyEligible
    && normalizedHistory
    && normalizedHistory.yieldedFiles === 0
  );
  if (shouldReduceWarmupForHistory) {
    const scaledSample = Math.max(1, Math.floor(baseWarmupSampleSize * config.historyWarmupSampleScale));
    const reducedSample = Math.max(
      1,
      Math.max(Math.floor(config.historyWarmupSampleFloor), scaledSample)
    );
    warmupSampleSize = Math.min(baseWarmupSampleSize, reducedSample);
    if (warmupSampleSize < baseWarmupSampleSize) {
      historySummary = {
        reducedWarmup: true,
        baseWarmupSampleSize,
        observedFiles: normalizedHistory.observedFiles,
        yieldedFiles: normalizedHistory.yieldedFiles,
        builds: normalizedHistory.builds
      };
    }
  }
  const warmupWindowSize = Math.max(
    1,
    Math.min(
      sortedEntries.length,
      Math.max(warmupSampleSize, Math.floor(warmupSampleSize * config.warmupWindowMultiplier))
    )
  );
  const warmupWindowEntries = sortedEntries.slice(0, warmupWindowSize);
  warmupSampleSize = Math.max(0, Math.min(warmupWindowEntries.length, warmupSampleSize));
  const sampledEntries = selectWarmupEntries({
    warmupWindowEntries,
    warmupSampleSize,
    seed: config.seed,
    history: normalizedHistory,
    repoFingerprint
  });
  const sampledOrderIndices = new Set();
  const sampledFamilies = {};
  const sampledFamilyByOrderIndex = new Map();
  const sampledCohorts = {};
  const sampledCohortByOrderIndex = new Map();
  const warmupFamilies = {};
  const warmupCohorts = {};
  for (const entry of warmupWindowEntries) {
    const family = resolveWarmupEntryFamily(entry);
    const familyKey = family?.key || '(unknown)';
    const cohort = buildExtractedProseLowYieldCohort({
      relPath: entry?.rel || null,
      absPath: entry?.abs || null,
      ext: entry?.ext || null,
      pathFamily: family?.pathFamily || null
    });
    const cohortKey = cohort?.key || 'code-comment-heavy';
    const current = warmupFamilies[familyKey] || {
      key: familyKey,
      ext: family?.ext || null,
      pathFamily: family?.pathFamily || null,
      docLike: family?.docLike === true,
      warmupFiles: 0
    };
    current.warmupFiles += 1;
    warmupFamilies[familyKey] = current;
    const cohortCurrent = warmupCohorts[cohortKey] || createEmptyCohortStats(cohort);
    cohortCurrent.warmupFiles += 1;
    warmupCohorts[cohortKey] = normalizeLowYieldCohortStats(cohortCurrent, cohortKey);
  }
  for (const entry of sampledEntries) {
    const orderIndex = Number(entry?.orderIndex);
    if (!Number.isFinite(orderIndex)) continue;
    const normalizedOrderIndex = Math.floor(orderIndex);
    sampledOrderIndices.add(normalizedOrderIndex);
    const family = resolveWarmupEntryFamily(entry);
    const familyKey = family?.key || '(unknown)';
    const cohort = buildExtractedProseLowYieldCohort({
      relPath: entry?.rel || null,
      absPath: entry?.abs || null,
      ext: entry?.ext || null,
      pathFamily: family?.pathFamily || null
    });
    const cohortKey = cohort?.key || 'code-comment-heavy';
    const current = sampledFamilies[familyKey] || {
      key: familyKey,
      ext: family?.ext || null,
      pathFamily: family?.pathFamily || null,
      docLike: family?.docLike === true,
      sampledFiles: 0,
      observedFiles: 0,
      yieldedFiles: 0,
      chunkCount: 0
    };
    current.sampledFiles += 1;
    sampledFamilies[familyKey] = current;
    sampledFamilyByOrderIndex.set(normalizedOrderIndex, familyKey);
    const cohortCurrent = sampledCohorts[cohortKey] || createEmptyCohortStats(cohort);
    cohortCurrent.sampledFiles += 1;
    sampledCohorts[cohortKey] = normalizeLowYieldCohortStats(cohortCurrent, cohortKey);
    sampledCohortByOrderIndex.set(normalizedOrderIndex, cohortKey);
  }
  const hasSufficientWarmupPopulation = sortedEntries.length >= Math.max(
    2,
    Math.floor(config.warmupSampleSize),
    Math.floor(config.minYieldedFiles)
  );
  return {
    enabled: config.enabled !== false
      && sampledOrderIndices.size > 0
      && hasSufficientWarmupPopulation,
    config,
    warmupWindowSize,
    warmupSampleSize,
    sampledOrderIndices,
    sampledFamilies,
    sampledCohorts,
    warmupFamilies,
    warmupCohorts,
    warmupFamilyOrderIndices: buildWarmupFamilyOrderIndices(warmupWindowEntries),
    sampledFamilyByOrderIndex,
    sampledCohortByOrderIndex,
    observedOrderIndices: new Set(),
    observedSamples: 0,
    yieldedSamples: 0,
    sampledChunkCount: 0,
    decisionMade: false,
    triggered: false,
    decisionAtOrderIndex: null,
    decisionAtMs: null,
    skippedFiles: 0,
    history: normalizedHistory
      ? {
        ...(historySummary || {}),
        builds: normalizedHistory.builds,
        observedFiles: normalizedHistory.observedFiles,
        yieldedFiles: normalizedHistory.yieldedFiles,
        chunkCount: normalizedHistory.chunkCount,
        families: normalizedHistory.families || {},
        cohorts: normalizedHistory.cohorts || {},
        fingerprint: normalizedHistory.fingerprint || null
      }
      : historySummary,
    repoFingerprint
  };
};

export const observeExtractedProseLowYieldSample = ({ bailout, orderIndex, result }) => {
  if (!bailout?.enabled) return null;
  if (!Number.isFinite(orderIndex)) return null;
  const normalizedOrderIndex = Math.floor(orderIndex);
  if (!bailout.sampledOrderIndices.has(normalizedOrderIndex)) return null;
  if (bailout.observedOrderIndices.has(normalizedOrderIndex)) return null;
  bailout.observedOrderIndices.add(normalizedOrderIndex);
  bailout.observedSamples += 1;
  const safeChunkCount = Math.max(0, Math.floor(Number(Array.isArray(result?.chunks) ? result.chunks.length : 0) || 0));
  if (safeChunkCount > 0) bailout.yieldedSamples += 1;
  bailout.sampledChunkCount += safeChunkCount;

  const familyKey = bailout.sampledFamilyByOrderIndex?.get(normalizedOrderIndex);
  if (familyKey) {
    const familyStats = bailout.sampledFamilies?.[familyKey];
    if (familyStats && typeof familyStats === 'object') {
      familyStats.observedFiles += 1;
      if (safeChunkCount > 0) familyStats.yieldedFiles += 1;
      familyStats.chunkCount += safeChunkCount;
      bailout.sampledFamilies[familyKey] = familyStats;
    }
  }
  const cohortKey = bailout.sampledCohortByOrderIndex?.get(normalizedOrderIndex);
  if (cohortKey) {
    const cohortStats = bailout.sampledCohorts?.[cohortKey];
    if (cohortStats && typeof cohortStats === 'object') {
      cohortStats.observedFiles += 1;
      if (safeChunkCount > 0) cohortStats.yieldedFiles += 1;
      cohortStats.chunkCount += safeChunkCount;
      bailout.sampledCohorts[cohortKey] = normalizeLowYieldCohortStats(cohortStats, cohortKey);
    }
  }
  if (bailout.decisionMade || bailout.observedSamples < bailout.warmupSampleSize) return null;

  const observedYieldRatio = bailout.observedSamples > 0 ? bailout.yieldedSamples / bailout.observedSamples : 0;
  const minYieldedFiles = Math.min(
    Math.max(1, Math.floor(Number(bailout.config.minYieldedFiles) || 1)),
    Math.max(1, bailout.observedSamples)
  );
  const minYieldedChunks = Math.max(minYieldedFiles, Math.floor(Number(bailout.config.minYieldedChunks) || 0));
  const lowRatio = observedYieldRatio < bailout.config.minYieldRatio;
  const lowYieldedCount = bailout.yieldedSamples < minYieldedFiles;
  const lowChunkCount = bailout.sampledChunkCount < minYieldedChunks;

  const familySummaries = Object.values(bailout.sampledFamilies || {})
    .filter((familyState) => Number(familyState?.observedFiles) > 0)
    .map((familyState) => {
      const familyObservedFiles = Math.max(0, Math.floor(Number(familyState.observedFiles) || 0));
      const familyYieldedFiles = Math.max(0, Math.floor(Number(familyState.yieldedFiles) || 0));
      const familyChunkCount = Math.max(0, Math.floor(Number(familyState.chunkCount) || 0));
      return {
        key: familyState.key,
        ext: familyState.ext,
        pathFamily: familyState.pathFamily,
        docLike: familyState.docLike === true,
        sampledFiles: Math.max(0, Math.floor(Number(familyState.sampledFiles) || 0)),
        observedFiles: familyObservedFiles,
        yieldedFiles: familyYieldedFiles,
        chunkCount: familyChunkCount,
        yieldRatio: familyObservedFiles > 0 ? familyYieldedFiles / familyObservedFiles : 0
      };
    });
  const historyFamilySummaries = Object.values(bailout.history?.families || {})
    .filter((familyState) => Number(familyState?.observedFiles) > 0)
    .map((familyState) => ({
      key: familyState.key,
      ext: familyState.ext,
      pathFamily: familyState.pathFamily,
      docLike: familyState.docLike === true,
      observedFiles: Math.max(0, Math.floor(Number(familyState.observedFiles) || 0)),
      yieldedFiles: Math.max(0, Math.floor(Number(familyState.yieldedFiles) || 0)),
      chunkCount: Math.max(0, Math.floor(Number(familyState.chunkCount) || 0)),
      yieldRatio: Number.isFinite(Number(familyState.yieldRatio)) ? Number(familyState.yieldRatio) : 0
    }));
  const sampledFamilyMap = Object.fromEntries(familySummaries.map((familyState) => [familyState.key, familyState]));
  const historyFamilyMap = Object.fromEntries(historyFamilySummaries.map((familyState) => [familyState.key, familyState]));
  const warmupFamilyMap = Object.fromEntries(Object.values(bailout.warmupFamilies || {}).map((familyState) => [familyState.key, familyState]));
  const sampledCohortMap = Object.fromEntries(Object.values(bailout.sampledCohorts || {}).map((cohortState) => [cohortState.key, cohortState]));
  const historyCohortMap = Object.fromEntries(Object.values(bailout.history?.cohorts || {}).map((cohortState) => [cohortState.key, cohortState]));
  const warmupCohortMap = Object.fromEntries(Object.values(bailout.warmupCohorts || {}).map((cohortState) => [cohortState.key, cohortState]));

  const familyEvidence = Object.values({ ...warmupFamilyMap, ...sampledFamilyMap, ...historyFamilyMap }).map((familyState) => {
    const key = familyState.key;
    return buildFamilyEvidenceSummary({
      sampledFamily: sampledFamilyMap[key] || bailout.sampledFamilies?.[key] || null,
      warmupFamily: warmupFamilyMap[key] || null,
      historyFamily: historyFamilyMap[key] || null,
      minYieldRatio: bailout.config.minYieldRatio,
      minYieldedFiles,
      minYieldedChunks
    });
  });
  const cohortEvidence = EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS
    .filter((cohortKey) => (
      hasMeaningfulCohortEvidence(warmupCohortMap[cohortKey])
      || hasMeaningfulCohortEvidence(sampledCohortMap[cohortKey])
      || hasMeaningfulCohortEvidence(historyCohortMap[cohortKey])
    ))
    .map((cohortKey) => buildCohortEvidenceSummary({
      sampledCohort: sampledCohortMap[cohortKey] || bailout.sampledCohorts?.[cohortKey] || null,
      warmupCohort: warmupCohortMap[cohortKey] || null,
      historyCohort: historyCohortMap[cohortKey] || null,
      repoFingerprint: bailout.repoFingerprint,
      historyFingerprint: bailout.history?.fingerprint || null,
      minYieldRatio: bailout.config.minYieldRatio,
      minYieldedFiles,
      minYieldedChunks
    }));

  const historyProtectedFamilies = familyEvidence.filter((familyState) => familyState.protectedByHistory === true);
  const historyProtected = historyProtectedFamilies.length > 0;
  const historyDeferredFamilies = familyEvidence.filter((familyState) => familyState.deferDecisionByHistory === true);
  const historyDeferred = historyDeferredFamilies.length > 0;
  const familyProtected = familySummaries.some((familyState) => (
    familyState.docLike === true
      ? familyState.yieldedFiles > 0 || familyState.chunkCount > 0
      : familyState.yieldRatio >= bailout.config.minYieldRatio
        || familyState.chunkCount >= Math.max(1, Math.ceil(minYieldedChunks / 2))
  ));
  const warmupDeferred = lowRatio
    && lowYieldedCount
    && lowChunkCount
    && bailout.yieldedSamples === 0
    && familyProtected !== true
    && historyProtected !== true
    && historyDeferred !== true
    ? expandWarmupSampleForUnsampledHighValueCohorts(bailout)
    : null;
  const protectedCohorts = cohortEvidence.filter((cohortState) => (
    cohortState.protectedBySample === true
    || cohortState.protectedByHistory === true
    || cohortState.protectedByPriority === true
  ));
  const strategyMismatchRiskCohorts = cohortEvidence.filter((cohortState) => cohortState.strategyMismatchRisk === true);
  const suppressedCohorts = lowRatio && lowYieldedCount && lowChunkCount
    ? cohortEvidence
      .filter((cohortState) => cohortState.suppressible === true)
      .map((cohortState) => ({
        key: cohortState.key,
        suppressionClass: cohortState.suppressionClass,
        expectedYieldClass: cohortState.expectedYieldClass,
        warmupFiles: cohortState.warmupFiles,
        sampledFiles: cohortState.sampledFiles,
        sampledObservedFiles: cohortState.sampledObservedFiles,
        sampledYieldedFiles: cohortState.sampledYieldedFiles,
        sampledChunkCount: cohortState.sampledChunkCount
      }))
    : [];

  if (warmupDeferred) {
    bailout.lastDecision = {
      triggered: false,
      observedYieldRatio,
      yieldedSamples: bailout.yieldedSamples,
      observedSamples: bailout.observedSamples,
      sampledChunkCount: bailout.sampledChunkCount,
      familyProtected,
      historyProtected,
      historyDeferred,
      warmupDeferred: true,
      warmupDeferredFamilies: warmupDeferred.deferredFamilies,
      warmupDeferredCohorts: warmupDeferred.deferredCohorts,
      sampledFamilies: familySummaries,
      historyFamilies: historyProtectedFamilies,
      historyDeferredFamilies,
      familyEvidence,
      cohortEvidence,
      protectedCohorts,
      suppressedCohorts: [],
      strategyMismatchRiskCohorts,
      minYieldRatio: bailout.config.minYieldRatio,
      minYieldedFiles,
      minYieldedChunks
    };
    return bailout.lastDecision;
  }

  bailout.decisionMade = true;
  bailout.suppressedCohorts = suppressedCohorts;
  bailout.triggered = suppressedCohorts.length > 0;
  bailout.decisionAtOrderIndex = normalizedOrderIndex;
  bailout.decisionAtMs = Date.now();
  bailout.lastDecision = {
    triggered: bailout.triggered,
    observedYieldRatio,
    yieldedSamples: bailout.yieldedSamples,
    observedSamples: bailout.observedSamples,
    sampledChunkCount: bailout.sampledChunkCount,
    familyProtected,
    historyProtected,
    historyDeferred,
    warmupDeferred: false,
    warmupDeferredFamilies: [],
    warmupDeferredCohorts: [],
    sampledFamilies: familySummaries,
    historyFamilies: historyProtectedFamilies,
    historyDeferredFamilies,
    familyEvidence,
    cohortEvidence,
    protectedCohorts,
    suppressedCohorts,
    strategyMismatchRiskCohorts,
    minYieldRatio: bailout.config.minYieldRatio,
    minYieldedFiles,
    minYieldedChunks
  };
  return bailout.lastDecision;
};

export const shouldSkipExtractedProseForLowYield = ({ bailout, orderIndex, entry = null }) => {
  if (!bailout?.enabled || !bailout.triggered) return false;
  if (!Number.isFinite(orderIndex)) return true;
  const normalizedOrderIndex = Math.floor(orderIndex);
  if (bailout.sampledOrderIndices.has(normalizedOrderIndex)) return false;
  if (Number.isFinite(bailout.decisionAtOrderIndex) && normalizedOrderIndex <= bailout.decisionAtOrderIndex) {
    return false;
  }
  const cohort = buildExtractedProseLowYieldCohort({
    relPath: entry?.rel || null,
    absPath: entry?.abs || null,
    ext: entry?.ext || null,
    pathFamily: entry?.family?.pathFamily || null
  });
  const cohortKey = cohort?.key || 'code-comment-heavy';
  return Array.isArray(bailout.suppressedCohorts)
    ? bailout.suppressedCohorts.some((cohortState) => cohortState.key === cohortKey)
    : false;
};

export const buildExtractedProseLowYieldBailoutSummary = (bailout) => {
  if (!bailout) return null;
  const observedYieldRatio = bailout.observedSamples > 0 ? bailout.yieldedSamples / bailout.observedSamples : 0;
  const rawSuppressedCohorts = Array.isArray(bailout.lastDecision?.suppressedCohorts)
    ? bailout.lastDecision.suppressedCohorts
    : [];
  const suppressedCohorts = buildSuppressedCohortRecallLossEstimates({
    suppressedCohorts: rawSuppressedCohorts,
    repoFingerprint: bailout.repoFingerprint
  });
  const protectedCohorts = Array.isArray(bailout.lastDecision?.protectedCohorts)
    ? bailout.lastDecision.protectedCohorts
    : [];
  const strategyMismatchRiskCohorts = Array.isArray(bailout.lastDecision?.strategyMismatchRiskCohorts)
    ? bailout.lastDecision.strategyMismatchRiskCohorts
    : [];
  const estimatedSuppressedFiles = suppressedCohorts.reduce(
    (sum, cohortState) => sum + Math.max(0, Math.floor(Number(cohortState?.estimatedSuppressedFiles) || 0)),
    0
  );
  const normalizedRepoFingerprint = normalizeRepoFingerprint(bailout.repoFingerprint);
  const estimatedRecallLossRatio = normalizedRepoFingerprint.totalEntries > 0
    ? estimatedSuppressedFiles / normalizedRepoFingerprint.totalEntries
    : 0;
  const estimatedRecallLossClass = classifyEstimatedRecallLoss(estimatedRecallLossRatio);
  const estimatedRecallLossConfidence = classifyEstimatedRecallLossConfidence({
    strategyMismatchRiskCount: strategyMismatchRiskCohorts.length,
    suppressedCohorts
  });
  return {
    enabled: bailout.enabled === true,
    triggered: bailout.triggered === true,
    reason: bailout.triggered ? EXTRACTED_PROSE_LOW_YIELD_SKIP_REASON : null,
    qualityImpact: bailout.triggered ? 'reduced-extracted-prose-recall' : null,
    seed: bailout.config.seed,
    warmupWindowSize: bailout.warmupWindowSize,
    warmupSampleSize: bailout.warmupSampleSize,
    sampledFiles: bailout.observedSamples,
    sampledYieldedFiles: bailout.yieldedSamples,
    sampledChunkCount: bailout.sampledChunkCount,
    observedYieldRatio,
    minYieldRatio: bailout.config.minYieldRatio,
    minYieldedFiles: bailout.config.minYieldedFiles,
    minYieldedChunks: bailout.config.minYieldedChunks,
    familyProtected: bailout.lastDecision?.familyProtected === true,
    historyProtected: bailout.lastDecision?.historyProtected === true,
    historyDeferred: bailout.lastDecision?.historyDeferred === true,
    warmupDeferred: bailout.lastDecision?.warmupDeferred === true,
    suppressedCohortCount: suppressedCohorts.length,
    protectedCohortCount: protectedCohorts.length,
    strategyMismatchRiskCount: strategyMismatchRiskCohorts.length,
    estimatedSuppressedFiles,
    estimatedRecallLossRatio,
    estimatedRecallLossClass,
    estimatedRecallLossConfidence,
    skippedFiles: bailout.skippedFiles,
    decisionAtOrderIndex: bailout.decisionAtOrderIndex,
    decisionAt: toIsoTimestamp(bailout.decisionAtMs),
    repoFingerprint: normalizedRepoFingerprint,
    sampledFamilies: Object.values(bailout.sampledFamilies || {}).map((familyState) => ({
      key: familyState.key,
      ext: familyState.ext,
      pathFamily: familyState.pathFamily,
      docLike: familyState.docLike === true,
      sampledFiles: Math.max(0, Math.floor(Number(familyState.sampledFiles) || 0)),
      observedFiles: Math.max(0, Math.floor(Number(familyState.observedFiles) || 0)),
      yieldedFiles: Math.max(0, Math.floor(Number(familyState.yieldedFiles) || 0)),
      chunkCount: Math.max(0, Math.floor(Number(familyState.chunkCount) || 0))
    })),
    historyFamilies: Object.values(bailout.history?.families || {}).map((familyState) => ({
      key: familyState.key,
      ext: familyState.ext,
      pathFamily: familyState.pathFamily,
      docLike: familyState.docLike === true,
      observedFiles: Math.max(0, Math.floor(Number(familyState.observedFiles) || 0)),
      yieldedFiles: Math.max(0, Math.floor(Number(familyState.yieldedFiles) || 0)),
      chunkCount: Math.max(0, Math.floor(Number(familyState.chunkCount) || 0)),
      yieldRatio: Number.isFinite(Number(familyState.yieldRatio)) ? Number(familyState.yieldRatio) : 0
    })),
    historyDeferredFamilies: Array.isArray(bailout.lastDecision?.historyDeferredFamilies)
      ? bailout.lastDecision.historyDeferredFamilies.map((familyState) => ({
        key: familyState.key,
        ext: familyState.ext,
        pathFamily: familyState.pathFamily,
        docLike: familyState.docLike === true,
        warmupFiles: familyState.warmupFiles,
        sampledFiles: familyState.sampledFiles,
        historyObservedFiles: familyState.historyObservedFiles,
        historyYieldedFiles: familyState.historyYieldedFiles,
        historyChunkCount: familyState.historyChunkCount,
        deferDecisionByHistory: familyState.deferDecisionByHistory === true
      }))
      : [],
    warmupDeferredFamilies: Array.isArray(bailout.lastDecision?.warmupDeferredFamilies)
      ? bailout.lastDecision.warmupDeferredFamilies.map((familyState) => ({
        key: familyState.key,
        ext: familyState.ext,
        pathFamily: familyState.pathFamily,
        docLike: familyState.docLike === true,
        warmupFiles: familyState.warmupFiles,
        sampledFiles: familyState.sampledFiles
      }))
      : [],
    warmupDeferredCohorts: Array.isArray(bailout.lastDecision?.warmupDeferredCohorts)
      ? bailout.lastDecision.warmupDeferredCohorts.map((cohortState) => ({
        key: cohortState.key,
        warmupFiles: Math.max(0, Math.floor(Number(cohortState.warmupFiles) || 0)),
        sampledFiles: Math.max(0, Math.floor(Number(cohortState.sampledFiles) || 0)),
        strategyMismatchRisk: cohortState.strategyMismatchRisk === true
      }))
      : [],
    familyEvidence: Array.isArray(bailout.lastDecision?.familyEvidence)
      ? bailout.lastDecision.familyEvidence.map((familyState) => ({ ...familyState }))
      : [],
    cohortEvidence: Array.isArray(bailout.lastDecision?.cohortEvidence)
      ? bailout.lastDecision.cohortEvidence.map((cohortState) => ({ ...cohortState }))
      : [],
    suppressedCohorts: suppressedCohorts.map((cohortState) => ({ ...cohortState })),
    protectedCohorts: protectedCohorts.map((cohortState) => ({
      key: cohortState.key,
      expectedYieldClass: typeof cohortState.expectedYieldClass === 'string'
        ? cohortState.expectedYieldClass
        : 'uncertain',
      strategyMismatchRisk: cohortState.strategyMismatchRisk === true,
      protectedBySample: cohortState.protectedBySample === true,
      protectedByHistory: cohortState.protectedByHistory === true,
      protectedByPriority: cohortState.protectedByPriority === true
    })),
    strategyMismatchRiskCohorts: strategyMismatchRiskCohorts.map((cohortState) => ({
      key: cohortState.key,
      expectedYieldClass: typeof cohortState.expectedYieldClass === 'string'
        ? cohortState.expectedYieldClass
        : 'uncertain'
    }))
  };
};

export { buildExtractedProseLowYieldHistory };
