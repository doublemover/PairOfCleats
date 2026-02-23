import { runWithConcurrency } from '../../shared/concurrency.js';
import { buildLineAuthors, getChunkAuthorsFromLines } from '../../index/scm/annotate.js';
import { toRepoPosixPath } from '../../index/scm/paths.js';
import { getScmProviderAndRoot, resolveScmConfig } from '../../index/scm/registry.js';
import { setScmRuntimeConfig } from '../../index/scm/runtime.js';
import { buildIndexSignature } from '../index-cache.js';
import { rebuildFilterIndexIfPresent } from './filter-index.js';

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

export const hydrateChunkAuthorsForIndex = async ({
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
    if (applied > 0) {
      rebuildFilterIndexIfPresent({ idx, fileChargramN });
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
  await runWithConcurrency(
    fileEntries,
    SCM_CHUNK_AUTHOR_ANNOTATE_CONCURRENCY,
    async ([filePosix, chunkRefs]) => {
      let annotateResult = null;
      try {
        annotateResult = await Promise.resolve(selection.providerImpl.annotate({
          repoRoot: selection.repoRoot,
          filePosix,
          timeoutMs: annotateTimeoutMs,
          commitId: commitId || null
        }));
      } catch {
        return null;
      }
      const lineAuthors = buildLineAuthors(annotateResult);
      if (!Array.isArray(lineAuthors) || !lineAuthors.length) return null;
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
      return null;
    },
    { collectResults: false }
  );
  setScmChunkAuthorHydrationCacheEntry(cacheKey, {
    chunkAuthorsByKey
  });
  scmChunkAuthorHydrationStats.hydrateRuns += 1;
  const applied = applyChunkAuthorMapToChunks({
    chunkMeta: idx.chunkMeta,
    chunkAuthorsByKey
  });
  if (applied > 0) {
    rebuildFilterIndexIfPresent({ idx, fileChargramN });
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
