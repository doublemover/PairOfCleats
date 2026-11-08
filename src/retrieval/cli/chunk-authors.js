import { runWithConcurrency } from '../../shared/concurrency/run-with-queue.js';
import { buildLineAuthors, getChunkAuthorsFromLines } from '../../index/scm/annotate.js';
import { toRepoPosixPath } from '../../index/scm/paths.js';
import { getScmProviderAndRoot, resolveScmConfig } from '../../index/scm/registry.js';
import { setScmRuntimeConfig, buildScmFreshnessGuard, resolveScmRevisionIdentity } from '../../index/scm/runtime.js';
import { buildIndexSignature } from '../index-cache.js';
import { rebuildFilterIndexIfPresent } from './filter-index.js';
import { acquireChunkAuthorCache, cacheChunkAuthorFile, snapshotChunkAuthors, retireChunkAuthorCache,
  resetChunkAuthorCache, chunkAuthorCacheStats, bindChunkAuthorCoverage } from './chunk-author-cache.js';
import { throwIfAborted, isAbortError } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

const SCM_CHUNK_AUTHOR_FILTER_FLAG = '--chunk-author';
const SCM_CHUNK_AUTHOR_FORCE_ENV = 'PAIROFCLEATS_FORCE_CHUNK_AUTHOR_HYDRATION';
const SCM_CHUNK_AUTHOR_ANNOTATE_TIMEOUT_MS = 15000;
const SCM_CHUNK_AUTHOR_ANNOTATE_CONCURRENCY = 4;
let scmChunkAuthorMaterializations = new WeakMap();
let scmChunkAuthorBasePairs = new WeakMap();
const scmChunkAuthorHydrationStats = {
  cacheHits: 0,
  cacheMisses: 0,
  hydrateRuns: 0,
  annotatedFiles: 0,
  metadataCopies: 0,
  filterIndexBuilds: 0,
  materializationHits: 0
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

const resolveExistingChunkAuthors = (chunk) => (
  Array.isArray(chunk?.chunk_authors)
    ? chunk.chunk_authors
    : (Array.isArray(chunk?.chunkAuthors) ? chunk.chunkAuthors : null)
);

const hasExistingChunkAuthors = (chunk) => {
  const existingAuthors = resolveExistingChunkAuthors(chunk);
  return Array.isArray(existingAuthors) && existingAuthors.length > 0;
};

const countResolvableMissingChunkAuthors = (chunkMeta) => {
  if (!Array.isArray(chunkMeta) || !chunkMeta.length) return 0;
  let count = 0;
  for (let index = 0; index < chunkMeta.length; index += 1) {
    const chunk = chunkMeta[index];
    if (!chunk) continue;
    if (hasExistingChunkAuthors(chunk)) continue;
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
    if (hasExistingChunkAuthors(chunk)) continue;
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

const applyChunkAuthorMapToChunks = ({ idx, chunkAuthorsByKey, fileChargramN }) => {
  const chunkMeta = idx.chunkMeta;
  if (!Array.isArray(chunkMeta) || !chunkMeta.length) return 0;
  if (!(chunkAuthorsByKey instanceof Map) || !chunkAuthorsByKey.size) return 0;
  let materializations = scmChunkAuthorMaterializations.get(chunkAuthorsByKey);
  if (!materializations) { materializations = new WeakMap(); scmChunkAuthorMaterializations.set(chunkAuthorsByKey, materializations); }
  const previous = materializations.get(chunkMeta);
  if (previous && previous.baseFilterIndex === idx.filterIndex && previous.fileChargramN === fileChargramN) {
    scmChunkAuthorBasePairs.set(previous.chunkMeta, { chunkMeta, filterIndex: idx.filterIndex });
    Object.assign(idx, { chunkMeta: previous.chunkMeta, filterIndex: previous.filterIndex });
    scmChunkAuthorHydrationStats.materializationHits++;
    return previous.applied;
  }
  const next = chunkMeta.slice();
  let applied = 0;
  for (let index = 0; index < chunkMeta.length; index += 1) {
    const chunk = chunkMeta[index];
    if (!chunk) continue;
    const key = resolveChunkAuthorChunkKey(chunk, index);
    if (!key) continue;
    const authors = chunkAuthorsByKey.get(key);
    if (!Array.isArray(authors) || !authors.length) continue;
    if (hasExistingChunkAuthors(chunk)) continue;
    const nextAuthors = Object.freeze(Array.from(authors));
    next[index] = { ...chunk, chunk_authors: nextAuthors, chunkAuthors: nextAuthors };
    applied += 1;
  }
  if (applied) {
    // Construct both derivatives before publishing either. Cache-owned rows and
    // other request wrappers retain their original coherent facts/filter pair.
    const overlay = { chunkMeta: next, filterIndex: idx.filterIndex };
    if (rebuildFilterIndexIfPresent({ idx: overlay, fileChargramN })) scmChunkAuthorHydrationStats.filterIndexBuilds++;
    materializations.set(chunkMeta, { ...overlay, applied, baseFilterIndex: idx.filterIndex, fileChargramN });
    scmChunkAuthorBasePairs.set(next, { chunkMeta, filterIndex: idx.filterIndex });
    Object.assign(idx, overlay);
    scmChunkAuthorHydrationStats.metadataCopies++;
  }
  return applied;
};

const resolveBuildCommitHint = (idx) => {
  const buildId = String(idx?.state?.buildId || '').trim();
  if (!buildId) return null;
  const parts = buildId.split('_');
  if (!/^\d{8}T\d{6}Z$/.test(parts[0])) return null;
  const position = parts.length >= 4 && /^(?:[0-9a-f]{8}|nohash)$/i.test(parts[3]) ? 2
    : parts.length === 3 && /^(?:[0-9a-f]{8}|nohash)$/i.test(parts[2]) ? 1 : null;
  if (position === null) return null;
  const candidate = String(parts[position] || '').trim().toLowerCase();
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
  } catch (error) {
    observeStorageResource(error, { phase: 'chunk-author-provider-selection' }).requireSettled();
    if (isAbortError(error)) throw error;
    return { selection: null, scmConfig: null };
  }
};

const resolveChunkAuthorHydrationCacheKey = async ({ idx, mode, authority }) => {
  if (!authority?.key) return null;
  const signature = idx?.indexDir ? await buildIndexSignature(idx.indexDir) : null;
  const fallback = [
    `build:${idx?.state?.buildId || 'missing'}`,
    `mode:${mode || 'unknown'}`,
    `dir:${idx?.indexDir || 'missing'}`
  ].join('|');
  return JSON.stringify([mode || 'unknown', signature || fallback, authority.key]);
};

export const hydrateChunkAuthorsForIndex = async ({
  idx,
  mode,
  rootDir,
  userConfig,
  fileChargramN,
  filtersActive,
  chunkAuthorFilterActive,
  emitOutput,
  signal = null
}) => {
  if (!shouldHydrateScmChunkAuthors({ filtersActive, chunkAuthorFilterActive })) {
    return { applied: 0, cacheHit: false };
  }
  if (!idx || !Array.isArray(idx.chunkMeta) || !idx.chunkMeta.length) {
    return { applied: 0, cacheHit: false };
  }
  throwIfAborted(signal);
  const base = scmChunkAuthorBasePairs.get(idx.chunkMeta);
  if (base) Object.assign(idx, base);
  const requested = idx.chunkMeta.filter(chunk => chunk && !hasExistingChunkAuthors(chunk)).length;
  const missingCount = countResolvableMissingChunkAuthors(idx.chunkMeta);
  const fileFailures = new Map();
  let admittedIdentity = null;
  const recordFailure = reason => fileFailures.set(reason, (fileFailures.get(reason) || 0) + 1);
  const finish = ({ applied = 0, cacheHit = false, provider = null, revision = null, reason = null, cacheable = false } = {}) => {
    const unresolved = idx.chunkMeta.filter(chunk => chunk && !hasExistingChunkAuthors(chunk)).length;
    const state = unresolved ? applied ? 'partial' : 'unavailable' : requested && !cacheable ? 'partial' : 'complete';
    const coverage = Object.freeze({ schemaVersion: 1, state,
      requested, qualified: requested - unresolved, unresolved, provider, revision, cacheable: cacheable && !unresolved,
      reason: state !== 'complete' ? reason || 'annotation-unavailable' : null,
      fileFailures: Object.freeze([...fileFailures].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([reason, files]) => Object.freeze({ reason, files }))) });
    idx.chunkAuthorCoverage = coverage;
    bindChunkAuthorCoverage(coverage, admittedIdentity);
    if (emitOutput && unresolved) console.warn(`[scm] chunk-author coverage ${coverage.state}: ${unresolved}/${requested} chunks unresolved; file-author fallback is not line-author evidence. Retry after SCM recovery.`);
    return { applied, cacheHit, coverage };
  };
  if (!requested) return finish({ cacheable: true });
  if (!missingCount) return finish({ reason: 'source-range-unavailable' });
  const { selection, scmConfig } = resolveScmSelectionForChunkAuthorHydration({
    rootDir,
    userConfig,
    emitOutput
  });
  if (
    !selection
    || selection.provider === 'none'
    || scmConfig?.annotate?.enabled === false
    || !selection.providerImpl
    || typeof selection.providerImpl.annotate !== 'function'
  ) {
    return finish({ provider: selection?.provider || null, reason: 'provider-disabled-or-unavailable' });
  }
  const refs = resolveMissingChunkAuthorRefs(idx.chunkMeta, selection.repoRoot || rootDir);
  if (!refs.byFile.size) return finish({ reason: 'source-range-unavailable' });
  const annotateTimeoutMs = resolveScmAnnotateTimeoutMs(scmConfig);
  let commitId = resolveScmRevisionIdentity(idx.state?.repo) || resolveScmRevisionIdentity(idx.state?.repoProvenance)
    || resolveBuildCommitHint(idx);
  if (!commitId && typeof selection.providerImpl.getRepoProvenance === 'function') {
    const provenance = await selection.providerImpl.getRepoProvenance({ repoRoot: selection.repoRoot, signal });
    commitId = resolveScmRevisionIdentity(provenance);
  }
  if (!/^[0-9a-f]{7,64}$/i.test(commitId || '')) commitId = null;
  throwIfAborted(signal);
  const authority = buildScmFreshnessGuard({ provider: selection.provider, repoRoot: selection.repoRoot,
    repoHeadId: commitId, config: scmConfig });
  // The Git annotate adapter honors its input commitId. JJ's current adapter
  // annotates its live operation and cannot certify this historical source.
  // metadataCapabilities.annotateCommitId describes returned per-line IDs.
  const cacheKey = selection.provider === 'git'
    ? await resolveChunkAuthorHydrationCacheKey({ idx, mode, authority }) : null;
  admittedIdentity = cacheKey;
  throwIfAborted(signal);
  const { entry, hit } = acquireChunkAuthorCache(cacheKey);
  if (hit) scmChunkAuthorHydrationStats.cacheHits++; else scmChunkAuthorHydrationStats.cacheMisses++;
  const fileEntries = Array.from(refs.byFile.entries());
  const current = [];
  let attempted = false;
  try {
    await runWithConcurrency(
      fileEntries,
      SCM_CHUNK_AUTHOR_ANNOTATE_CONCURRENCY,
      async ([filePosix, chunkRefs]) => {
        throwIfAborted(signal);
        const known = entry.files.get(filePosix);
        if (known && chunkRefs.every(ref => known.has(ref.chunkKey))) return;
        const produce = async () => {
          attempted = true;
          let annotateResult;
          try { annotateResult = await selection.providerImpl.annotate({
            repoRoot: selection.repoRoot,
            filePosix,
            timeoutMs: annotateTimeoutMs,
            commitId, signal
          }); }
          catch (error) {
            observeStorageResource(error, { phase: 'chunk-author-annotation' }).requireSettled();
            if (isAbortError(error) || signal?.aborted) throw error;
            return { authors: null, reason: 'annotation-error' };
          }
          throwIfAborted(signal);
          if (annotateResult?.ok === false) {
            return { authors: null, reason: ['disabled', 'unsupported', 'timeout', 'unavailable'].includes(annotateResult.reason)
              ? annotateResult.reason : 'unavailable' };
          }
          const lineAuthors = buildLineAuthors(annotateResult);
          if (!Array.isArray(lineAuthors) || !lineAuthors.length) return { authors: null, reason: 'no-author-lines' };
          scmChunkAuthorHydrationStats.annotatedFiles++;
          const authorsByKey = new Map();
          for (const chunkRef of chunkRefs) {
            if (chunkRef.endLine > lineAuthors.length) continue;
            const authors = normalizeChunkAuthorList(
              getChunkAuthorsFromLines(
                lineAuthors,
                chunkRef.startLine,
                chunkRef.endLine
              )
            );
            if (!authors.length || authors.includes('unknown')) continue;
            authorsByKey.set(chunkRef.chunkKey, Object.freeze(authors));
          }
          if (authorsByKey.size === chunkRefs.length) cacheChunkAuthorFile(cacheKey, entry, filePosix, authorsByKey);
          return { authors: authorsByKey, reason: authorsByKey.size === chunkRefs.length ? null : 'partial-author-lines' };
        };
        let flights = !signal && entry.flights.get(idx.chunkMeta);
        if (!signal && !flights) { flights = new Map(); entry.flights.set(idx.chunkMeta, flights); }
        let flight = flights && flights.get(filePosix);
        if (!flight) {
          flight = produce();
          if (flights) flights.set(filePosix, flight);
        }
        try {
          const result = await flight, authors = result?.authors;
          if (result?.reason) recordFailure(result.reason);
          if (authors?.size && [...authors.keys()].some(key => !entry.files.get(filePosix)?.has(key))) current.push(authors);
        } finally {
          if (flights?.get(filePosix) === flight) flights.delete(filePosix);
          if (flights && !flights.size && entry.flights.get(idx.chunkMeta) === flights) entry.flights.delete(idx.chunkMeta);
        }
      },
      { collectResults: false, signal, retries: 0 }
    );
    throwIfAborted(signal);
    if (attempted) scmChunkAuthorHydrationStats.hydrateRuns++;
    const chunkAuthorsByKey = snapshotChunkAuthors(entry, current);
    const applied = applyChunkAuthorMapToChunks({
      idx, fileChargramN, chunkAuthorsByKey
    });
    return finish({ applied, cacheHit: hit, provider: selection.provider, revision: commitId,
      reason: !commitId ? 'source-revision-unqualified' : !cacheKey ? 'provider-revision-unqualified' : null,
      cacheable: Boolean(cacheKey) });
  } finally { retireChunkAuthorCache(cacheKey, entry); }
};

export const __testScmChunkAuthorHydration = Object.freeze({
  reset: () => {
    resetChunkAuthorCache();
    scmChunkAuthorMaterializations = new WeakMap();
    scmChunkAuthorBasePairs = new WeakMap();
    scmChunkAuthorHydrationStats.cacheHits = 0;
    scmChunkAuthorHydrationStats.cacheMisses = 0;
    scmChunkAuthorHydrationStats.hydrateRuns = 0;
    scmChunkAuthorHydrationStats.annotatedFiles = 0;
    scmChunkAuthorHydrationStats.metadataCopies = 0;
    scmChunkAuthorHydrationStats.filterIndexBuilds = 0;
    scmChunkAuthorHydrationStats.materializationHits = 0;
  },
  getStats: () => ({
    ...scmChunkAuthorHydrationStats,
    ...chunkAuthorCacheStats()
  })
});
