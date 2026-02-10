import { compareStrings } from '../../../shared/sort.js';
import { createLruCache } from '../../../shared/cache.js';
import { readVfsManifestRowAtOffset } from '../../tooling/vfs.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';

const DEFAULT_ROW_CACHE_MAX = 50000;
const DEFAULT_MISS_CACHE_MAX = 10000;

const coercePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

export const createTreeSitterSchedulerLookup = ({
  outDir,
  index = new Map(),
  log = null,
  maxCacheEntries = null,
  maxMissCacheEntries = null
}) => {
  const paths = resolveTreeSitterSchedulerPaths(outDir);
  const cacheMax = coercePositiveInt(maxCacheEntries, DEFAULT_ROW_CACHE_MAX);
  const missCacheMax = coercePositiveInt(maxMissCacheEntries, DEFAULT_MISS_CACHE_MAX);
  const rowCache = createLruCache({
    name: 'tree-sitter-scheduler-row',
    maxEntries: cacheMax
  });
  const missCache = createLruCache({
    name: 'tree-sitter-scheduler-miss',
    maxEntries: missCacheMax
  });

  const loadRow = async (virtualPath) => {
    if (!virtualPath) return null;
    const cached = rowCache.get(virtualPath);
    if (cached) return cached;
    if (missCache.get(virtualPath)) return null;
    const entry = index.get(virtualPath) || null;
    if (!entry) {
      missCache.set(virtualPath, true);
      return null;
    }
    const grammarKey = entry.grammarKey || null;
    if (!grammarKey) {
      missCache.set(virtualPath, true);
      return null;
    }
    const manifestPath = paths.resultsPathForGrammarKey(grammarKey);
    const row = await readVfsManifestRowAtOffset({
      manifestPath,
      offset: entry.offset,
      bytes: entry.bytes
    });
    if (!row) {
      missCache.set(virtualPath, true);
      return null;
    }
    rowCache.set(virtualPath, row);
    return row;
  };

  const loadChunks = async (virtualPath) => {
    const row = await loadRow(virtualPath);
    const chunks = Array.isArray(row?.chunks) ? row.chunks : null;
    return chunks || null;
  };

  const grammarKeys = () => {
    const keys = new Set();
    for (const entry of index.values()) {
      if (entry?.grammarKey) keys.add(entry.grammarKey);
    }
    return Array.from(keys).sort(compareStrings);
  };

  return {
    outDir,
    paths,
    index,
    grammarKeys,
    loadRow,
    loadChunks,
    stats: () => ({
      indexEntries: index.size,
      cacheEntries: rowCache.size(),
      missEntries: missCache.size(),
      grammarKeys: grammarKeys().length
    }),
    log
  };
};
