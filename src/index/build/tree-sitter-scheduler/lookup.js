import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import zlib from 'node:zlib';
import { compareStrings } from '../../../shared/sort.js';
import { createLruCache } from '../../../shared/cache.js';
import { sha1 } from '../../../shared/hash.js';
import { readJsonlRows } from '../../../shared/merge.js';
import { coercePositiveIntMinOne } from '../../../shared/number-coerce.js';
import {
  parseBinaryJsonRowBuffer,
  createVfsManifestOffsetReader,
  readVfsManifestRowsAtOffsets
} from '../../tooling/vfs.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';

const DEFAULT_ROW_CACHE_MAX = 4096;
const DEFAULT_MISS_CACHE_MAX = 10000;
const DEFAULT_PAGE_CACHE_MAX = 1024;
const DEFAULT_MAX_OPEN_READERS = process.platform === 'win32' ? 8 : 32;
const TRANSIENT_FD_ERROR_CODES = new Set(['EAGAIN', 'EMFILE', 'ENFILE']);
const TRANSIENT_FD_RETRY_ATTEMPTS = 24;
const TRANSIENT_FD_RETRY_BASE_DELAY_MS = 50;
const TRANSIENT_FD_RETRY_MAX_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create lookup service for scheduler virtual-path row/chunk retrieval.
 *
 * @param {{
 *  outDir:string,
 *  index?:Map<string,object>,
 *  log?:(line:string)=>void,
 *  maxCacheEntries?:number|null,
 *  maxMissCacheEntries?:number|null,
 *  maxOpenReaders?:number|null
 * }} input
 * @returns {object}
 */
export const createTreeSitterSchedulerLookup = ({
  outDir,
  index = new Map(),
  log = null,
  maxCacheEntries = null,
  maxMissCacheEntries = null,
  maxOpenReaders = null
}) => {
  const paths = resolveTreeSitterSchedulerPaths(outDir);
  const cacheMax = coercePositiveIntMinOne(maxCacheEntries) ?? DEFAULT_ROW_CACHE_MAX;
  const missCacheMax = coercePositiveIntMinOne(maxMissCacheEntries) ?? DEFAULT_MISS_CACHE_MAX;
  const maxReaderCount = coercePositiveIntMinOne(maxOpenReaders) ?? DEFAULT_MAX_OPEN_READERS;
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
  const stats = {
    readerEvictions: 0,
    transientFdRetries: 0
  };
  const pageRefCounts = new Map();
  const consumedVirtualPaths = new Set();
  const readersByManifestPath = new Map();
  let readerUseTick = 0;
  const segmentMetaByGrammarKey = new Map(); // grammarKey -> Promise<Map<number, object>|null>
  const pageIndexByGrammarKey = new Map(); // grammarKey -> Promise<Map<number, object>|null>

  const isTransientFdError = (err) => TRANSIENT_FD_ERROR_CODES.has(String(err?.code || ''));

  const withTransientFdRetry = async (fn, contextLabel = null) => {
    let lastError = null;
    for (let attempt = 0; attempt < TRANSIENT_FD_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (!isTransientFdError(err) || attempt >= TRANSIENT_FD_RETRY_ATTEMPTS - 1) {
          throw err;
        }
        stats.transientFdRetries += 1;
        if (typeof log === 'function' && attempt === 0 && contextLabel) {
          log(
            `[tree-sitter:schedule] transient fd pressure during ${contextLabel}; ` +
            `retrying (${String(err?.code || 'ERR')}).`
          );
        }
        const delayMs = Math.min(
          TRANSIENT_FD_RETRY_BASE_DELAY_MS * (attempt + 1),
          TRANSIENT_FD_RETRY_MAX_DELAY_MS
        );
        await sleep(delayMs);
      }
    }
    throw lastError || new Error('Transient fd retry failed.');
  };

  /**
   * Resolve shared page-cache key for a paged-json index entry.
   *
   * @param {object} entry
   * @returns {string|null}
   */
  const pageCacheKeyForEntry = (entry) => {
    if (!entry || entry.store !== 'paged-json') return null;
    const grammarKey = typeof entry.grammarKey === 'string' ? entry.grammarKey : null;
    const pageId = Number(entry.page);
    if (!grammarKey || !Number.isFinite(pageId) || pageId < 0) return null;
    return `${grammarKey}:${pageId}`;
  };

  for (const entry of index.values()) {
    const pageKey = pageCacheKeyForEntry(entry);
    if (!pageKey) continue;
    const current = pageRefCounts.get(pageKey) || 0;
    pageRefCounts.set(pageKey, current + 1);
  }

  /**
   * Get or create VFS manifest reader for one manifest+format tuple.
   *
   * @param {string} manifestPath
   * @param {'jsonl'|'binary-v1'} [format='jsonl']
   * @returns {object}
   */
  const evictOldestReader = async () => {
    if (readersByManifestPath.size < maxReaderCount) return;
    let oldest = null;
    for (const entry of readersByManifestPath.values()) {
      if (!oldest || entry.lastUsedTick < oldest.lastUsedTick) {
        oldest = entry;
      }
    }
    if (!oldest) return;
    readersByManifestPath.delete(oldest.key);
    stats.readerEvictions += 1;
    try {
      await oldest.reader.close();
    } catch {}
  };

  const getReaderForManifest = async (manifestPath, format = 'jsonl') => {
    const key = `${manifestPath}|${format}`;
    const existing = readersByManifestPath.get(key);
    if (existing) {
      existing.lastUsedTick = ++readerUseTick;
      return existing.reader;
    }
    await evictOldestReader();
    const secondCheck = readersByManifestPath.get(key);
    if (secondCheck) {
      secondCheck.lastUsedTick = ++readerUseTick;
      return secondCheck.reader;
    }
    const reader = createVfsManifestOffsetReader({
      manifestPath,
      parseRowBuffer: format === 'binary-v1' ? parseBinaryJsonRowBuffer : undefined
    });
    readersByManifestPath.set(key, {
      key,
      reader,
      lastUsedTick: ++readerUseTick
    });
    return reader;
  };

  /**
   * Close readers and clear lookup caches.
   *
   * @returns {Promise<void>}
   */
  const close = async () => {
    const readers = Array.from(readersByManifestPath.values(), (entry) => entry.reader);
    readersByManifestPath.clear();
    segmentMetaByGrammarKey.clear();
    pageIndexByGrammarKey.clear();
    pageRowsCache.clear();
    pageRefCounts.clear();
    consumedVirtualPaths.clear();
    await Promise.all(readers.map(async (reader) => {
      try {
        await reader.close();
      } catch {}
    }));
  };

  /**
   * Load per-grammar segment metadata indexed by `segmentRef`.
   *
   * @param {string} grammarKey
   * @returns {Promise<Map<number, object>|null>}
   */
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
        await withTransientFdRetry(async () => {
          for await (const row of readJsonlRows(metaPath)) {
            const ref = Number(row?.segmentRef);
            if (!Number.isFinite(ref) || ref < 0) continue;
            metaByRef.set(ref, row);
          }
        }, `scheduler meta load ${grammarKey}`);
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
      return metaByRef;
    })();
    segmentMetaByGrammarKey.set(grammarKey, pending);
    return pending;
  };

  /**
   * Hydrate row with segment metadata fields when missing from row payload.
   *
   * @param {object} row
   * @param {Map<number, object>|null} metaByRef
   * @returns {object|null}
   */
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

  /**
   * Load one row by virtual path.
   *
   * @param {string} virtualPath
   * @returns {Promise<object|null>}
   */
  const loadRow = async (virtualPath) => {
    const [row] = await loadRows([virtualPath]);
    return row || null;
  };

  /**
   * Load paged-json index map for one grammar key.
   *
   * @param {string} grammarKey
   * @returns {Promise<Map<number, object>|null>}
   */
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
            invalidRows += 1;
            continue;
          }
          const pageId = Number(row?.pageId);
          const offset = Number(row?.offset);
          const bytes = Number(row?.bytes);
          if (
            !Number.isFinite(pageId)
            || pageId < 0
            || !Number.isFinite(offset)
            || offset < 0
            || !Number.isFinite(bytes)
            || bytes <= 0
          ) {
            invalidRows += 1;
            continue;
          }
          map.set(pageId, row);
        }
        if (invalidRows > 0) {
          const err = new Error(`[tree-sitter:schedule] invalid page index rows: ${pageIndexPath}`);
          err.code = 'ERR_TREE_SITTER_PAGE_INDEX_PARSE';
          throw err;
        }
      };
      try {
        const text = await withTransientFdRetry(
          () => fsPromises.readFile(pageIndexPath, 'utf8'),
          `scheduler page index load ${grammarKey}`
        );
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

  /**
   * Decode paged row payload in plain or gzip-encoded JSON format.
   *
   * @param {object} pagePayload
   * @returns {object[]|null}
   */
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

  /**
   * Load rows for a batch of virtual paths using grouped manifest reads.
   *
   * @param {string[]} virtualPaths
   * @returns {Promise<Array<object|null>>}
   */
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
      const reader = await getReaderForManifest(manifestPath, format);
      const grammarKey = list[0]?.entry?.grammarKey || null;
      const segmentMeta = grammarKey ? await loadSegmentMeta(grammarKey) : null;
      const requests = list.map(({ entry }) => ({
        offset: entry.offset,
        bytes: entry.bytes
      }));
      const loadedRows = await withTransientFdRetry(
        () => readVfsManifestRowsAtOffsets({
          manifestPath,
          requests,
          reader
        }),
        `scheduler row load ${manifestPath}`
      );
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
      const reader = await getReaderForManifest(manifestPath, 'binary-v1');
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
      const loadedPages = await withTransientFdRetry(
        () => readVfsManifestRowsAtOffsets({
          manifestPath,
          requests: pageRequests,
          reader
        }),
        `scheduler page load ${manifestPath}`
      );
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

  /**
   * Release per-virtual-path caches and decrement page reference tracking.
   *
   * @param {string} virtualPath
   * @returns {void}
   */
  const releaseVirtualPathCaches = (virtualPath) => {
    if (!virtualPath) return;
    rowCache.delete(virtualPath);
    missCache.delete(virtualPath);
    if (consumedVirtualPaths.has(virtualPath)) return;
    consumedVirtualPaths.add(virtualPath);
    const entry = index.get(virtualPath);
    const pageKey = pageCacheKeyForEntry(entry);
    if (!pageKey) return;
    const remaining = pageRefCounts.get(pageKey);
    if (Number.isFinite(remaining)) {
      if (remaining <= 1) {
        pageRefCounts.delete(pageKey);
        pageRowsCache.delete(pageKey);
      } else {
        pageRefCounts.set(pageKey, remaining - 1);
      }
      return;
    }
    pageRowsCache.delete(pageKey);
  };

  /**
   * Load parsed chunks for one virtual path.
   *
   * @param {string} virtualPath
   * @param {{consume?:boolean}} [options]
   * @returns {Promise<object[]|null>}
   */
  const loadChunks = async (virtualPath, options = {}) => {
    const consume = options?.consume !== false;
    const row = await loadRow(virtualPath);
    const chunks = Array.isArray(row?.chunks) ? row.chunks : null;
    if (consume) {
      releaseVirtualPathCaches(virtualPath);
    }
    return chunks || null;
  };

  /**
   * Load parsed chunks for many virtual paths.
   *
   * @param {string[]} virtualPaths
   * @param {{consume?:boolean}} [options]
   * @returns {Promise<Array<object[]|null>>}
   */
  const loadChunksBatch = async (virtualPaths, options = {}) => {
    const keys = Array.isArray(virtualPaths) ? virtualPaths : [];
    if (!keys.length) return [];
    const consume = options?.consume !== false;
    const rows = await loadRows(keys);
    const chunks = rows.map((row) => (Array.isArray(row?.chunks) ? row.chunks : null));
    if (consume) {
      for (const virtualPath of keys) {
        releaseVirtualPathCaches(virtualPath);
      }
    }
    return chunks;
  };

  /**
   * List distinct grammar keys represented in lookup index.
   *
   * @returns {string[]}
   */
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
    loadChunksBatch,
    close,
    stats: () => ({
      ...stats,
      indexEntries: index.size,
      openReaders: readersByManifestPath.size,
      maxOpenReaders: maxReaderCount,
      cacheEntries: rowCache.size(),
      pageCacheEntries: pageRowsCache.size(),
      missEntries: missCache.size(),
      grammarKeys: grammarKeys().length
    }),
    log
  };
};
