import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';

const CACHE_VERSION = 3;
const CACHE_FILE = 'import-resolution-cache.json';
const CACHE_DIAGNOSTICS_VERSION = 1;

const isObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeStringList = (value) => {
  if (!Array.isArray(value)) return [];
  const deduped = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return Array.from(deduped.values()).sort((a, b) => a.localeCompare(b));
};

const normalizeCount = (value, { allowNegative = false } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (!allowNegative && numeric < 0) return 0;
  return Math.trunc(numeric);
};

const normalizeCategoryCounts = (counts, { allowNegative = false } = {}) => {
  if (!isObject(counts)) return Object.create(null);
  const entries = Object.entries(counts)
    .filter(([category]) => typeof category === 'string' && category.trim())
    .map(([category, value]) => [category.trim(), normalizeCount(value, { allowNegative })])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const output = Object.create(null);
  for (const [category, count] of entries) {
    if (!allowNegative && count < 0) continue;
    output[category] = count;
  }
  return output;
};

const normalizeUnresolvedSnapshot = (raw) => {
  if (!isObject(raw)) return null;
  const categories = normalizeCategoryCounts(raw.categories);
  const categoriesTotal = Object.values(categories).reduce((sum, value) => sum + value, 0);
  const rawTotal = Number(raw.total);
  const total = Number.isFinite(rawTotal) && rawTotal >= 0
    ? Math.trunc(rawTotal)
    : categoriesTotal;
  const liveSuppressedRaw = Number(raw.liveSuppressed);
  const liveSuppressed = Number.isFinite(liveSuppressedRaw) && liveSuppressedRaw >= 0
    ? Math.min(total, Math.trunc(liveSuppressedRaw))
    : 0;
  const actionableRaw = Number(raw.actionable);
  const actionable = Number.isFinite(actionableRaw) && actionableRaw >= 0
    ? Math.min(total, Math.trunc(actionableRaw))
    : Math.max(0, total - liveSuppressed);
  return {
    total,
    actionable,
    liveSuppressed,
    categories,
    liveSuppressedCategories: normalizeStringList(raw.liveSuppressedCategories)
  };
};

const normalizeSuppressionPolicy = (raw) => {
  if (!isObject(raw)) return { liveSuppressedCategories: [] };
  return {
    liveSuppressedCategories: normalizeStringList(raw.liveSuppressedCategories)
  };
};

const normalizeDiagnostics = (raw) => {
  if (!isObject(raw)) return null;
  const unresolvedTrendRaw = isObject(raw.unresolvedTrend) ? raw.unresolvedTrend : {};
  const unresolvedTrend = {
    previous: normalizeUnresolvedSnapshot(unresolvedTrendRaw.previous),
    current: normalizeUnresolvedSnapshot(unresolvedTrendRaw.current),
    deltaTotal: Number.isFinite(Number(unresolvedTrendRaw.deltaTotal))
      ? Math.trunc(Number(unresolvedTrendRaw.deltaTotal))
      : null,
    deltaByCategory: normalizeCategoryCounts(unresolvedTrendRaw.deltaByCategory, { allowNegative: true })
  };
  return {
    version: CACHE_DIAGNOSTICS_VERSION,
    suppressionPolicy: normalizeSuppressionPolicy(raw.suppressionPolicy),
    unresolvedTrend
  };
};

const createEmptyCache = () => ({
  version: CACHE_VERSION,
  generatedAt: null,
  packageFingerprint: null,
  fileSetFingerprint: null,
  cacheKey: null,
  files: {},
  lookup: null,
  diagnostics: null
});

const buildCategoryDelta = (previous, current) => {
  const previousCounts = normalizeCategoryCounts(previous || {});
  const currentCounts = normalizeCategoryCounts(current || {});
  const keys = new Set([
    ...Object.keys(previousCounts),
    ...Object.keys(currentCounts)
  ]);
  const orderedKeys = Array.from(keys.values()).sort((a, b) => a.localeCompare(b));
  const delta = Object.create(null);
  for (const key of orderedKeys) {
    const prev = previousCounts[key] || 0;
    const next = currentCounts[key] || 0;
    delta[key] = next - prev;
  }
  return delta;
};

const buildSnapshotFromTaxonomy = ({ unresolvedTaxonomy, unresolvedTotal }) => {
  const taxonomy = isObject(unresolvedTaxonomy) ? unresolvedTaxonomy : {};
  const categories = normalizeCategoryCounts(taxonomy.categories);
  const categoriesTotal = Object.values(categories).reduce((sum, value) => sum + value, 0);
  const candidateTotal = Number(unresolvedTotal);
  const taxonomyTotal = Number(taxonomy.total);
  const total = Number.isFinite(candidateTotal) && candidateTotal >= 0
    ? Math.trunc(candidateTotal)
    : (
      Number.isFinite(taxonomyTotal) && taxonomyTotal >= 0
        ? Math.trunc(taxonomyTotal)
        : categoriesTotal
    );
  const liveSuppressedRaw = Number(taxonomy.liveSuppressed);
  const liveSuppressed = Number.isFinite(liveSuppressedRaw) && liveSuppressedRaw >= 0
    ? Math.min(total, Math.trunc(liveSuppressedRaw))
    : 0;
  const actionableRaw = Number(taxonomy.actionable);
  const actionable = Number.isFinite(actionableRaw) && actionableRaw >= 0
    ? Math.min(total, Math.trunc(actionableRaw))
    : Math.max(0, total - liveSuppressed);
  return {
    total,
    actionable,
    liveSuppressed,
    categories,
    liveSuppressedCategories: normalizeStringList(taxonomy.liveSuppressedCategories)
  };
};

const normalizeCache = (raw) => {
  if (!isObject(raw)) return null;
  if (Number(raw.version) !== CACHE_VERSION) return null;
  const files = isObject(raw.files) ? raw.files : {};
  const lookup = isObject(raw.lookup) ? raw.lookup : null;
  const normalizedLookup = lookup
    ? {
      compatibilityFingerprint: typeof lookup.compatibilityFingerprint === 'string'
        ? lookup.compatibilityFingerprint
        : null,
      rootHash: typeof lookup.rootHash === 'string' ? lookup.rootHash : null,
      fileSetFingerprint: typeof lookup.fileSetFingerprint === 'string'
        ? lookup.fileSetFingerprint
        : null,
      hasTsconfig: lookup.hasTsconfig === true,
      fileSet: Array.isArray(lookup.fileSet)
        ? lookup.fileSet.filter((entry) => typeof entry === 'string')
        : [],
      fileLower: isObject(lookup.fileLower) ? lookup.fileLower : {},
      pathTrie: isObject(lookup.pathTrie) ? lookup.pathTrie : null
    }
    : null;
  return {
    version: CACHE_VERSION,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
    packageFingerprint: typeof raw.packageFingerprint === 'string' ? raw.packageFingerprint : null,
    fileSetFingerprint: typeof raw.fileSetFingerprint === 'string' ? raw.fileSetFingerprint : null,
    cacheKey: typeof raw.cacheKey === 'string' ? raw.cacheKey : null,
    files,
    lookup: normalizedLookup,
    diagnostics: normalizeDiagnostics(raw.diagnostics)
  };
};

export const resolveImportResolutionCachePath = (incrementalState) => {
  const dir = incrementalState?.incrementalDir;
  if (!dir) return null;
  return path.join(dir, CACHE_FILE);
};

export const loadImportResolutionCache = async ({ incrementalState, log = null } = {}) => {
  const cachePath = resolveImportResolutionCachePath(incrementalState);
  if (!cachePath || !fsSync.existsSync(cachePath)) {
    return {
      cache: createEmptyCache(),
      cachePath
    };
  }
  try {
    const raw = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    const normalized = normalizeCache(raw);
    if (normalized) return { cache: normalized, cachePath };
  } catch (err) {
    if (typeof log === 'function') {
      log(`[imports] Failed to read import resolution cache: ${err?.message || err}`);
    }
  }
  return {
    cache: createEmptyCache(),
    cachePath
  };
};

export const saveImportResolutionCache = async ({ cache, cachePath } = {}) => {
  if (!cachePath || !cache) return;
  const payload = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    packageFingerprint: typeof cache.packageFingerprint === 'string' ? cache.packageFingerprint : null,
    fileSetFingerprint: typeof cache.fileSetFingerprint === 'string' ? cache.fileSetFingerprint : null,
    cacheKey: typeof cache.cacheKey === 'string' ? cache.cacheKey : null,
    files: isObject(cache.files) ? cache.files : {},
    lookup: isObject(cache.lookup) ? cache.lookup : null,
    diagnostics: normalizeDiagnostics(cache.diagnostics)
  };
  try {
    await atomicWriteJson(cachePath, payload, { spaces: 2 });
  } catch {
    // ignore cache write failures
  }
};

export const updateImportResolutionDiagnosticsCache = ({
  cache,
  unresolvedTaxonomy,
  unresolvedTotal = null
} = {}) => {
  if (!isObject(cache)) return null;
  const normalizedExisting = normalizeDiagnostics(cache.diagnostics);
  const previousCurrent = normalizedExisting?.unresolvedTrend?.current || null;
  const current = buildSnapshotFromTaxonomy({ unresolvedTaxonomy, unresolvedTotal });
  const suppressionCategories = current.liveSuppressedCategories.length
    ? current.liveSuppressedCategories
    : normalizeStringList(normalizedExisting?.suppressionPolicy?.liveSuppressedCategories);
  const diagnostics = {
    version: CACHE_DIAGNOSTICS_VERSION,
    suppressionPolicy: {
      liveSuppressedCategories: suppressionCategories
    },
    unresolvedTrend: {
      previous: previousCurrent,
      current,
      deltaTotal: previousCurrent ? (current.total - previousCurrent.total) : null,
      deltaByCategory: buildCategoryDelta(previousCurrent?.categories || {}, current.categories)
    }
  };
  cache.diagnostics = diagnostics;
  return diagnostics;
};

