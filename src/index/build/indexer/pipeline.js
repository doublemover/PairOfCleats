import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAdaptiveDictConfig, getIndexDir, getMetricsDir } from '../../../shared/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../../integrations/triage/index-records.js';
import { createCacheReporter, createLruCache, estimateFileTextBytes } from '../../../shared/cache.js';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { getEnvConfig } from '../../../shared/env.js';
import { log, showProgress } from '../../../shared/progress.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { coerceUnitFraction } from '../../../shared/number-coerce.js';
import { createCrashLogger } from '../crash-log.js';
import { recordOrderingSeedInputs, updateBuildState } from '../build-state.js';
import { estimateContextWindow } from '../context-window.js';
import { createPerfProfile, loadPerfProfile } from '../perf-profile.js';
import { createStageCheckpointRecorder } from '../stage-checkpoints.js';
import { createIndexState } from '../state.js';
import { enqueueEmbeddingJob } from './embedding-queue.js';
import { getTreeSitterStats, resetTreeSitterStats } from '../../../lang/tree-sitter.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../contracts/index-profile.js';
import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { writeSchedulerAutoTuneProfile } from '../runtime/scheduler-autotune-profile.js';
import { formatHealthFailure, runIndexingHealthChecks } from '../../../shared/ops-health.js';
import { runWithOperationalFailurePolicy } from '../../../shared/ops-failure-injection.js';
import {
  RESOURCE_GROWTH_THRESHOLDS,
  RESOURCE_WARNING_CODES,
  evaluateResourceGrowth,
  formatResourceGrowthWarning,
  readIndexArtifactBytes
} from '../../../shared/ops-resource-visibility.js';
import {
  SIGNATURE_VERSION,
  buildIncrementalSignature,
  buildIncrementalSignatureSummary,
  buildTokenizationKey
} from './signatures.js';
import { runDiscovery } from './steps/discover.js';
import {
  loadIncrementalPlan,
  prepareIncrementalBundleVfsRows,
  pruneIncrementalState,
  updateIncrementalBundles
} from './steps/incremental.js';
import { buildIndexPostings } from './steps/postings.js';
import { processFiles } from './steps/process-files.js';
import { postScanImports, preScanImports, runCrossFileInference } from './steps/relations.js';
import { writeIndexArtifactsForMode } from './steps/write.js';

/**
 * Resolve effective analysis feature flags with policy overrides.
 * Runtime toggles provide defaults; explicit policy booleans take precedence.
 *
 * @param {object} runtime
 * @returns {{gitBlame:boolean,typeInference:boolean,typeInferenceCrossFile:boolean,riskAnalysis:boolean,riskAnalysisCrossFile:boolean}}
 */
const resolveAnalysisFlags = (runtime) => {
  const policy = runtime.analysisPolicy || {};
  return {
    gitBlame: typeof policy?.git?.blame === 'boolean' ? policy.git.blame : runtime.gitBlameEnabled,
    typeInference: typeof policy?.typeInference?.local?.enabled === 'boolean'
      ? policy.typeInference.local.enabled
      : runtime.typeInferenceEnabled,
    typeInferenceCrossFile: typeof policy?.typeInference?.crossFile?.enabled === 'boolean'
      ? policy.typeInference.crossFile.enabled
      : runtime.typeInferenceCrossFileEnabled,
    riskAnalysis: typeof policy?.risk?.enabled === 'boolean' ? policy.risk.enabled : runtime.riskAnalysisEnabled,
    riskAnalysisCrossFile: typeof policy?.risk?.crossFile === 'boolean'
      ? policy.risk.crossFile
      : runtime.riskAnalysisCrossFileEnabled
  };
};

/**
 * Vector-only builds can proceed when embeddings are either immediately
 * available (`embeddingEnabled`) or deferred to service queueing
 * (`embeddingService`).
 *
 * @param {object} runtime
 * @returns {boolean}
 */
const hasVectorEmbeddingBuildCapability = (runtime) => (
  runtime?.embeddingEnabled === true || runtime?.embeddingService === true
);

/**
 * Resolve vector-only profile shortcut policy for downstream stages.
 *
 * @param {object} runtime
 * @returns {{profileId:string,enabled:boolean,disableImportGraph:boolean,disableCrossFileInference:boolean}}
 */
export const resolveVectorOnlyShortcutPolicy = (runtime) => {
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const config = runtime?.indexingConfig?.vectorOnly && typeof runtime.indexingConfig.vectorOnly === 'object'
    ? runtime.indexingConfig.vectorOnly
    : {};
  return {
    profileId,
    enabled: vectorOnly,
    disableImportGraph: vectorOnly ? config.disableImportGraph !== false : false,
    disableCrossFileInference: vectorOnly ? config.disableCrossFileInference !== false : false
  };
};

const MODALITY_SPARSITY_SCHEMA_VERSION = '1.0.0';
const MODALITY_SPARSITY_PROFILE_FILE = 'modality-sparsity-profile.json';
const MODALITY_SPARSITY_MAX_ENTRIES = 512;
const EXTRACTED_PROSE_YIELD_PROFILE_SCHEMA_VERSION = '1.0.0';
const EXTRACTED_PROSE_YIELD_PROFILE_FILE = 'extracted-prose-yield-profile.json';
const EXTRACTED_PROSE_YIELD_PROFILE_MAX_ENTRIES = 128;
const DOCUMENT_EXTRACTION_CACHE_SCHEMA_VERSION = '1.0.0';
const DOCUMENT_EXTRACTION_CACHE_FILE = 'document-extraction-cache.json';
const DOCUMENT_EXTRACTION_CACHE_MAX_ENTRIES = 1024;
const DOCUMENT_EXTRACTION_CACHE_MAX_TEXT_BYTES = 2 * 1024 * 1024;
const SHARED_PROSE_FILE_TEXT_CACHE_KEY = 'prose-extracted:fileText';
const SHARED_PROSE_MODES = new Set(['prose', 'extracted-prose']);

const createEmptyModalitySparsityProfile = () => ({
  schemaVersion: MODALITY_SPARSITY_SCHEMA_VERSION,
  updatedAt: null,
  entries: {}
});

const resolveSharedModeCaches = (runtime) => {
  if (!runtime || typeof runtime !== 'object') return null;
  if (!runtime.sharedModeCaches || typeof runtime.sharedModeCaches !== 'object') {
    runtime.sharedModeCaches = {};
  }
  return runtime.sharedModeCaches;
};

export const resolveFileTextCacheForMode = ({ runtime, mode, cacheReporter }) => {
  const createCache = () => createLruCache({
    name: 'fileText',
    maxMb: runtime.cacheConfig?.fileText?.maxMb,
    ttlMs: runtime.cacheConfig?.fileText?.ttlMs,
    sizeCalculation: estimateFileTextBytes,
    reporter: cacheReporter
  });
  if (!SHARED_PROSE_MODES.has(mode)) {
    return createCache();
  }
  const sharedCaches = resolveSharedModeCaches(runtime);
  if (!sharedCaches) return createCache();
  if (!sharedCaches[SHARED_PROSE_FILE_TEXT_CACHE_KEY]) {
    sharedCaches[SHARED_PROSE_FILE_TEXT_CACHE_KEY] = createCache();
  }
  return sharedCaches[SHARED_PROSE_FILE_TEXT_CACHE_KEY];
};

/**
 * Resolve per-repo modality sparsity profile artifact path.
 *
 * @param {object} runtime
 * @returns {string|null}
 */
export const resolveModalitySparsityProfilePath = (runtime) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string' ? runtime.repoCacheRoot : '';
  if (!repoCacheRoot) return null;
  return path.join(repoCacheRoot, MODALITY_SPARSITY_PROFILE_FILE);
};

/**
 * Build stable key for modality sparsity profile entries.
 *
 * @param {{mode:string,cacheSignature:string}} input
 * @returns {string}
 */
export const buildModalitySparsityEntryKey = ({ mode, cacheSignature }) => (
  `${String(mode || 'unknown')}:${String(cacheSignature || 'nosig')}`
);

const normalizeModalitySparsityProfile = (profile) => {
  if (!profile || typeof profile !== 'object') return createEmptyModalitySparsityProfile();
  const entries = profile.entries && typeof profile.entries === 'object' ? profile.entries : {};
  return {
    schemaVersion: typeof profile.schemaVersion === 'string'
      ? profile.schemaVersion
      : MODALITY_SPARSITY_SCHEMA_VERSION,
    updatedAt: typeof profile.updatedAt === 'string' ? profile.updatedAt : null,
    entries
  };
};

/**
 * Read modality sparsity profile from disk (or return empty profile).
 *
 * @param {object} runtime
 * @returns {Promise<{profilePath:string|null,profile:object}>}
 */
export const readModalitySparsityProfile = async (runtime) => {
  const profilePath = resolveModalitySparsityProfilePath(runtime);
  if (!profilePath) {
    return { profilePath: null, profile: createEmptyModalitySparsityProfile() };
  }
  try {
    const raw = await fs.readFile(profilePath, 'utf8');
    const parsed = normalizeModalitySparsityProfile(JSON.parse(raw));
    return { profilePath, profile: parsed };
  } catch {
    return { profilePath, profile: createEmptyModalitySparsityProfile() };
  }
};

const trimModalitySparsityEntries = (entries = {}) => {
  const list = Object.entries(entries);
  if (list.length <= MODALITY_SPARSITY_MAX_ENTRIES) return entries;
  list.sort((a, b) => {
    const aTs = Date.parse(a?.[1]?.updatedAt || 0) || 0;
    const bTs = Date.parse(b?.[1]?.updatedAt || 0) || 0;
    return bTs - aTs;
  });
  const keep = list.slice(0, MODALITY_SPARSITY_MAX_ENTRIES);
  return Object.fromEntries(keep);
};

/**
 * Upsert one modality sparsity observation and persist profile atomically.
 *
 * @param {{
 *  runtime:object,
 *  profilePath:string|null,
 *  profile:object,
 *  mode:string,
 *  cacheSignature:string,
 *  fileCount:number,
 *  chunkCount:number,
 *  elided:boolean,
 *  source:string
 * }} input
 * @returns {Promise<void>}
 */
export const writeModalitySparsityEntry = async ({
  runtime,
  profilePath,
  profile,
  mode,
  cacheSignature,
  fileCount,
  chunkCount,
  elided,
  source
}) => {
  if (!profilePath) return;
  const now = new Date().toISOString();
  const key = buildModalitySparsityEntryKey({ mode, cacheSignature });
  const next = normalizeModalitySparsityProfile(profile);
  next.updatedAt = now;
  next.entries = {
    ...next.entries,
    [key]: {
      schemaVersion: MODALITY_SPARSITY_SCHEMA_VERSION,
      key,
      mode,
      cacheSignature: cacheSignature || null,
      fileCount: Number.isFinite(Number(fileCount)) ? Number(fileCount) : 0,
      chunkCount: Number.isFinite(Number(chunkCount)) ? Number(chunkCount) : 0,
      elided: elided === true,
      source: source || null,
      repoRoot: runtime?.root || null,
      updatedAt: now
    }
  };
  next.entries = trimModalitySparsityEntries(next.entries);
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await atomicWriteJson(profilePath, next, { spaces: 2 });
};

const createEmptyExtractedProseYieldProfile = () => ({
  schemaVersion: EXTRACTED_PROSE_YIELD_PROFILE_SCHEMA_VERSION,
  updatedAt: null,
  entries: {}
});

const createEmptyDocumentExtractionCache = () => ({
  schemaVersion: DOCUMENT_EXTRACTION_CACHE_SCHEMA_VERSION,
  updatedAt: null,
  entries: {}
});

const resolveExtractedProseYieldProfilePath = (runtime) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string' ? runtime.repoCacheRoot : '';
  if (!repoCacheRoot) return null;
  return path.join(repoCacheRoot, EXTRACTED_PROSE_YIELD_PROFILE_FILE);
};

const resolveDocumentExtractionCachePath = (runtime) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string' ? runtime.repoCacheRoot : '';
  if (!repoCacheRoot) return null;
  return path.join(repoCacheRoot, DOCUMENT_EXTRACTION_CACHE_FILE);
};

const buildExtractedProseYieldProfileEntryKey = ({ mode, cacheSignature }) => (
  `${String(mode || 'unknown')}:${String(cacheSignature || 'nosig')}`
);

const normalizeExtractedProseYieldProfileFamily = (family, key) => {
  if (!family || typeof family !== 'object') return null;
  const observedFiles = Math.max(0, Math.floor(Number(family.observedFiles) || 0));
  if (observedFiles <= 0) return null;
  const yieldedFiles = Math.max(0, Math.floor(Number(family.yieldedFiles) || 0));
  const chunkCount = Math.max(0, Math.floor(Number(family.chunkCount) || 0));
  return {
    key: family.key || key || null,
    ext: family.ext || null,
    pathFamily: family.pathFamily || null,
    pathHint: family.pathHint || null,
    observedFiles,
    yieldedFiles,
    chunkCount,
    yieldRatio: observedFiles > 0
      ? yieldedFiles / observedFiles
      : 0
  };
};

const normalizeExtractedProseYieldProfileEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const familiesRaw = entry.families && typeof entry.families === 'object'
    ? entry.families
    : {};
  const families = {};
  for (const [key, family] of Object.entries(familiesRaw)) {
    const normalized = normalizeExtractedProseYieldProfileFamily(family, key);
    if (!normalized) continue;
    families[key] = normalized;
  }
  const totals = entry.totals && typeof entry.totals === 'object'
    ? entry.totals
    : {};
  return {
    schemaVersion: EXTRACTED_PROSE_YIELD_PROFILE_SCHEMA_VERSION,
    key: entry.key || null,
    mode: entry.mode || 'extracted-prose',
    cacheSignature: entry.cacheSignature || null,
    builds: Math.max(0, Math.floor(Number(entry.builds) || 0)),
    config: entry.config && typeof entry.config === 'object' ? entry.config : {},
    totals: {
      observedFiles: Math.max(0, Math.floor(Number(totals.observedFiles) || 0)),
      yieldedFiles: Math.max(0, Math.floor(Number(totals.yieldedFiles) || 0)),
      chunkCount: Math.max(0, Math.floor(Number(totals.chunkCount) || 0)),
      familyCount: Math.max(0, Math.floor(Number(totals.familyCount) || 0)),
      overflowFamilies: Math.max(0, Math.floor(Number(totals.overflowFamilies) || 0)),
      skippedByProfile: Math.max(0, Math.floor(Number(totals.skippedByProfile) || 0))
    },
    families,
    repoRoot: entry.repoRoot || null,
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null
  };
};

const normalizeExtractedProseYieldProfile = (profile) => {
  if (!profile || typeof profile !== 'object') return createEmptyExtractedProseYieldProfile();
  const entriesRaw = profile.entries && typeof profile.entries === 'object'
    ? profile.entries
    : {};
  const entries = {};
  for (const [key, value] of Object.entries(entriesRaw)) {
    const normalized = normalizeExtractedProseYieldProfileEntry(value);
    if (!normalized) continue;
    entries[key] = normalized;
  }
  return {
    schemaVersion: typeof profile.schemaVersion === 'string'
      ? profile.schemaVersion
      : EXTRACTED_PROSE_YIELD_PROFILE_SCHEMA_VERSION,
    updatedAt: typeof profile.updatedAt === 'string' ? profile.updatedAt : null,
    entries
  };
};

const trimExtractedProseYieldProfileEntries = (entries = {}) => {
  const list = Object.entries(entries);
  if (list.length <= EXTRACTED_PROSE_YIELD_PROFILE_MAX_ENTRIES) return entries;
  list.sort((a, b) => {
    const aTs = Date.parse(a?.[1]?.updatedAt || 0) || 0;
    const bTs = Date.parse(b?.[1]?.updatedAt || 0) || 0;
    return bTs - aTs;
  });
  return Object.fromEntries(list.slice(0, EXTRACTED_PROSE_YIELD_PROFILE_MAX_ENTRIES));
};

const selectExtractedProseYieldProfileEntry = ({ profile, mode, cacheSignature }) => {
  const normalized = normalizeExtractedProseYieldProfile(profile);
  const exactKey = buildExtractedProseYieldProfileEntryKey({ mode, cacheSignature });
  const exactEntry = normalized.entries?.[exactKey] || null;
  if (exactEntry) {
    return {
      key: exactKey,
      source: 'exact',
      entry: exactEntry
    };
  }
  const candidates = Object.entries(normalized.entries || {})
    .filter(([, value]) => value?.mode === mode)
    .sort((a, b) => {
      const aTs = Date.parse(a?.[1]?.updatedAt || 0) || 0;
      const bTs = Date.parse(b?.[1]?.updatedAt || 0) || 0;
      return bTs - aTs;
    });
  if (!candidates.length) return { key: null, source: null, entry: null };
  return {
    key: candidates[0][0],
    source: 'latest',
    entry: candidates[0][1]
  };
};

const mergeExtractedProseYieldProfileEntry = ({
  existingEntry,
  observation,
  runtime,
  mode,
  cacheSignature
}) => {
  const existing = normalizeExtractedProseYieldProfileEntry(existingEntry) || {
    schemaVersion: EXTRACTED_PROSE_YIELD_PROFILE_SCHEMA_VERSION,
    key: null,
    mode,
    cacheSignature,
    builds: 0,
    config: {},
    totals: {
      observedFiles: 0,
      yieldedFiles: 0,
      chunkCount: 0,
      familyCount: 0,
      overflowFamilies: 0,
      skippedByProfile: 0
    },
    families: {},
    repoRoot: runtime?.root || null,
    updatedAt: null
  };
  const observedTotals = observation?.totals && typeof observation.totals === 'object'
    ? observation.totals
    : {};
  const observedFamilies = observation?.families && typeof observation.families === 'object'
    ? observation.families
    : {};
  const families = { ...(existing.families || {}) };
  for (const [key, family] of Object.entries(observedFamilies)) {
    const normalized = normalizeExtractedProseYieldProfileFamily(family, key);
    if (!normalized) continue;
    const current = normalizeExtractedProseYieldProfileFamily(families[key], key) || {
      key,
      ext: normalized.ext || null,
      pathFamily: normalized.pathFamily || null,
      pathHint: normalized.pathHint || null,
      observedFiles: 0,
      yieldedFiles: 0,
      chunkCount: 0,
      yieldRatio: 0
    };
    const mergedObserved = current.observedFiles + normalized.observedFiles;
    const mergedYielded = current.yieldedFiles + normalized.yieldedFiles;
    const mergedChunkCount = current.chunkCount + normalized.chunkCount;
    families[key] = {
      key,
      ext: normalized.ext || current.ext || null,
      pathFamily: normalized.pathFamily || current.pathFamily || null,
      pathHint: normalized.pathHint || current.pathHint || null,
      observedFiles: mergedObserved,
      yieldedFiles: mergedYielded,
      chunkCount: mergedChunkCount,
      yieldRatio: mergedObserved > 0 ? mergedYielded / mergedObserved : 0
    };
  }
  const maxFamilies = Number(observation?.config?.maxFamilies);
  const familyEntries = Object.entries(families);
  if (Number.isFinite(maxFamilies) && maxFamilies > 0 && familyEntries.length > maxFamilies) {
    familyEntries.sort((a, b) => {
      const aObserved = Number(a?.[1]?.observedFiles) || 0;
      const bObserved = Number(b?.[1]?.observedFiles) || 0;
      if (aObserved !== bObserved) return bObserved - aObserved;
      return String(a?.[0] || '').localeCompare(String(b?.[0] || ''));
    });
    familyEntries.length = Math.max(1, Math.floor(maxFamilies));
  } else {
    familyEntries.sort((a, b) => String(a?.[0] || '').localeCompare(String(b?.[0] || '')));
  }
  const now = new Date().toISOString();
  return {
    schemaVersion: EXTRACTED_PROSE_YIELD_PROFILE_SCHEMA_VERSION,
    key: buildExtractedProseYieldProfileEntryKey({ mode, cacheSignature }),
    mode,
    cacheSignature: cacheSignature || null,
    builds: Math.max(0, Math.floor(Number(existing.builds) || 0))
      + Math.max(0, Math.floor(Number(observation?.builds) || 0)),
    config: observation?.config && typeof observation.config === 'object'
      ? observation.config
      : (existing.config || {}),
    totals: {
      observedFiles: Math.max(0, Math.floor(Number(existing?.totals?.observedFiles) || 0))
        + Math.max(0, Math.floor(Number(observedTotals.observedFiles) || 0)),
      yieldedFiles: Math.max(0, Math.floor(Number(existing?.totals?.yieldedFiles) || 0))
        + Math.max(0, Math.floor(Number(observedTotals.yieldedFiles) || 0)),
      chunkCount: Math.max(0, Math.floor(Number(existing?.totals?.chunkCount) || 0))
        + Math.max(0, Math.floor(Number(observedTotals.chunkCount) || 0)),
      familyCount: familyEntries.length,
      overflowFamilies: Math.max(0, Math.floor(Number(existing?.totals?.overflowFamilies) || 0))
        + Math.max(0, Math.floor(Number(observedTotals.overflowFamilies) || 0)),
      skippedByProfile: Math.max(0, Math.floor(Number(existing?.totals?.skippedByProfile) || 0))
        + Math.max(0, Math.floor(Number(observedTotals.skippedByProfile) || 0))
    },
    families: Object.fromEntries(familyEntries),
    repoRoot: runtime?.root || null,
    updatedAt: now
  };
};

const readExtractedProseYieldProfile = async (runtime) => {
  const profilePath = resolveExtractedProseYieldProfilePath(runtime);
  if (!profilePath) {
    return { profilePath: null, profile: createEmptyExtractedProseYieldProfile() };
  }
  try {
    const raw = await fs.readFile(profilePath, 'utf8');
    return {
      profilePath,
      profile: normalizeExtractedProseYieldProfile(JSON.parse(raw))
    };
  } catch {
    return { profilePath, profile: createEmptyExtractedProseYieldProfile() };
  }
};

const writeExtractedProseYieldProfileEntry = async ({
  runtime,
  profilePath,
  profile,
  mode,
  cacheSignature,
  observation
}) => {
  if (!profilePath || !observation || typeof observation !== 'object') return;
  const key = buildExtractedProseYieldProfileEntryKey({ mode, cacheSignature });
  const next = normalizeExtractedProseYieldProfile(profile);
  next.updatedAt = new Date().toISOString();
  next.entries = {
    ...next.entries,
    [key]: mergeExtractedProseYieldProfileEntry({
      existingEntry: next.entries?.[key] || null,
      observation,
      runtime,
      mode,
      cacheSignature
    })
  };
  next.entries = trimExtractedProseYieldProfileEntries(next.entries);
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await atomicWriteJson(profilePath, next, { spaces: 2 });
};

const normalizeDocumentExtractionCacheEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const text = typeof entry.text === 'string' ? entry.text : '';
  if (!text) return null;
  const sourceType = entry.sourceType === 'docx' ? 'docx' : 'pdf';
  return {
    sourceType,
    extractor: entry.extractor && typeof entry.extractor === 'object'
      ? {
        name: entry.extractor.name || null,
        version: entry.extractor.version || null,
        target: entry.extractor.target || null
      }
      : null,
    text,
    counts: {
      pages: Math.max(0, Math.floor(Number(entry?.counts?.pages) || 0)),
      paragraphs: Math.max(0, Math.floor(Number(entry?.counts?.paragraphs) || 0)),
      totalUnits: Math.max(0, Math.floor(Number(entry?.counts?.totalUnits) || 0))
    },
    units: Array.isArray(entry.units)
      ? entry.units
        .filter((unit) => unit && typeof unit === 'object')
        .map((unit) => ({
          type: unit.type === 'docx' ? 'docx' : 'pdf',
          ...(Number.isFinite(Number(unit.pageNumber)) ? { pageNumber: Math.floor(Number(unit.pageNumber)) } : {}),
          ...(Number.isFinite(Number(unit.index)) ? { index: Math.floor(Number(unit.index)) } : {}),
          ...(typeof unit.style === 'string' ? { style: unit.style } : {}),
          start: Math.max(0, Math.floor(Number(unit.start) || 0)),
          end: Math.max(0, Math.floor(Number(unit.end) || 0))
        }))
      : [],
    normalizationPolicy: entry.normalizationPolicy || null,
    warnings: Array.isArray(entry.warnings)
      ? entry.warnings.slice(0, 32).map((item) => String(item))
      : []
  };
};

const normalizeDocumentExtractionCache = (cache) => {
  if (!cache || typeof cache !== 'object') return createEmptyDocumentExtractionCache();
  const entriesRaw = cache.entries && typeof cache.entries === 'object'
    ? cache.entries
    : {};
  const entries = {};
  for (const [key, value] of Object.entries(entriesRaw)) {
    const normalized = normalizeDocumentExtractionCacheEntry(value);
    if (!normalized) continue;
    entries[key] = normalized;
  }
  return {
    schemaVersion: typeof cache.schemaVersion === 'string'
      ? cache.schemaVersion
      : DOCUMENT_EXTRACTION_CACHE_SCHEMA_VERSION,
    updatedAt: typeof cache.updatedAt === 'string' ? cache.updatedAt : null,
    entries
  };
};

const readDocumentExtractionCache = async (runtime) => {
  const cachePath = resolveDocumentExtractionCachePath(runtime);
  if (!cachePath) {
    return { cachePath: null, cache: createEmptyDocumentExtractionCache() };
  }
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    return {
      cachePath,
      cache: normalizeDocumentExtractionCache(JSON.parse(raw))
    };
  } catch {
    return { cachePath, cache: createEmptyDocumentExtractionCache() };
  }
};

const createDocumentExtractionCacheRuntime = ({ runtime, cachePath, cache }) => {
  const config = runtime?.indexingConfig?.documentExtraction?.cache
    && typeof runtime.indexingConfig.documentExtraction.cache === 'object'
    ? runtime.indexingConfig.documentExtraction.cache
    : {};
  const enabled = config.enabled !== false;
  const maxEntriesRaw = Number(config.maxEntries ?? runtime?.cacheConfig?.documentExtraction?.maxEntries);
  const maxEntries = Number.isFinite(maxEntriesRaw) && maxEntriesRaw > 0
    ? Math.max(1, Math.floor(maxEntriesRaw))
    : DOCUMENT_EXTRACTION_CACHE_MAX_ENTRIES;
  const maxTextBytesRaw = Number(config.maxTextBytes);
  const maxTextBytes = Number.isFinite(maxTextBytesRaw) && maxTextBytesRaw > 0
    ? Math.max(1024, Math.floor(maxTextBytesRaw))
    : DOCUMENT_EXTRACTION_CACHE_MAX_TEXT_BYTES;
  const normalized = normalizeDocumentExtractionCache(cache);
  const entries = new Map(Object.entries(normalized.entries || {}));
  const stats = {
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0
  };
  let dirty = false;
  const get = (key) => {
    if (!enabled) return null;
    const cacheKey = typeof key === 'string' ? key : '';
    if (!cacheKey || !entries.has(cacheKey)) {
      stats.misses += 1;
      return null;
    }
    stats.hits += 1;
    return normalizeDocumentExtractionCacheEntry(entries.get(cacheKey));
  };
  const set = (key, value) => {
    if (!enabled) return;
    const cacheKey = typeof key === 'string' ? key : '';
    if (!cacheKey) return;
    const normalizedValue = normalizeDocumentExtractionCacheEntry(value);
    if (!normalizedValue) return;
    if (Buffer.byteLength(normalizedValue.text, 'utf8') > maxTextBytes) return;
    if (entries.has(cacheKey)) entries.delete(cacheKey);
    entries.set(cacheKey, normalizedValue);
    stats.stores += 1;
    dirty = true;
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey == null) break;
      entries.delete(oldestKey);
      stats.evictions += 1;
    }
  };
  const snapshot = () => ({
    schemaVersion: DOCUMENT_EXTRACTION_CACHE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: Object.fromEntries(
      Array.from(entries.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    )
  });
  return {
    cachePath,
    enabled,
    maxEntries,
    maxTextBytes,
    get,
    set,
    stats: () => ({
      ...stats,
      entries: entries.size,
      maxEntries,
      maxTextBytes
    }),
    isDirty: () => dirty,
    snapshot
  };
};

const writeDocumentExtractionCacheRuntime = async (cacheRuntime) => {
  if (!cacheRuntime?.enabled || !cacheRuntime?.cachePath || cacheRuntime?.isDirty?.() !== true) return;
  await fs.mkdir(path.dirname(cacheRuntime.cachePath), { recursive: true });
  await atomicWriteJson(cacheRuntime.cachePath, cacheRuntime.snapshot(), { spaces: 2 });
};

/**
 * Determine whether stage processing can be elided for empty modality.
 *
 * @param {{fileCount:number,chunkCount:number}} input
 * @returns {boolean}
 */
export const shouldElideModalityProcessingStage = ({ fileCount, chunkCount }) => (
  Number(fileCount) === 0 && Number(chunkCount) === 0
);

const estimateEntryBytes = (entry) => {
  const statSize = Number(entry?.stat?.size);
  if (Number.isFinite(statSize) && statSize >= 0) return statSize;
  const entrySize = Number(entry?.size);
  if (Number.isFinite(entrySize) && entrySize >= 0) return entrySize;
  return 0;
};

const estimateRepoLinesFromEntries = (entries = []) => {
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += estimateEntryBytes(entry);
  }
  // Conservative estimate; source trees with short lines still remain under
  // tiny thresholds due the explicit file/byte guards.
  const estimatedLines = Math.floor(totalBytes / 48);
  return {
    totalBytes,
    estimatedLines
  };
};

/**
 * Resolve tiny-repo fast-path activation and shortcut settings.
 *
 * @param {{runtime:object,entries:Array<object>}} [input]
 * @returns {object}
 */
export const resolveTinyRepoFastPath = ({ runtime, entries = [] } = {}) => {
  const config = runtime?.indexingConfig?.tinyRepoFastPath
    && typeof runtime.indexingConfig.tinyRepoFastPath === 'object'
    ? runtime.indexingConfig.tinyRepoFastPath
    : {};
  const enabled = config.enabled === true;
  if (!enabled) {
    return {
      enabled: false,
      active: false,
      reason: 'disabled-or-unconfigured',
      estimatedLines: 0,
      totalBytes: 0,
      fileCount: Array.isArray(entries) ? entries.length : 0
    };
  }
  const fileCount = Array.isArray(entries) ? entries.length : 0;
  const { totalBytes, estimatedLines } = estimateRepoLinesFromEntries(entries);
  const maxEstimatedLines = Number.isFinite(Number(config.maxEstimatedLines))
    ? Math.max(1000, Math.floor(Number(config.maxEstimatedLines)))
    : 5000;
  const maxFiles = Number.isFinite(Number(config.maxFiles))
    ? Math.max(1, Math.floor(Number(config.maxFiles)))
    : 256;
  const maxBytes = Number.isFinite(Number(config.maxBytes))
    ? Math.max(64 * 1024, Math.floor(Number(config.maxBytes)))
    : 3 * 1024 * 1024;
  const active = fileCount > 0
    && fileCount <= maxFiles
    && totalBytes <= maxBytes
    && estimatedLines <= maxEstimatedLines;
  return {
    enabled: true,
    active,
    reason: active ? 'threshold-match' : 'threshold-miss',
    estimatedLines,
    totalBytes,
    fileCount,
    maxEstimatedLines,
    maxFiles,
    maxBytes,
    disableImportGraph: active && config.disableImportGraph !== false,
    disableCrossFileInference: active && config.disableCrossFileInference !== false,
    minimalArtifacts: active && config.minimalArtifacts !== false
  };
};

/**
 * Build the effective feature toggle set for a mode from runtime settings,
 * analysis policy flags, and index profile behavior.
 *
 * @param {object} runtime
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @returns {object}
 */
export const buildFeatureSettings = (runtime, mode) => {
  const analysisFlags = resolveAnalysisFlags(runtime);
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtime);
  return {
    profileId,
    // Query-AST filtering depends on per-chunk tokens even for vector_only retrieval.
    // Keep tokenization enabled while still disabling sparse postings artifacts.
    tokenize: true,
    postings: !vectorOnly,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    gitBlame: analysisFlags.gitBlame,
    pythonAst: runtime.languageOptions?.pythonAst?.enabled !== false && mode === 'code',
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    typeInference: analysisFlags.typeInference && mode === 'code',
    riskAnalysis: analysisFlags.riskAnalysis && mode === 'code',
    lint: runtime.lintEnabled && mode === 'code',
    complexity: runtime.complexityEnabled && mode === 'code',
    astDataflow: runtime.astDataflowEnabled && mode === 'code',
    controlFlow: runtime.controlFlowEnabled && mode === 'code',
    typeInferenceCrossFile: analysisFlags.typeInferenceCrossFile && mode === 'code',
    riskAnalysisCrossFile: analysisFlags.riskAnalysisCrossFile && mode === 'code',
    vectorOnlyShortcuts: vectorOnlyShortcuts.enabled
      ? {
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
      }
      : null
  };
};

const VOLATILE_SCHEDULER_QUEUE_FIELDS = new Set([
  'oldestWaitMs',
  'lastWaitMs',
  'waitP95Ms',
  'waitSampleCount'
]);

const sanitizeSchedulerQueueForCheckpoint = (queueStats) => {
  if (!queueStats || typeof queueStats !== 'object') return queueStats || null;
  const next = { ...queueStats };
  for (const key of VOLATILE_SCHEDULER_QUEUE_FIELDS) {
    if (key in next) delete next[key];
  }
  return next;
};

/**
 * Remove high-churn scheduler wait metrics from persisted stage checkpoints.
 * Runtime warnings still use the unsanitized snapshot.
 *
 * @param {object|null} snapshot
 * @returns {object|null}
 */
export const sanitizeRuntimeSnapshotForCheckpoint = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return snapshot || null;
  const sanitized = { ...snapshot };
  const scheduler = snapshot.scheduler && typeof snapshot.scheduler === 'object'
    ? { ...snapshot.scheduler }
    : null;
  if (scheduler?.queues && typeof scheduler.queues === 'object') {
    scheduler.queues = Object.fromEntries(
      Object.entries(scheduler.queues).map(([name, queueStats]) => [
        name,
        sanitizeSchedulerQueueForCheckpoint(queueStats)
      ])
    );
  }
  sanitized.scheduler = scheduler;
  return sanitized;
};

const countFieldEntries = (fieldMaps) => {
  if (!fieldMaps || typeof fieldMaps !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldMaps)) {
    if (entry && typeof entry.size === 'number') total += entry.size;
  }
  return total;
};

const countFieldArrayEntries = (fieldArrays) => {
  if (!fieldArrays || typeof fieldArrays !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldArrays)) {
    if (Array.isArray(entry)) total += entry.length;
  }
  return total;
};

const summarizeGraphRelations = (graphRelations) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  const summarize = (graph) => ({
    nodes: Number.isFinite(graph?.nodeCount) ? graph.nodeCount : 0,
    edges: Number.isFinite(graph?.edgeCount) ? graph.edgeCount : 0
  });
  return {
    callGraph: summarize(graphRelations.callGraph),
    usageGraph: summarize(graphRelations.usageGraph),
    importGraph: summarize(graphRelations.importGraph)
  };
};

const summarizeDocumentExtractionForMode = (state) => {
  const fileInfoByPath = state?.fileInfoByPath;
  if (!(fileInfoByPath && typeof fileInfoByPath.entries === 'function')) return null;
  const files = [];
  const extractorMap = new Map();
  const totals = {
    files: 0,
    pages: 0,
    paragraphs: 0,
    units: 0
  };
  for (const [file, info] of fileInfoByPath.entries()) {
    const extraction = info?.extraction;
    if (!extraction || extraction.status !== 'ok') continue;
    const extractorName = extraction?.extractor?.name || null;
    const extractorVersion = extraction?.extractor?.version || null;
    const extractorTarget = extraction?.extractor?.target || null;
    const extractorKey = `${extractorName || 'unknown'}|${extractorVersion || 'unknown'}|${extractorTarget || ''}`;
    if (!extractorMap.has(extractorKey)) {
      extractorMap.set(extractorKey, {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      });
    }
    const unitCounts = {
      pages: Number(extraction?.counts?.pages) || 0,
      paragraphs: Number(extraction?.counts?.paragraphs) || 0,
      totalUnits: Number(extraction?.counts?.totalUnits) || 0
    };
    totals.files += 1;
    totals.pages += unitCounts.pages;
    totals.paragraphs += unitCounts.paragraphs;
    totals.units += unitCounts.totalUnits;
    files.push({
      file,
      sourceType: extraction.sourceType || null,
      extractor: {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      },
      sourceBytesHash: extraction.sourceBytesHash || null,
      sourceBytesHashAlgo: extraction.sourceBytesHashAlgo || 'sha256',
      unitCounts,
      normalizationPolicy: extraction.normalizationPolicy || null
    });
  }
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  if (!files.length) return null;
  const extractors = Array.from(extractorMap.values()).sort((a, b) => {
    const left = `${a.name || ''}|${a.version || ''}|${a.target || ''}`;
    const right = `${b.name || ''}|${b.version || ''}|${b.target || ''}`;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return {
    schemaVersion: 1,
    files,
    extractors,
    totals
  };
};

/**
 * Build indexes for one mode by running discovery/planning/stage pipeline.
 *
 * @param {{
 *  mode:'code'|'prose'|'records'|'extracted-prose',
 *  runtime:object,
 *  discovery?:{entries:Array,skippedFiles:Array},
 *  abortSignal?:AbortSignal|null
 * }} input
 * @returns {Promise<void>}
 */
export async function buildIndexForMode({ mode, runtime, discovery = null, abortSignal = null }) {
  throwIfAborted(abortSignal);
  if (mode === 'records') {
    await buildRecordsIndexForRepo({ runtime, discovery, abortSignal });
    if (runtime?.overallProgress?.advance) {
      runtime.overallProgress.advance({ message: 'records' });
    }
    return;
  }
  const crashLogger = await createCrashLogger({
    repoCacheRoot: runtime.repoCacheRoot,
    enabled: runtime.debugCrash === true,
    log
  });
  const outDir = getIndexDir(runtime.root, mode, runtime.userConfig, { indexRoot: runtime.buildRoot });
  const indexSizeBaselineBytes = await readIndexArtifactBytes(outDir);
  await fs.mkdir(outDir, { recursive: true });
  const indexingHealth = runIndexingHealthChecks({ mode, runtime, outDir });
  if (!indexingHealth.ok) {
    const firstFailure = indexingHealth.failures[0] || null;
    const message = formatHealthFailure(firstFailure);
    log(message);
    const error = new Error(message);
    error.code = firstFailure?.code || 'op_health_indexing_failed';
    error.healthReport = indexingHealth;
    throw error;
  }
  log(`[init] ${mode} index dir: ${outDir}`);
  log(`\n📄  Scanning ${mode} ...`);
  const timing = { start: Date.now() };
  const metricsDir = getMetricsDir(runtime.root, runtime.userConfig);
  const analysisFlags = resolveAnalysisFlags(runtime);
  const perfFeatures = {
    stage: runtime.stage || null,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    relations: runtime.stage !== 'stage1',
    tooling: runtime.toolingEnabled,
    typeInference: analysisFlags.typeInference,
    riskAnalysis: analysisFlags.riskAnalysis
  };
  const perfProfile = createPerfProfile({
    configHash: runtime.configHash,
    mode,
    buildId: runtime.buildId,
    features: perfFeatures
  });
  const stageCheckpoints = createStageCheckpointRecorder({
    buildRoot: runtime.buildRoot,
    metricsDir,
    mode,
    buildId: runtime.buildId
  });
  if (runtime.languageOptions?.treeSitter?.enabled !== false) {
    resetTreeSitterStats();
  }
  const featureMetrics = runtime.featureMetrics || null;
  if (featureMetrics?.registerSettings) {
    featureMetrics.registerSettings(mode, buildFeatureSettings(runtime, mode));
  }
  const priorPerfProfile = await loadPerfProfile({
    metricsDir,
    mode,
    configHash: runtime.configHash,
    log
  });
  const shardPerfProfile = priorPerfProfile?.totals?.durationMs
    ? priorPerfProfile
    : null;
  crashLogger.updatePhase(`scan:${mode}`);

  const state = createIndexState({ postingsConfig: runtime.postingsConfig });
  const cacheReporter = createCacheReporter({ enabled: runtime.verboseCache, log });
  const fileTextCache = resolveFileTextCacheForMode({
    runtime,
    mode,
    cacheReporter
  });
  const fileTextByFile = {
    get: (key) => fileTextCache.get(key),
    set: (key, value) => fileTextCache.set(key, value),
    captureBuffers: true
  };
  const seenFiles = new Set();

  const stagePlan = [
    { id: 'discover', label: 'discovery' },
    { id: 'imports', label: 'imports' },
    { id: 'processing', label: 'processing' },
    { id: 'relations', label: 'relations' },
    { id: 'postings', label: 'postings' },
    { id: 'write', label: 'write' }
  ];
  const stageTotal = stagePlan.length;
  let stageIndex = 0;
  const getSchedulerStats = () => (runtime?.scheduler?.stats ? runtime.scheduler.stats() : null);
  const schedulerTelemetry = runtime?.scheduler
    && typeof runtime.scheduler.setTelemetryOptions === 'function'
    ? runtime.scheduler
    : null;
  const queueDepthSnapshotIntervalMs = Number.isFinite(
    Number(runtime?.indexingConfig?.scheduler?.queueDepthSnapshotIntervalMs)
  )
    ? Math.max(1000, Math.floor(Number(runtime.indexingConfig.scheduler.queueDepthSnapshotIntervalMs)))
    : 5000;
  const queueDepthSnapshotFileThreshold = Number.isFinite(
    Number(runtime?.indexingConfig?.scheduler?.queueDepthSnapshotFileThreshold)
  )
    ? Math.max(1, Math.floor(Number(runtime.indexingConfig.scheduler.queueDepthSnapshotFileThreshold)))
    : 20000;
  let queueDepthSnapshotsEnabled = false;
  const setSchedulerTelemetryStage = (stageId) => {
    if (!schedulerTelemetry || typeof stageId !== 'string') return;
    schedulerTelemetry.setTelemetryOptions({ stage: stageId });
  };
  const enableQueueDepthSnapshots = () => {
    if (!schedulerTelemetry || queueDepthSnapshotsEnabled) return;
    queueDepthSnapshotsEnabled = true;
    schedulerTelemetry.setTelemetryOptions({
      queueDepthSnapshotsEnabled: true,
      queueDepthSnapshotIntervalMs
    });
  };
  if (runtime?.hugeRepoProfileEnabled === true) {
    enableQueueDepthSnapshots();
  }
  let lowUtilizationWarningEmitted = false;
  const utilizationTarget = coerceUnitFraction(runtime?.schedulerConfig?.utilizationAlertTarget)
    ?? 0.75;
  const utilizationAlertWindowMs = Number.isFinite(Number(runtime?.schedulerConfig?.utilizationAlertWindowMs))
    ? Math.max(1000, Math.floor(Number(runtime.schedulerConfig.utilizationAlertWindowMs)))
    : 15000;
  const heavyUtilizationStages = new Set(['processing', 'relations', 'postings', 'write']);
  let utilizationUnderTargetSinceMs = 0;
  let utilizationTargetWarningEmitted = false;
  const queueUtilizationUnderTargetSinceMs = new Map();
  const queueUtilizationWarningEmitted = new Set();
  let lastCpuUsage = process.cpuUsage();
  let lastCpuUsageAtMs = Date.now();

  const resolveProcessBusyPct = (cpuCount) => {
    const usage = process.cpuUsage();
    const nowMs = Date.now();
    const elapsedMs = Math.max(1, nowMs - lastCpuUsageAtMs);
    const previous = lastCpuUsage;
    lastCpuUsage = usage;
    lastCpuUsageAtMs = nowMs;
    if (!previous || !Number.isFinite(cpuCount) || cpuCount <= 0) return null;
    const userDeltaUs = Math.max(0, Number(usage.user) - Number(previous.user));
    const systemDeltaUs = Math.max(0, Number(usage.system) - Number(previous.system));
    const consumedMs = (userDeltaUs + systemDeltaUs) / 1000;
    const capacityMs = elapsedMs * cpuCount;
    if (!Number.isFinite(consumedMs) || !Number.isFinite(capacityMs) || capacityMs <= 0) return null;
    return Math.max(0, Math.min(100, (consumedMs / capacityMs) * 100));
  };
  /**
   * Capture an operational snapshot used for stage checkpoint telemetry.
   *
   * @returns {object}
   */
  const captureRuntimeSnapshot = () => {
    const schedulerStats = getSchedulerStats();
    const schedulerQueueDepth = schedulerStats?.queues
      ? Object.values(schedulerStats.queues).reduce((sum, queue) => (
        sum + (Number.isFinite(Number(queue?.pending)) ? Number(queue.pending) : 0)
      ), 0)
      : null;
    const queueInflightBytes = runtime?.queues
      ? {
        io: Number(runtime.queues.io?.inflightBytes) || 0,
        cpu: Number(runtime.queues.cpu?.inflightBytes) || 0,
        embedding: Number(runtime.queues.embedding?.inflightBytes) || 0,
        proc: Number(runtime.queues.proc?.inflightBytes) || 0
      }
      : null;
    const telemetryInflightBytes = runtime?.telemetry?.readInFlightBytes
      ? runtime.telemetry.readInFlightBytes()
      : null;
    const workerStats = runtime?.workerPool?.stats ? runtime.workerPool.stats() : null;
    const quantizeWorkerStats = runtime?.quantizePool
      && runtime.quantizePool !== runtime.workerPool
      && runtime.quantizePool?.stats
      ? runtime.quantizePool.stats()
      : null;
    const cpuCount = Array.isArray(runtime?.cpuList) && runtime.cpuList.length
      ? runtime.cpuList.length
      : (Array.isArray(os.cpus()) ? os.cpus().length : null);
    const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
    const oneMinuteLoad = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) ? loadAvg[0] : null;
    const normalizedCpuLoad = Number.isFinite(oneMinuteLoad) && Number.isFinite(cpuCount) && cpuCount > 0
      ? Math.max(0, Math.min(1, oneMinuteLoad / cpuCount))
      : null;
    const processBusyPct = resolveProcessBusyPct(cpuCount);
    const resolvedBusyPct = Number.isFinite(normalizedCpuLoad)
      ? Math.max(0, Math.min(100, Math.round(normalizedCpuLoad * 1000) / 10))
      : (Number.isFinite(processBusyPct)
        ? Math.max(0, Math.min(100, Math.round(processBusyPct * 10) / 10))
        : null);
    const totalMem = Number(os.totalmem()) || 0;
    const freeMem = Number(os.freemem()) || 0;
    const memoryUtilization = totalMem > 0
      ? Math.max(0, Math.min(1, (totalMem - freeMem) / totalMem))
      : null;
    return {
      scheduler: schedulerStats,
      cpu: {
        cores: Number.isFinite(cpuCount) ? cpuCount : null,
        loadAvg1m: oneMinuteLoad,
        normalizedLoad: normalizedCpuLoad,
        busyPct: resolvedBusyPct
      },
      memory: {
        totalBytes: totalMem > 0 ? totalMem : null,
        freeBytes: freeMem > 0 ? freeMem : null,
        utilization: memoryUtilization
      },
      queues: runtime?.queues
        ? {
          ioPending: Number.isFinite(runtime.queues.io?.size) ? runtime.queues.io.size : null,
          cpuPending: Number.isFinite(runtime.queues.cpu?.size) ? runtime.queues.cpu.size : null,
          embeddingPending: Number.isFinite(runtime.queues.embedding?.size) ? runtime.queues.embedding.size : null,
          procPending: Number.isFinite(runtime.queues.proc?.size) ? runtime.queues.proc.size : null,
          schedulerPending: schedulerQueueDepth
        }
        : null,
      inFlightBytes: {
        queue: queueInflightBytes,
        telemetry: telemetryInflightBytes,
        total: Number(
          (queueInflightBytes?.io || 0)
          + (queueInflightBytes?.cpu || 0)
          + (queueInflightBytes?.embedding || 0)
          + (queueInflightBytes?.proc || 0)
          + (telemetryInflightBytes?.total || 0)
        ) || 0
      },
      workers: {
        tokenize: workerStats || null,
        quantize: quantizeWorkerStats || null
      }
    };
  };
  const maybeWarnLowSchedulerUtilization = ({ snapshot, stage, step }) => {
    if (lowUtilizationWarningEmitted) return;
    const schedulerStats = snapshot?.scheduler;
    const utilization = Number(schedulerStats?.utilization?.overall);
    const pending = Number(schedulerStats?.activity?.pending);
    const cpuTokens = Number(schedulerStats?.tokens?.cpu?.total);
    const ioTokens = Number(schedulerStats?.tokens?.io?.total);
    const tokenBudget = Math.max(1, Math.floor((cpuTokens || 0) + (ioTokens || 0)));
    if (!Number.isFinite(utilization) || !Number.isFinite(pending)) return;
    if (pending < Math.max(64, tokenBudget * 4)) return;
    if (utilization >= 0.35) return;
    lowUtilizationWarningEmitted = true;
    log(
      `[perf] scheduler under-utilization detected at ${stage}${step ? `/${step}` : ''}: ` +
      `utilization=${utilization.toFixed(2)}, pending=${Math.floor(pending)}, ` +
      `tokens(cpu=${Math.floor(cpuTokens || 0)}, io=${Math.floor(ioTokens || 0)}).`
    );
  };
  const maybeWarnUtilizationTarget = ({ snapshot, stage, step }) => {
    if (!heavyUtilizationStages.has(String(step || stage || '').toLowerCase())) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    const schedulerStats = snapshot?.scheduler;
    const utilization = Number(schedulerStats?.utilization?.overall);
    const pending = Number(schedulerStats?.activity?.pending);
    const cpuTokens = Number(schedulerStats?.tokens?.cpu?.total);
    const ioTokens = Number(schedulerStats?.tokens?.io?.total);
    const tokenBudget = Math.max(1, Math.floor((cpuTokens || 0) + (ioTokens || 0)));
    if (!Number.isFinite(utilization) || !Number.isFinite(pending)) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (pending < Math.max(16, tokenBudget * 2)) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (utilization >= utilizationTarget) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    const now = Date.now();
    if (!utilizationUnderTargetSinceMs) {
      utilizationUnderTargetSinceMs = now;
      return;
    }
    if (utilizationTargetWarningEmitted) return;
    const underMs = now - utilizationUnderTargetSinceMs;
    if (underMs < utilizationAlertWindowMs) return;
    utilizationTargetWarningEmitted = true;
    const underSeconds = Math.max(1, Math.round(underMs / 1000));
    log(
      `[perf] sustained scheduler utilization below target at ${stage}${step ? `/${step}` : ''}: ` +
      `utilization=${utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, ` +
      `pending=${Math.floor(pending)}, duration=${underSeconds}s.`
    );
    stageCheckpoints.record({
      stage: 'scheduler',
      step: 'utilization-target-breach',
      label: `${stage}${step ? `/${step}` : ''}`,
      extra: {
        utilization,
        target: utilizationTarget,
        pending: Math.floor(pending),
        durationMs: underMs
      }
    });
  };
  const maybeWarnQueueUtilizationTarget = ({ snapshot, stage, step }) => {
    const schedulerStats = snapshot?.scheduler;
    const queues = schedulerStats?.queues && typeof schedulerStats.queues === 'object'
      ? schedulerStats.queues
      : null;
    if (!queues) return;
    const now = Date.now();
    for (const [queueName, queueStats] of Object.entries(queues)) {
      const pending = Math.max(0, Number(queueStats?.pending) || 0);
      const running = Math.max(0, Number(queueStats?.running) || 0);
      const demand = pending + running;
      const key = String(queueName || '');
      const warningKey = `${stage || 'unknown'}:${key}`;
      if (!key || demand < 4) {
        queueUtilizationUnderTargetSinceMs.delete(key);
        queueUtilizationWarningEmitted.delete(warningKey);
        continue;
      }
      const utilization = running / Math.max(1, demand);
      if (!Number.isFinite(utilization) || utilization >= utilizationTarget) {
        queueUtilizationUnderTargetSinceMs.delete(key);
        queueUtilizationWarningEmitted.delete(warningKey);
        continue;
      }
      const since = queueUtilizationUnderTargetSinceMs.get(key) || now;
      queueUtilizationUnderTargetSinceMs.set(key, since);
      const underMs = now - since;
      if (underMs < utilizationAlertWindowMs) continue;
      if (queueUtilizationWarningEmitted.has(warningKey)) continue;
      queueUtilizationWarningEmitted.add(warningKey);
      log(
        `[perf] sustained queue utilization below target at ${stage}${step ? `/${step}` : ''}: ` +
        `queue=${key}, utilization=${utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, ` +
        `pending=${pending}, running=${running}, durationMs=${underMs}.`
      );
      stageCheckpoints.record({
        stage: 'scheduler',
        step: 'queue-utilization-target-breach',
        label: `${stage}${step ? `/${step}` : ''}:${key}`,
        extra: {
          queue: key,
          utilization,
          target: utilizationTarget,
          pending,
          running,
          durationMs: underMs
        }
      });
    }
  };
  /**
   * Record a stage checkpoint enriched with the current runtime snapshot.
   *
   * @param {object} input
   * @param {string} input.stage
   * @param {string|null} [input.step]
   * @param {string|null} [input.label]
   * @param {object|null} [input.extra]
   */
  const recordStageCheckpoint = ({
    stage,
    step = null,
    label = null,
    extra = null
  }) => {
    const safeExtra = extra && typeof extra === 'object' ? extra : {};
    const runtimeSnapshot = captureRuntimeSnapshot();
    const persistedRuntimeSnapshot = sanitizeRuntimeSnapshotForCheckpoint(runtimeSnapshot);
    stageCheckpoints.record({
      stage,
      step,
      label,
      extra: {
        ...safeExtra,
        runtime: persistedRuntimeSnapshot
      }
    });
    maybeWarnLowSchedulerUtilization({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
    maybeWarnUtilizationTarget({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
    maybeWarnQueueUtilizationTarget({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
  };
  const advanceStage = (stage) => {
    if (runtime?.overallProgress?.advance && stageIndex > 0) {
      const prevStage = stagePlan[stageIndex - 1];
      runtime.overallProgress.advance({ message: `${mode} ${prevStage.label}` });
    }
    stageIndex += 1;
    setSchedulerTelemetryStage(stage.id);
    showProgress('Stage', stageIndex, stageTotal, {
      taskId: `stage:${mode}`,
      stage: stage.id,
      mode,
      message: stage.label,
      scheduler: getSchedulerStats()
    });
  };

  advanceStage(stagePlan[0]);
  const discoveryResult = await runWithOperationalFailurePolicy({
    target: 'indexing.hotpath',
    operation: 'discovery',
    log,
    execute: async () => runDiscovery({
      runtime,
      mode,
      discovery,
      state,
      timing,
      stageNumber: stageIndex,
      abortSignal
    })
  });
  const allEntries = discoveryResult.value;
  if (!queueDepthSnapshotsEnabled && allEntries.length >= queueDepthSnapshotFileThreshold) {
    enableQueueDepthSnapshots();
  }
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'discovery',
    extra: {
      files: allEntries.length,
      skipped: state.skippedFiles?.length || 0
    }
  });
  await recordOrderingSeedInputs(runtime.buildRoot, {
    discoveryHash: state.discoveryHash,
    fileListHash: state.fileListHash,
    fileCount: allEntries.length
  }, { stage: 'stage1', mode });
  throwIfAborted(abortSignal);
  const dictConfig = applyAdaptiveDictConfig(runtime.dictConfig, allEntries.length);
  const tinyRepoFastPath = resolveTinyRepoFastPath({ runtime, entries: allEntries });
  const tinyRepoFastPathActive = tinyRepoFastPath.active === true;
  const runtimeRefBase = dictConfig === runtime.dictConfig
    ? runtime
    : { ...runtime, dictConfig };
  const runtimeRef = tinyRepoFastPathActive
    ? {
      ...runtimeRefBase,
      // Tiny-repo fast path: disable expensive cross-file analysis passes.
      typeInferenceEnabled: false,
      typeInferenceCrossFileEnabled: false,
      riskAnalysisCrossFileEnabled: false,
      tinyRepoFastPath
    }
    : runtimeRefBase;
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtimeRef);
  state.vectorOnlyShortcuts = vectorOnlyShortcuts.enabled
    ? {
      disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
      disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
    }
    : null;
  state.tinyRepoFastPath = tinyRepoFastPathActive
    ? {
      active: true,
      estimatedLines: tinyRepoFastPath.estimatedLines,
      totalBytes: tinyRepoFastPath.totalBytes,
      fileCount: tinyRepoFastPath.fileCount,
      disableImportGraph: tinyRepoFastPath.disableImportGraph,
      disableCrossFileInference: tinyRepoFastPath.disableCrossFileInference,
      minimalArtifacts: tinyRepoFastPath.minimalArtifacts
    }
    : null;
  if (vectorOnlyShortcuts.enabled) {
    log(
      '[vector_only] analysis shortcuts: '
      + `disableImportGraph=${vectorOnlyShortcuts.disableImportGraph}, `
      + `disableCrossFileInference=${vectorOnlyShortcuts.disableCrossFileInference}.`
    );
  }
  if (tinyRepoFastPathActive) {
    log(
      `[tiny_repo] fast path active: files=${tinyRepoFastPath.fileCount}, ` +
      `bytes=${tinyRepoFastPath.totalBytes}, estimatedLines=${tinyRepoFastPath.estimatedLines}, ` +
      `disableImportGraph=${tinyRepoFastPath.disableImportGraph}, ` +
      `disableCrossFileInference=${tinyRepoFastPath.disableCrossFileInference}, ` +
      `minimalArtifacts=${tinyRepoFastPath.minimalArtifacts}.`
    );
  }
  await updateBuildState(runtimeRef.buildRoot, {
    analysisShortcuts: {
      [mode]: {
        profileId: vectorOnlyShortcuts.profileId,
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference,
        tinyRepoFastPath: tinyRepoFastPathActive
          ? {
            estimatedLines: tinyRepoFastPath.estimatedLines,
            totalBytes: tinyRepoFastPath.totalBytes,
            fileCount: tinyRepoFastPath.fileCount,
            disableImportGraph: tinyRepoFastPath.disableImportGraph,
            disableCrossFileInference: tinyRepoFastPath.disableCrossFileInference,
            minimalArtifacts: tinyRepoFastPath.minimalArtifacts
          }
          : null
      }
    }
  });
  const vectorOnlyProfile = runtimeRef?.profile?.id === INDEX_PROFILE_VECTOR_ONLY;
  if (vectorOnlyProfile && !hasVectorEmbeddingBuildCapability(runtimeRef)) {
    throw new Error(
      'indexing.profile=vector_only requires embeddings to be available during index build. ' +
      'Enable inline/stub embeddings or service-mode embedding queueing and rebuild.'
    );
  }
  const tokenizationKey = buildTokenizationKey(runtimeRef, mode);
  const cacheSignature = buildIncrementalSignature(runtimeRef, mode, tokenizationKey);
  const cacheSignatureSummary = buildIncrementalSignatureSummary(runtimeRef, mode, tokenizationKey);
  await updateBuildState(runtimeRef.buildRoot, {
    signatures: {
      [mode]: {
        tokenizationKey,
        cacheSignature,
        signatureVersion: SIGNATURE_VERSION
      }
    }
  });
  const {
    profilePath: modalitySparsityProfilePath,
    profile: modalitySparsityProfile
  } = await readModalitySparsityProfile(runtimeRef);
  const {
    profilePath: extractedProseYieldProfilePath,
    profile: extractedProseYieldProfile
  } = mode === 'extracted-prose'
    ? await readExtractedProseYieldProfile(runtimeRef)
    : { profilePath: null, profile: createEmptyExtractedProseYieldProfile() };
  const extractedProseYieldProfileSelection = mode === 'extracted-prose'
    ? selectExtractedProseYieldProfileEntry({
      profile: extractedProseYieldProfile,
      mode,
      cacheSignature
    })
    : { key: null, source: null, entry: null };
  const documentExtractionEnabledForMode = mode === 'extracted-prose'
    && runtimeRef?.indexingConfig?.documentExtraction?.enabled === true;
  const {
    cachePath: documentExtractionCachePath,
    cache: documentExtractionCache
  } = documentExtractionEnabledForMode
    ? await readDocumentExtractionCache(runtimeRef)
    : { cachePath: null, cache: createEmptyDocumentExtractionCache() };
  const documentExtractionCacheRuntime = documentExtractionEnabledForMode
    ? createDocumentExtractionCacheRuntime({
      runtime: runtimeRef,
      cachePath: documentExtractionCachePath,
      cache: documentExtractionCache
    })
    : null;
  const modalitySparsityKey = buildModalitySparsityEntryKey({ mode, cacheSignature });
  const cachedModalitySparsity = modalitySparsityProfile?.entries?.[modalitySparsityKey] || null;
  const cachedZeroModality = shouldElideModalityProcessingStage({
    fileCount: cachedModalitySparsity?.fileCount ?? null,
    chunkCount: cachedModalitySparsity?.chunkCount ?? null
  });
  const { incrementalState, reused } = await loadIncrementalPlan({
    runtime: runtimeRef,
    mode,
    outDir,
    entries: allEntries,
    tokenizationKey,
    cacheSignature,
    cacheSignatureSummary,
    cacheReporter
  });
  if (reused) {
    recordStageCheckpoint({
      stage: 'stage1',
      step: 'incremental',
      label: 'reused',
      extra: { files: allEntries.length }
    });
    await stageCheckpoints.flush();
    cacheReporter.report();
    return;
  }

  const relationsEnabled = runtimeRef.stage !== 'stage1';
  const importGraphEnabled = relationsEnabled
    && !vectorOnlyShortcuts.disableImportGraph
    && !(tinyRepoFastPathActive && tinyRepoFastPath.disableImportGraph);
  const crossFileInferenceEnabled = relationsEnabled
    && !vectorOnlyShortcuts.disableCrossFileInference
    && !(tinyRepoFastPathActive && tinyRepoFastPath.disableCrossFileInference);
  advanceStage(stagePlan[1]);
  let { importResult, scanPlan } = await preScanImports({
    runtime: runtimeRef,
    mode,
    relationsEnabled: importGraphEnabled,
    entries: allEntries,
    crashLogger,
    timing,
    incrementalState,
    fileTextByFile,
    abortSignal
  });
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'imports',
    extra: {
      imports: importResult?.stats
        ? {
          modules: Number(importResult.stats.modules) || 0,
          edges: Number(importResult.stats.edges) || 0,
          files: Number(importResult.stats.files) || 0
        }
        : { modules: 0, edges: 0, files: 0 }
    }
  });
  throwIfAborted(abortSignal);

  const shouldElideProcessingStage = shouldElideModalityProcessingStage({
    fileCount: allEntries.length,
    chunkCount: state?.chunks?.length || 0
  });

  let processResult = {
    tokenizationStats: null,
    shardSummary: null,
    postingsQueueStats: null,
    stageElided: false
  };
  if (shouldElideProcessingStage) {
    const elisionSource = cachedZeroModality ? 'sparsity-cache-hit' : 'discovery';
    advanceStage(stagePlan[2]);
    processResult = {
      ...processResult,
      stageElided: true
    };
    log(
      `[stage1:${mode}] processing stage elided (zero modality: files=0, chunks=0; source=${elisionSource}).`
    );
    state.modalityStageElisions = {
      ...(state.modalityStageElisions || {}),
      [mode]: {
        source: elisionSource,
        cacheSignature,
        fileCount: 0,
        chunkCount: 0
      }
    };
  } else {
    const contextWin = await estimateContextWindow({
      files: allEntries.map((entry) => entry.abs),
      root: runtimeRef.root,
      mode,
      languageOptions: runtimeRef.languageOptions
    });
    log(`Auto-selected context window: ${contextWin} lines`);

    advanceStage(stagePlan[2]);
    processResult = await processFiles({
      mode,
      runtime: runtimeRef,
      discovery,
      outDir,
      entries: allEntries,
      contextWin,
      timing,
      crashLogger,
      state,
      perfProfile,
      cacheReporter,
      seenFiles,
      incrementalState,
      relationsEnabled,
      shardPerfProfile,
      fileTextCache,
      extractedProseYieldProfile: extractedProseYieldProfileSelection?.entry || null,
      documentExtractionCache: documentExtractionCacheRuntime,
      abortSignal
    });
  }
  throwIfAborted(abortSignal);
  const {
    tokenizationStats,
    shardSummary,
    postingsQueueStats,
    extractedProseYieldProfile: extractedProseYieldProfileObservation
  } = processResult;
  const summarizePostingsQueue = (stats) => {
    if (!stats || typeof stats !== 'object') return null;
    return {
      limits: stats.limits || null,
      highWater: stats.highWater || null,
      backpressure: stats.backpressure || null,
      oversize: stats.oversize || null,
      memory: stats.memory || null
    };
  };
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'processing',
    extra: {
      files: allEntries.length,
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenPostings: state.tokenPostings?.size || 0,
      phrasePostings: state.phrasePost?.size || 0,
      chargramPostings: state.triPost?.size || 0,
      fieldPostings: countFieldEntries(state.fieldPostings),
      fieldDocLengths: countFieldArrayEntries(state.fieldDocLengths),
      treeSitter: getTreeSitterStats(),
      postingsQueue: summarizePostingsQueue(postingsQueueStats),
      stageElided: processResult?.stageElided === true,
      sparsityCacheHit: processResult?.stageElided === true && cachedZeroModality === true
    }
  });
  await updateBuildState(runtimeRef.buildRoot, {
    counts: {
      [mode]: {
        files: allEntries.length,
        chunks: state.chunks?.length || 0,
        skipped: state.skippedFiles?.length || 0
      }
    }
  });
  await writeModalitySparsityEntry({
    runtime: runtimeRef,
    profilePath: modalitySparsityProfilePath,
    profile: modalitySparsityProfile,
    mode,
    cacheSignature,
    fileCount: allEntries.length,
    chunkCount: state.chunks?.length || 0,
    elided: processResult?.stageElided === true,
    source: processResult?.stageElided === true
      ? (cachedZeroModality ? 'sparsity-cache-hit' : 'discovery')
      : 'observed'
  });
  if (mode === 'extracted-prose') {
    await writeExtractedProseYieldProfileEntry({
      runtime: runtimeRef,
      profilePath: extractedProseYieldProfilePath,
      profile: extractedProseYieldProfile,
      mode,
      cacheSignature,
      observation: extractedProseYieldProfileObservation
    });
    await writeDocumentExtractionCacheRuntime(documentExtractionCacheRuntime);
    const extractionSummary = summarizeDocumentExtractionForMode(state);
    if (extractionSummary) {
      await updateBuildState(runtimeRef.buildRoot, {
        documentExtraction: {
          [mode]: extractionSummary
        }
      });
    }
  }

  const postImportResult = await postScanImports({
    mode,
    relationsEnabled: importGraphEnabled,
    scanPlan,
    state,
    timing,
    runtime: runtimeRef,
    entries: allEntries,
    importResult,
    incrementalState,
    fileTextByFile
  });
  if (postImportResult) importResult = postImportResult;

  const incrementalBundleVfsRowsPromise = mode === 'code'
    && crossFileInferenceEnabled
    && runtimeRef.incrementalEnabled === true
    ? prepareIncrementalBundleVfsRows({
      runtime: runtimeRef,
      incrementalState,
      enabled: true
    })
    : null;

  const overlapConfig = runtimeRef?.indexingConfig?.pipelineOverlap
    && typeof runtimeRef.indexingConfig.pipelineOverlap === 'object'
    ? runtimeRef.indexingConfig.pipelineOverlap
    : {};
  const overlapInferPostings = mode === 'code'
    && overlapConfig.enabled !== false
    && overlapConfig.inferPostings !== false
    && crossFileInferenceEnabled;
  const runPostingsBuild = () => (runtimeRef.scheduler?.schedule
    ? runtimeRef.scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage1Postings,
      { cpu: 1 },
      () => buildIndexPostings({ runtime: runtimeRef, state, incrementalState })
    )
    : buildIndexPostings({ runtime: runtimeRef, state, incrementalState }));
  const postingsPromise = overlapInferPostings ? runPostingsBuild() : null;
  if (postingsPromise) {
    // Avoid transient unhandled-rejection noise before the awaited join point.
    postingsPromise.catch(() => {});
  }

  advanceStage(stagePlan[3]);
  let crossFileEnabled = false;
  let graphRelations = null;
  if (crossFileInferenceEnabled || importGraphEnabled) {
    const relationsResult = await (runtimeRef.scheduler?.schedule
      ? runtimeRef.scheduler.schedule(
        SCHEDULER_QUEUE_NAMES.stage2Relations,
        { cpu: 1, mem: 1 },
        () => runCrossFileInference({
          runtime: runtimeRef,
          mode,
          state,
          crashLogger,
          featureMetrics,
          relationsEnabled: importGraphEnabled,
          crossFileInferenceEnabled,
          abortSignal
        })
      )
      : runCrossFileInference({
        runtime: runtimeRef,
        mode,
        state,
        crashLogger,
        featureMetrics,
        relationsEnabled: importGraphEnabled,
        crossFileInferenceEnabled,
        abortSignal
      }));
    crossFileEnabled = relationsResult?.crossFileEnabled === true;
    graphRelations = relationsResult?.graphRelations || null;
  } else if (tinyRepoFastPathActive) {
    log(`[tiny_repo] skipping relations stage for ${mode} (tiny-repo fast path).`);
  }
  throwIfAborted(abortSignal);
  recordStageCheckpoint({
    stage: 'stage2',
    step: 'relations',
    extra: {
      fileRelations: state.fileRelations?.size || 0,
      importGraphCache: postImportResult?.cacheStats
        ? {
          files: Number(postImportResult.cacheStats.files) || 0,
          filesHashed: Number(postImportResult.cacheStats.filesHashed) || 0,
          filesReused: Number(postImportResult.cacheStats.filesReused) || 0,
          filesInvalidated: Number(postImportResult.cacheStats.filesInvalidated) || 0,
          specs: Number(postImportResult.cacheStats.specs) || 0,
          specsReused: Number(postImportResult.cacheStats.specsReused) || 0,
          specsComputed: Number(postImportResult.cacheStats.specsComputed) || 0,
          packageInvalidated: postImportResult.cacheStats.packageInvalidated === true,
          reuseRatio: postImportResult.cacheStats.files
            ? Number(postImportResult.cacheStats.filesReused || 0) / Number(postImportResult.cacheStats.files || 1)
            : 0
        }
        : null,
      importGraph: state.importResolutionGraph?.stats
        ? {
          files: Number(state.importResolutionGraph.stats.files) || 0,
          nodes: Number(state.importResolutionGraph.stats.nodes) || 0,
          edges: Number(state.importResolutionGraph.stats.edges) || 0,
          resolved: Number(state.importResolutionGraph.stats.resolved) || 0,
          external: Number(state.importResolutionGraph.stats.external) || 0,
          unresolved: Number(state.importResolutionGraph.stats.unresolved) || 0,
          truncatedEdges: Number(state.importResolutionGraph.stats.truncatedEdges) || 0,
          truncatedNodes: Number(state.importResolutionGraph.stats.truncatedNodes) || 0,
          warningSuppressed: Number(state.importResolutionGraph.stats.warningSuppressed) || 0
        }
        : null,
      graphs: summarizeGraphRelations(graphRelations),
      shortcuts: {
        importGraphEnabled,
        crossFileInferenceEnabled,
        tinyRepoFastPathActive
      }
    }
  });
  const envConfig = getEnvConfig();
  if (envConfig.verbose === true && tokenizationStats.chunks) {
    const avgTokens = (tokenizationStats.tokens / tokenizationStats.chunks).toFixed(1);
    const avgChargrams = (tokenizationStats.chargrams / tokenizationStats.chunks).toFixed(1);
    log(`[tokenization] ${mode}: chunks=${tokenizationStats.chunks}, tokens=${tokenizationStats.tokens}, avgTokens=${avgTokens}, avgChargrams=${avgChargrams}`);
  }

  await pruneIncrementalState({
    runtime: runtimeRef,
    incrementalState,
    seenFiles
  });

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  advanceStage(stagePlan[4]);
  throwIfAborted(abortSignal);
  const postings = postingsPromise
    ? await postingsPromise
    : await runPostingsBuild();
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'postings',
    extra: {
      tokenVocab: postings.tokenVocab?.length || 0,
      phraseVocab: postings.phraseVocab?.length || 0,
      chargramVocab: postings.chargramVocab?.length || 0,
      chargramStats: postings.chargramStats || null,
      postingsMerge: postings.postingsMergeStats || null,
      denseVectors: postings.quantizedVectors?.length || 0,
      docVectors: postings.quantizedDocVectors?.length || 0,
      codeVectors: postings.quantizedCodeVectors?.length || 0,
      overlapInferPostings
    }
  });

  advanceStage(stagePlan[5]);
  throwIfAborted(abortSignal);
  await writeIndexArtifactsForMode({
    runtime: runtimeRef,
    mode,
    outDir,
    state,
    postings,
    timing,
    entries: allEntries,
    perfProfile,
    graphRelations,
    shardSummary,
    stageCheckpoints
  });
  if (runtimeRef.incrementalEnabled === true) {
    // Write incremental bundles after artifact finalization so bundle metaV2
    // stays byte-for-byte aligned with emitted chunk_meta.
    const existingVfsManifestRowsByFile = mode === 'code' && crossFileEnabled && incrementalBundleVfsRowsPromise
      ? await incrementalBundleVfsRowsPromise
      : null;
    await updateIncrementalBundles({
      runtime: runtimeRef,
      incrementalState,
      state,
      existingVfsManifestRowsByFile,
      log
    });
  }
  const vfsStats = state.vfsManifestStats || state.vfsManifestCollector?.stats || null;
  const vfsExtra = vfsStats
    ? {
      rows: vfsStats.totalRecords || 0,
      bytes: vfsStats.totalBytes || 0,
      maxLineBytes: vfsStats.maxLineBytes || 0,
      trimmedRows: vfsStats.trimmedRows || 0,
      droppedRows: vfsStats.droppedRows || 0,
      runsSpilled: vfsStats.runsSpilled || 0
    }
    : null;
  recordStageCheckpoint({
    stage: 'stage2',
    step: 'write',
    extra: {
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenVocab: postings.tokenVocab?.length || 0,
      vfsManifest: vfsExtra
    }
  });
  const indexSizeCurrentBytes = await readIndexArtifactBytes(outDir);
  const indexGrowth = evaluateResourceGrowth({
    baselineBytes: indexSizeBaselineBytes,
    currentBytes: indexSizeCurrentBytes,
    ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.indexSizeRatio,
    deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.indexSizeDeltaBytes
  });
  if (indexGrowth.abnormal) {
    log(formatResourceGrowthWarning({
      code: RESOURCE_WARNING_CODES.INDEX_SIZE_GROWTH_ABNORMAL,
      component: 'indexing',
      metric: `${mode}.artifact_bytes`,
      growth: indexGrowth,
      nextAction: 'Review indexing inputs or profile artifact bloat before release.'
    }));
  }
  throwIfAborted(abortSignal);
  if (runtimeRef?.overallProgress?.advance) {
    const finalStage = stagePlan[stagePlan.length - 1];
    runtimeRef.overallProgress.advance({ message: `${mode} ${finalStage.label}` });
  }
  await writeSchedulerAutoTuneProfile({
    repoCacheRoot: runtimeRef.repoCacheRoot,
    schedulerStats: getSchedulerStats(),
    schedulerConfig: runtimeRef.schedulerConfig,
    buildId: runtimeRef.buildId,
    log
  });
  await enqueueEmbeddingJob({ runtime: runtimeRef, mode, indexDir: outDir, abortSignal });
  crashLogger.updatePhase('done');
  cacheReporter.report();
  await stageCheckpoints.flush();
}

export const indexerPipelineInternals = Object.freeze({
  resolveModalitySparsityProfilePath,
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  writeModalitySparsityEntry,
  shouldElideModalityProcessingStage,
  resolveTinyRepoFastPath,
  sanitizeRuntimeSnapshotForCheckpoint
});
