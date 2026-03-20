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
export const EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS = Object.freeze([
  'docs-markdown',
  'tests-examples',
  'templates-config',
  'generated-machine',
  'code-comment-heavy'
]);
const EXTRACTED_PROSE_LOW_YIELD_DOC_SAMPLE_RATIO = 0.5;
const EXTRACTED_PROSE_LOW_YIELD_GENERATED_PATH_FAMILIES = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'git',
  'generated',
  'gen',
  'target',
  'out'
]);
const EXTRACTED_PROSE_LOW_YIELD_TEST_PATH_FAMILIES = new Set([
  'test',
  'tests',
  'spec',
  'specs',
  'example',
  'examples',
  'sample',
  'samples',
  'demo',
  'demos',
  'fixture',
  'fixtures',
  'benchmark',
  'benchmarks'
]);
const EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_PATH_FAMILIES = new Set([
  'config',
  'configs',
  '.github',
  '.gitlab',
  '.vscode',
  '.idea',
  'template',
  'templates'
]);
const EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_EXTENSIONS = new Set([
  '.conf',
  '.cfg',
  '.ini',
  '.toml',
  '.yaml',
  '.yml',
  '.json',
  '.jsonc',
  '.properties',
  '.xml',
  '.html',
  '.htm',
  '.mustache',
  '.hbs',
  '.handlebars',
  '.liquid',
  '.njk',
  '.jinja',
  '.jinja2',
  '.tpl',
  '.tmpl'
]);
const EXTRACTED_PROSE_LOW_YIELD_HIGH_VALUE_COHORTS = new Set([
  'docs-markdown',
  'tests-examples',
  'templates-config'
]);
const EXTRACTED_PROSE_LOW_YIELD_MACHINE_COHORTS = new Set([
  'generated-machine'
]);
const EXTRACTED_PROSE_LOW_YIELD_CODE_COHORTS = new Set([
  'code-comment-heavy'
]);

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
const normalizePathFamily = (value) => String(value || '(root)').trim().toLowerCase() || '(root)';
const normalizeWarmupPath = (value) => {
  const normalized = toPosix(String(value || '')).trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};
const resolveWarmupPathSegments = (value) => normalizeWarmupPath(value)
  .replace(/^\/+/, '')
  .split('/')
  .filter(Boolean);

const resolveWarmupEntryFamily = (entry) => buildExtractedProseYieldProfileFamily({
  relPath: entry?.rel || null,
  absPath: entry?.abs || null,
  ext: resolveWarmupEntryExtension(entry)
});

const resolveExtractedProseLowYieldCohortKey = ({
  relPath = null,
  absPath = null,
  ext = null,
  pathFamily = null
} = {}) => {
  const normalizedPath = normalizeWarmupPath(relPath || absPath || '');
  const normalizedExt = resolveWarmupEntryExtension({ ext });
  const normalizedFamily = normalizePathFamily(pathFamily);
  const segments = resolveWarmupPathSegments(normalizedPath);
  const fileName = segments.length > 0 ? segments[segments.length - 1] : '';
  const docLike = isExtractedProseDocumentLikeExtension(normalizedExt);
  if (
    EXTRACTED_PROSE_LOW_YIELD_GENERATED_PATH_FAMILIES.has(normalizedFamily)
    || segments.some((segment) => EXTRACTED_PROSE_LOW_YIELD_GENERATED_PATH_FAMILIES.has(segment))
    || fileName.includes('.min.')
    || fileName.endsWith('.map')
    || fileName.endsWith('.lock')
  ) {
    return 'generated-machine';
  }
  if (
    EXTRACTED_PROSE_LOW_YIELD_TEST_PATH_FAMILIES.has(normalizedFamily)
    || segments.some((segment) => EXTRACTED_PROSE_LOW_YIELD_TEST_PATH_FAMILIES.has(segment))
  ) {
    return 'tests-examples';
  }
  if (
    EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_PATH_FAMILIES.has(normalizedFamily)
    || segments.some((segment) => EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_PATH_FAMILIES.has(segment))
    || EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_EXTENSIONS.has(normalizedExt)
  ) {
    return docLike && normalizedFamily === 'docs' ? 'docs-markdown' : 'templates-config';
  }
  if (docLike) return 'docs-markdown';
  return 'code-comment-heavy';
};

export const buildExtractedProseLowYieldCohort = ({
  relPath = null,
  absPath = null,
  ext = null,
  pathFamily = null
} = {}) => {
  const normalizedPath = normalizeWarmupPath(relPath || absPath || '');
  const normalizedExt = resolveWarmupEntryExtension({ ext });
  const normalizedFamily = normalizePathFamily(pathFamily);
  const key = resolveExtractedProseLowYieldCohortKey({
    relPath,
    absPath,
    ext,
    pathFamily: normalizedFamily
  });
  return {
    key,
    ext: normalizedExt || null,
    pathFamily: normalizedFamily,
    docLike: isExtractedProseDocumentLikeExtension(normalizedExt),
    pathHint: normalizedPath || null
  };
};

const resolveWarmupEntryCohort = (entry) => {
  const family = resolveWarmupEntryFamily(entry);
  return buildExtractedProseLowYieldCohort({
    relPath: entry?.rel || null,
    absPath: entry?.abs || null,
    ext: resolveWarmupEntryExtension(entry),
    pathFamily: family?.pathFamily || null
  });
};

const createEmptyCohortStats = (cohort = null) => ({
  key: cohort?.key || null,
  ext: cohort?.ext || null,
  pathFamily: cohort?.pathFamily || null,
  docLike: cohort?.docLike === true,
  warmupFiles: 0,
  sampledFiles: 0,
  observedFiles: 0,
  yieldedFiles: 0,
  chunkCount: 0
});

const normalizeLowYieldCohortStats = (value, fallbackKey = null) => {
  const observedFiles = Math.max(0, Math.floor(Number(value?.observedFiles) || 0));
  const yieldedFiles = Math.min(observedFiles, Math.max(0, Math.floor(Number(value?.yieldedFiles) || 0)));
  const chunkCount = Math.max(0, Math.floor(Number(value?.chunkCount) || 0));
  return {
    key: String(value?.key || fallbackKey || ''),
    ext: typeof value?.ext === 'string' ? value.ext : null,
    pathFamily: typeof value?.pathFamily === 'string' ? value.pathFamily : null,
    docLike: value?.docLike === true,
    warmupFiles: Math.max(0, Math.floor(Number(value?.warmupFiles) || 0)),
    sampledFiles: Math.max(0, Math.floor(Number(value?.sampledFiles) || 0)),
    observedFiles,
    yieldedFiles,
    chunkCount,
    yieldRatio: observedFiles > 0 ? yieldedFiles / observedFiles : 0
  };
};

const normalizeRepoFingerprint = (value) => {
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

const buildExtractedProseRepoFingerprint = (entries = []) => {
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

const compareRepoFingerprintShape = ({ current = null, previous = null, cohortKey = null } = {}) => {
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
        docLike: isExtractedProseDocumentLikeExtension(resolveWarmupEntryExtension(entry)),
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

const buildWarmupFamilyOrderIndices = (entries) => {
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

const selectWarmupEntries = ({
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
  const families = value.families && typeof value.families === 'object'
    ? value.families
    : {};
  const cohorts = value.cohorts && typeof value.cohorts === 'object'
    ? value.cohorts
    : {};
  const normalizedFamilies = {};
  for (const [familyKey, familyStats] of Object.entries(families)) {
    if (!familyKey || !familyStats || typeof familyStats !== 'object') continue;
    const observedFiles = Math.max(0, Math.floor(Number(familyStats.observedFiles) || 0));
    const yieldedFiles = Math.min(observedFiles, Math.max(0, Math.floor(Number(familyStats.yieldedFiles) || 0)));
    const chunkCount = Math.max(0, Math.floor(Number(familyStats.chunkCount) || 0));
    const [ext = null, pathFamily = null] = String(familyKey).split('|');
    normalizedFamilies[familyKey] = {
      key: familyKey,
      ext,
      pathFamily,
      observedFiles,
      yieldedFiles,
      chunkCount,
      yieldRatio: observedFiles > 0 ? yieldedFiles / observedFiles : 0,
      docLike: isExtractedProseDocumentLikeExtension(ext)
    };
  }
  const derivedCohorts = {};
  for (const familyState of Object.values(normalizedFamilies)) {
    const cohort = buildExtractedProseLowYieldCohort({
      relPath: familyState.pathFamily && familyState.ext
        ? `${familyState.pathFamily}/synthetic${familyState.ext}`
        : null,
      ext: familyState.ext,
      pathFamily: familyState.pathFamily
    });
    const current = normalizeLowYieldCohortStats(derivedCohorts[cohort.key] || null, cohort.key);
    derivedCohorts[cohort.key] = normalizeLowYieldCohortStats({
      ...current,
      key: cohort.key,
      ext: cohort.ext,
      pathFamily: cohort.pathFamily,
      docLike: cohort.docLike,
      observedFiles: current.observedFiles + familyState.observedFiles,
      yieldedFiles: current.yieldedFiles + familyState.yieldedFiles,
      chunkCount: current.chunkCount + familyState.chunkCount
    }, cohort.key);
  }
  const normalizedCohorts = {};
  for (const cohortKey of EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS) {
    normalizedCohorts[cohortKey] = normalizeLowYieldCohortStats(
      cohorts[cohortKey] || derivedCohorts[cohortKey] || { key: cohortKey },
      cohortKey
    );
  }
  return {
    builds: Math.max(0, Math.floor(Number(value.builds) || 0)),
    observedFiles: Math.max(0, Math.floor(Number(value.observedFiles) || 0)),
    yieldedFiles: Math.max(0, Math.floor(Number(value.yieldedFiles) || 0)),
    chunkCount: Math.max(0, Math.floor(Number(value.chunkCount) || 0)),
    families: normalizedFamilies,
    cohorts: normalizedCohorts,
    fingerprint: normalizeRepoFingerprint(value.fingerprint)
  };
};

export const buildExtractedProseLowYieldHistory = (value) => normalizeLowYieldHistory(value);

const buildFamilyEvidenceSummary = ({
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
  const historyYieldedCap = docLike
    ? Math.max(1, minYieldedFiles)
    : 1;
  const historyChunkCap = docLike
    ? Math.max(1, minYieldedChunks)
    : Math.max(1, Math.ceil(Math.max(1, minYieldedChunks) / 2));
  const weightedHistoryObservedFiles = Math.min(historyObservedFiles, historyObservedCap);
  const weightedHistoryYieldedFiles = Math.min(historyYieldedFiles, historyYieldedCap);
  const weightedHistoryChunkCount = Math.min(historyChunkCount, historyChunkCap);
  const effectiveObservedFiles = sampledObservedFiles + weightedHistoryObservedFiles;
  const effectiveYieldedFiles = sampledYieldedFiles + weightedHistoryYieldedFiles;
  const effectiveChunkCount = sampledChunkCount + weightedHistoryChunkCount;
  const effectiveYieldRatio = effectiveObservedFiles > 0
    ? effectiveYieldedFiles / effectiveObservedFiles
    : 0;
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

const buildCohortEvidenceSummary = ({
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
  const strategyMismatchRisk = (
    (highValue || codeHeavy) && fingerprintShifted
  ) || (highValue && warmupFiles > sampledFiles && historyProductive);
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

const hasMeaningfulCohortEvidence = (cohortState = null) => {
  if (!cohortState || typeof cohortState !== 'object') return false;
  return (
    Math.max(0, Math.floor(Number(cohortState.warmupFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.sampledFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.observedFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.yieldedFiles) || 0)) > 0
    || Math.max(0, Math.floor(Number(cohortState.chunkCount) || 0)) > 0
  );
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
    const cohort = resolveWarmupEntryCohort(entry);
    const cohortKey = cohort?.key || 'code-comment-heavy';
    const current = warmupFamilies[familyKey] || {
      key: familyKey,
      ext: family?.ext || null,
      pathFamily: family?.pathFamily || null,
      docLike: isExtractedProseDocumentLikeExtension(resolveWarmupEntryExtension(entry)),
      warmupFiles: 0
    };
    current.warmupFiles += 1;
    warmupFamilies[familyKey] = current;
    const cohortCurrent = warmupCohorts[cohortKey] || createEmptyCohortStats(cohort);
    cohortCurrent.warmupFiles += 1;
    warmupCohorts[cohortKey] = normalizeLowYieldCohortStats(cohortCurrent, cohortKey);
  }
  for (const entry of sampledEntries) {
    const orderIndex = resolveEntryOrderIndex(entry, null);
    if (!Number.isFinite(orderIndex)) continue;
    const normalizedOrderIndex = Math.floor(orderIndex);
    sampledOrderIndices.add(normalizedOrderIndex);
    const family = resolveWarmupEntryFamily(entry);
    const familyKey = family?.key || '(unknown)';
    const cohort = resolveWarmupEntryCohort(entry);
    const cohortKey = cohort?.key || 'code-comment-heavy';
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

const expandWarmupSampleForUnsampledHighValueCohorts = (bailout) => {
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
  const cohortKey = bailout.sampledCohortByOrderIndex?.get(normalizedOrderIndex);
  if (cohortKey) {
    const cohortStats = bailout.sampledCohorts?.[cohortKey];
    if (cohortStats && typeof cohortStats === 'object') {
      cohortStats.observedFiles += 1;
      if (safeChunkCount > 0) {
        cohortStats.yieldedFiles += 1;
      }
      cohortStats.chunkCount += safeChunkCount;
      bailout.sampledCohorts[cohortKey] = normalizeLowYieldCohortStats(cohortStats, cohortKey);
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
      yieldRatio: Number.isFinite(Number(familyState.yieldRatio))
        ? Number(familyState.yieldRatio)
        : 0
    }));
  const sampledFamilyMap = Object.fromEntries(
    familySummaries.map((familyState) => [familyState.key, familyState])
  );
  const historyFamilyMap = Object.fromEntries(
    historyFamilySummaries.map((familyState) => [familyState.key, familyState])
  );
  const warmupFamilyMap = Object.fromEntries(
    Object.values(bailout.warmupFamilies || {}).map((familyState) => [familyState.key, familyState])
  );
  const sampledCohortMap = Object.fromEntries(
    Object.values(bailout.sampledCohorts || {}).map((cohortState) => [cohortState.key, cohortState])
  );
  const historyCohortMap = Object.fromEntries(
    Object.values(bailout.history?.cohorts || {}).map((cohortState) => [cohortState.key, cohortState])
  );
  const warmupCohortMap = Object.fromEntries(
    Object.values(bailout.warmupCohorts || {}).map((cohortState) => [cohortState.key, cohortState])
  );
  const familyEvidence = Object.values({
    ...warmupFamilyMap,
    ...sampledFamilyMap,
    ...historyFamilyMap
  }).map((familyState) => {
    const key = familyState.key;
    const sampledFamily = sampledFamilyMap[key] || bailout.sampledFamilies?.[key] || null;
    const warmupFamily = warmupFamilyMap[key] || null;
    const historyFamily = historyFamilyMap[key] || null;
    return buildFamilyEvidenceSummary({
      sampledFamily,
      warmupFamily,
      historyFamily,
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
  const cohort = resolveWarmupEntryCohort(entry);
  const cohortKey = cohort?.key || 'code-comment-heavy';
  return Array.isArray(bailout.suppressedCohorts)
    ? bailout.suppressedCohorts.some((cohortState) => cohortState.key === cohortKey)
    : false;
};

export const buildExtractedProseLowYieldBailoutSummary = (bailout) => {
  if (!bailout) return null;
  const observedYieldRatio = bailout.observedSamples > 0
    ? bailout.yieldedSamples / bailout.observedSamples
    : 0;
  const suppressedCohorts = Array.isArray(bailout.lastDecision?.suppressedCohorts)
    ? bailout.lastDecision.suppressedCohorts
    : [];
  const protectedCohorts = Array.isArray(bailout.lastDecision?.protectedCohorts)
    ? bailout.lastDecision.protectedCohorts
    : [];
  const strategyMismatchRiskCohorts = Array.isArray(bailout.lastDecision?.strategyMismatchRiskCohorts)
    ? bailout.lastDecision.strategyMismatchRiskCohorts
    : [];
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
    skippedFiles: bailout.skippedFiles,
    decisionAtOrderIndex: bailout.decisionAtOrderIndex,
    decisionAt: toIsoTimestamp(bailout.decisionAtMs),
    repoFingerprint: normalizeRepoFingerprint(bailout.repoFingerprint),
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
      ? bailout.lastDecision.familyEvidence.map((familyState) => ({
        key: familyState.key,
        ext: familyState.ext,
        pathFamily: familyState.pathFamily,
        docLike: familyState.docLike === true,
        warmupFiles: familyState.warmupFiles,
        sampledFiles: familyState.sampledFiles,
        sampledObservedFiles: familyState.sampledObservedFiles,
        sampledYieldedFiles: familyState.sampledYieldedFiles,
        sampledChunkCount: familyState.sampledChunkCount,
        historyObservedFiles: familyState.historyObservedFiles,
        historyYieldedFiles: familyState.historyYieldedFiles,
        historyChunkCount: familyState.historyChunkCount,
        weightedHistoryObservedFiles: familyState.weightedHistoryObservedFiles,
        weightedHistoryYieldedFiles: familyState.weightedHistoryYieldedFiles,
        weightedHistoryChunkCount: familyState.weightedHistoryChunkCount,
        effectiveObservedFiles: familyState.effectiveObservedFiles,
        effectiveYieldedFiles: familyState.effectiveYieldedFiles,
        effectiveChunkCount: familyState.effectiveChunkCount,
        effectiveYieldRatio: familyState.effectiveYieldRatio,
        protectedBySample: familyState.protectedBySample === true,
        protectedByHistory: familyState.protectedByHistory === true,
        deferDecisionByHistory: familyState.deferDecisionByHistory === true
      }))
      : [],
    cohortEvidence: Array.isArray(bailout.lastDecision?.cohortEvidence)
      ? bailout.lastDecision.cohortEvidence.map((cohortState) => ({
        key: cohortState.key,
        docLike: cohortState.docLike === true,
        warmupFiles: Math.max(0, Math.floor(Number(cohortState.warmupFiles) || 0)),
        sampledFiles: Math.max(0, Math.floor(Number(cohortState.sampledFiles) || 0)),
        sampledObservedFiles: Math.max(0, Math.floor(Number(cohortState.sampledObservedFiles) || 0)),
        sampledYieldedFiles: Math.max(0, Math.floor(Number(cohortState.sampledYieldedFiles) || 0)),
        sampledChunkCount: Math.max(0, Math.floor(Number(cohortState.sampledChunkCount) || 0)),
        sampledYieldRatio: Number.isFinite(Number(cohortState.sampledYieldRatio))
          ? Number(cohortState.sampledYieldRatio)
          : 0,
        historyObservedFiles: Math.max(0, Math.floor(Number(cohortState.historyObservedFiles) || 0)),
        historyYieldedFiles: Math.max(0, Math.floor(Number(cohortState.historyYieldedFiles) || 0)),
        historyChunkCount: Math.max(0, Math.floor(Number(cohortState.historyChunkCount) || 0)),
        historyYieldRatio: Number.isFinite(Number(cohortState.historyYieldRatio))
          ? Number(cohortState.historyYieldRatio)
          : 0,
        fingerprintShifted: cohortState.fingerprintShifted === true,
        expectedYieldClass: typeof cohortState.expectedYieldClass === 'string'
          ? cohortState.expectedYieldClass
          : 'uncertain',
        strategyMismatchRisk: cohortState.strategyMismatchRisk === true,
        protectedBySample: cohortState.protectedBySample === true,
        protectedByHistory: cohortState.protectedByHistory === true,
        protectedByPriority: cohortState.protectedByPriority === true,
        suppressible: cohortState.suppressible === true,
        suppressionClass: typeof cohortState.suppressionClass === 'string'
          ? cohortState.suppressionClass
          : null
      }))
      : [],
    suppressedCohorts: suppressedCohorts.map((cohortState) => ({
      key: cohortState.key,
      suppressionClass: cohortState.suppressionClass,
      expectedYieldClass: cohortState.expectedYieldClass,
      warmupFiles: Math.max(0, Math.floor(Number(cohortState.warmupFiles) || 0)),
      sampledFiles: Math.max(0, Math.floor(Number(cohortState.sampledFiles) || 0)),
      sampledObservedFiles: Math.max(0, Math.floor(Number(cohortState.sampledObservedFiles) || 0)),
      sampledYieldedFiles: Math.max(0, Math.floor(Number(cohortState.sampledYieldedFiles) || 0)),
      sampledChunkCount: Math.max(0, Math.floor(Number(cohortState.sampledChunkCount) || 0))
    })),
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
