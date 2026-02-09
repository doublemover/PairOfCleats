import { compareStrings } from '../../../shared/sort.js';
import { readVfsManifestRowAtOffset } from '../../tooling/vfs.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';

const DEFAULT_ROW_CACHE_MAX = 50000;

const coercePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const touchLru = (map, key, value) => {
  map.delete(key);
  map.set(key, value);
};

export const createTreeSitterSchedulerLookup = ({
  outDir,
  index = new Map(),
  log = null,
  maxCacheEntries = null
}) => {
  const paths = resolveTreeSitterSchedulerPaths(outDir);
  const cacheMax = coercePositiveInt(maxCacheEntries, DEFAULT_ROW_CACHE_MAX);
  const rowCache = new Map(); // virtualPath -> row
  const missCache = new Set();

  const ensureCacheLimit = () => {
    while (rowCache.size > cacheMax) {
      const oldest = rowCache.keys().next().value;
      if (oldest === undefined) break;
      rowCache.delete(oldest);
    }
  };

  const loadRow = async (virtualPath) => {
    if (!virtualPath) return null;
    if (rowCache.has(virtualPath)) {
      const row = rowCache.get(virtualPath);
      touchLru(rowCache, virtualPath, row);
      return row;
    }
    if (missCache.has(virtualPath)) return null;
    const entry = index.get(virtualPath) || null;
    if (!entry) {
      missCache.add(virtualPath);
      return null;
    }
    const grammarKey = entry.grammarKey || null;
    if (!grammarKey) {
      missCache.add(virtualPath);
      return null;
    }
    const manifestPath = paths.resultsPathForGrammarKey(grammarKey);
    const row = await readVfsManifestRowAtOffset({
      manifestPath,
      offset: entry.offset,
      bytes: entry.bytes
    });
    if (!row) {
      missCache.add(virtualPath);
      return null;
    }
    rowCache.set(virtualPath, row);
    ensureCacheLimit();
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
      cacheEntries: rowCache.size,
      missEntries: missCache.size,
      grammarKeys: grammarKeys().length
    }),
    log
  };
};
