import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import zlib from 'node:zlib';
import { compareStrings } from '../../../shared/sort.js';
import { createLruCache } from '../../../shared/cache.js';
import { sha1 } from '../../../shared/hash.js';
import { readJsonlRows } from '../../../shared/merge.js';
import {
  parseBinaryJsonRowBuffer,
  createVfsManifestOffsetReader,
  readVfsManifestRowsAtOffsets
} from '../../tooling/vfs.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';

const DEFAULT_ROW_CACHE_MAX = 50000;
const DEFAULT_MISS_CACHE_MAX = 10000;
const DEFAULT_PAGE_CACHE_MAX = 1024;

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
  const pageRowsCache = createLruCache({
    name: 'tree-sitter-scheduler-page-rows',
    maxEntries: DEFAULT_PAGE_CACHE_MAX
  });
  const readersByManifestPath = new Map();
  const segmentMetaByGrammarKey = new Map(); // grammarKey -> Promise<Map<number, object>|null>
  const pageIndexByGrammarKey = new Map(); // grammarKey -> Promise<Map<number, object>|null>

  const getReaderForManifest = (manifestPath, format = 'jsonl') => {
    const key = `${manifestPath}|${format}`;
    if (readersByManifestPath.has(key)) {
      return readersByManifestPath.get(key);
    }
    const reader = createVfsManifestOffsetReader({
      manifestPath,
      parseRowBuffer: format === 'binary-v1' ? parseBinaryJsonRowBuffer : undefined
    });
    readersByManifestPath.set(key, reader);
    return reader;
  };

  const close = async () => {
    const readers = Array.from(readersByManifestPath.values());
    readersByManifestPath.clear();
    segmentMetaByGrammarKey.clear();
    pageIndexByGrammarKey.clear();
    pageRowsCache.clear();
    await Promise.all(readers.map(async (reader) => {
      try {
        await reader.close();
      } catch {}
    }));
  };

  const loadSegmentMeta = async (grammarKey) => {
    if (!grammarKey) return null;
    if (segmentMetaByGrammarKey.has(grammarKey)) {
      return segmentMetaByGrammarKey.get(grammarKey);
    }
    const pending = (async () => {
      const metaPath = paths.resultsMetaPathForGrammarKey(grammarKey);
      if (!metaPath || !fs.existsSync(metaPath)) return null;
      const metaByRef = new Map();
      try {
        for await (const row of readJsonlRows(metaPath)) {
          const ref = Number(row?.segmentRef);
          if (!Number.isFinite(ref) || ref < 0) continue;
          metaByRef.set(ref, row);
        }
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
      return metaByRef;
    })();
    segmentMetaByGrammarKey.set(grammarKey, pending);
    return pending;
  };

  const hydrateRowWithSegmentMeta = (row, metaByRef) => {
    if (!row || typeof row !== 'object') return null;
    if (
      typeof row.containerPath === 'string'
      && typeof row.languageId === 'string'
      && typeof row.effectiveExt === 'string'
    ) {
      return row;
    }
    const ref = Number(row.segmentRef);
    if (!Number.isFinite(ref) || ref < 0 || !(metaByRef instanceof Map)) {
      return row;
    }
    const meta = metaByRef.get(ref);
    if (!meta || typeof meta !== 'object') return row;
    return {
      ...row,
      containerPath: typeof row.containerPath === 'string'
        ? row.containerPath
        : (typeof meta.containerPath === 'string' ? meta.containerPath : null),
      languageId: typeof row.languageId === 'string'
        ? row.languageId
        : (typeof meta.languageId === 'string' ? meta.languageId : null),
      effectiveExt: typeof row.effectiveExt === 'string'
        ? row.effectiveExt
        : (typeof meta.effectiveExt === 'string' ? meta.effectiveExt : null)
    };
  };

  const loadRow = async (virtualPath) => {
    const [row] = await loadRows([virtualPath]);
    return row || null;
  };

  const loadPageIndex = async (grammarKey) => {
    if (!grammarKey) return null;
    if (pageIndexByGrammarKey.has(grammarKey)) {
      return pageIndexByGrammarKey.get(grammarKey);
    }
    const pending = (async () => {
      const pageIndexPath = paths.resultsPageIndexPathForGrammarKey(grammarKey);
      if (!pageIndexPath || !fs.existsSync(pageIndexPath)) return null;
      const map = new Map();
      const parsePageIndexText = (text) => {
        let invalidRows = 0;
        const lines = String(text || '').split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let row = null;
          try {
            row = JSON.parse(trimmed);
          } catch {
            const start = trimmed.indexOf('{');
            const end = trimmed.lastIndexOf('}');
            if (start >= 0 && end > start) {
              try {
                row = JSON.parse(trimmed.slice(start, end + 1));
              } catch {
                invalidRows += 1;
                continue;
              }
            } else {
              invalidRows += 1;
              continue;
            }
          }
          const pageId = Number(row?.pageId);
          if (!Number.isFinite(pageId) || pageId < 0) continue;
          map.set(pageId, row);
        }
        if (!map.size && invalidRows > 0) {
          const err = new Error(`[tree-sitter:schedule] invalid page index rows: ${pageIndexPath}`);
          err.code = 'ERR_TREE_SITTER_PAGE_INDEX_PARSE';
          throw err;
        }
      };
      try {
        const text = await fsPromises.readFile(pageIndexPath, 'utf8');
        parsePageIndexText(text);
      } catch (err) {
        // Atomic swap windows can briefly leave no page-index file. Fall back to
        // per-row embedded page offsets instead of failing the whole build.
        if (err?.code === 'ENOENT' || err?.code === 'ERR_TREE_SITTER_PAGE_INDEX_PARSE') return null;
        throw err;
      }
      return map;
    })();
    pageIndexByGrammarKey.set(grammarKey, pending);
    return pending;
  };

  const decodePageRows = (pagePayload) => {
    if (!pagePayload || typeof pagePayload !== 'object') return null;
    const codec = typeof pagePayload.codec === 'string'
      ? pagePayload.codec.toLowerCase()
      : 'none';
    if (codec === 'gzip') {
      const data = typeof pagePayload.data === 'string' ? pagePayload.data : '';
      if (!data) return null;
      const decoded = zlib.gunzipSync(Buffer.from(data, 'base64')).toString('utf8');
      const rows = JSON.parse(decoded);
      return Array.isArray(rows) ? rows : null;
    }
    return Array.isArray(pagePayload.rows) ? pagePayload.rows : null;
  };

  const loadRows = async (virtualPaths) => {
    const keys = Array.isArray(virtualPaths) ? virtualPaths : [];
    if (!keys.length) return [];
    const rows = new Array(keys.length).fill(null);
    const groups = new Map(); // `${manifestPath}|${format}` -> { manifestPath, format, list }
    const pagedGroups = new Map(); // grammarKey -> { grammarKey, manifestPath, list }

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
      if (entry?.store === 'paged-json') {
        const manifestPath = paths.resultsPathForGrammarKey(grammarKey, 'binary-v1');
        if (!pagedGroups.has(grammarKey)) {
          pagedGroups.set(grammarKey, { grammarKey, manifestPath, list: [] });
        }
        pagedGroups.get(grammarKey).list.push({ index: i, virtualPath, entry });
        continue;
      }
      const format = entry?.format === 'binary-v1' ? 'binary-v1' : 'jsonl';
      const manifestPath = paths.resultsPathForGrammarKey(grammarKey, format);
      const groupKey = `${manifestPath}|${format}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { manifestPath, format, list: [] });
      }
      groups.get(groupKey).list.push({ index: i, virtualPath, entry });
    }

    for (const group of groups.values()) {
      const { manifestPath, format, list } = group;
      const reader = getReaderForManifest(manifestPath, format);
      const grammarKey = list[0]?.entry?.grammarKey || null;
      const segmentMeta = grammarKey ? await loadSegmentMeta(grammarKey) : null;
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
        const { index: rowIndex, virtualPath, entry } = list[i];
        const rawRow = loadedRows[i] || null;
        if (rawRow && typeof entry?.checksum === 'string' && entry.checksum) {
          const actualChecksum = sha1(JSON.stringify(rawRow)).slice(0, 16);
          if (actualChecksum !== entry.checksum) {
            throw new Error(
              `[tree-sitter:schedule] row checksum mismatch for ${virtualPath}: ` +
              `expected=${entry.checksum} actual=${actualChecksum}`
            );
          }
        }
        const row = hydrateRowWithSegmentMeta(rawRow, segmentMeta);
        rows[rowIndex] = row;
        if (row) {
          rowCache.set(virtualPath, row);
        } else {
          missCache.set(virtualPath, true);
        }
      }
    }

    for (const pagedGroup of pagedGroups.values()) {
      const { grammarKey, manifestPath, list } = pagedGroup;
      const segmentMeta = grammarKey ? await loadSegmentMeta(grammarKey) : null;
      const pageIndex = await loadPageIndex(grammarKey);
      const reader = getReaderForManifest(manifestPath, 'binary-v1');
      const byPage = new Map();
      const fallbackPageMetaByPage = new Map();
      for (const item of list) {
        const pageId = Number(item?.entry?.page);
        const rowIndex = Number(item?.entry?.row);
        if (!Number.isFinite(pageId) || pageId < 0 || !Number.isFinite(rowIndex) || rowIndex < 0) {
          continue;
        }
        if (!byPage.has(pageId)) byPage.set(pageId, []);
        byPage.get(pageId).push({ ...item, rowIndex });
        const pageOffset = Number(item?.entry?.pageOffset);
        const pageBytes = Number(item?.entry?.pageBytes);
        if (Number.isFinite(pageOffset) && pageOffset >= 0 && Number.isFinite(pageBytes) && pageBytes > 0) {
          if (!fallbackPageMetaByPage.has(pageId)) {
            fallbackPageMetaByPage.set(pageId, {
              offset: pageOffset,
              bytes: pageBytes,
              checksum: typeof item?.entry?.pageChecksum === 'string' ? item.entry.pageChecksum : null
            });
          }
        }
      }
      const pageIds = Array.from(byPage.keys()).sort((a, b) => a - b);
      const pageRequests = [];
      const requestedPages = [];
      for (const pageId of pageIds) {
        const pageMeta = pageIndex?.get?.(pageId) || fallbackPageMetaByPage.get(pageId) || null;
        if (!pageMeta) continue;
        pageRequests.push({
          offset: pageMeta.offset,
          bytes: pageMeta.bytes
        });
        requestedPages.push({ pageId, pageMeta });
      }
      const loadedPages = await readVfsManifestRowsAtOffsets({
        manifestPath,
        requests: pageRequests,
        reader
      });
      for (let i = 0; i < requestedPages.length; i += 1) {
        const { pageId, pageMeta } = requestedPages[i];
        const cacheKey = `${grammarKey}:${pageId}`;
        let pageRows = pageRowsCache.get(cacheKey);
        if (!pageRows) {
          const pagePayload = loadedPages[i] || null;
          pageRows = decodePageRows(pagePayload);
          if (!Array.isArray(pageRows)) continue;
          const checksum = typeof pageMeta?.checksum === 'string' ? pageMeta.checksum : null;
          if (checksum) {
            const actual = sha1(JSON.stringify(pageRows)).slice(0, 16);
            if (actual !== checksum) {
              throw new Error(
                `[tree-sitter:schedule] page checksum mismatch for ${grammarKey} page=${pageId}: ` +
                `expected=${checksum} actual=${actual}`
              );
            }
          }
          pageRowsCache.set(cacheKey, pageRows);
        }
        const members = byPage.get(pageId) || [];
        for (const member of members) {
          const rawRow = pageRows[member.rowIndex] || null;
          if (rawRow && typeof member?.entry?.checksum === 'string' && member.entry.checksum) {
            const actualChecksum = sha1(JSON.stringify(rawRow)).slice(0, 16);
            if (actualChecksum !== member.entry.checksum) {
              throw new Error(
                `[tree-sitter:schedule] row checksum mismatch for ${member.virtualPath}: ` +
                `expected=${member.entry.checksum} actual=${actualChecksum}`
              );
            }
          }
          const hydrated = hydrateRowWithSegmentMeta(rawRow, segmentMeta);
          rows[member.index] = hydrated;
          if (hydrated) {
            rowCache.set(member.virtualPath, hydrated);
          } else {
            missCache.set(member.virtualPath, true);
          }
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
