import {
  selectDeterministicWarmupSample
} from '../../../../../chunking/formats/document-common.js';
import {
  resolveEntryOrderIndex
} from '../ordering.js';
import {
  EXTRACTED_PROSE_LOW_YIELD_CODE_COHORTS,
  EXTRACTED_PROSE_LOW_YIELD_HIGH_VALUE_COHORTS,
  EXTRACTED_PROSE_LOW_YIELD_MACHINE_COHORTS,
  buildExtractedProseLowYieldCohort,
  resolveWarmupEntryCohort,
  resolveWarmupEntryExtension,
  resolveWarmupEntryFamily,
  resolveWarmupEntryKey
} from './cohorts.js';
import { compareRepoFingerprintShape } from './fingerprint.js';
import { normalizeLowYieldCohortStats } from './history.js';

const EXTRACTED_PROSE_LOW_YIELD_DOC_SAMPLE_RATIO = 0.5;

const scoreWarmupCohortPriority = ({ cohortKey, history = null, repoFingerprint = null }) => {
  const normalizedHistory = history && typeof history === 'object' ? history : {};
  const cohortHistory = normalizeLowYieldCohortStats(
    normalizedHistory.cohorts?.[cohortKey] || null,
    cohortKey
  );
  const historyHasYield = cohortHistory.yieldedFiles > 0 || cohortHistory.chunkCount > 0;
  const shapeChanged = compareRepoFingerprintShape({
    current: repoFingerprint,
    previous: normalizedHistory.fingerprint,
    cohortKey
  });
  if (EXTRACTED_PROSE_LOW_YIELD_HIGH_VALUE_COHORTS.has(cohortKey)) {
    return historyHasYield || shapeChanged ? 0 : 1;
  }
  if (EXTRACTED_PROSE_LOW_YIELD_MACHINE_COHORTS.has(cohortKey)) {
    return historyHasYield ? 2 : 4;
  }
  if (EXTRACTED_PROSE_LOW_YIELD_CODE_COHORTS.has(cohortKey)) {
    return historyHasYield || shapeChanged ? 2 : 3;
  }
  return 2;
};

const groupWarmupEntriesByFamily = ({ entries, seed }) => {
  const families = new Map();
  for (const entry of entries) {
    const family = resolveWarmupEntryFamily(entry);
    const cohort = resolveWarmupEntryCohort(entry);
    const key = family?.key || '(unknown)';
    if (!families.has(key)) {
      families.set(key, {
        key,
        ext: family?.ext || null,
        pathFamily: family?.pathFamily || null,
        docLike: family?.docLike === true,
        cohortKey: cohort?.key || 'code-comment-heavy',
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

export const buildWarmupFamilyOrderIndices = (entries) => {
  const mapping = {};
  for (const entry of entries || []) {
    const orderIndex = resolveEntryOrderIndex(entry, null);
    if (!Number.isFinite(orderIndex)) continue;
    const family = resolveWarmupEntryFamily(entry);
    const key = family?.key || '(unknown)';
    const bucket = mapping[key] || [];
    bucket.push(Math.floor(orderIndex));
    mapping[key] = bucket;
  }
  return mapping;
};

const takeFamilyEntry = (family, selectedKeys, selectedEntries) => {
  if (!family || !Array.isArray(family.orderedEntries) || family.orderedEntries.length === 0) {
    return false;
  }
  while (family.orderedEntries.length > 0) {
    const candidate = family.orderedEntries.shift();
    const key = resolveWarmupEntryKey(candidate);
    if (!key || selectedKeys.has(key)) continue;
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
  return Array.from(grouped.values()).map((bucket) => bucket[0]).filter(Boolean);
};

const prioritizeWarmupFamilies = ({ familyBuckets, history = null, repoFingerprint = null }) => (
  [...familyBuckets].sort((left, right) => {
    const leftPriority = scoreWarmupCohortPriority({
      cohortKey: left?.cohortKey || 'code-comment-heavy',
      history,
      repoFingerprint
    });
    const rightPriority = scoreWarmupCohortPriority({
      cohortKey: right?.cohortKey || 'code-comment-heavy',
      history,
      repoFingerprint
    });
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftDocLike = left?.docLike === true ? 1 : 0;
    const rightDocLike = right?.docLike === true ? 1 : 0;
    if (leftDocLike !== rightDocLike) return rightDocLike - leftDocLike;
    return String(left?.key || '').localeCompare(String(right?.key || ''));
  })
);

export const selectWarmupEntries = ({
  warmupWindowEntries,
  warmupSampleSize,
  seed,
  history = null,
  repoFingerprint = null
}) => {
  const requested = Math.max(0, Math.floor(Number(warmupSampleSize) || 0));
  if (!Array.isArray(warmupWindowEntries) || !warmupWindowEntries.length || requested <= 0) {
    return [];
  }
  const familyBuckets = prioritizeWarmupFamilies({
    familyBuckets: groupWarmupEntriesByFamily({ entries: warmupWindowEntries, seed }),
    history,
    repoFingerprint
  });
  const docLikeFamilies = familyBuckets.filter((family) => family.docLike === true);
  const docLikeQuota = docLikeFamilies.length > 0
    ? Math.min(requested, Math.max(1, Math.floor(requested * EXTRACTED_PROSE_LOW_YIELD_DOC_SAMPLE_RATIO)))
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
      if (selectedDocLike < docLikeQuota && family.docLike !== true) continue;
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

export const expandWarmupSampleForUnsampledHighValueCohorts = (bailout) => {
  if (!bailout || bailout.enabled !== true) return null;
  const warmupFamilyOrderIndices = bailout.warmupFamilyOrderIndices || {};
  const sampledFamilies = bailout.sampledFamilies || {};
  const selectedOrderIndices = [];
  const deferredFamilies = [];
  const deferredCohorts = [];
  for (const [familyKey, warmupFamily] of Object.entries(bailout.warmupFamilies || {})) {
    const cohort = buildExtractedProseLowYieldCohort({
      relPath: warmupFamily?.pathFamily && warmupFamily?.ext
        ? `${warmupFamily.pathFamily}/synthetic${warmupFamily.ext}`
        : null,
      ext: warmupFamily?.ext,
      pathFamily: warmupFamily?.pathFamily
    });
    const cohortKey = cohort?.key || 'code-comment-heavy';
    if (!EXTRACTED_PROSE_LOW_YIELD_HIGH_VALUE_COHORTS.has(cohortKey)) continue;
    const sampledFamily = sampledFamilies[familyKey] || null;
    const sampledFiles = Math.max(0, Math.floor(Number(sampledFamily?.sampledFiles) || 0));
    if (sampledFiles > 0) continue;
    const candidates = Array.isArray(warmupFamilyOrderIndices[familyKey])
      ? warmupFamilyOrderIndices[familyKey]
      : [];
    const nextOrderIndex = candidates.find((candidate) => (
      !bailout.sampledOrderIndices.has(candidate)
      && !bailout.observedOrderIndices.has(candidate)
    ));
    if (!Number.isFinite(nextOrderIndex)) continue;
    bailout.sampledOrderIndices.add(nextOrderIndex);
    bailout.sampledFamilyByOrderIndex.set(nextOrderIndex, familyKey);
    const current = sampledFamilies[familyKey] || {
      key: familyKey,
      ext: warmupFamily?.ext || null,
      pathFamily: warmupFamily?.pathFamily || null,
      docLike: true,
      sampledFiles: 0,
      observedFiles: 0,
      yieldedFiles: 0,
      chunkCount: 0
    };
    current.sampledFiles += 1;
    sampledFamilies[familyKey] = current;
    selectedOrderIndices.push(nextOrderIndex);
    deferredFamilies.push({
      key: familyKey,
      ext: warmupFamily?.ext || null,
      pathFamily: warmupFamily?.pathFamily || null,
      docLike: warmupFamily?.docLike === true,
      warmupFiles: Math.max(0, Math.floor(Number(warmupFamily?.warmupFiles) || 0)),
      sampledFiles: 0
    });
    if (!deferredCohorts.some((entry) => entry.key === cohortKey)) {
      deferredCohorts.push({
        key: cohortKey,
        warmupFiles: Math.max(0, Math.floor(Number(bailout.warmupCohorts?.[cohortKey]?.warmupFiles) || 0)),
        sampledFiles: 0,
        strategyMismatchRisk: true
      });
    }
  }
  bailout.sampledFamilies = sampledFamilies;
  if (!selectedOrderIndices.length) return null;
  bailout.warmupSampleSize += selectedOrderIndices.length;
  return {
    addedOrderIndices: selectedOrderIndices,
    deferredFamilies,
    deferredCohorts
  };
};
