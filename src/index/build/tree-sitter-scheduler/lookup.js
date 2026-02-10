import { compareStrings } from '../../../shared/sort.js';
import { createLruCache } from '../../../shared/cache.js';
import {
  createVfsManifestOffsetReader,
  readVfsManifestRowsAtOffsets
} from '../../tooling/vfs.js';
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
  const readersByManifestPath = new Map();

  const getReaderForManifest = (manifestPath) => {
    if (readersByManifestPath.has(manifestPath)) {
      return readersByManifestPath.get(manifestPath);
    }
    const reader = createVfsManifestOffsetReader({ manifestPath });
    readersByManifestPath.set(manifestPath, reader);
    return reader;
  };

  const close = async () => {
    const readers = Array.from(readersByManifestPath.values());
    readersByManifestPath.clear();
    await Promise.all(readers.map(async (reader) => {
      try {
        await reader.close();
      } catch {}
    }));
  };

  const loadRow = async (virtualPath) => {
    const [row] = await loadRows([virtualPath]);
    return row || null;
  };

  const loadRows = async (virtualPaths) => {
    const keys = Array.isArray(virtualPaths) ? virtualPaths : [];
    if (!keys.length) return [];
    const rows = new Array(keys.length).fill(null);
    const groups = new Map(); // manifestPath -> [{ index, entry }]

    for (let i = 0; i < keys.length; i += 1) {
      const virtualPath = keys[i];
      if (!virtualPath) continue;
      const cached = rowCache.get(virtualPath);
      if (cached) {
        rows[i] = cached;
        continue;
      }
      if (missCache.get(virtualPath)) {
        rows[i] = null;
        continue;
      }
      const entry = index.get(virtualPath) || null;
      if (!entry) {
        missCache.set(virtualPath, true);
        rows[i] = null;
        continue;
      }
      const grammarKey = entry.grammarKey || null;
      if (!grammarKey) {
        missCache.set(virtualPath, true);
        rows[i] = null;
        continue;
      }
      const manifestPath = paths.resultsPathForGrammarKey(grammarKey);
      if (!groups.has(manifestPath)) groups.set(manifestPath, []);
      groups.get(manifestPath).push({ index: i, virtualPath, entry });
    }

    for (const [manifestPath, list] of groups.entries()) {
      const reader = getReaderForManifest(manifestPath);
      const requests = list.map(({ entry }) => ({
        offset: entry.offset,
        bytes: entry.bytes
      }));
      const loadedRows = await readVfsManifestRowsAtOffsets({
        manifestPath,
        requests,
        reader
      });
      for (let i = 0; i < list.length; i += 1) {
        const { index: rowIndex, virtualPath } = list[i];
        const row = loadedRows[i] || null;
        rows[rowIndex] = row;
        if (row) {
          rowCache.set(virtualPath, row);
        } else {
          missCache.set(virtualPath, true);
        }
      }
    }

    return rows;
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
    loadRows,
    loadChunks,
    close,
    stats: () => ({
      indexEntries: index.size,
      cacheEntries: rowCache.size(),
      missEntries: missCache.size(),
      grammarKeys: grammarKeys().length
    }),
    log
  };
};
