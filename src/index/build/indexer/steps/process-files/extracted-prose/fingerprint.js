import {
  EXTRACTED_PROSE_LOW_YIELD_CODE_COHORTS,
  EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS,
  EXTRACTED_PROSE_LOW_YIELD_HIGH_VALUE_COHORTS,
  EXTRACTED_PROSE_LOW_YIELD_MACHINE_COHORTS,
  resolveWarmupEntryCohort
} from './cohorts.js';

export const normalizeRepoFingerprint = (value) => {
  const payload = value && typeof value === 'object' ? value : {};
  const cohortCountsRaw = payload.cohortCounts && typeof payload.cohortCounts === 'object'
    ? payload.cohortCounts
    : {};
  const cohortCounts = {};
  for (const cohortKey of EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS) {
    cohortCounts[cohortKey] = Math.max(0, Math.floor(Number(cohortCountsRaw[cohortKey]) || 0));
  }
  const totalEntries = Object.values(cohortCounts).reduce((sum, count) => sum + count, 0);
  const dominantCohort = EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS
    .slice()
    .sort((left, right) => {
      const delta = cohortCounts[right] - cohortCounts[left];
      if (delta !== 0) return delta;
      return left.localeCompare(right);
    })[0] || null;
  return {
    totalEntries,
    docLikeEntries: Math.max(0, Math.floor(Number(payload.docLikeEntries) || 0)),
    dominantCohort: cohortCounts[dominantCohort] > 0 ? dominantCohort : null,
    cohortCounts
  };
};

export const buildExtractedProseRepoFingerprint = (entries = []) => {
  const cohortCounts = Object.fromEntries(
    EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS.map((cohortKey) => [cohortKey, 0])
  );
  let docLikeEntries = 0;
  for (const entry of entries) {
    const cohort = resolveWarmupEntryCohort(entry);
    if (cohort?.key && Object.prototype.hasOwnProperty.call(cohortCounts, cohort.key)) {
      cohortCounts[cohort.key] += 1;
    }
    if (cohort?.docLike === true) {
      docLikeEntries += 1;
    }
  }
  return normalizeRepoFingerprint({ cohortCounts, docLikeEntries });
};

export const compareRepoFingerprintShape = ({ current = null, previous = null, cohortKey = null } = {}) => {
  const currentFingerprint = normalizeRepoFingerprint(current);
  const previousFingerprint = normalizeRepoFingerprint(previous);
  if (currentFingerprint.totalEntries <= 0 || previousFingerprint.totalEntries <= 0) return false;
  if (
    currentFingerprint.dominantCohort
    && previousFingerprint.dominantCohort
    && currentFingerprint.dominantCohort !== previousFingerprint.dominantCohort
  ) {
    return true;
  }
  if (!cohortKey) return false;
  const currentShare = currentFingerprint.totalEntries > 0
    ? currentFingerprint.cohortCounts[cohortKey] / currentFingerprint.totalEntries
    : 0;
  const previousShare = previousFingerprint.totalEntries > 0
    ? previousFingerprint.cohortCounts[cohortKey] / previousFingerprint.totalEntries
    : 0;
  return Math.abs(currentShare - previousShare) >= 0.2;
};

export const buildFamilyEvidenceSummary = ({
  sampledFamily = null,
  warmupFamily = null,
  historyFamily = null,
  minYieldRatio = 0,
  minYieldedFiles = 1,
  minYieldedChunks = 1
} = {}) => {
  const sampledObservedFiles = Math.max(0, Math.floor(Number(sampledFamily?.observedFiles) || 0));
  const sampledYieldedFiles = Math.max(0, Math.floor(Number(sampledFamily?.yieldedFiles) || 0));
  const sampledChunkCount = Math.max(0, Math.floor(Number(sampledFamily?.chunkCount) || 0));
  const sampledFiles = Math.max(
    sampledObservedFiles,
    Math.max(0, Math.floor(Number(sampledFamily?.sampledFiles) || 0))
  );
  const historyObservedFiles = Math.max(0, Math.floor(Number(historyFamily?.observedFiles) || 0));
  const historyYieldedFiles = Math.max(0, Math.floor(Number(historyFamily?.yieldedFiles) || 0));
  const historyChunkCount = Math.max(0, Math.floor(Number(historyFamily?.chunkCount) || 0));
  const warmupFiles = Math.max(
    sampledFiles,
    Math.max(0, Math.floor(Number(warmupFamily?.warmupFiles) || 0))
  );
  const docLike = sampledFamily?.docLike === true || historyFamily?.docLike === true;
  const historyObservedCap = docLike
    ? Math.max(2, sampledFiles || 2)
    : Math.max(1, Math.ceil(Math.max(1, sampledFiles || 1) / 2));
  const historyYieldedCap = docLike ? Math.max(1, minYieldedFiles) : 1;
  const historyChunkCap = docLike
    ? Math.max(1, minYieldedChunks)
    : Math.max(1, Math.ceil(Math.max(1, minYieldedChunks) / 2));
  const weightedHistoryObservedFiles = Math.min(historyObservedFiles, historyObservedCap);
  const weightedHistoryYieldedFiles = Math.min(historyYieldedFiles, historyYieldedCap);
  const weightedHistoryChunkCount = Math.min(historyChunkCount, historyChunkCap);
  const effectiveObservedFiles = sampledObservedFiles + weightedHistoryObservedFiles;
  const effectiveYieldedFiles = sampledYieldedFiles + weightedHistoryYieldedFiles;
  const effectiveChunkCount = sampledChunkCount + weightedHistoryChunkCount;
  const effectiveYieldRatio = effectiveObservedFiles > 0 ? effectiveYieldedFiles / effectiveObservedFiles : 0;
  const protectedBySample = docLike
    ? sampledYieldedFiles > 0 || sampledChunkCount > 0
    : sampledYieldedFiles >= minYieldedFiles
      || sampledChunkCount >= Math.max(1, Math.ceil(minYieldedChunks / 2))
      || (sampledObservedFiles > 0 && sampledYieldedFiles / sampledObservedFiles >= minYieldRatio);
  const protectedByHistory = effectiveYieldedFiles >= minYieldedFiles
    || effectiveChunkCount >= minYieldedChunks
    || (effectiveObservedFiles > 0 && effectiveYieldRatio >= minYieldRatio);
  const deferDecisionByHistory = docLike
    && warmupFiles > sampledFiles
    && historyYieldedFiles > 0
    && historyChunkCount > 0;
  return {
    key: sampledFamily?.key || historyFamily?.key || '(unknown)',
    ext: sampledFamily?.ext || historyFamily?.ext || null,
    pathFamily: sampledFamily?.pathFamily || historyFamily?.pathFamily || null,
    docLike,
    warmupFiles,
    sampledFiles,
    sampledObservedFiles,
    sampledYieldedFiles,
    sampledChunkCount,
    historyObservedFiles,
    historyYieldedFiles,
    historyChunkCount,
    weightedHistoryObservedFiles,
    weightedHistoryYieldedFiles,
    weightedHistoryChunkCount,
    effectiveObservedFiles,
    effectiveYieldedFiles,
    effectiveChunkCount,
    effectiveYieldRatio,
    protectedBySample,
    protectedByHistory,
    deferDecisionByHistory
  };
};

export const buildCohortEvidenceSummary = ({
  sampledCohort = null,
  warmupCohort = null,
  historyCohort = null,
  repoFingerprint = null,
  historyFingerprint = null,
  minYieldRatio = 0,
  minYieldedFiles = 1,
  minYieldedChunks = 1
} = {}) => {
  const sampledObservedFiles = Math.max(0, Math.floor(Number(sampledCohort?.observedFiles) || 0));
  const sampledYieldedFiles = Math.max(0, Math.floor(Number(sampledCohort?.yieldedFiles) || 0));
  const sampledChunkCount = Math.max(0, Math.floor(Number(sampledCohort?.chunkCount) || 0));
  const sampledFiles = Math.max(
    sampledObservedFiles,
    Math.max(0, Math.floor(Number(sampledCohort?.sampledFiles) || 0))
  );
  const historyObservedFiles = Math.max(0, Math.floor(Number(historyCohort?.observedFiles) || 0));
  const historyYieldedFiles = Math.max(0, Math.floor(Number(historyCohort?.yieldedFiles) || 0));
  const historyChunkCount = Math.max(0, Math.floor(Number(historyCohort?.chunkCount) || 0));
  const warmupFiles = Math.max(
    sampledFiles,
    Math.max(0, Math.floor(Number(warmupCohort?.warmupFiles) || 0))
  );
  const key = String(sampledCohort?.key || warmupCohort?.key || historyCohort?.key || '');
  const docLike = sampledCohort?.docLike === true || warmupCohort?.docLike === true || historyCohort?.docLike === true;
  const sampledYieldRatio = sampledObservedFiles > 0 ? sampledYieldedFiles / sampledObservedFiles : 0;
  const historyYieldRatio = historyObservedFiles > 0 ? historyYieldedFiles / historyObservedFiles : 0;
  const fingerprintShifted = compareRepoFingerprintShape({
    current: repoFingerprint,
    previous: historyFingerprint,
    cohortKey: key
  });
  const highValue = EXTRACTED_PROSE_LOW_YIELD_HIGH_VALUE_COHORTS.has(key);
  const machineHeavy = EXTRACTED_PROSE_LOW_YIELD_MACHINE_COHORTS.has(key);
  const codeHeavy = EXTRACTED_PROSE_LOW_YIELD_CODE_COHORTS.has(key);
  const historyProductive = historyYieldedFiles > 0 || historyChunkCount > 0;
  const sampleProductive = sampledYieldedFiles > 0 || sampledChunkCount > 0;
  const historyLowYield = historyObservedFiles >= Math.max(1, warmupFiles)
    && historyYieldedFiles === 0
    && historyChunkCount === 0;
  const strategyMismatchRisk = ((highValue || codeHeavy) && fingerprintShifted)
    || (highValue && warmupFiles > sampledFiles && historyProductive);
  const expectedYieldClass = sampleProductive || historyProductive || highValue
    ? 'expected-high'
    : machineHeavy && historyLowYield
      ? 'expected-low'
      : codeHeavy && !historyLowYield
        ? 'uncertain'
        : 'likely-low';
  const protectedByHistory = historyProductive;
  const protectedBySample = sampleProductive;
  const protectedByPriority = highValue || strategyMismatchRisk;
  const suppressible = (
    protectedBySample !== true
    && protectedByHistory !== true
    && protectedByPriority !== true
    && (
      machineHeavy === true
      || (codeHeavy === true && historyLowYield === true)
    )
  );
  const suppressionClass = suppressible
    ? (historyLowYield || machineHeavy ? 'genuine-low-yield' : 'likely-low-yield')
    : null;
  return {
    key,
    docLike,
    warmupFiles,
    sampledFiles,
    sampledObservedFiles,
    sampledYieldedFiles,
    sampledChunkCount,
    sampledYieldRatio,
    historyObservedFiles,
    historyYieldedFiles,
    historyChunkCount,
    historyYieldRatio,
    fingerprintShifted,
    expectedYieldClass,
    strategyMismatchRisk,
    protectedBySample,
    protectedByHistory,
    protectedByPriority,
    suppressible,
    suppressionClass,
    minYieldRatio,
    minYieldedFiles,
    minYieldedChunks
  };
};

export const hasMeaningfulCohortEvidence = (cohortState = null) => {
  if (!cohortState || typeof cohortState !== 'object') return false;
  return (
    Math.max(0, Math.floor(Number(cohortState.warmupFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.sampledFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.observedFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.yieldedFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.chunkCount) || 0)) > 0
  );
};
