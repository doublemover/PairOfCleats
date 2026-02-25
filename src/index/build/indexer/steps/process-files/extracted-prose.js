import { toPosix } from '../../../../../shared/files.js';
import {
  normalizeExtractedProseLowYieldBailoutConfig,
  selectDeterministicWarmupSample
} from '../../../../chunking/formats/document-common.js';
import {
  resolveEntryOrderIndex,
  sortEntriesByOrderIndex
} from './ordering.js';

export const EXTRACTED_PROSE_LOW_YIELD_SKIP_REASON = 'extracted-prose-low-yield-bailout';

const toIsoTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
};

const resolveExtractedProseLowYieldBailoutConfig = (runtime) => {
  const extractedProseConfig = runtime?.indexingConfig?.extractedProse
    && typeof runtime.indexingConfig.extractedProse === 'object'
    ? runtime.indexingConfig.extractedProse
    : {};
  return normalizeExtractedProseLowYieldBailoutConfig(extractedProseConfig.lowYieldBailout);
};

const normalizeLowYieldHistory = (value) => {
  if (!value || typeof value !== 'object') return null;
  return {
    builds: Math.max(0, Math.floor(Number(value.builds) || 0)),
    observedFiles: Math.max(0, Math.floor(Number(value.observedFiles) || 0)),
    yieldedFiles: Math.max(0, Math.floor(Number(value.yieldedFiles) || 0)),
    chunkCount: Math.max(0, Math.floor(Number(value.chunkCount) || 0))
  };
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
    Math.min(
      Math.floor(config.historyMinObservedFiles),
      Math.max(1, sortedEntries.length)
    )
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
        builds: normalizedHistory.builds
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
  const sampledEntries = selectDeterministicWarmupSample({
    values: warmupWindowEntries,
    sampleSize: warmupSampleSize,
    seed: config.seed,
    resolveKey: (entry) => entry?.rel || toPosix(entry?.abs || '')
  });
  const sampledOrderIndices = new Set();
  for (const entry of sampledEntries) {
    const orderIndex = resolveEntryOrderIndex(entry, null);
    if (!Number.isFinite(orderIndex)) continue;
    sampledOrderIndices.add(Math.floor(orderIndex));
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
    observedOrderIndices: new Set(),
    observedSamples: 0,
    yieldedSamples: 0,
    sampledChunkCount: 0,
    decisionMade: false,
    triggered: false,
    decisionAtOrderIndex: null,
    decisionAtMs: null,
    skippedFiles: 0,
    history: historySummary
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
  const chunkCount = Array.isArray(result?.chunks) ? result.chunks.length : 0;
  const safeChunkCount = Math.max(0, Math.floor(Number(chunkCount) || 0));
  if (safeChunkCount > 0) {
    bailout.yieldedSamples += 1;
  }
  bailout.sampledChunkCount += safeChunkCount;
  if (bailout.decisionMade || bailout.observedSamples < bailout.warmupSampleSize) {
    return null;
  }
  const observedYieldRatio = bailout.observedSamples > 0
    ? bailout.yieldedSamples / bailout.observedSamples
    : 0;
  const minYieldedFiles = Math.min(
    Math.max(1, Math.floor(Number(bailout.config.minYieldedFiles) || 1)),
    Math.max(1, bailout.observedSamples)
  );
  const lowRatio = observedYieldRatio < bailout.config.minYieldRatio;
  const lowYieldedCount = bailout.yieldedSamples < minYieldedFiles;
  bailout.decisionMade = true;
  bailout.triggered = lowRatio && lowYieldedCount;
  bailout.decisionAtOrderIndex = normalizedOrderIndex;
  bailout.decisionAtMs = Date.now();
  return {
    triggered: bailout.triggered,
    observedYieldRatio,
    yieldedSamples: bailout.yieldedSamples,
    observedSamples: bailout.observedSamples,
    sampledChunkCount: bailout.sampledChunkCount,
    minYieldRatio: bailout.config.minYieldRatio,
    minYieldedFiles
  };
};

export const shouldSkipExtractedProseForLowYield = ({ bailout, orderIndex }) => {
  if (!bailout?.enabled || !bailout.triggered) return false;
  if (!Number.isFinite(orderIndex)) return true;
  const normalizedOrderIndex = Math.floor(orderIndex);
  if (bailout.sampledOrderIndices.has(normalizedOrderIndex)) return false;
  if (Number.isFinite(bailout.decisionAtOrderIndex) && normalizedOrderIndex <= bailout.decisionAtOrderIndex) {
    return false;
  }
  return true;
};

export const buildExtractedProseLowYieldBailoutSummary = (bailout) => {
  if (!bailout) return null;
  const observedYieldRatio = bailout.observedSamples > 0
    ? bailout.yieldedSamples / bailout.observedSamples
    : 0;
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
    skippedFiles: bailout.skippedFiles,
    decisionAtOrderIndex: bailout.decisionAtOrderIndex,
    decisionAt: toIsoTimestamp(bailout.decisionAtMs)
  };
};
