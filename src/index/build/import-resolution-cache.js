import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { sha1 } from '../../shared/hash.js';
import {
  IMPORT_DISPOSITIONS,
  IMPORT_FAILURE_CAUSES,
  IMPORT_REASON_CODES,
  IMPORT_RESOLVER_STAGES
} from './import-resolution/reason-codes.js';

const CACHE_VERSION = 5;
const CACHE_FILE = 'import-resolution-cache.json';
const CACHE_DIAGNOSTICS_VERSION = 4;
const IMPORT_SPEC_CANDIDATE_EXTENSIONS = Object.freeze([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.node',
  '.d.ts'
]);

const isObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
const KNOWN_REASON_CODES = new Set(Object.values(IMPORT_REASON_CODES));
const KNOWN_FAILURE_CAUSES = new Set(Object.values(IMPORT_FAILURE_CAUSES));
const KNOWN_DISPOSITIONS = new Set(Object.values(IMPORT_DISPOSITIONS));
const KNOWN_RESOLVER_STAGES = new Set(Object.values(IMPORT_RESOLVER_STAGES));

const normalizeStringList = (value) => {
  if (!Array.isArray(value)) return [];
  const deduped = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return Array.from(deduped.values()).sort(sortStrings);
};

const normalizeCount = (value, { allowNegative = false } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (!allowNegative && numeric < 0) return 0;
  return Math.trunc(numeric);
};

const normalizeRate = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(1, Number(fallback) || 0));
  return Math.max(0, Math.min(1, numeric));
};

const normalizeRateDelta = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(-1, Math.min(1, numeric));
};

const normalizeCategoryCounts = (
  counts,
  {
    allowNegative = false,
    allowedKeys = null,
    unknownKeysOut = null
  } = {}
) => {
  if (!isObject(counts)) return Object.create(null);
  const entries = Object.entries(counts)
    .filter(([category]) => {
      if (typeof category !== 'string') return false;
      const trimmed = category.trim();
      if (!trimmed) return false;
      if (allowedKeys && !allowedKeys.has(trimmed)) {
        if (Array.isArray(unknownKeysOut)) unknownKeysOut.push(trimmed);
        return false;
      }
      return true;
    })
    .map(([category, value]) => [category.trim(), normalizeCount(value, { allowNegative })])
    .sort((a, b) => sortStrings(a[0], b[0]));
  const output = Object.create(null);
  for (const [category, count] of entries) {
    if (!allowNegative && count < 0) continue;
    output[category] = count;
  }
  return output;
};

const normalizeActionableHotspots = (hotspots) => {
  if (!Array.isArray(hotspots)) return [];
  return hotspots
    .map((entry) => ({
      importer: typeof entry?.importer === 'string' ? entry.importer.trim() : '',
      count: normalizeCount(entry?.count)
    }))
    .filter((entry) => entry.importer && entry.count > 0)
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.importer, b.importer)
    ))
    .slice(0, 20);
};

const normalizeUnresolvedSnapshot = (
  raw,
  { cachePath = null, cacheVersion = null } = {}
) => {
  if (!isObject(raw)) return null;
  const unknownReasonCodes = [];
  const unknownFailureCauses = [];
  const unknownDispositions = [];
  const unknownResolverStages = [];
  const categories = normalizeCategoryCounts(raw.categories);
  const reasonCodes = normalizeCategoryCounts(raw.reasonCodes, {
    allowedKeys: KNOWN_REASON_CODES,
    unknownKeysOut: unknownReasonCodes
  });
  const failureCauses = normalizeCategoryCounts(raw.failureCauses, {
    allowedKeys: KNOWN_FAILURE_CAUSES,
    unknownKeysOut: unknownFailureCauses
  });
  const dispositions = normalizeCategoryCounts(raw.dispositions, {
    allowedKeys: KNOWN_DISPOSITIONS,
    unknownKeysOut: unknownDispositions
  });
  const resolverStages = normalizeCategoryCounts(raw.resolverStages, {
    allowedKeys: KNOWN_RESOLVER_STAGES,
    unknownKeysOut: unknownResolverStages
  });
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownReasonCodes,
    fieldName: 'reasonCode',
    cachePath,
    cacheVersion
  });
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownFailureCauses,
    fieldName: 'failureCause',
    cachePath,
    cacheVersion
  });
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownDispositions,
    fieldName: 'disposition',
    cachePath,
    cacheVersion
  });
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownResolverStages,
    fieldName: 'resolverStage',
    cachePath,
    cacheVersion
  });
  const resolverBudgetExhaustedRaw = Number(raw.resolverBudgetExhausted);
  const resolverBudgetExhausted = Number.isFinite(resolverBudgetExhaustedRaw) && resolverBudgetExhaustedRaw >= 0
    ? Math.trunc(resolverBudgetExhaustedRaw)
    : (reasonCodes.IMP_U_RESOLVER_BUDGET_EXHAUSTED || 0);
  const resolverBudgetExhaustedByType = normalizeCategoryCounts(raw.resolverBudgetExhaustedByType);
  const categoriesTotal = Object.values(categories).reduce((sum, value) => sum + value, 0);
  const rawTotal = Number(raw.total);
  const total = Number.isFinite(rawTotal) && rawTotal >= 0
    ? Math.trunc(rawTotal)
    : categoriesTotal;
  const liveSuppressedRaw = Number(raw.liveSuppressed);
  const liveSuppressed = Number.isFinite(liveSuppressedRaw) && liveSuppressedRaw >= 0
    ? Math.min(total, Math.trunc(liveSuppressedRaw))
    : 0;
  const gateSuppressedRaw = Number(raw.gateSuppressed);
  const gateSuppressed = Number.isFinite(gateSuppressedRaw) && gateSuppressedRaw >= 0
    ? Math.min(Math.max(0, total - liveSuppressed), Math.trunc(gateSuppressedRaw))
    : 0;
  const actionableRaw = Number(raw.actionable);
  const actionable = Number.isFinite(actionableRaw) && actionableRaw >= 0
    ? Math.min(Math.max(0, total - liveSuppressed), Math.trunc(actionableRaw))
    : Math.max(0, total - liveSuppressed - gateSuppressed);
  const actionableRateRaw = Number(raw.actionableRate);
  const actionableRate = Number.isFinite(actionableRateRaw)
    ? normalizeRate(actionableRateRaw, 0)
    : (total > 0 ? actionable / total : 0);
  const parserArtifactCount = Number(failureCauses.parser_artifact || 0);
  const resolverGapCount = Number(failureCauses.resolver_gap || 0);
  const parserArtifactRate = Number.isFinite(Number(raw.parserArtifactRate))
    ? normalizeRate(raw.parserArtifactRate, 0)
    : (total > 0 ? parserArtifactCount / total : 0);
  const resolverGapRate = Number.isFinite(Number(raw.resolverGapRate))
    ? normalizeRate(raw.resolverGapRate, 0)
    : (total > 0 ? resolverGapCount / total : 0);
  return {
    total,
    actionable,
    liveSuppressed,
    gateSuppressed,
    categories,
    reasonCodes,
    failureCauses,
    dispositions,
    resolverStages,
    resolverBudgetExhausted,
    resolverBudgetExhaustedByType,
    actionableHotspots: normalizeActionableHotspots(raw.actionableHotspots),
    actionableByLanguage: normalizeCategoryCounts(raw.actionableByLanguage),
    actionableRate,
    parserArtifactRate,
    resolverGapRate,
    liveSuppressedCategories: normalizeStringList(raw.liveSuppressedCategories)
  };
};

const normalizeSuppressionPolicy = (raw) => {
  if (!isObject(raw)) return { liveSuppressedCategories: [] };
  return {
    liveSuppressedCategories: normalizeStringList(raw.liveSuppressedCategories)
  };
};

const normalizeDiagnostics = (
  raw,
  { cachePath = null, cacheVersion = null } = {}
) => {
  if (!isObject(raw)) return null;
  const unresolvedTrendRaw = isObject(raw.unresolvedTrend) ? raw.unresolvedTrend : {};
  const unknownDeltaReasonCodes = [];
  const unknownDeltaFailureCauses = [];
  const unknownDeltaDispositions = [];
  const unknownDeltaResolverStages = [];
  const unresolvedTrend = {
    previous: normalizeUnresolvedSnapshot(unresolvedTrendRaw.previous, {
      cachePath,
      cacheVersion
    }),
    current: normalizeUnresolvedSnapshot(unresolvedTrendRaw.current, {
      cachePath,
      cacheVersion
    }),
    deltaTotal: Number.isFinite(Number(unresolvedTrendRaw.deltaTotal))
      ? Math.trunc(Number(unresolvedTrendRaw.deltaTotal))
      : null,
    deltaByCategory: normalizeCategoryCounts(unresolvedTrendRaw.deltaByCategory, { allowNegative: true }),
    deltaByReasonCode: normalizeCategoryCounts(unresolvedTrendRaw.deltaByReasonCode, {
      allowNegative: true,
      allowedKeys: KNOWN_REASON_CODES,
      unknownKeysOut: unknownDeltaReasonCodes
    }),
    deltaByFailureCause: normalizeCategoryCounts(unresolvedTrendRaw.deltaByFailureCause, {
      allowNegative: true,
      allowedKeys: KNOWN_FAILURE_CAUSES,
      unknownKeysOut: unknownDeltaFailureCauses
    }),
    deltaByDisposition: normalizeCategoryCounts(unresolvedTrendRaw.deltaByDisposition, {
      allowNegative: true,
      allowedKeys: KNOWN_DISPOSITIONS,
      unknownKeysOut: unknownDeltaDispositions
    }),
    deltaByResolverStage: normalizeCategoryCounts(unresolvedTrendRaw.deltaByResolverStage, {
      allowNegative: true,
      allowedKeys: KNOWN_RESOLVER_STAGES,
      unknownKeysOut: unknownDeltaResolverStages
    }),
    deltaResolverBudgetExhausted: Number.isFinite(Number(unresolvedTrendRaw.deltaResolverBudgetExhausted))
      ? Math.trunc(Number(unresolvedTrendRaw.deltaResolverBudgetExhausted))
      : 0,
    deltaResolverBudgetExhaustedByType: normalizeCategoryCounts(
      unresolvedTrendRaw.deltaResolverBudgetExhaustedByType,
      { allowNegative: true }
    ),
    deltaActionableRate: normalizeRateDelta(unresolvedTrendRaw.deltaActionableRate),
    deltaParserArtifactRate: normalizeRateDelta(unresolvedTrendRaw.deltaParserArtifactRate),
    deltaResolverGapRate: normalizeRateDelta(unresolvedTrendRaw.deltaResolverGapRate)
  };
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownDeltaReasonCodes,
    fieldName: 'delta reasonCode',
    cachePath,
    cacheVersion
  });
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownDeltaFailureCauses,
    fieldName: 'delta failureCause',
    cachePath,
    cacheVersion
  });
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownDeltaDispositions,
    fieldName: 'delta disposition',
    cachePath,
    cacheVersion
  });
  throwIfUnknownCategoryKeys({
    unknownKeys: unknownDeltaResolverStages,
    fieldName: 'delta resolverStage',
    cachePath,
    cacheVersion
  });
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

const createIncompatibleCacheError = ({
  cachePath = null,
  foundVersion = null,
  detail = null
} = {}) => {
  const foundLabel = foundVersion == null ? 'missing' : String(foundVersion);
  const location = typeof cachePath === 'string' && cachePath ? cachePath : '<unknown>';
  const suffix = typeof detail === 'string' && detail.trim() ? ` ${detail.trim()}` : '';
  const error = new Error(
    `[imports] incompatible import resolution cache version at ${location}: ` +
    `found=${foundLabel}, expected=${CACHE_VERSION}. Remove the cache file and rerun.${suffix}`
  );
  error.code = 'ERR_IMPORT_RESOLUTION_CACHE_INCOMPATIBLE';
  error.cachePath = cachePath;
  error.foundVersion = foundVersion;
  error.expectedVersion = CACHE_VERSION;
  return error;
};

const throwIfUnknownCategoryKeys = ({
  unknownKeys,
  fieldName,
  cachePath,
  cacheVersion
}) => {
  const unique = Array.from(new Set(
    Array.isArray(unknownKeys)
      ? unknownKeys.filter((entry) => typeof entry === 'string' && entry.trim())
      : []
  )).sort(sortStrings);
  if (unique.length === 0) return;
  throw createIncompatibleCacheError({
    cachePath,
    foundVersion: cacheVersion,
    detail: `Unknown ${fieldName} keys: ${unique.join(', ')}`
  });
};

const normalizeRelPath = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) return null;
  const trimmed = normalized.replace(/^\.\/+/, '');
  const compact = path.posix.normalize(trimmed);
  if (!compact || compact === '.' || compact.startsWith('../') || compact === '..') return null;
  return compact;
};

const collectCurrentFileSetFromEntries = (entries) => {
  const fileSet = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const rel = typeof entry === 'string'
      ? entry
      : (
        typeof entry?.rel === 'string'
          ? entry.rel
          : null
      );
    const key = normalizeRelPath(rel);
    if (!key) continue;
    fileSet.add(key);
  }
  return fileSet;
};

const computeFileSetFingerprintFromSet = (fileSet) => {
  if (!(fileSet instanceof Set) || fileSet.size === 0) return null;
  const ordered = Array.from(fileSet.values()).sort(sortStrings);
  return sha1(ordered.map((entry) => `${entry}\n`).join(''));
};

const collectDependencyNeighborhood = (files) => {
  const forward = new Map();
  const reverse = new Map();
  const unresolvedRelativeSpecs = new Map();
  if (!isObject(files)) {
    return { forward, reverse, unresolvedRelativeSpecs };
  }
  for (const [rawImporter, rawFileCache] of Object.entries(files)) {
    const importer = normalizeRelPath(rawImporter);
    if (!importer) continue;
    const specs = isObject(rawFileCache?.specs) ? rawFileCache.specs : null;
    if (!specs) continue;
    for (const [rawSpec, rawSpecCache] of Object.entries(specs)) {
      const spec = typeof rawSpec === 'string' ? rawSpec.trim() : '';
      if (!spec) continue;
      const resolvedPath = normalizeRelPath(rawSpecCache?.resolvedPath);
      if (resolvedPath) {
        if (!forward.has(importer)) forward.set(importer, new Set());
        forward.get(importer).add(resolvedPath);
        if (!reverse.has(resolvedPath)) reverse.set(resolvedPath, new Set());
        reverse.get(resolvedPath).add(importer);
      }
      const resolvedType = typeof rawSpecCache?.resolvedType === 'string'
        ? rawSpecCache.resolvedType
        : '';
      if (resolvedType !== 'unresolved') continue;
      const relativeSpec = spec.startsWith('.') || spec.startsWith('/');
      if (!relativeSpec) continue;
      if (!unresolvedRelativeSpecs.has(importer)) unresolvedRelativeSpecs.set(importer, new Set());
      unresolvedRelativeSpecs.get(importer).add(spec);
    }
  }
  return { forward, reverse, unresolvedRelativeSpecs };
};

const resolveRelativeImportCandidates = (importer, specifier) => {
  const normalizedImporter = normalizeRelPath(importer);
  const normalizedSpecifier = typeof specifier === 'string'
    ? specifier.trim().replace(/\\/g, '/')
    : '';
  if (!normalizedImporter || !normalizedSpecifier) return [];
  if (!(normalizedSpecifier.startsWith('.') || normalizedSpecifier.startsWith('/'))) return [];
  const importerDir = path.posix.dirname(normalizedImporter);
  const joined = normalizedSpecifier.startsWith('/')
    ? normalizedSpecifier.slice(1)
    : path.posix.join(importerDir === '.' ? '' : importerDir, normalizedSpecifier);
  const base = normalizeRelPath(joined);
  if (!base) return [];
  const candidates = new Set([base]);
  const hasExt = Boolean(path.posix.extname(base));
  if (!hasExt) {
    for (const ext of IMPORT_SPEC_CANDIDATE_EXTENSIONS) {
      candidates.add(`${base}${ext}`);
      candidates.add(path.posix.join(base, `index${ext}`));
    }
  }
  return Array.from(candidates.values());
};

const addReasonCount = (target, key, count = 1) => {
  if (!isObject(target) || !key) return;
  const nextCount = Number(target[key]) || 0;
  target[key] = nextCount + Math.max(0, Math.floor(Number(count) || 0));
};

const buildCategoryDelta = (previous, current) => {
  const previousCounts = normalizeCategoryCounts(previous || {});
  const currentCounts = normalizeCategoryCounts(current || {});
  const keys = new Set([
    ...Object.keys(previousCounts),
    ...Object.keys(currentCounts)
  ]);
  const orderedKeys = Array.from(keys.values()).sort(sortStrings);
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
  const reasonCodes = normalizeCategoryCounts(taxonomy.reasonCodes);
  const failureCauses = normalizeCategoryCounts(taxonomy.failureCauses);
  const dispositions = normalizeCategoryCounts(taxonomy.dispositions);
  const resolverStages = normalizeCategoryCounts(taxonomy.resolverStages);
  const resolverBudgetExhaustedRaw = Number(taxonomy.resolverBudgetExhausted);
  const resolverBudgetExhausted = Number.isFinite(resolverBudgetExhaustedRaw) && resolverBudgetExhaustedRaw >= 0
    ? Math.trunc(resolverBudgetExhaustedRaw)
    : (reasonCodes.IMP_U_RESOLVER_BUDGET_EXHAUSTED || 0);
  const resolverBudgetExhaustedByType = normalizeCategoryCounts(taxonomy.resolverBudgetExhaustedByType);
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
  const gateSuppressedRaw = Number(taxonomy.gateSuppressed);
  const gateSuppressed = Number.isFinite(gateSuppressedRaw) && gateSuppressedRaw >= 0
    ? Math.min(Math.max(0, total - liveSuppressed), Math.trunc(gateSuppressedRaw))
    : 0;
  const actionableRaw = Number(taxonomy.actionable);
  const actionable = Number.isFinite(actionableRaw) && actionableRaw >= 0
    ? Math.min(Math.max(0, total - liveSuppressed), Math.trunc(actionableRaw))
    : Math.max(0, total - liveSuppressed - gateSuppressed);
  const actionableRateRaw = Number(taxonomy.actionableRate);
  const actionableRate = Number.isFinite(actionableRateRaw)
    ? normalizeRate(actionableRateRaw, 0)
    : (total > 0 ? actionable / total : 0);
  const parserArtifactRate = Number.isFinite(Number(taxonomy.parserArtifactRate))
    ? normalizeRate(taxonomy.parserArtifactRate, 0)
    : (total > 0 ? Number(failureCauses.parser_artifact || 0) / total : 0);
  const resolverGapRate = Number.isFinite(Number(taxonomy.resolverGapRate))
    ? normalizeRate(taxonomy.resolverGapRate, 0)
    : (total > 0 ? Number(failureCauses.resolver_gap || 0) / total : 0);
  return {
    total,
    actionable,
    liveSuppressed,
    gateSuppressed,
    categories,
    reasonCodes,
    failureCauses,
    dispositions,
    resolverStages,
    resolverBudgetExhausted,
    resolverBudgetExhaustedByType,
    actionableHotspots: normalizeActionableHotspots(taxonomy.actionableHotspots),
    actionableByLanguage: normalizeCategoryCounts(taxonomy.actionableByLanguage),
    actionableRate,
    parserArtifactRate,
    resolverGapRate,
    liveSuppressedCategories: normalizeStringList(taxonomy.liveSuppressedCategories)
  };
};

const normalizeCache = (raw, { cachePath = null } = {}) => {
  if (!isObject(raw)) return null;
  const versionRaw = raw.version;
  const versionNumeric = Number(versionRaw);
  if (!Number.isFinite(versionNumeric) || Math.trunc(versionNumeric) !== CACHE_VERSION) {
    throw createIncompatibleCacheError({
      cachePath,
      foundVersion: versionRaw
    });
  }
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
    diagnostics: normalizeDiagnostics(raw.diagnostics, {
      cachePath,
      cacheVersion: versionNumeric
    })
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
    const normalized = normalizeCache(raw, { cachePath });
    if (normalized) return { cache: normalized, cachePath };
  } catch (err) {
    if (err?.code === 'ERR_IMPORT_RESOLUTION_CACHE_INCOMPATIBLE') {
      if (typeof log === 'function') log(err.message);
      throw err;
    }
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

/**
 * Apply precise import-resolution cache invalidation from file-set diffs.
 *
 * This keeps unaffected importer entries warm by invalidating only changed
 * files and their dependency neighborhood, plus unresolved-relative stale
 * edges that can become valid when new files appear.
 *
 * @param {{
 *   cache?:object|null,
 *   entries?:Array<object|string>|null,
 *   cacheStats?:object|null,
 *   log?:(message:string)=>void
 * }} [input]
 * @returns {{
 *   fileSetChanged:boolean,
 *   added:number,
 *   removed:number,
 *   invalidated:number,
 *   staleEdgeInvalidated:number,
 *   usedFallbackGlobal:boolean
 * }|null}
 */
export const applyImportResolutionCacheFileSetDiffInvalidation = ({
  cache,
  entries,
  cacheStats = null,
  log = null
} = {}) => {
  if (!isObject(cache)) return null;
  if (!isObject(cache.files)) cache.files = {};
  const currentFileSet = collectCurrentFileSetFromEntries(entries);
  const currentFingerprint = computeFileSetFingerprintFromSet(currentFileSet);
  const previousFingerprint = typeof cache.fileSetFingerprint === 'string' && cache.fileSetFingerprint
    ? cache.fileSetFingerprint
    : null;
  const previousLookupSet = new Set(
    Array.isArray(cache.lookup?.fileSet)
      ? cache.lookup.fileSet
        .map((entry) => normalizeRelPath(entry))
        .filter(Boolean)
      : []
  );
  const addedFiles = new Set();
  const removedFiles = new Set();
  for (const file of currentFileSet.values()) {
    if (!previousLookupSet.has(file)) addedFiles.add(file);
  }
  for (const file of previousLookupSet.values()) {
    if (!currentFileSet.has(file)) removedFiles.add(file);
  }
  const hasDiffByLookup = addedFiles.size > 0 || removedFiles.size > 0;
  const hasDiffByFingerprint = Boolean(
    previousFingerprint
    && currentFingerprint
    && previousFingerprint !== currentFingerprint
  );
  const seededFingerprint = !previousFingerprint && Boolean(currentFingerprint);
  const fileSetChanged = seededFingerprint || hasDiffByLookup || hasDiffByFingerprint;
  let invalidated = 0;
  let staleEdgeInvalidated = 0;
  let usedFallbackGlobal = false;
  let neighborhoodInvalidated = 0;

  if (fileSetChanged && (hasDiffByLookup || hasDiffByFingerprint)) {
    const { forward, reverse, unresolvedRelativeSpecs } = collectDependencyNeighborhood(cache.files);
    const invalidationSet = new Set();
    const markInvalidated = (filePath) => {
      const key = normalizeRelPath(filePath);
      if (!key || !Object.prototype.hasOwnProperty.call(cache.files, key)) return false;
      if (invalidationSet.has(key)) return false;
      invalidationSet.add(key);
      return true;
    };
    for (const changed of [...addedFiles, ...removedFiles]) {
      if (markInvalidated(changed)) neighborhoodInvalidated += 1;
      const incoming = reverse.get(changed);
      if (incoming) {
        for (const importer of incoming.values()) {
          if (markInvalidated(importer)) neighborhoodInvalidated += 1;
        }
      }
      const outgoing = forward.get(changed);
      if (outgoing) {
        for (const dependent of outgoing.values()) {
          if (markInvalidated(dependent)) neighborhoodInvalidated += 1;
        }
      }
    }
    if (addedFiles.size > 0) {
      for (const [importer, unresolvedSpecs] of unresolvedRelativeSpecs.entries()) {
        if (invalidationSet.has(importer)) continue;
        let stale = false;
        for (const unresolvedSpec of unresolvedSpecs.values()) {
          const candidates = resolveRelativeImportCandidates(importer, unresolvedSpec);
          if (!candidates.some((candidate) => addedFiles.has(candidate))) continue;
          stale = true;
          break;
        }
        if (stale && markInvalidated(importer)) {
          staleEdgeInvalidated += 1;
        }
      }
    }
    // Compatibility fallback: if lookup-set diff is unavailable but file-set hash
    // changed, we cannot build a safe neighborhood and must reset cached files.
    if (!hasDiffByLookup && hasDiffByFingerprint) {
      usedFallbackGlobal = true;
      for (const filePath of Object.keys(cache.files)) {
        invalidationSet.add(filePath);
      }
    }
    for (const filePath of invalidationSet.values()) {
      if (!Object.prototype.hasOwnProperty.call(cache.files, filePath)) continue;
      delete cache.files[filePath];
      invalidated += 1;
    }
    cache.lookup = null;
    cache.cacheKey = null;
  }

  if (currentFingerprint) {
    cache.fileSetFingerprint = currentFingerprint;
  } else if (seededFingerprint) {
    cache.fileSetFingerprint = null;
  }

  if (isObject(cacheStats)) {
    cacheStats.fileSetInvalidated = fileSetChanged;
    cacheStats.fileSetDelta = {
      added: addedFiles.size,
      removed: removedFiles.size
    };
    cacheStats.filesNeighborhoodInvalidated = Number(cacheStats.filesNeighborhoodInvalidated || 0) + neighborhoodInvalidated;
    cacheStats.staleEdgeInvalidated = Number(cacheStats.staleEdgeInvalidated || 0) + staleEdgeInvalidated;
    if (!isObject(cacheStats.invalidationReasons)) {
      cacheStats.invalidationReasons = Object.create(null);
    }
    if (seededFingerprint) addReasonCount(cacheStats.invalidationReasons, 'seeded_file_set', 1);
    if (hasDiffByLookup || hasDiffByFingerprint) addReasonCount(cacheStats.invalidationReasons, 'file_set_diff', 1);
    if (neighborhoodInvalidated > 0) addReasonCount(cacheStats.invalidationReasons, 'dependency_neighborhood', neighborhoodInvalidated);
    if (staleEdgeInvalidated > 0) addReasonCount(cacheStats.invalidationReasons, 'stale_unresolved_edge', staleEdgeInvalidated);
    if (usedFallbackGlobal) addReasonCount(cacheStats.invalidationReasons, 'fallback_global_reset', 1);
  }

  if (fileSetChanged && typeof log === 'function') {
    log(
      `[imports] cache file-set diff: added=${addedFiles.size}, removed=${removedFiles.size}, ` +
      `invalidated=${invalidated} (neighborhood=${neighborhoodInvalidated}, stale-edge=${staleEdgeInvalidated}).`
    );
    if (usedFallbackGlobal) {
      log('[imports] cache file-set diff fallback: full importer cache reset (lookup diff unavailable).');
    }
  }

  return {
    fileSetChanged,
    added: addedFiles.size,
    removed: removedFiles.size,
    invalidated,
    staleEdgeInvalidated,
    usedFallbackGlobal
  };
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
      deltaByCategory: buildCategoryDelta(previousCurrent?.categories || {}, current.categories),
      deltaByReasonCode: buildCategoryDelta(previousCurrent?.reasonCodes || {}, current.reasonCodes),
      deltaByFailureCause: buildCategoryDelta(previousCurrent?.failureCauses || {}, current.failureCauses),
      deltaByDisposition: buildCategoryDelta(previousCurrent?.dispositions || {}, current.dispositions),
      deltaByResolverStage: buildCategoryDelta(previousCurrent?.resolverStages || {}, current.resolverStages),
      deltaByActionableLanguage: buildCategoryDelta(
        previousCurrent?.actionableByLanguage || {},
        current.actionableByLanguage
      ),
      deltaResolverBudgetExhausted: current.resolverBudgetExhausted - (previousCurrent?.resolverBudgetExhausted || 0),
      deltaResolverBudgetExhaustedByType: buildCategoryDelta(
        previousCurrent?.resolverBudgetExhaustedByType || {},
        current.resolverBudgetExhaustedByType
      ),
      deltaActionableRate: previousCurrent
        ? current.actionableRate - (previousCurrent.actionableRate || 0)
        : null,
      deltaParserArtifactRate: previousCurrent
        ? current.parserArtifactRate - (previousCurrent.parserArtifactRate || 0)
        : null,
      deltaResolverGapRate: previousCurrent
        ? current.resolverGapRate - (previousCurrent.resolverGapRate || 0)
        : null
    }
  };
  cache.diagnostics = diagnostics;
  return diagnostics;
};

