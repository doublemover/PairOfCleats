import path from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_JSON_BYTES } from '../../../shared/artifact-io/constants.js';
import { readJsonFile } from '../../../shared/artifact-io/json.js';
import { buildIndexSignature } from '../../index-cache.js';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import {
  buildContextIndex,
  expandContext,
  serializeContextIndex,
  hydrateContextIndex
} from '../../context-expansion.js';
import { filterChunks } from '../../output.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';

const readContextCacheJson = (filePath, maxBytes = MAX_JSON_BYTES) => {
  if (!filePath) return null;
  try {
    return readJsonFile(filePath, { maxBytes });
  } catch (error) {
    observeStorageResource(error, { phase: 'context-index-cache-read' }).requireSettled();
    if (isAbortError(error)) throw error;
    return null;
  }
};

export function createModeExpander({
  contextExpansionEnabled,
  contextExpansionOptions,
  contextExpansionRespectFilters,
  filters,
  filtersActive,
  filterPredicates,
  explain,
  contextCacheDir = null,
  signal = null
}) {
  const contextExpansionStats = {
    enabled: contextExpansionEnabled,
    code: { added: 0, workUnitsUsed: 0, truncation: null },
    prose: { added: 0, workUnitsUsed: 0, truncation: null },
    'extracted-prose': { added: 0, workUnitsUsed: 0, truncation: null },
    records: { added: 0, workUnitsUsed: 0, truncation: null }
  };
  const contextIndexByIndex = new WeakMap();
  const allowedIdsByIndex = new WeakMap();

  const resolveContextCachePaths = async idx => {
    if (!idx?.indexDir || !contextCacheDir) return null;
    const cacheRoot = path.resolve(contextCacheDir);
    const relative = path.relative(path.resolve(idx.indexDir), cacheRoot);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return null;
    const signature = await buildIndexSignature(idx.indexDir);
    if (!signature) return null;
    const identity = createHash('sha256').update(JSON.stringify([path.resolve(idx.indexDir), signature])).digest('hex');
    const base = path.join(cacheRoot, 'context-index-v2', identity);
    return { signature, metaPath: `${base}.meta.json`, dataPath: `${base}.json` };
  };

  const loadContextIndexCache = async (idx) => {
    const paths = await resolveContextCachePaths(idx);
    if (!paths) return null;
    const { metaPath, dataPath, signature } = paths;
    const meta = readContextCacheJson(metaPath);
    if (!meta) return null;
    if (!meta?.signature || meta.version !== 2) return null;
    if (signature !== meta.signature) return null;
    const raw = readContextCacheJson(dataPath);
    if (!raw) return null;
    return hydrateContextIndex(raw);
  };
  const persistContextIndexCache = async (idx, contextIndex) => {
    if (!contextIndex) return;
    const paths = await resolveContextCachePaths(idx);
    if (!paths) return;
    const { signature, metaPath, dataPath } = paths;
    const payload = serializeContextIndex(contextIndex);
    if (!signature || !payload) return;
    try {
      throwIfAborted(signal);
      await atomicWriteJson(dataPath, payload, { spaces: 0 });
      throwIfAborted(signal);
      await atomicWriteJson(metaPath, { version: 2, signature }, { spaces: 0 });
    } catch (error) {
      observeStorageResource(error, { phase: 'context-index-cache-write' }).requireSettled();
      if (isAbortError(error)) throw error;
      throwIfAborted(signal);
    }
  };
  const getContextIndex = async (idx) => {
    if (!idx?.chunkMeta?.length) return null;
    const cached = idx.contextIndex;
    if (cached && cached.chunkMeta === idx.chunkMeta && cached.repoMap === idx.repoMap) {
      return cached;
    }
    const pending = contextIndexByIndex.get(idx);
    if (pending) return pending;
    const nextPromise = (async () => {
      let next = await loadContextIndexCache(idx);
      throwIfAborted(signal);
      if (next) {
        next.chunkMeta = idx.chunkMeta;
        next.repoMap = idx.repoMap;
        idx.contextIndex = next;
        return next;
      }
      next = buildContextIndex({ chunkMeta: idx.chunkMeta, repoMap: idx.repoMap });
      throwIfAborted(signal);
      idx.contextIndex = next;
      await persistContextIndexCache(idx, next);
      return next;
    })();
    contextIndexByIndex.set(idx, nextPromise);
    try {
      return await nextPromise;
    } finally {
      contextIndexByIndex.delete(idx);
    }
  };
  const getAllowedIds = (idx) => {
    if (!(contextExpansionRespectFilters && filtersActive)) return { ids: null,
      preparation: { state: 'not-requested', availableChunkRows: idx.chunkMeta.length, selectedRows: null, elapsedMs: 0 } };
    const cached = allowedIdsByIndex.get(idx);
    if (cached && cached.chunkMeta === idx.chunkMeta && cached.filterIndex === idx.filterIndex
      && cached.fileRelations === idx.fileRelations) return {
      ids: cached.ids, preparation: { ...cached.preparation, state: 'reused', elapsedMs: 0 }
    };
    const started = performance.now();
    const next = new Set(
      filterChunks(idx.chunkMeta, filters, idx.filterIndex, idx.fileRelations, {
        compiled: filterPredicates
      })
        .map((chunk) => chunk.id)
    );
    const prepared = { ids: next, preparation: { state: 'built', availableChunkRows: idx.chunkMeta.length,
      selectedRows: next.size, elapsedMs: Math.max(0, performance.now() - started) } };
    allowedIdsByIndex.set(idx, { ...prepared, chunkMeta: idx.chunkMeta, filterIndex: idx.filterIndex, fileRelations: idx.fileRelations });
    return prepared;
  };
  const expandModeHits = async (mode, idx, hits) => {
    throwIfAborted(signal);
    if (!contextExpansionEnabled || !hits.length || !idx?.chunkMeta?.length) {
      return { hits, contextHits: [], stats: { added: 0, workUnitsUsed: 0, truncation: null } };
    }
    const prepared = await getContextIndex(idx);
    throwIfAborted(signal);
    const allowed = getAllowedIds(idx);
    throwIfAborted(signal);
    const result = expandContext({
      hits,
      chunkMeta: idx.chunkMeta,
      fileRelations: idx.fileRelations,
      repoMap: idx.repoMap,
      graphRelations: idx.graphRelations || null,
      options: {
        ...contextExpansionOptions,
        explain
      },
      allowedIds: allowed.ids,
      contextIndex: prepared,
      signal
    });
    result.stats.preparation.filterSet = allowed.preparation;
    contextExpansionStats[mode] = result.stats;
    return {
      hits: hits.concat(result.contextHits),
      contextHits: result.contextHits,
      stats: result.stats
    };
  };

  return {
    contextExpansionStats,
    expandModeHits
  };
}
