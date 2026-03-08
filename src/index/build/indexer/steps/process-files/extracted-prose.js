import { toPosix } from '../../../../../shared/files.js';
import {
  isExtractedProseDocumentLikeExtension,
  normalizeExtractedProseLowYieldBailoutConfig,
  selectDeterministicWarmupSample
} from '../../../../chunking/formats/document-common.js';
import { buildExtractedProseYieldProfileFamily } from '../../../file-processor/skip.js';
import {
  resolveEntryOrderIndex,
  sortEntriesByOrderIndex
} from './ordering.js';

export const EXTRACTED_PROSE_LOW_YIELD_SKIP_REASON = 'extracted-prose-low-yield-bailout';
const EXTRACTED_PROSE_LOW_YIELD_DOC_SAMPLE_RATIO = 0.5;

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

const resolveWarmupEntryKey = (entry) => String(entry?.rel || toPosix(entry?.abs || '') || '');

const resolveWarmupEntryExtension = (entry) => String(entry?.ext || '').trim().toLowerCase();

const resolveWarmupEntryFamily = (entry) => buildExtractedProseYieldProfileFamily({
  relPath: entry?.rel || null,
  absPath: entry?.abs || null,
  ext: resolveWarmupEntryExtension(entry)
});

const groupWarmupEntriesByFamily = ({ entries, seed }) => {
  const families = new Map();
  for (const entry of entries) {
    const family = resolveWarmupEntryFamily(entry);
    const key = family?.key || '(unknown)';
    if (!families.has(key)) {
      families.set(key, {
        key,
        ext: family?.ext || null,
        pathFamily: family?.pathFamily || null,
        docLike: isExtractedProseDocumentLikeExtension(resolveWarmupEntryExtension(entry)),
        entries: []
      });
    }
    families.get(key).entries.push(entry);
  }
  const orderedFamilies = [...families.values()]
    .map((family) => ({
      ...family,
      orderedEntries: selectDeterministicWarmupSample({
        values: family.entries,
        sampleSize: family.entries.length,
        seed: `${seed}|family:${family.key}`,
        resolveKey: resolveWarmupEntryKey
      })
    }))
    .sort((left, right) => {
      const leftDocLike = left.docLike === true ? 1 : 0;
      const rightDocLike = right.docLike === true ? 1 : 0;
      if (leftDocLike !== rightDocLike) return rightDocLike - leftDocLike;
      if (left.key < right.key) return -1;
      if (left.key > right.key) return 1;
      return 0;
    });
  return orderedFamilies;
};

const takeFamilyEntry = (family, selectedKeys, selectedEntries) => {
  if (!family || !Array.isArray(family.orderedEntries) || family.orderedEntries.length === 0) {
    return false;
  }
  while (family.orderedEntries.length > 0) {
    const candidate = family.orderedEntries.shift();
    const key = resolveWarmupEntryKey(candidate);
    if (!key || selectedKeys.has(key)) {
      continue;
    }
    selectedKeys.add(key);
    selectedEntries.push(candidate);
    return true;
  }
  return false;
};

const selectFamilyRepresentativesByPathFamily = (families) => {
  const grouped = new Map();
  for (const family of families || []) {
    const pathFamily = String(family?.pathFamily || '(root)');
    const bucket = grouped.get(pathFamily) || [];
    bucket.push(family);
    grouped.set(pathFamily, bucket);
  }
  return Array.from(grouped.values())
    .map((bucket) => bucket[0])
    .filter(Boolean);
};

const selectWarmupEntries = ({ warmupWindowEntries, warmupSampleSize, seed }) => {
  const requested = Math.max(0, Math.floor(Number(warmupSampleSize) || 0));
  if (!Array.isArray(warmupWindowEntries) || !warmupWindowEntries.length || requested <= 0) {
    return [];
  }
  const familyBuckets = groupWarmupEntriesByFamily({ entries: warmupWindowEntries, seed });
  const docLikeFamilies = familyBuckets.filter((family) => family.docLike === true);
  const docLikeQuota = docLikeFamilies.length > 0
    ? Math.min(
      requested,
      Math.max(1, Math.floor(requested * EXTRACTED_PROSE_LOW_YIELD_DOC_SAMPLE_RATIO))
    )
    : 0;
  const selectedEntries = [];
  const selectedKeys = new Set();
  let selectedDocLike = 0;

  const docLikeRepresentatives = selectFamilyRepresentativesByPathFamily(docLikeFamilies);
  for (const family of docLikeRepresentatives) {
    if (selectedEntries.length >= requested || selectedDocLike >= docLikeQuota) break;
    if (takeFamilyEntry(family, selectedKeys, selectedEntries)) {
      selectedDocLike += 1;
    }
  }

  for (const family of docLikeFamilies) {
    if (selectedEntries.length >= requested || selectedDocLike >= docLikeQuota) break;
    if (takeFamilyEntry(family, selectedKeys, selectedEntries)) {
      selectedDocLike += 1;
    }
  }

  for (const family of familyBuckets) {
    if (selectedEntries.length >= requested) break;
    const before = selectedEntries.length;
    if (takeFamilyEntry(family, selectedKeys, selectedEntries)
      && family.docLike === true
      && before !== selectedEntries.length) {
      selectedDocLike += 1;
    }
  }

  while (selectedEntries.length < requested) {
    let madeProgress = false;
    for (const family of familyBuckets) {
      if (selectedEntries.length >= requested) break;
      if (selectedDocLike < docLikeQuota && family.docLike !== true) {
        continue;
      }
      const before = selectedEntries.length;
      if (takeFamilyEntry(family, selectedKeys, selectedEntries)) {
        madeProgress = true;
        if (family.docLike === true && before !== selectedEntries.length) {
          selectedDocLike += 1;
        }
      }
    }
    if (madeProgress) continue;
    for (const family of familyBuckets) {
      if (selectedEntries.length >= requested) break;
      if (takeFamilyEntry(family, selectedKeys, selectedEntries)) {
        madeProgress = true;
        if (family.docLike === true) selectedDocLike += 1;
      }
    }
    if (!madeProgress) break;
  }
  return selectedEntries;
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
  const sampledEntries = selectWarmupEntries({
    warmupWindowEntries,
    warmupSampleSize,
    seed: config.seed
  });
  const sampledOrderIndices = new Set();
  const sampledFamilies = {};
  const sampledFamilyByOrderIndex = new Map();
  for (const entry of sampledEntries) {
    const orderIndex = resolveEntryOrderIndex(entry, null);
    if (!Number.isFinite(orderIndex)) continue;
    const normalizedOrderIndex = Math.floor(orderIndex);
    sampledOrderIndices.add(normalizedOrderIndex);
    const family = resolveWarmupEntryFamily(entry);
    const familyKey = family?.key || '(unknown)';
    const current = sampledFamilies[familyKey] || {
      key: familyKey,
      ext: family?.ext || null,
      pathFamily: family?.pathFamily || null,
      docLike: isExtractedProseDocumentLikeExtension(resolveWarmupEntryExtension(entry)),
      sampledFiles: 0,
      observedFiles: 0,
      yieldedFiles: 0,
      chunkCount: 0
    };
    current.sampledFiles += 1;
    sampledFamilies[familyKey] = current;
    sampledFamilyByOrderIndex.set(normalizedOrderIndex, familyKey);
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
    sampledFamilyByOrderIndex,
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
  const familyKey = bailout.sampledFamilyByOrderIndex?.get(normalizedOrderIndex);
  if (familyKey) {
    const familyStats = bailout.sampledFamilies?.[familyKey];
    if (familyStats && typeof familyStats === 'object') {
      familyStats.observedFiles += 1;
      if (safeChunkCount > 0) {
        familyStats.yieldedFiles += 1;
      }
      familyStats.chunkCount += safeChunkCount;
      bailout.sampledFamilies[familyKey] = familyStats;
    }
  }
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
  const minYieldedChunks = Math.max(
    minYieldedFiles,
    Math.floor(Number(bailout.config.minYieldedChunks) || 0)
  );
  const lowRatio = observedYieldRatio < bailout.config.minYieldRatio;
  const lowYieldedCount = bailout.yieldedSamples < minYieldedFiles;
  const lowChunkCount = bailout.sampledChunkCount < minYieldedChunks;
  const familySummaries = Object.values(bailout.sampledFamilies || {})
    .filter((familyState) => Number(familyState?.observedFiles) > 0)
    .map((familyState) => {
      const familyObservedFiles = Math.max(0, Math.floor(Number(familyState.observedFiles) || 0));
      const familyYieldedFiles = Math.max(0, Math.floor(Number(familyState.yieldedFiles) || 0));
      const familyChunkCount = Math.max(0, Math.floor(Number(familyState.chunkCount) || 0));
      const familyYieldRatio = familyObservedFiles > 0
        ? familyYieldedFiles / familyObservedFiles
        : 0;
      return {
        key: familyState.key,
        ext: familyState.ext,
        pathFamily: familyState.pathFamily,
        docLike: familyState.docLike === true,
        sampledFiles: Math.max(0, Math.floor(Number(familyState.sampledFiles) || 0)),
        observedFiles: familyObservedFiles,
        yieldedFiles: familyYieldedFiles,
        chunkCount: familyChunkCount,
        yieldRatio: familyYieldRatio
      };
    });
  const familyProtected = familySummaries.some((familyState) => (
    familyState.docLike === true
      ? familyState.yieldedFiles > 0 || familyState.chunkCount > 0
      : familyState.yieldRatio >= bailout.config.minYieldRatio
        || familyState.chunkCount >= Math.max(1, Math.ceil(minYieldedChunks / 2))
  ));
  bailout.decisionMade = true;
  bailout.triggered = lowRatio && lowYieldedCount && lowChunkCount && familyProtected !== true;
  bailout.decisionAtOrderIndex = normalizedOrderIndex;
  bailout.decisionAtMs = Date.now();
  return {
    triggered: bailout.triggered,
    observedYieldRatio,
    yieldedSamples: bailout.yieldedSamples,
    observedSamples: bailout.observedSamples,
    sampledChunkCount: bailout.sampledChunkCount,
    familyProtected,
    sampledFamilies: familySummaries,
    minYieldRatio: bailout.config.minYieldRatio,
    minYieldedFiles,
    minYieldedChunks
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
    minYieldedChunks: bailout.config.minYieldedChunks,
    skippedFiles: bailout.skippedFiles,
    decisionAtOrderIndex: bailout.decisionAtOrderIndex,
    decisionAt: toIsoTimestamp(bailout.decisionAtMs)
  };
};
