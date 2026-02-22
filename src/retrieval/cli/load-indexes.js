import path from 'node:path';
import { spawnSubprocessSync } from '../../shared/subprocess.js';
import { pathExists } from '../../shared/files.js';
import {
  hasIndexMetaAsync,
  loadFileRelations,
  loadIndexCached,
  loadRepoMap,
  resolveDenseVector,
  warnPendingState
} from './index-loader.js';
import { loadIndex, requireIndexDir, resolveIndexDir } from '../cli-index.js';
import { resolveModelIds } from './model-ids.js';
import { buildFilterIndex } from '../filter-index.js';
import { buildIndexSignature } from '../index-cache.js';
import {
  MAX_JSON_BYTES,
  loadGraphRelations,
  loadJsonObjectArtifact,
  loadPiecesManifest,
  readJsonFile,
  readCompatibilityKey,
  resolveArtifactPresence,
  resolveDirArtifactPath
} from '../../shared/artifact-io.js';
import { resolveLanceDbPaths, resolveLanceDbTarget } from '../../shared/lancedb.js';
import { tryRequire } from '../../shared/optional-deps.js';
import { normalizeTantivyConfig, resolveTantivyPaths } from '../../shared/tantivy.js';
import { buildLineAuthors, getChunkAuthorsFromLines } from '../../index/scm/annotate.js';
import { toRepoPosixPath } from '../../index/scm/paths.js';
import { getScmProviderAndRoot, resolveScmConfig } from '../../index/scm/registry.js';
import { setScmRuntimeConfig } from '../../index/scm/runtime.js';
import { getRuntimeConfig, resolveRuntimeEnv, resolveToolRoot } from '../../../tools/shared/dict-utils.js';

const EMPTY_INDEX = {
  chunkMeta: [],
  denseVec: null,
  minhash: null,
  filterIndex: null,
  fileRelations: null,
  repoMap: null
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const DENSE_ARTIFACT_LEGACY_FILES = Object.freeze({
  dense_vectors: Object.freeze(['dense_vectors_uint8.json', 'dense_vectors.json']),
  dense_vectors_doc: Object.freeze(['dense_vectors_doc_uint8.json', 'dense_vectors_doc.json']),
  dense_vectors_code: Object.freeze(['dense_vectors_code_uint8.json', 'dense_vectors_code.json'])
});

const normalizeModel = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeIdentityNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const loadDenseArtifactFromLegacyPath = async (dir, artifactName) => {
  const candidates = DENSE_ARTIFACT_LEGACY_FILES[artifactName];
  if (!Array.isArray(candidates) || !candidates.length) return null;
  for (const relPath of candidates) {
    const absPath = path.join(dir, relPath);
    const exists = await pathExists(absPath)
      || await pathExists(`${absPath}.gz`)
      || await pathExists(`${absPath}.zst`);
    if (!exists) continue;
    try {
      return readJsonFile(absPath, { maxBytes: MAX_JSON_BYTES });
    } catch {}
  }
  return null;
};

const numbersEqual = (left, right) => Math.abs(left - right) <= 1e-9;
const isMissingManifestLikeError = (err) => {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return code === 'ERR_MANIFEST_MISSING'
    || code === 'ERR_MANIFEST_INVALID'
    || code === 'ERR_COMPATIBILITY_KEY_MISSING'
    || /Missing pieces manifest/i.test(message)
    || /Missing compatibilityKey/i.test(message);
};

const extractEmbeddingIdentity = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  const quantization = meta.quantization && typeof meta.quantization === 'object'
    ? meta.quantization
    : null;
  const identity = {};
  const dims = normalizeIdentityNumber(meta.dims);
  if (dims != null) identity.dims = dims;
  const model = normalizeModel(meta.model) || normalizeModel(meta.modelId);
  if (model != null) identity.model = model;
  const scale = normalizeIdentityNumber(meta.scale);
  if (scale != null) identity.scale = scale;
  const minVal = normalizeIdentityNumber(meta.minVal ?? quantization?.minVal);
  if (minVal != null) identity.minVal = minVal;
  const maxVal = normalizeIdentityNumber(meta.maxVal ?? quantization?.maxVal);
  if (maxVal != null) identity.maxVal = maxVal;
  const levels = normalizeIdentityNumber(meta.levels ?? quantization?.levels);
  if (levels != null) identity.levels = levels;
  return identity;
};

const SCM_CHUNK_AUTHOR_FILTER_FLAG = '--chunk-author';
const SCM_CHUNK_AUTHOR_FORCE_ENV = 'PAIROFCLEATS_FORCE_CHUNK_AUTHOR_HYDRATION';
const SCM_CHUNK_AUTHOR_ANNOTATE_TIMEOUT_MS = 15000;
const SCM_CHUNK_AUTHOR_ANNOTATE_CONCURRENCY = 4;
const SCM_CHUNK_AUTHOR_CACHE_MAX_ENTRIES = 16;
const scmChunkAuthorHydrationCache = new Map();
const scmChunkAuthorHydrationStats = {
  cacheHits: 0,
  cacheMisses: 0,
  hydrateRuns: 0,
  annotatedFiles: 0
};

const shouldHydrateScmChunkAuthors = ({ filtersActive, chunkAuthorFilterActive = false } = {}) => {
  if (!filtersActive) return false;
  if (chunkAuthorFilterActive === true) return true;
  const forceRaw = process.env[SCM_CHUNK_AUTHOR_FORCE_ENV];
  if (typeof forceRaw === 'string' && forceRaw.trim()) {
    const normalized = forceRaw.trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(normalized);
  }
  const argv = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  for (const entry of argv) {
    const token = String(entry || '').trim();
    if (!token) continue;
    if (token === SCM_CHUNK_AUTHOR_FILTER_FLAG) return true;
    if (token.startsWith(`${SCM_CHUNK_AUTHOR_FILTER_FLAG}=`)) return true;
  }
  return false;
};

const normalizeChunkLineNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return null;
  return Math.max(1, Math.floor(numeric));
};

const resolveChunkLineRange = (chunk) => {
  const startRaw = chunk?.startLine
    ?? chunk?.start_line
    ?? chunk?.lineStart
    ?? chunk?.line_start
    ?? null;
  const endRaw = chunk?.endLine
    ?? chunk?.end_line
    ?? chunk?.lineEnd
    ?? chunk?.line_end
    ?? startRaw;
  const startLine = normalizeChunkLineNumber(startRaw);
  const endLine = normalizeChunkLineNumber(endRaw);
  if (!startLine || !endLine) return null;
  return { startLine, endLine: Math.max(startLine, endLine) };
};

const resolveChunkAuthorChunkKey = (chunk, fallbackIndex = null) => {
  const id = Number(chunk?.id);
  if (Number.isFinite(id)) {
    return `id:${Math.floor(id)}`;
  }
  const fileValue = String(chunk?.file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .trim();
  const lineRange = resolveChunkLineRange(chunk);
  if (!fileValue || !lineRange) return null;
  const suffix = Number.isFinite(Number(fallbackIndex))
    ? `:${Math.floor(Number(fallbackIndex))}`
    : '';
  return `file:${fileValue}:${lineRange.startLine}:${lineRange.endLine}${suffix}`;
};

const normalizeChunkAuthorList = (authors) => {
  if (!Array.isArray(authors) || !authors.length) return [];
  const out = [];
  const seen = new Set();
  for (const value of authors) {
    const author = String(value || '').trim();
    if (!author || seen.has(author)) continue;
    seen.add(author);
    out.push(author);
  }
  return out;
};

const countResolvableMissingChunkAuthors = (chunkMeta) => {
  if (!Array.isArray(chunkMeta) || !chunkMeta.length) return 0;
  let count = 0;
  for (let index = 0; index < chunkMeta.length; index += 1) {
    const chunk = chunkMeta[index];
    if (!chunk) continue;
    const existingAuthors = Array.isArray(chunk?.chunk_authors)
      ? chunk.chunk_authors
      : (Array.isArray(chunk?.chunkAuthors) ? chunk.chunkAuthors : null);
    if (Array.isArray(existingAuthors) && existingAuthors.length) continue;
    if (!String(chunk?.file || '').trim()) continue;
    if (!resolveChunkLineRange(chunk)) continue;
    if (!resolveChunkAuthorChunkKey(chunk, index)) continue;
    count += 1;
  }
  return count;
};

const resolveMissingChunkAuthorRefs = (chunkMeta, repoRoot) => {
  const byFile = new Map();
  if (!Array.isArray(chunkMeta) || !chunkMeta.length) return { byFile, missingCount: 0 };
  let missingCount = 0;
  for (let index = 0; index < chunkMeta.length; index += 1) {
    const chunk = chunkMeta[index];
    if (!chunk) continue;
    const existingAuthors = Array.isArray(chunk?.chunk_authors)
      ? chunk.chunk_authors
      : (Array.isArray(chunk?.chunkAuthors) ? chunk.chunkAuthors : null);
    if (Array.isArray(existingAuthors) && existingAuthors.length) continue;
    const filePosix = toRepoPosixPath(chunk?.file, repoRoot);
    const lineRange = resolveChunkLineRange(chunk);
    const chunkKey = resolveChunkAuthorChunkKey(chunk, index);
    if (!filePosix || !lineRange || !chunkKey) continue;
    const refs = byFile.get(filePosix) || [];
    refs.push({
      chunkKey,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine
    });
    byFile.set(filePosix, refs);
    missingCount += 1;
  }
  return { byFile, missingCount };
};

const applyChunkAuthorMapToChunks = ({ chunkMeta, chunkAuthorsByKey }) => {
  if (!Array.isArray(chunkMeta) || !chunkMeta.length) return 0;
  if (!(chunkAuthorsByKey instanceof Map) || !chunkAuthorsByKey.size) return 0;
  let applied = 0;
  for (let index = 0; index < chunkMeta.length; index += 1) {
    const chunk = chunkMeta[index];
    if (!chunk) continue;
    const key = resolveChunkAuthorChunkKey(chunk, index);
    if (!key) continue;
    const authors = chunkAuthorsByKey.get(key);
    if (!Array.isArray(authors) || !authors.length) continue;
    const existingAuthors = Array.isArray(chunk?.chunk_authors)
      ? chunk.chunk_authors
      : (Array.isArray(chunk?.chunkAuthors) ? chunk.chunkAuthors : null);
    if (Array.isArray(existingAuthors) && existingAuthors.length) continue;
    const nextAuthors = Array.from(authors);
    chunk.chunk_authors = nextAuthors;
    chunk.chunkAuthors = nextAuthors;
    applied += 1;
  }
  return applied;
};

const pruneScmChunkAuthorHydrationCache = () => {
  while (scmChunkAuthorHydrationCache.size > SCM_CHUNK_AUTHOR_CACHE_MAX_ENTRIES) {
    const oldestKey = scmChunkAuthorHydrationCache.keys().next()?.value;
    if (!oldestKey) break;
    scmChunkAuthorHydrationCache.delete(oldestKey);
  }
};

const getScmChunkAuthorHydrationCacheEntry = (cacheKey) => {
  if (!cacheKey) return null;
  const cached = scmChunkAuthorHydrationCache.get(cacheKey) || null;
  if (!cached) return null;
  scmChunkAuthorHydrationCache.delete(cacheKey);
  scmChunkAuthorHydrationCache.set(cacheKey, cached);
  return cached;
};

const setScmChunkAuthorHydrationCacheEntry = (cacheKey, entry) => {
  if (!cacheKey || !entry) return;
  scmChunkAuthorHydrationCache.set(cacheKey, entry);
  pruneScmChunkAuthorHydrationCache();
};

const resolveBuildCommitHint = (idx) => {
  const buildId = String(idx?.state?.buildId || '').trim();
  if (!buildId) return null;
  const parts = buildId.split('_');
  if (parts.length < 3) return null;
  const candidate = String(parts[2] || '').trim().toLowerCase();
  return /^[0-9a-f]{7,64}$/i.test(candidate) ? candidate : null;
};

const resolveScmAnnotateTimeoutMs = (scmConfig = null) => {
  const annotateTimeoutRaw = Number(scmConfig?.annotate?.timeoutMs);
  const fallbackTimeoutRaw = Number(scmConfig?.timeoutMs);
  const resolved = Number.isFinite(annotateTimeoutRaw) && annotateTimeoutRaw > 0
    ? Math.floor(annotateTimeoutRaw)
    : (Number.isFinite(fallbackTimeoutRaw) && fallbackTimeoutRaw > 0
      ? Math.floor(fallbackTimeoutRaw)
      : SCM_CHUNK_AUTHOR_ANNOTATE_TIMEOUT_MS);
  return Math.max(1000, resolved);
};

const resolveScmSelectionForChunkAuthorHydration = ({ rootDir, userConfig, emitOutput }) => {
  try {
    const indexingConfig = userConfig?.indexing && typeof userConfig.indexing === 'object'
      ? userConfig.indexing
      : {};
    const scmConfig = resolveScmConfig({ indexingConfig });
    setScmRuntimeConfig(scmConfig);
    const selection = getScmProviderAndRoot({
      provider: scmConfig?.provider || 'auto',
      startPath: rootDir,
      log: emitOutput ? console.warn : null
    });
    return { selection, scmConfig };
  } catch {
    return { selection: null, scmConfig: null };
  }
};

const resolveChunkAuthorHydrationCacheKey = async ({ idx, mode }) => {
  const signature = idx?.indexDir ? await buildIndexSignature(idx.indexDir) : null;
  const fallback = [
    `build:${idx?.state?.buildId || 'missing'}`,
    `mode:${mode || 'unknown'}`,
    `dir:${idx?.indexDir || 'missing'}`
  ].join('|');
  return `${mode || 'unknown'}:${signature || fallback}`;
};

const hydrateChunkAuthorsForIndex = async ({
  idx,
  mode,
  rootDir,
  userConfig,
  fileChargramN,
  filtersActive,
  chunkAuthorFilterActive,
  emitOutput
}) => {
  if (!shouldHydrateScmChunkAuthors({ filtersActive, chunkAuthorFilterActive })) {
    return { applied: 0, cacheHit: false };
  }
  if (!idx || !Array.isArray(idx.chunkMeta) || !idx.chunkMeta.length) {
    return { applied: 0, cacheHit: false };
  }
  const missingCount = countResolvableMissingChunkAuthors(idx.chunkMeta);
  if (!missingCount) {
    return { applied: 0, cacheHit: false };
  }
  const cacheKey = await resolveChunkAuthorHydrationCacheKey({ idx, mode });
  const cached = getScmChunkAuthorHydrationCacheEntry(cacheKey);
  if (cached?.chunkAuthorsByKey instanceof Map) {
    scmChunkAuthorHydrationStats.cacheHits += 1;
    const applied = applyChunkAuthorMapToChunks({
      chunkMeta: idx.chunkMeta,
      chunkAuthorsByKey: cached.chunkAuthorsByKey
    });
    if (applied > 0 && idx.filterIndex) {
      idx.filterIndex = buildFilterIndex(idx.chunkMeta, { fileChargramN });
    }
    return { applied, cacheHit: true };
  }
  scmChunkAuthorHydrationStats.cacheMisses += 1;

  const { selection, scmConfig } = resolveScmSelectionForChunkAuthorHydration({
    rootDir,
    userConfig,
    emitOutput
  });
  if (
    !selection
    || selection.provider === 'none'
    || !selection.providerImpl
    || typeof selection.providerImpl.annotate !== 'function'
  ) {
    setScmChunkAuthorHydrationCacheEntry(cacheKey, { chunkAuthorsByKey: new Map() });
    return { applied: 0, cacheHit: false };
  }
  const refs = resolveMissingChunkAuthorRefs(idx.chunkMeta, selection.repoRoot || rootDir);
  if (!refs.byFile.size) {
    setScmChunkAuthorHydrationCacheEntry(cacheKey, { chunkAuthorsByKey: new Map() });
    return { applied: 0, cacheHit: false };
  }
  const annotateTimeoutMs = resolveScmAnnotateTimeoutMs(scmConfig);
  const commitId = resolveBuildCommitHint(idx);
  const fileEntries = Array.from(refs.byFile.entries());
  const chunkAuthorsByKey = new Map();
  let cursor = 0;
  const workerCount = Math.min(SCM_CHUNK_AUTHOR_ANNOTATE_CONCURRENCY, fileEntries.length);
  const runWorker = async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= fileEntries.length) return;
      const [filePosix, chunkRefs] = fileEntries[current];
      let annotateResult = null;
      try {
        annotateResult = await Promise.resolve(selection.providerImpl.annotate({
          repoRoot: selection.repoRoot,
          filePosix,
          timeoutMs: annotateTimeoutMs,
          commitId: commitId || null
        }));
      } catch {
        continue;
      }
      const lineAuthors = buildLineAuthors(annotateResult);
      if (!Array.isArray(lineAuthors) || !lineAuthors.length) continue;
      scmChunkAuthorHydrationStats.annotatedFiles += 1;
      for (const chunkRef of chunkRefs) {
        const authors = normalizeChunkAuthorList(
          getChunkAuthorsFromLines(
            lineAuthors,
            chunkRef.startLine,
            chunkRef.endLine
          )
        );
        if (!authors.length) continue;
        chunkAuthorsByKey.set(chunkRef.chunkKey, Object.freeze(authors));
      }
    }
  };
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, runWorker));
  }
  setScmChunkAuthorHydrationCacheEntry(cacheKey, {
    chunkAuthorsByKey
  });
  scmChunkAuthorHydrationStats.hydrateRuns += 1;
  const applied = applyChunkAuthorMapToChunks({
    chunkMeta: idx.chunkMeta,
    chunkAuthorsByKey
  });
  if (applied > 0 && idx.filterIndex) {
    idx.filterIndex = buildFilterIndex(idx.chunkMeta, { fileChargramN });
  }
  return { applied, cacheHit: false };
};

export const __testScmChunkAuthorHydration = Object.freeze({
  reset: () => {
    scmChunkAuthorHydrationCache.clear();
    scmChunkAuthorHydrationStats.cacheHits = 0;
    scmChunkAuthorHydrationStats.cacheMisses = 0;
    scmChunkAuthorHydrationStats.hydrateRuns = 0;
    scmChunkAuthorHydrationStats.annotatedFiles = 0;
  },
  getStats: () => ({
    ...scmChunkAuthorHydrationStats,
    cacheEntries: scmChunkAuthorHydrationCache.size
  })
});

/**
 * Load retrieval indexes across enabled modes and attach optional ANN/graph
 * side artifacts while enforcing cohort compatibility and embedding identity.
 * In non-strict mode, incompatible ANN sources are disabled instead of failing.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function loadSearchIndexes({
  rootDir,
  userConfig,
  searchMode,
  runProse,
  runExtractedProse,
  loadExtractedProse = false,
  runCode,
  runRecords,
  useSqlite,
  useLmdb,
  emitOutput,
  exitOnError,
  annActive,
  filtersActive,
  chunkAuthorFilterActive = false,
  contextExpansionEnabled,
  graphRankingEnabled,
  sqliteFtsRequested,
  backendLabel,
  backendForcedTantivy,
  indexCache,
  modelIdDefault,
  fileChargramN,
  hnswConfig,
  lancedbConfig,
  tantivyConfig,
  strict = true,
  allowUnsafeMix = false,
  indexStates = null,
  loadIndexFromSqlite,
  loadIndexFromLmdb,
  resolvedDenseVectorMode,
  requiredArtifacts,
  indexDirByMode = null,
  indexBaseRootByMode = null,
  explicitRef = false
}) {
  const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
  const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;
  const runtimeConfig = getRuntimeConfig(rootDir, userConfig);
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, process.env);
  const hasRequirements = requiredArtifacts && typeof requiredArtifacts.has === 'function';
  const needsAnnArtifacts = hasRequirements ? requiredArtifacts.has('ann') : true;
  const needsFilterIndex = hasRequirements ? requiredArtifacts.has('filterIndex') : true;
  const needsFileRelations = hasRequirements ? requiredArtifacts.has('fileRelations') : true;
  const needsRepoMap = hasRequirements ? requiredArtifacts.has('repoMap') : true;
  const needsGraphRelations = hasRequirements
    ? requiredArtifacts.has('graphRelations')
    : (contextExpansionEnabled || graphRankingEnabled);
  const needsChunkMetaCold = Boolean(
    filtersActive
    || contextExpansionEnabled
    || graphRankingEnabled
    || needsFilterIndex
    || needsFileRelations
  );
  const lazyDenseVectorsEnabled = userConfig?.retrieval?.dense?.lazyLoad !== false;
  const resolveOptions = {
    indexDirByMode,
    indexBaseRootByMode,
    explicitRef
  };

  const proseIndexDir = runProse ? resolveIndexDir(rootDir, 'prose', userConfig, resolveOptions) : null;
  const codeIndexDir = runCode ? resolveIndexDir(rootDir, 'code', userConfig, resolveOptions) : null;
  const proseDir = runProse && !useSqlite
    ? requireIndexDir(rootDir, 'prose', userConfig, { emitOutput, exitOnError, resolveOptions })
    : proseIndexDir;
  const codeDir = runCode && !useSqlite
    ? requireIndexDir(rootDir, 'code', userConfig, { emitOutput, exitOnError, resolveOptions })
    : codeIndexDir;
  const recordsDir = runRecords
    ? requireIndexDir(rootDir, 'records', userConfig, { emitOutput, exitOnError, resolveOptions })
    : null;

  const resolvedTantivyConfig = normalizeTantivyConfig(tantivyConfig || userConfig.tantivy || {});
  const tantivyRequired = backendLabel === 'tantivy' || backendForcedTantivy === true;
  const tantivyEnabled = resolvedTantivyConfig.enabled || tantivyRequired;
  if (tantivyRequired) {
    const dep = tryRequire('tantivy');
    if (!dep.ok) {
      throw new Error('Tantivy backend requested but the optional "tantivy" module is not available.');
    }
  }

  const resolveTantivyAvailability = async (mode, indexDir) => {
    if (!tantivyEnabled || !indexDir) {
      return { dir: null, metaPath: null, meta: null, available: false };
    }
    const paths = resolveTantivyPaths(indexDir, mode, resolvedTantivyConfig);
    let meta = null;
    if (paths.metaPath && await pathExists(paths.metaPath)) {
      try {
        meta = readJsonFile(paths.metaPath, { maxBytes: MAX_JSON_BYTES });
      } catch {}
    }
    const available = Boolean(meta && paths.dir && await pathExists(paths.dir));
    return { ...paths, meta, available };
  };

  const ensureTantivyIndex = async (mode, indexDir) => {
    const availability = await resolveTantivyAvailability(mode, indexDir);
    if (availability.available) return availability;
    if (!tantivyRequired || !resolvedTantivyConfig.autoBuild) return availability;
    const toolRoot = resolveToolRoot();
    const scriptPath = path.join(toolRoot, 'tools', 'build/tantivy-index.js');
    const result = spawnSubprocessSync(
      process.execPath,
      [scriptPath, '--mode', mode, '--repo', rootDir],
      {
        stdio: emitOutput ? 'inherit' : 'ignore',
        rejectOnNonZeroExit: false,
        env: runtimeEnv
      }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Tantivy index build failed for mode=${mode}.`);
    }
    return resolveTantivyAvailability(mode, indexDir);
  };

  const loadIndexCachedLocal = async (dir, options = {}, mode = null) => loadIndexCached({
    indexCache,
    dir,
    modelIdDefault,
    fileChargramN,
    includeHnsw: options.includeHnsw !== false,
    includeDense: options.includeDense !== false,
    includeMinhash: options.includeMinhash !== false,
    includeFilterIndex: options.includeFilterIndex !== false,
    includeFileRelations: options.includeFileRelations !== false,
    includeRepoMap: options.includeRepoMap !== false,
    includeChunkMetaCold: options.includeChunkMetaCold !== false,
    hnswConfig,
    denseVectorMode: resolvedDenseVectorMode,
    loadIndex: (targetDir, loadOptions) => loadIndex(targetDir, {
      ...loadOptions,
      strict,
      mode,
      denseVectorMode: resolvedDenseVectorMode
    })
  });

  let extractedProseDir = null;
  let resolvedRunExtractedProse = runExtractedProse;
  let resolvedLoadExtractedProse = runExtractedProse || loadExtractedProse;
  const disableOptionalExtractedProse = (reason = null) => {
    if (!resolvedLoadExtractedProse || resolvedRunExtractedProse) return false;
    if (reason && emitOutput) {
      console.warn(`[search] ${reason}; skipping extracted-prose comment joins.`);
    }
    resolvedLoadExtractedProse = false;
    extractedProseDir = null;
    return true;
  };
  if (resolvedLoadExtractedProse) {
    if (resolvedRunExtractedProse && (searchMode === 'extracted-prose' || searchMode === 'default')) {
      extractedProseDir = requireIndexDir(rootDir, 'extracted-prose', userConfig, {
        emitOutput,
        exitOnError,
        resolveOptions
      });
    } else {
      try {
        extractedProseDir = resolveIndexDir(rootDir, 'extracted-prose', userConfig, resolveOptions);
      } catch (error) {
        if (error?.code !== 'NO_INDEX') throw error;
        // Optional comment-join path: explicit as-of refs should not hard-fail when extracted-prose
        // was not requested and is unavailable for the selected snapshot/build.
        resolvedRunExtractedProse = false;
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
      }
      if (!await hasIndexMetaAsync(extractedProseDir)) {
        if (resolvedRunExtractedProse && emitOutput) {
          console.warn('[search] extracted-prose index not found; skipping.');
        }
        resolvedRunExtractedProse = false;
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
      }
    }
  }

  if (strict) {
    const ensureManifest = (dir) => {
      if (!dir) return;
      loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict: true });
    };
    if (runCode) ensureManifest(codeDir);
    if (runProse) ensureManifest(proseDir);
    if (runRecords) ensureManifest(recordsDir);
    if (resolvedRunExtractedProse && resolvedLoadExtractedProse) ensureManifest(extractedProseDir);
  }

  const includeExtractedProseInCompatibility = resolvedLoadExtractedProse;
  const compatibilityTargetCandidates = [
    runCode ? { mode: 'code', dir: codeDir } : null,
    runProse ? { mode: 'prose', dir: proseDir } : null,
    runRecords ? { mode: 'records', dir: recordsDir } : null,
    includeExtractedProseInCompatibility ? { mode: 'extracted-prose', dir: extractedProseDir } : null
  ].filter((entry) => entry && entry.dir);
  const compatibilityChecks = await Promise.all(
    compatibilityTargetCandidates.map(async (entry) => ({
      entry,
      hasMeta: await hasIndexMetaAsync(entry.dir)
    }))
  );
  const compatibilityTargets = compatibilityChecks
    .filter((check) => check.hasMeta)
    .map((check) => check.entry);
  if (compatibilityTargets.length) {
    const compatibilityResults = await Promise.all(
      compatibilityTargets.map(async (entry) => {
        const strictCompatibilityKey = strict && (entry.mode !== 'extracted-prose' || resolvedRunExtractedProse);
        const { key } = readCompatibilityKey(entry.dir, {
          maxBytes: MAX_JSON_BYTES,
          strict: strictCompatibilityKey
        });
        return { mode: entry.mode, key };
      })
    );
    const keys = new Map(compatibilityResults.map((entry) => [entry.mode, entry.key]));
    let keysToValidate = keys;
    const hasMixedCompatibilityKeys = (map) => (new Set(map.values())).size > 1;
    if (hasMixedCompatibilityKeys(keysToValidate) && !resolvedRunExtractedProse && keysToValidate.has('extracted-prose')) {
      const filtered = new Map(Array.from(keysToValidate.entries()).filter(([mode]) => mode !== 'extracted-prose'));
      if (!hasMixedCompatibilityKeys(filtered)) {
        if (emitOutput) {
          console.warn('[search] extracted-prose index mismatch; skipping comment joins.');
        }
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
        keysToValidate = filtered;
      }
    }
    if (hasMixedCompatibilityKeys(keysToValidate)) {
      const details = Array.from(keysToValidate.entries())
        .map(([mode, key]) => `- ${mode}: ${key}`)
        .join('\n');
      if (allowUnsafeMix === true) {
        if (emitOutput) {
          console.warn(
            '[search] compatibilityKey mismatch overridden via --allow-unsafe-mix. ' +
            'Results may combine incompatible index cohorts:\n' +
            details
          );
        }
      } else {
        throw new Error(`Incompatible indexes detected (compatibilityKey mismatch):\n${details}`);
      }
    }
  }

  const loadOptions = {
    includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
    includeMinhash: needsAnnArtifacts,
    includeFilterIndex: needsFilterIndex,
    includeFileRelations: needsFileRelations,
    includeRepoMap: needsRepoMap,
    includeChunkMetaCold: needsChunkMetaCold,
    includeHnsw: annActive
  };
  /**
   * Resolve ordered dense-vector artifact candidates for a mode.
   * Auto mode prefers split vectors by cohort, but legacy indexes may only
   * expose merged vectors, so merged remains a fallback candidate during
   * mixed-version rollouts.
   *
   * @param {string} mode
   * @returns {string[]}
   */
  const resolveDenseArtifactCandidates = (mode) => {
    if (resolvedDenseVectorMode === 'code') return ['dense_vectors_code'];
    if (resolvedDenseVectorMode === 'doc') return ['dense_vectors_doc'];
    if (resolvedDenseVectorMode === 'auto') {
      if (mode === 'code') return ['dense_vectors_code', 'dense_vectors'];
      if (mode === 'prose' || mode === 'extracted-prose') return ['dense_vectors_doc', 'dense_vectors'];
    }
    return ['dense_vectors'];
  };
  /**
   * Attach lazy dense-vector loading for modes that defer ANN artifacts.
   * Candidate artifacts are tried in priority order and memoized per index.
   *
   * @param {object} idx
   * @param {string} mode
   * @param {string|null} dir
   */
  const attachDenseVectorLoader = (idx, mode, dir) => {
    if (!idx || !dir || !needsAnnArtifacts || !lazyDenseVectorsEnabled) return;
    const artifactCandidates = resolveDenseArtifactCandidates(mode);
    let pendingLoad = null;
    idx.loadDenseVectors = async () => {
      if (Array.isArray(idx?.denseVec?.vectors) && idx.denseVec.vectors.length > 0) {
        return idx.denseVec;
      }
      if (pendingLoad) return pendingLoad;
      pendingLoad = (async () => {
        let manifest = null;
        try {
          manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
        } catch (err) {
          if (err?.code !== 'ERR_MANIFEST_MISSING' && err?.code !== 'ERR_MANIFEST_INVALID') {
            throw err;
          }
        }
        for (const artifactName of artifactCandidates) {
          let loaded = null;
          try {
            loaded = await loadJsonObjectArtifact(dir, artifactName, {
              maxBytes: MAX_JSON_BYTES,
              manifest,
              strict
            });
          } catch {
            if (strict) continue;
          }
          if ((!loaded || !Array.isArray(loaded.vectors) || !loaded.vectors.length) && !strict) {
            loaded = await loadDenseArtifactFromLegacyPath(dir, artifactName);
          }
          if (!loaded || !Array.isArray(loaded.vectors) || !loaded.vectors.length) continue;
          if (!loaded.model && modelIdDefault) loaded.model = modelIdDefault;
          idx.denseVec = loaded;
          return loaded;
        }
        idx.loadDenseVectors = null;
        return null;
      })().finally(() => {
        pendingLoad = null;
      });
      return pendingLoad;
    };
  };
  const idxProse = runProse
    ? (useSqlite ? loadIndexFromSqlite('prose', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: sqliteContextChunks,
      includeFilterIndex: needsFilterIndex
    }) : (useLmdb ? loadIndexFromLmdb('prose', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: true,
      includeFilterIndex: needsFilterIndex
    }) : await loadIndexCachedLocal(proseDir, loadOptions, 'prose')))
    : { ...EMPTY_INDEX };
  let idxExtractedProse = { ...EMPTY_INDEX };
  if (resolvedLoadExtractedProse) {
    try {
      if (useSqlite) {
        try {
          idxExtractedProse = loadIndexFromSqlite('extracted-prose', {
            includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
            includeMinhash: needsAnnArtifacts,
            includeChunks: sqliteContextChunks,
            includeFilterIndex: needsFilterIndex
          });
        } catch {
          idxExtractedProse = await loadIndexCachedLocal(extractedProseDir, {
            ...loadOptions,
            includeHnsw: annActive && resolvedRunExtractedProse
          }, 'extracted-prose');
        }
      } else {
        idxExtractedProse = await loadIndexCachedLocal(extractedProseDir, {
          ...loadOptions,
          includeHnsw: annActive && resolvedRunExtractedProse
        }, 'extracted-prose');
      }
    } catch (err) {
      if (!isMissingManifestLikeError(err) || !disableOptionalExtractedProse('optional extracted-prose artifacts unavailable')) {
        throw err;
      }
      idxExtractedProse = { ...EMPTY_INDEX };
    }
  }
  const idxCode = runCode
    ? (useSqlite ? loadIndexFromSqlite('code', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: sqliteContextChunks,
      includeFilterIndex: needsFilterIndex
    }) : (useLmdb ? loadIndexFromLmdb('code', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: true,
      includeFilterIndex: needsFilterIndex
    }) : await loadIndexCachedLocal(codeDir, loadOptions, 'code')))
    : { ...EMPTY_INDEX };
  const idxRecords = runRecords
    ? await loadIndexCachedLocal(recordsDir, loadOptions, 'records')
    : { ...EMPTY_INDEX };

  if (!idxCode.state && indexStates?.code) idxCode.state = indexStates.code;
  if (!idxProse.state && indexStates?.prose) idxProse.state = indexStates.prose;
  if (!idxExtractedProse.state && indexStates?.['extracted-prose']) {
    idxExtractedProse.state = indexStates['extracted-prose'];
  }
  if (!idxRecords.state && indexStates?.records) idxRecords.state = indexStates.records;

  warnPendingState(idxCode, 'code', { emitOutput, useSqlite, annActive });
  warnPendingState(idxProse, 'prose', { emitOutput, useSqlite, annActive });
  warnPendingState(idxExtractedProse, 'extracted-prose', { emitOutput, useSqlite, annActive });

  const relationLoadTasks = [];
  if (runCode) {
    idxCode.denseVec = resolveDenseVector(idxCode, 'code', resolvedDenseVectorMode);
    if (!idxCode.denseVec && idxCode?.state?.embeddings?.embeddingIdentity) {
      idxCode.denseVec = { ...idxCode.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxCode, 'code', codeIndexDir);
    idxCode.indexDir = codeIndexDir;
    if ((useSqlite || useLmdb) && needsFileRelations && !idxCode.fileRelations) {
      relationLoadTasks.push(
        loadFileRelations(rootDir, userConfig, 'code', { resolveOptions })
          .then((value) => {
            idxCode.fileRelations = value;
          })
      );
    }
    if ((useSqlite || useLmdb) && needsRepoMap && !idxCode.repoMap) {
      relationLoadTasks.push(
        loadRepoMap(rootDir, userConfig, 'code', { resolveOptions })
          .then((value) => {
            idxCode.repoMap = value;
          })
      );
    }
  }
  if (runProse) {
    idxProse.denseVec = resolveDenseVector(idxProse, 'prose', resolvedDenseVectorMode);
    if (!idxProse.denseVec && idxProse?.state?.embeddings?.embeddingIdentity) {
      idxProse.denseVec = { ...idxProse.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxProse, 'prose', proseIndexDir);
    idxProse.indexDir = proseIndexDir;
    if ((useSqlite || useLmdb) && needsFileRelations && !idxProse.fileRelations) {
      relationLoadTasks.push(
        loadFileRelations(rootDir, userConfig, 'prose', { resolveOptions })
          .then((value) => {
            idxProse.fileRelations = value;
          })
      );
    }
    if ((useSqlite || useLmdb) && needsRepoMap && !idxProse.repoMap) {
      relationLoadTasks.push(
        loadRepoMap(rootDir, userConfig, 'prose', { resolveOptions })
          .then((value) => {
            idxProse.repoMap = value;
          })
      );
    }
  }
  if (resolvedLoadExtractedProse) {
    idxExtractedProse.denseVec = resolveDenseVector(
      idxExtractedProse,
      'extracted-prose',
      resolvedDenseVectorMode
    );
    if (!idxExtractedProse.denseVec && idxExtractedProse?.state?.embeddings?.embeddingIdentity) {
      idxExtractedProse.denseVec = { ...idxExtractedProse.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxExtractedProse, 'extracted-prose', extractedProseDir);
    idxExtractedProse.indexDir = extractedProseDir;
    if (needsFileRelations && !idxExtractedProse.fileRelations) {
      relationLoadTasks.push(
        loadFileRelations(rootDir, userConfig, 'extracted-prose', { resolveOptions })
          .then((value) => {
            idxExtractedProse.fileRelations = value;
          })
      );
    }
    if (needsRepoMap && !idxExtractedProse.repoMap) {
      relationLoadTasks.push(
        loadRepoMap(rootDir, userConfig, 'extracted-prose', { resolveOptions })
          .then((value) => {
            idxExtractedProse.repoMap = value;
          })
      );
    }
  }
  if (relationLoadTasks.length) {
    await Promise.all(relationLoadTasks);
  }

  if (runRecords) {
    idxRecords.denseVec = resolveDenseVector(idxRecords, 'records', resolvedDenseVectorMode);
    if (!idxRecords.denseVec && idxRecords?.state?.embeddings?.embeddingIdentity) {
      idxRecords.denseVec = { ...idxRecords.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxRecords, 'records', recordsDir);
    idxRecords.indexDir = recordsDir;
  }

  const scmHydrationTasks = [];
  if (runCode) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxCode,
      mode: 'code',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (runProse) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxProse,
      mode: 'prose',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (resolvedLoadExtractedProse) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxExtractedProse,
      mode: 'extracted-prose',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (runRecords) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxRecords,
      mode: 'records',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (scmHydrationTasks.length) {
    await Promise.all(scmHydrationTasks);
  }

  /**
   * Attach LanceDB metadata/dir pointers for ANN search.
   * Non-strict mode tolerates missing manifest entries and falls back to
   * legacy on-disk paths when present.
   *
   * @param {object} idx
   * @param {string} mode
   * @param {string|null} dir
   * @returns {Promise<object|null>}
   */
  const attachLanceDb = async (idx, mode, dir) => {
    if (!idx || !dir || lancedbConfig?.enabled === false) return null;
    const paths = resolveLanceDbPaths(dir);
    const target = resolveLanceDbTarget(mode, resolvedDenseVectorMode);
    const targetPaths = paths?.[target] || {};
    const metaName = target === 'doc'
      ? 'dense_vectors_doc_lancedb_meta'
      : target === 'code'
        ? 'dense_vectors_code_lancedb_meta'
        : 'dense_vectors_lancedb_meta';
    const dirName = target === 'doc'
      ? 'dense_vectors_doc_lancedb'
      : target === 'code'
        ? 'dense_vectors_code_lancedb'
        : 'dense_vectors_lancedb';
    let manifest = null;
    try {
      manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
    } catch (err) {
      if (
        err?.code !== 'ERR_MANIFEST_MISSING'
        && err?.code !== 'ERR_MANIFEST_INVALID'
      ) {
        throw err;
      }
      if (strict) throw err;
    }
    let meta = null;
    if (manifest) {
      const metaPresence = resolveArtifactPresence(dir, metaName, {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict
      });
      const missingMetaEntry = metaPresence?.error?.code === 'ERR_MANIFEST_MISSING'
        || metaPresence?.format === 'missing';
      if (metaPresence?.error && !missingMetaEntry) {
        throw metaPresence.error;
      }
      if (!missingMetaEntry) {
        try {
          meta = await loadJsonObjectArtifact(dir, metaName, {
            maxBytes: MAX_JSON_BYTES,
            manifest,
            strict
          });
        } catch (err) {
          if (strict) {
            throw err;
          }
        }
      }
    }
    if (!meta && !strict && targetPaths.metaPath && await pathExists(targetPaths.metaPath)) {
      try {
        meta = readJsonFile(targetPaths.metaPath, { maxBytes: MAX_JSON_BYTES });
      } catch {}
    }
    let lanceDir = null;
    if (manifest) {
      const dirPresence = resolveArtifactPresence(dir, dirName, {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict
      });
      const missingDirEntry = dirPresence?.error?.code === 'ERR_MANIFEST_MISSING'
        || dirPresence?.format === 'missing';
      if (dirPresence?.error && !missingDirEntry) {
        throw dirPresence.error;
      }
      if (!missingDirEntry) {
        try {
          lanceDir = resolveDirArtifactPath(dir, dirName, {
            manifest,
            strict
          });
        } catch (err) {
          if (
            err?.code !== 'ERR_MANIFEST_MISSING'
            && err?.code !== 'ERR_MANIFEST_INVALID'
          ) {
            throw err;
          }
        }
      }
    }
    if (!lanceDir && !strict && targetPaths.dir && await pathExists(targetPaths.dir)) {
      lanceDir = targetPaths.dir;
    }
    const available = Boolean(meta && lanceDir && await pathExists(lanceDir));
    idx.lancedb = {
      target,
      dir: lanceDir || null,
      metaPath: targetPaths.metaPath || null,
      meta,
      available
    };
    return idx.lancedb;
  };

  const attachGraphRelations = async (idx, dir) => {
    if (!idx || !dir || !needsGraphRelations) return null;
    let manifest = null;
    try {
      manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
    } catch (err) {
      if (err?.code === 'ERR_MANIFEST_MISSING' || err?.code === 'ERR_MANIFEST_INVALID') {
        return null;
      }
      throw err;
    }
    const presence = resolveArtifactPresence(dir, 'graph_relations', {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict
    });
    if (!presence || presence.format === 'missing' || presence.error || presence.missingPaths?.length) {
      idx.graphRelations = null;
      return null;
    }
    try {
      idx.graphRelations = await loadGraphRelations(dir, {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict
      });
      return idx.graphRelations;
    } catch (err) {
      if (emitOutput) {
        console.warn(
          `[search] graph_relations load failed (${err?.message || err}); using name-based context expansion.`
        );
      }
      idx.graphRelations = null;
      return null;
    }
  };

  const attachTasks = [];
  if (needsGraphRelations) {
    attachTasks.push(() => attachGraphRelations(idxCode, codeIndexDir));
  }
  if (needsAnnArtifacts) {
    attachTasks.push(() => attachLanceDb(idxCode, 'code', codeIndexDir));
    attachTasks.push(() => attachLanceDb(idxProse, 'prose', proseIndexDir));
    if (resolvedRunExtractedProse && resolvedLoadExtractedProse) {
      attachTasks.push(() => attachLanceDb(idxExtractedProse, 'extracted-prose', extractedProseDir));
    }
  }
  if (attachTasks.length) {
    const limit = 2;
    let cursor = 0;
    const runTask = async () => {
      while (cursor < attachTasks.length) {
        const current = cursor;
        cursor += 1;
        await attachTasks[current]();
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, attachTasks.length) }, runTask));
  }

  /**
   * Compare embedding identity across ANN-related artifacts for one mode.
   * Returns mismatch records; in non-strict mode, disable hooks may mark
   * incompatible ANN sources unavailable to keep retrieval operational.
   *
   * @param {string} mode
   * @param {object} idx
   * @returns {Array<object>}
   */
  const validateEmbeddingIdentityForMode = (mode, idx) => {
    if (!idx) return [];
    const sources = [];
    const stateIdentity = extractEmbeddingIdentity(idx?.state?.embeddings?.embeddingIdentity);
    if (stateIdentity) {
      sources.push({ name: 'index_state', identity: stateIdentity, disable: null });
    }
    const denseIdentity = extractEmbeddingIdentity(idx.denseVec);
    if (denseIdentity) {
      sources.push({ name: 'dense_vectors', identity: denseIdentity, disable: null });
    }
    const hnswIdentity = extractEmbeddingIdentity(idx.hnsw?.meta);
    if (hnswIdentity) {
      sources.push({
        name: 'hnsw',
        identity: hnswIdentity,
        disable: () => {
          if (!idx.hnsw || typeof idx.hnsw !== 'object') return;
          idx.hnsw.available = false;
          idx.hnsw.index = null;
        }
      });
    }
    const lanceIdentity = extractEmbeddingIdentity(idx.lancedb?.meta);
    if (lanceIdentity) {
      sources.push({
        name: 'lancedb',
        identity: lanceIdentity,
        disable: () => {
          if (!idx.lancedb || typeof idx.lancedb !== 'object') return;
          idx.lancedb.available = false;
        }
      });
    }
    const sqliteVecIdentity = extractEmbeddingIdentity(idx.sqliteVecMeta);
    if (sqliteVecIdentity) {
      sources.push({ name: 'sqlite-vec-meta', identity: sqliteVecIdentity, disable: null });
    }
    if (sources.length <= 1) return [];

    const reference = sources[0];
    const mismatches = [];
    const quantFields = ['scale', 'minVal', 'maxVal', 'levels'];
    for (const source of sources.slice(1)) {
      const beforeCount = mismatches.length;
      const leftDims = normalizeIdentityNumber(reference.identity?.dims);
      const rightDims = normalizeIdentityNumber(source.identity?.dims);
      if (leftDims == null || rightDims == null || !numbersEqual(leftDims, rightDims)) {
        mismatches.push({
          mode,
          source: source.name,
          field: 'dims',
          expected: leftDims,
          actual: rightDims
        });
      }

      const leftModel = normalizeModel(reference.identity?.model);
      const rightModel = normalizeModel(source.identity?.model);
      if (leftModel && rightModel && leftModel !== rightModel) {
        mismatches.push({
          mode,
          source: source.name,
          field: 'model',
          expected: leftModel,
          actual: rightModel
        });
      }

      for (const field of quantFields) {
        const leftHas = hasOwn(reference.identity, field);
        const rightHas = hasOwn(source.identity, field);
        if (!leftHas || !rightHas) continue;
        const leftValue = normalizeIdentityNumber(reference.identity[field]);
        const rightValue = normalizeIdentityNumber(source.identity[field]);
        // Some ANN metadata formats omit quantization fields; treat null/omitted as unknown,
        // and only enforce when both sides provide concrete numeric values.
        if (leftValue == null || rightValue == null) continue;
        if (!numbersEqual(leftValue, rightValue)) {
          mismatches.push({
            mode,
            source: source.name,
            field,
            expected: leftValue,
            actual: rightValue
          });
        }
      }
      if (mismatches.length > beforeCount && !strict && typeof source.disable === 'function') {
        source.disable();
      }
    }
    return mismatches;
  };

  if (needsAnnArtifacts) {
    const identityMismatches = [];
    if (runCode) identityMismatches.push(...validateEmbeddingIdentityForMode('code', idxCode));
    if (runProse) identityMismatches.push(...validateEmbeddingIdentityForMode('prose', idxProse));
    if (resolvedLoadExtractedProse) {
      identityMismatches.push(...validateEmbeddingIdentityForMode('extracted-prose', idxExtractedProse));
    }
    if (runRecords) identityMismatches.push(...validateEmbeddingIdentityForMode('records', idxRecords));
    if (identityMismatches.length) {
      const details = identityMismatches
        .map((entry) => (
          `- ${entry.mode}/${entry.source}: ${entry.field} expected=${entry.expected ?? 'null'} actual=${entry.actual ?? 'null'}`
        ))
        .join('\n');
      if (strict) {
        throw new Error(`Embedding identity mismatch detected:\n${details}`);
      }
      if (emitOutput) {
        console.warn(`[search] Embedding identity mismatch detected; disabling incompatible ANN backends.\n${details}`);
      }
    }
  }

  const attachTantivy = async (idx, mode, dir) => {
    if (!idx || !dir || !tantivyEnabled) return null;
    const availability = await ensureTantivyIndex(mode, dir);
    idx.tantivy = {
      dir: availability.dir,
      metaPath: availability.metaPath,
      meta: availability.meta,
      available: availability.available
    };
    return idx.tantivy;
  };

  await Promise.all([
    attachTantivy(idxCode, 'code', codeIndexDir),
    attachTantivy(idxProse, 'prose', proseIndexDir),
    attachTantivy(idxExtractedProse, 'extracted-prose', extractedProseDir),
    attachTantivy(idxRecords, 'records', recordsDir)
  ]);

  if (tantivyRequired) {
    const missingModes = [];
    if (runCode && !idxCode?.tantivy?.available) missingModes.push('code');
    if (runProse && !idxProse?.tantivy?.available) missingModes.push('prose');
    if (resolvedRunExtractedProse && !idxExtractedProse?.tantivy?.available) {
      missingModes.push('extracted-prose');
    }
    if (runRecords && !idxRecords?.tantivy?.available) missingModes.push('records');
    if (missingModes.length) {
      throw new Error(`Tantivy index missing for mode(s): ${missingModes.join(', ')}.`);
    }
  }

  const hnswAnnState = {
    code: { available: Boolean(idxCode?.hnsw?.available) },
    prose: { available: Boolean(idxProse?.hnsw?.available) },
    records: { available: Boolean(idxRecords?.hnsw?.available) },
    'extracted-prose': { available: Boolean(idxExtractedProse?.hnsw?.available) }
  };
  const hnswAnnUsed = {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  };

  const lanceAnnState = {
    code: {
      available: Boolean(idxCode?.lancedb?.available),
      dims: idxCode?.lancedb?.meta?.dims ?? null,
      metric: idxCode?.lancedb?.meta?.metric ?? null
    },
    prose: {
      available: Boolean(idxProse?.lancedb?.available),
      dims: idxProse?.lancedb?.meta?.dims ?? null,
      metric: idxProse?.lancedb?.meta?.metric ?? null
    },
    records: { available: false, dims: null, metric: null },
    'extracted-prose': {
      available: Boolean(idxExtractedProse?.lancedb?.available),
      dims: idxExtractedProse?.lancedb?.meta?.dims ?? null,
      metric: idxExtractedProse?.lancedb?.meta?.metric ?? null
    }
  };
  const lanceAnnUsed = {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  };

  const {
    modelIdForCode,
    modelIdForProse,
    modelIdForExtractedProse,
    modelIdForRecords
  } = resolveModelIds({
    modelIdDefault,
    runCode,
    runProse,
    runExtractedProse: resolvedRunExtractedProse,
    extractedProseLoaded: resolvedLoadExtractedProse,
    runRecords,
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords
  });

  return {
    idxProse,
    idxExtractedProse,
    idxCode,
    idxRecords,
    runExtractedProse: resolvedRunExtractedProse,
    extractedProseLoaded: resolvedLoadExtractedProse,
    hnswAnnState,
    hnswAnnUsed,
    lanceAnnState,
    lanceAnnUsed,
    modelIdForCode,
    modelIdForProse,
    modelIdForExtractedProse,
    modelIdForRecords
  };
}
