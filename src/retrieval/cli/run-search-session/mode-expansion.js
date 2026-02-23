import path from 'node:path';
import { MAX_JSON_BYTES, readJsonFile } from '../../../shared/artifact-io.js';
import { buildIndexSignature } from '../../index-cache.js';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import {
  buildContextIndex,
  expandContext,
  serializeContextIndex,
  hydrateContextIndex
} from '../../context-expansion.js';
import { filterChunks } from '../../output.js';

const readContextCacheJson = (filePath, maxBytes = MAX_JSON_BYTES) => {
  if (!filePath) return null;
  try {
    return readJsonFile(filePath, { maxBytes });
  } catch {
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
  explain
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

  const loadContextIndexCache = async (idx) => {
    if (!idx?.indexDir) return null;
    const metaPath = path.join(idx.indexDir, 'context_index.meta.json');
    const dataPath = path.join(idx.indexDir, 'context_index.json');
    const meta = readContextCacheJson(metaPath);
    if (!meta) return null;
    if (!meta?.signature || meta.version !== 1) return null;
    const signature = await buildIndexSignature(idx.indexDir);
    if (signature !== meta.signature) return null;
    const raw = readContextCacheJson(dataPath);
    if (!raw) return null;
    return hydrateContextIndex(raw);
  };
  const persistContextIndexCache = async (idx, contextIndex) => {
    if (!idx?.indexDir || !contextIndex) return;
    const signature = await buildIndexSignature(idx.indexDir);
    const payload = serializeContextIndex(contextIndex);
    if (!signature || !payload) return;
    const metaPath = path.join(idx.indexDir, 'context_index.meta.json');
    const dataPath = path.join(idx.indexDir, 'context_index.json');
    try {
      await atomicWriteJson(dataPath, payload, { spaces: 0 });
      await atomicWriteJson(metaPath, { version: 1, signature }, { spaces: 0 });
    } catch {}
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
      if (next) {
        next.chunkMeta = idx.chunkMeta;
        next.repoMap = idx.repoMap;
        idx.contextIndex = next;
        return next;
      }
      next = buildContextIndex({ chunkMeta: idx.chunkMeta, repoMap: idx.repoMap });
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
    if (!(contextExpansionRespectFilters && filtersActive)) return null;
    const cached = allowedIdsByIndex.get(idx);
    if (cached) return cached;
    const next = new Set(
      filterChunks(idx.chunkMeta, filters, idx.filterIndex, idx.fileRelations, {
        compiled: filterPredicates
      })
        .map((chunk) => chunk.id)
    );
    allowedIdsByIndex.set(idx, next);
    return next;
  };
  const expandModeHits = async (mode, idx, hits) => {
    if (!contextExpansionEnabled || !hits.length || !idx?.chunkMeta?.length) {
      return { hits, contextHits: [], stats: { added: 0, workUnitsUsed: 0, truncation: null } };
    }
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
      allowedIds: getAllowedIds(idx),
      contextIndex: await getContextIndex(idx)
    });
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
