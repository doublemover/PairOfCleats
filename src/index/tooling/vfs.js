import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { checksumString } from '../../shared/hash.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { fromPosix, toPosix } from '../../shared/files.js';
import { buildChunkRef } from '../../shared/identity.js';
import { decodeBloomFilter } from '../../shared/bloom.js';
import { getCacheRoot } from '../../shared/cache-roots.js';
import { isTestingEnv } from '../../shared/env.js';
import { readJsonFile } from '../../shared/artifact-io.js';
import { writeJsonLinesFile, writeJsonObjectFile } from '../../shared/json-stream.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { computeSegmentUid } from '../identity/chunk-uid.js';
import { LANGUAGE_ID_EXT } from '../segments/config.js';

const VFS_PREFIX = '.poc-vfs/';
const VFS_HASH_PREFIX = `${VFS_PREFIX}by-hash/`;
export const VFS_MANIFEST_MAX_ROW_BYTES = 32 * 1024;
const VFS_DISK_CACHE = new Map();
const VFS_DOC_HASH_CACHE = new Map();
const VFS_DOC_HASH_CACHE_MAX = 50000;
const VFS_COLD_START_SCHEMA_VERSION = '1.0.0';
const VFS_COLD_START_DIR = 'vfs-cold-start';
const VFS_COLD_START_META = 'vfs_cold_start.meta.json';
const VFS_COLD_START_DATA = 'vfs_cold_start.jsonl';
const VFS_COLD_START_MAX_BYTES = 64 * 1024 * 1024;
const VFS_COLD_START_MAX_AGE_DAYS = 7;
const VFS_MANIFEST_HASH_MAX_BYTES = 64 * 1024 * 1024;

const encodeContainerPath = (value) => {
  const rawPath = value == null ? '' : String(value);
  const posixPath = toPosix(rawPath);
  return posixPath.replace(/%/g, '%25').replace(/#/g, '%23');
};

/**
 * Resolve the effective extension for a virtual document.
 * @param {{languageId?:string|null,containerExt?:string|null}} input
 * @returns {string}
 */
export const resolveEffectiveExt = ({ languageId, containerExt }) => {
  if (languageId && LANGUAGE_ID_EXT.has(languageId)) {
    return LANGUAGE_ID_EXT.get(languageId);
  }
  return containerExt || '';
};

/**
 * Build a deterministic VFS virtual path.
 * @param {{containerPath:string,segmentUid?:string|null,effectiveExt?:string|null}} input
 * @returns {string}
 */
export const buildVfsVirtualPath = ({ containerPath, segmentUid, effectiveExt }) => {
  const encoded = encodeContainerPath(containerPath);
  if (!segmentUid) return `${VFS_PREFIX}${encoded}`;
  return `${VFS_PREFIX}${encoded}#seg:${segmentUid}${effectiveExt || ''}`;
};

/**
 * Build a content-addressed VFS virtual path.
 * @param {{docHash:string,effectiveExt?:string|null}} input
 * @returns {string|null}
 */
export const buildVfsHashVirtualPath = ({ docHash, effectiveExt }) => {
  if (!docHash) return null;
  return `${VFS_HASH_PREFIX}${docHash}${effectiveExt || ''}`;
};

/**
 * Resolve the VFS virtual path based on routing settings.
 * @param {{containerPath:string,segmentUid?:string|null,effectiveExt?:string|null,docHash?:string|null,hashRouting?:boolean}} input
 * @returns {string}
 */
export const resolveVfsVirtualPath = ({
  containerPath,
  segmentUid,
  effectiveExt,
  docHash = null,
  hashRouting = false
}) => {
  if (hashRouting) {
    const hashPath = buildVfsHashVirtualPath({ docHash, effectiveExt });
    if (hashPath) return hashPath;
  }
  return buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt });
};

const resolveTextSource = (fileTextByPath, containerPath) => {
  if (!fileTextByPath) return null;
  if (typeof fileTextByPath.get === 'function') return fileTextByPath.get(containerPath) || null;
  if (typeof fileTextByPath === 'function') return fileTextByPath(containerPath);
  return null;
};

const buildDocHashCacheKey = ({
  fileHash,
  fileHashAlgo,
  languageId,
  effectiveExt,
  segmentStart,
  segmentEnd
}) => {
  if (!fileHash) return null;
  const algo = fileHashAlgo || 'sha1';
  const lang = languageId || 'unknown';
  const ext = effectiveExt || '';
  return `${algo}:${fileHash}::${lang}::${ext}::${segmentStart}-${segmentEnd}`;
};

const getCachedDocHash = (cacheKey) => {
  if (!cacheKey) return null;
  const cached = VFS_DOC_HASH_CACHE.get(cacheKey) || null;
  if (!cached) return null;
  VFS_DOC_HASH_CACHE.delete(cacheKey);
  VFS_DOC_HASH_CACHE.set(cacheKey, cached);
  return cached;
};

const setCachedDocHash = (cacheKey, docHash) => {
  if (!cacheKey) return;
  VFS_DOC_HASH_CACHE.set(cacheKey, docHash);
  if (VFS_DOC_HASH_CACHE.size > VFS_DOC_HASH_CACHE_MAX) {
    const oldestKey = VFS_DOC_HASH_CACHE.keys().next().value;
    if (oldestKey !== undefined) VFS_DOC_HASH_CACHE.delete(oldestKey);
  }
};

const computeDocHash = async (text, cacheKey = null) => {
  const cached = getCachedDocHash(cacheKey);
  if (cached) return cached;
  const hash = await checksumString(text || '');
  const docHash = hash?.value ? `xxh64:${hash.value}` : 'xxh64:';
  setCachedDocHash(cacheKey, docHash);
  return docHash;
};

const normalizeLanguageId = (value, fallback = null) => {
  if (!value) return fallback;
  const text = String(value).trim();
  return text ? text.toLowerCase() : fallback;
};

export const resolveEffectiveLanguageId = ({ chunk, segment, containerLanguageId }) => {
  const candidate = chunk?.lang
    || chunk?.metaV2?.lang
    || segment?.languageId
    || chunk?.containerLanguageId
    || containerLanguageId;
  return normalizeLanguageId(candidate, 'unknown');
};

const buildSegmentLookupKey = ({
  containerPath,
  segmentUid,
  segmentStart,
  segmentEnd,
  languageId,
  effectiveExt
}) => [
  containerPath || '',
  segmentUid || '',
  `${segmentStart}-${segmentEnd}`,
  languageId || '',
  effectiveExt || ''
].join('::');

const buildCoalesceGroupKey = ({
  containerPath,
  segmentStart,
  segmentEnd,
  languageId,
  effectiveExt
}) => [
  containerPath || '',
  `${segmentStart}-${segmentEnd}`,
  languageId || '',
  effectiveExt || ''
].join('::');

const buildSegmentDescriptor = ({
  chunk,
  containerPath,
  containerExt,
  containerLanguageId
}) => {
  const segment = chunk?.segment || null;
  if (!segment) return null;
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return null;
  const languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
  const effectiveExt = segment.ext || resolveEffectiveExt({ languageId, containerExt });
  return {
    containerPath,
    segmentUid: segment.segmentUid || null,
    segmentId: segment.segmentId || null,
    segmentType: segment.type || 'embedded',
    start: segment.start,
    end: segment.end,
    languageId,
    effectiveExt
  };
};

const buildCoalescedSegmentMap = (chunks) => {
  const segmentsByContainer = new Map();
  const dedupe = new Set();
  for (const chunk of chunks || []) {
    if (!chunk?.file) continue;
    const containerPath = toPosix(chunk.file);
    const containerExt = chunk.ext || null;
    const containerLanguageId = chunk.containerLanguageId || null;
    const descriptor = buildSegmentDescriptor({
      chunk,
      containerPath,
      containerExt,
      containerLanguageId
    });
    if (!descriptor) continue;
    const key = buildSegmentLookupKey({
      containerPath,
      segmentUid: descriptor.segmentUid,
      segmentStart: descriptor.start,
      segmentEnd: descriptor.end,
      languageId: descriptor.languageId,
      effectiveExt: descriptor.effectiveExt
    });
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    if (!segmentsByContainer.has(containerPath)) segmentsByContainer.set(containerPath, []);
    segmentsByContainer.get(containerPath).push(descriptor);
  }
  const groupMap = new Map();
  for (const [containerPath, segments] of segmentsByContainer) {
    if (!Array.isArray(segments) || !segments.length) continue;
    segments.sort((a, b) => (a.start - b.start) || (a.end - b.end));
    let current = null;
    const flush = () => {
      if (!current) return;
      for (const seg of current.segments) {
        const key = buildSegmentLookupKey({
          containerPath,
          segmentUid: seg.segmentUid,
          segmentStart: seg.start,
          segmentEnd: seg.end,
          languageId: seg.languageId,
          effectiveExt: seg.effectiveExt
        });
        groupMap.set(key, current);
      }
      current = null;
    };
    for (const seg of segments) {
      if (!current) {
        current = {
          containerPath,
          start: seg.start,
          end: seg.end,
          languageId: seg.languageId,
          effectiveExt: seg.effectiveExt,
          segmentType: seg.segmentType,
          segments: [seg],
          segmentUid: seg.segmentUid || null,
          segmentId: seg.segmentId || null,
          key: buildCoalesceGroupKey({
            containerPath,
            segmentStart: seg.start,
            segmentEnd: seg.end,
            languageId: seg.languageId,
            effectiveExt: seg.effectiveExt
          }),
          coalesced: false,
          _segmentUidPromise: null
        };
        continue;
      }
      const canMerge = seg.start === current.end
        && seg.languageId === current.languageId
        && seg.effectiveExt === current.effectiveExt
        && seg.segmentType === current.segmentType;
      if (!canMerge) {
        flush();
        current = {
          containerPath,
          start: seg.start,
          end: seg.end,
          languageId: seg.languageId,
          effectiveExt: seg.effectiveExt,
          segmentType: seg.segmentType,
          segments: [seg],
          segmentUid: seg.segmentUid || null,
          segmentId: seg.segmentId || null,
          key: buildCoalesceGroupKey({
            containerPath,
            segmentStart: seg.start,
            segmentEnd: seg.end,
            languageId: seg.languageId,
            effectiveExt: seg.effectiveExt
          }),
          coalesced: false,
          _segmentUidPromise: null
        };
        continue;
      }
      current.segments.push(seg);
      current.end = seg.end;
      current.coalesced = current.segments.length > 1;
      current.segmentUid = current.coalesced ? null : current.segmentUid;
      current.segmentId = current.coalesced ? null : current.segmentId;
      current.key = buildCoalesceGroupKey({
        containerPath,
        segmentStart: current.start,
        segmentEnd: current.end,
        languageId: current.languageId,
        effectiveExt: current.effectiveExt
      });
    }
    flush();
  }
  return groupMap;
};

const ensureCoalescedSegmentUid = async (group, fileText) => {
  if (!group) return null;
  if (group.segmentUid) return group.segmentUid;
  if (!group.coalesced) {
    group.segmentUid = group.segments?.[0]?.segmentUid || null;
    return group.segmentUid;
  }
  if (group._segmentUidPromise) return group._segmentUidPromise;
  group._segmentUidPromise = (async () => {
    const text = typeof fileText === 'string'
      ? fileText.slice(group.start, group.end)
      : '';
    const uid = await computeSegmentUid({
      segmentText: text,
      segmentType: 'coalesced',
      languageId: group.languageId
    });
    group.segmentUid = uid || group.segments?.[0]?.segmentUid || null;
    return group.segmentUid;
  })();
  return group._segmentUidPromise;
};

/**
 * Trim oversized VFS manifest rows deterministically.
 * @param {object} row
 * @param {{log?:Function,stats?:{trimmedRows?:number,droppedRows?:number}}} options
 * @returns {object|null}
 */
export const trimVfsManifestRow = (row, { log, stats } = {}) => {
  if (!row || typeof row !== 'object') return null;
  const measure = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  const baseBytes = measure(row);
  if (baseBytes <= VFS_MANIFEST_MAX_ROW_BYTES) return row;
  let trimmed = { ...row };
  let changed = false;
  if (trimmed.extensions) delete trimmed.extensions;
  if (!Object.is(trimmed.extensions, row.extensions)) changed = true;
  let trimmedBytes = measure(trimmed);
  if (trimmedBytes <= VFS_MANIFEST_MAX_ROW_BYTES) {
    if (stats) stats.trimmedRows = (stats.trimmedRows || 0) + 1;
    return trimmed;
  }
  if (trimmed.segmentId) {
    trimmed.segmentId = null;
    changed = true;
  }
  trimmedBytes = measure(trimmed);
  if (trimmedBytes <= VFS_MANIFEST_MAX_ROW_BYTES) {
    if (stats) stats.trimmedRows = (stats.trimmedRows || 0) + 1;
    return trimmed;
  }
  if (log) {
    const label = trimmed.containerPath || trimmed.virtualPath || 'unknown';
    log(`[vfs] vfs_manifest row exceeded ${VFS_MANIFEST_MAX_ROW_BYTES} bytes for ${label}`);
  }
  if (stats) {
    if (changed) stats.trimmedRows = (stats.trimmedRows || 0) + 1;
    stats.droppedRows = (stats.droppedRows || 0) + 1;
  }
  return null;
};

const sortTargets = (a, b) => {
  const keyA = `${a.virtualPath}:${a.chunkRef?.chunkUid || ''}`;
  const keyB = `${b.virtualPath}:${b.chunkRef?.chunkUid || ''}`;
  return keyA.localeCompare(keyB);
};

const sortDocuments = (a, b) => {
  return String(a.virtualPath || '').localeCompare(String(b.virtualPath || ''));
};

/**
 * Deterministic ordering for VFS manifest rows.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export const compareVfsManifestRows = (a, b) => {
  if (a.containerPath !== b.containerPath) return String(a.containerPath).localeCompare(String(b.containerPath));
  if (a.segmentStart !== b.segmentStart) return a.segmentStart - b.segmentStart;
  if (a.segmentEnd !== b.segmentEnd) return a.segmentEnd - b.segmentEnd;
  if (a.languageId !== b.languageId) return String(a.languageId).localeCompare(String(b.languageId));
  if (a.effectiveExt !== b.effectiveExt) return String(a.effectiveExt).localeCompare(String(b.effectiveExt));
  const segA = a.segmentUid || '';
  const segB = b.segmentUid || '';
  if (segA !== segB) return segA.localeCompare(segB);
  return String(a.virtualPath).localeCompare(String(b.virtualPath));
};

/**
 * Build tooling virtual documents + targets from chunks.
 * @param {object} input
 * @param {boolean} [input.coalesceSegments]
 * @returns {Promise<{documents:Array,targets:Array}>}
 */
export const buildToolingVirtualDocuments = async ({
  chunks,
  fileTextByPath,
  strict = true,
  maxVirtualFileBytes = null,
  hashRouting = false,
  coalesceSegments = false,
  log = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) {
    return { documents: [], targets: [] };
  }
  const docMap = new Map();
  const skippedSegments = new Set();
  const targets = [];
  const coalescedMap = coalesceSegments ? buildCoalescedSegmentMap(chunks) : null;

  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const containerPath = toPosix(chunk.file);
    const fileText = resolveTextSource(fileTextByPath, containerPath);
    if (typeof fileText !== 'string') {
      if (strict) throw new Error(`Missing file text for ${containerPath}`);
      if (log) log(`[tooling] missing file text for ${containerPath}; skipping.`);
      continue;
    }
    const containerExt = chunk.ext || null;
    const containerLanguageId = chunk.containerLanguageId || null;
    const segment = chunk.segment || null;
    const baseSegmentStart = segment ? segment.start : 0;
    const baseSegmentEnd = segment ? segment.end : fileText.length;
    let languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
    let effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
    let segmentStart = baseSegmentStart;
    let segmentEnd = baseSegmentEnd;
    let segmentUid = segment?.segmentUid || null;
    let segmentId = segment?.segmentId || null;
    let segmentKeyBase = `${containerPath}::${segmentUid || ''}`;
    if (segment && coalescedMap) {
      const lookupKey = buildSegmentLookupKey({
        containerPath,
        segmentUid,
        segmentStart: baseSegmentStart,
        segmentEnd: baseSegmentEnd,
        languageId,
        effectiveExt
      });
      const group = coalescedMap.get(lookupKey) || null;
      if (group) {
        segmentStart = group.start;
        segmentEnd = group.end;
        languageId = group.languageId;
        effectiveExt = group.effectiveExt;
        segmentUid = await ensureCoalescedSegmentUid(group, fileText);
        segmentId = group.coalesced ? null : segmentId;
        segmentKeyBase = group.key || segmentKeyBase;
      }
    }
    if (skippedSegments.has(segmentKeyBase)) continue;
    if (segment && !segmentUid && strict) {
      throw new Error(`Missing segmentUid for ${containerPath}`);
    }
    const text = segment ? fileText.slice(segmentStart, segmentEnd) : fileText;
    const fileHash = chunk.fileHash || chunk.metaV2?.fileHash || null;
    const fileHashAlgo = chunk.fileHashAlgo || chunk.metaV2?.fileHashAlgo || null;
    if (Number.isFinite(maxVirtualFileBytes) && maxVirtualFileBytes > 0) {
      const textBytes = Buffer.byteLength(text, 'utf8');
      if (textBytes > maxVirtualFileBytes) {
        const message = `[vfs] virtual document exceeds maxVirtualFileBytes (${textBytes} > ${maxVirtualFileBytes}) for ${containerPath}`;
        if (strict) throw new Error(message);
        if (log) log(message);
        skippedSegments.add(segmentKeyBase);
        continue;
      }
    }
    const docHashCacheKey = buildDocHashCacheKey({
      fileHash,
      fileHashAlgo,
      languageId,
      effectiveExt,
      segmentStart,
      segmentEnd
    });
    const docHash = await computeDocHash(text, docHashCacheKey);
    const virtualPath = resolveVfsVirtualPath({
      containerPath,
      segmentUid,
      effectiveExt,
      docHash,
      hashRouting
    });
    const legacyVirtualPath = hashRouting
      ? buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt })
      : null;
    const segmentKey = hashRouting ? virtualPath : `${containerPath}::${segmentUid || ''}`;
    if (!docMap.has(segmentKey)) {
      docMap.set(segmentKey, {
        virtualPath,
        legacyVirtualPath: legacyVirtualPath && legacyVirtualPath !== virtualPath ? legacyVirtualPath : null,
        containerPath,
        containerExt,
        containerLanguageId,
        languageId,
        effectiveExt,
        segmentUid,
        segmentId,
        segmentRange: { start: segmentStart, end: segmentEnd },
        text,
        docHash,
        lineIndex: buildLineIndex(text)
      });
    }
    const doc = docMap.get(segmentKey);
    if (!doc) continue;
    const resolveVirtualRange = () => {
      const start = Number.isFinite(chunk.start) ? chunk.start : null;
      const end = Number.isFinite(chunk.end) ? chunk.end : null;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      if (!segment) return { start, end };
      const relStart = start - segmentStart;
      const relEnd = end - segmentStart;
      const relInBounds = relStart >= 0 && relEnd >= relStart && relEnd <= doc.text.length;
      if (relInBounds) return { start: relStart, end: relEnd };
      const directInBounds = start >= 0 && end >= start && end <= doc.text.length;
      if (directInBounds) {
        if (log) {
          log(`[tooling] virtualRange fallback for ${containerPath} (${start}-${end})`);
        }
        return { start, end };
      }
      return null;
    };
    const virtualRange = resolveVirtualRange();
    if (!virtualRange) {
      const message = `Invalid virtualRange for ${containerPath} (${chunk.start}-${chunk.end})`;
      if (log) log(`[tooling] ${message}; skipping target.`);
      continue;
    }
    const chunkRef = buildChunkRef(chunk);
    if (!chunkRef?.chunkUid && strict) {
      throw new Error(`Missing chunkUid for ${containerPath}`);
    }
    targets.push({
      chunkRef,
      chunk: chunkRef,
      virtualPath: doc.virtualPath,
      virtualRange,
      languageId: doc.languageId,
      ext: doc.effectiveExt,
      symbolHint: chunk.name || chunk.kind ? { name: chunk.name, kind: chunk.kind } : null
    });
  }

  const documents = Array.from(docMap.values());
  documents.sort(sortDocuments);
  targets.sort(sortTargets);
  return { documents, targets };
};

export const buildVfsManifestRowsForFile = async ({
  chunks,
  fileText,
  containerPath,
  containerExt = null,
  containerLanguageId = null,
  lineIndex = null,
  fileHash = null,
  fileHashAlgo = null,
  strict = true,
  log = null,
  concurrency = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  if (typeof fileText !== 'string') {
    if (strict) throw new Error(`Missing file text for ${containerPath}`);
    return [];
  }
  const resolvedLineIndex = lineIndex || buildLineIndex(fileText);
  const safeContainerPath = toPosix(containerPath);
  const seen = new Set();
  const groups = [];
  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const segment = chunk.segment || null;
    const segmentUid = segment?.segmentUid || null;
    const key = `${segmentUid || ''}`;
    if (seen.has(key)) continue;
    const segmentStart = segment ? segment.start : 0;
    const segmentEnd = segment ? segment.end : fileText.length;
    const languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
    const effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
    const entry = {
      key,
      segment,
      segmentUid,
      segmentStart,
      segmentEnd,
      languageId,
      effectiveExt
    };
    seen.add(key);
    groups.push(entry);
  }
  const buildRow = async (entry) => {
    const segmentText = entry.segment
      ? fileText.slice(entry.segmentStart, entry.segmentEnd)
      : fileText;
    const docHashCacheKey = buildDocHashCacheKey({
      fileHash,
      fileHashAlgo,
      languageId: entry.languageId,
      effectiveExt: entry.effectiveExt,
      segmentStart: entry.segmentStart,
      segmentEnd: entry.segmentEnd
    });
    const docHash = await computeDocHash(segmentText, docHashCacheKey);
    const virtualPath = buildVfsVirtualPath({
      containerPath: safeContainerPath,
      segmentUid: entry.segmentUid,
      effectiveExt: entry.effectiveExt
    });
    const lineStart = offsetToLine(resolvedLineIndex, entry.segmentStart);
    const endOffset = entry.segmentEnd > entry.segmentStart ? entry.segmentEnd - 1 : entry.segmentStart;
    const lineEnd = offsetToLine(resolvedLineIndex, endOffset);
    return {
      schemaVersion: '1.0.0',
      virtualPath,
      docHash,
      containerPath: safeContainerPath,
      containerExt: containerExt || null,
      containerLanguageId: containerLanguageId || null,
      languageId: entry.languageId,
      effectiveExt: entry.effectiveExt,
      segmentUid: entry.segmentUid,
      segmentId: entry.segment?.segmentId || null,
      segmentStart: entry.segmentStart,
      segmentEnd: entry.segmentEnd,
      lineStart,
      lineEnd
    };
  };
  const resolvedConcurrency = Number.isFinite(Number(concurrency))
    ? Math.max(1, Math.floor(Number(concurrency)))
    : 1;
  let rows = [];
  if (resolvedConcurrency > 1 && groups.length > 1) {
    rows = await runWithConcurrency(groups, resolvedConcurrency, buildRow);
  } else {
    for (const entry of groups) {
      rows.push(await buildRow(entry));
    }
  }
  rows = rows.filter(Boolean);
  rows.sort(compareVfsManifestRows);
  const filtered = [];
  for (const row of rows) {
    const trimmed = trimVfsManifestRow(row, { log });
    if (trimmed) filtered.push(trimmed);
  }
  return filtered;
};

/**
 * Ensure a VFS-backed document exists on disk; avoid rewrites when the doc hash matches.
 * @param {{baseDir:string,virtualPath:string,text?:string,docHash?:string|null}} input
 * @returns {Promise<{path:string,cacheHit:boolean}>}
 */
export const ensureVfsDiskDocument = async ({
  baseDir,
  virtualPath,
  text = '',
  docHash = null,
  coldStartCache = null
}) => {
  const cacheKey = `${baseDir}::${virtualPath}`;
  const cachedPath = coldStartCache?.get
    ? coldStartCache.get({ virtualPath, docHash })
    : null;
  if (cachedPath) {
    VFS_DISK_CACHE.set(cacheKey, { path: cachedPath, docHash });
    if (coldStartCache?.set) {
      const sizeBytes = Buffer.byteLength(text || '', 'utf8');
      coldStartCache.set({
        virtualPath,
        docHash,
        diskPath: cachedPath,
        sizeBytes
      });
    }
    return { path: cachedPath, cacheHit: true, source: 'cold-start' };
  }
  const absPath = resolveVfsDiskPath({ baseDir, virtualPath });
  const cached = VFS_DISK_CACHE.get(cacheKey);
  if (cached && cached.docHash === docHash) {
    try {
      await fsPromises.access(absPath);
      if (coldStartCache?.set) {
        const sizeBytes = Buffer.byteLength(text || '', 'utf8');
        coldStartCache.set({
          virtualPath,
          docHash,
          diskPath: absPath,
          sizeBytes
        });
      }
      return { path: absPath, cacheHit: true };
    } catch {}
  }
  await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
  await fsPromises.writeFile(absPath, text || '', 'utf8');
  VFS_DISK_CACHE.set(cacheKey, { path: absPath, docHash });
  if (coldStartCache?.set) {
    const sizeBytes = Buffer.byteLength(text || '', 'utf8');
    coldStartCache.set({
      virtualPath,
      docHash,
      diskPath: absPath,
      sizeBytes
    });
  }
  return { path: absPath, cacheHit: false };
};

/**
 * Resolve a safe disk path for a virtual path under a base directory.
 * @param {{baseDir:string,virtualPath:string}} input
 * @returns {string}
 */
export const resolveVfsDiskPath = ({ baseDir, virtualPath }) => {
  const encodeUnsafeChar = (ch) => {
    const hex = ch.codePointAt(0).toString(16).toUpperCase().padStart(2, '0');
    return `%${hex}`;
  };
  const parts = String(virtualPath || '').split('/');
  const safeParts = parts.map((part) => {
    if (part === '.' || part === '..') {
      return part.split('').map((ch) => encodeUnsafeChar(ch)).join('');
    }
    return part.replace(/[:*?"<>|]/g, (ch) => encodeUnsafeChar(ch));
  });
  const relative = safeParts.join(path.sep);
  return path.join(baseDir, relative);
};

const readJsonlRows = async function* (filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let lineNumber = 0;
  let buffer = '';
  try {
    for await (const chunk of stream) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        lineNumber += 1;
        const trimmed = line.trim();
        if (!trimmed) {
          newlineIndex = buffer.indexOf('\n');
          continue;
        }
        try {
          const row = JSON.parse(trimmed);
          yield row;
        } catch (err) {
          const message = err?.message || 'JSON parse error';
          throw new Error(`Invalid JSONL at ${filePath}:${lineNumber}: ${message}`);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const trimmed = buffer.trim();
    if (trimmed) {
      lineNumber += 1;
      try {
        const row = JSON.parse(trimmed);
        yield row;
      } catch (err) {
        const message = err?.message || 'JSON parse error';
        throw new Error(`Invalid JSONL at ${filePath}:${lineNumber}: ${message}`);
      }
    }
  } finally {
    if (!stream.destroyed) stream.destroy();
  }
};

/**
 * Load a VFS manifest bloom filter from disk.
 * @param {{bloomPath:string}} input
 * @returns {Promise<object|null>}
 */
export const loadVfsManifestBloomFilter = async ({ bloomPath }) => {
  if (!bloomPath || !fs.existsSync(bloomPath)) return null;
  const raw = readJsonFile(bloomPath);
  return decodeBloomFilter(raw);
};

const scanVfsManifestRowByPath = async ({ manifestPath, virtualPath }) => {
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  for await (const row of readJsonlRows(manifestPath)) {
    if (row?.virtualPath === virtualPath) return row;
  }
  return null;
};

const resolveVfsManifestSource = (indexDir) => {
  if (!indexDir) return null;
  const candidates = [
    path.join(indexDir, 'vfs_manifest.jsonl'),
    path.join(indexDir, 'vfs_manifest.jsonl.gz'),
    path.join(indexDir, 'vfs_manifest.jsonl.zst')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { type: 'single', path: candidate };
    }
  }
  const metaPath = path.join(indexDir, 'vfs_manifest.meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta = null;
  try {
    meta = readJsonFile(metaPath);
  } catch {
    return null;
  }
  const parts = Array.isArray(meta?.parts) ? meta.parts : [];
  if (!parts.length) return null;
  const partNames = parts
    .map((part) => part?.path)
    .filter((value) => typeof value === 'string' && value.trim());
  if (!partNames.length) return null;
  const partPaths = partNames.map((partName) => path.join(indexDir, fromPosix(partName)));
  return { type: 'sharded', partNames, partPaths };
};

const hashManifestFile = async (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  let stat = null;
  try {
    stat = await fsPromises.stat(filePath);
  } catch {
    return null;
  }
  if (stat.size > VFS_MANIFEST_HASH_MAX_BYTES) return null;
  const buffer = await fsPromises.readFile(filePath);
  const hash = await checksumString(buffer);
  return hash?.value ? `xxh64:${hash.value}` : null;
};

/**
 * Compute a deterministic hash for the VFS manifest contents.
 * @param {{indexDir:string}} input
 * @returns {Promise<string|null>}
 */
export const computeVfsManifestHash = async ({ indexDir }) => {
  const source = resolveVfsManifestSource(indexDir);
  if (!source) return null;
  if (source.type === 'single') {
    return hashManifestFile(source.path);
  }
  if (source.type === 'sharded') {
    const parts = [];
    for (let i = 0; i < source.partPaths.length; i += 1) {
      const partPath = source.partPaths[i];
      const hashValue = await hashManifestFile(partPath);
      if (!hashValue) return null;
      const name = source.partNames[i] || path.basename(partPath);
      parts.push(`${name}:${hashValue.replace(/^xxh64:/, '')}`);
    }
    const combined = await checksumString(parts.join('|'));
    return combined?.value ? `xxh64:${combined.value}` : null;
  }
  return null;
};

const resolveColdStartConfig = (value) => {
  if (value === false || value?.enabled === false) {
    return { enabled: false };
  }
  const enabled = typeof value?.enabled === 'boolean' ? value.enabled : true;
  if (!enabled) return { enabled: false };
  if (isTestingEnv() && value?.enabled !== true) {
    return { enabled: false };
  }
  const maxBytes = Number.isFinite(Number(value?.maxBytes))
    ? Math.max(0, Math.floor(Number(value.maxBytes)))
    : VFS_COLD_START_MAX_BYTES;
  const maxAgeDays = Number.isFinite(Number(value?.maxAgeDays))
    ? Math.max(0, Number(value.maxAgeDays))
    : VFS_COLD_START_MAX_AGE_DAYS;
  const cacheRoot = typeof value?.cacheRoot === 'string' && value.cacheRoot.trim()
    ? path.resolve(value.cacheRoot)
    : getCacheRoot();
  return {
    enabled: true,
    maxBytes,
    maxAgeDays,
    cacheRoot
  };
};

const resolveVfsColdStartPaths = (cacheRoot) => {
  const baseDir = path.join(cacheRoot, VFS_COLD_START_DIR);
  return {
    baseDir,
    metaPath: path.join(baseDir, VFS_COLD_START_META),
    dataPath: path.join(baseDir, VFS_COLD_START_DATA)
  };
};

const normalizeColdStartEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const virtualPath = typeof entry.virtualPath === 'string' ? entry.virtualPath.trim() : '';
  const docHash = typeof entry.docHash === 'string' ? entry.docHash.trim() : '';
  const diskPath = typeof entry.diskPath === 'string' ? entry.diskPath.trim() : '';
  if (!virtualPath || !docHash || !diskPath) return null;
  const sizeBytes = Number.isFinite(Number(entry.sizeBytes))
    ? Math.max(0, Math.floor(Number(entry.sizeBytes)))
    : 0;
  const updatedAt = typeof entry.updatedAt === 'string' && entry.updatedAt.trim()
    ? entry.updatedAt
    : new Date().toISOString();
  return {
    schemaVersion: VFS_COLD_START_SCHEMA_VERSION,
    virtualPath,
    docHash,
    diskPath,
    sizeBytes,
    updatedAt
  };
};

const compactColdStartEntries = (entries, { maxBytes, maxAgeMs }) => {
  const cutoff = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? Date.now() - maxAgeMs : null;
  const filtered = entries.filter((entry) => {
    if (!entry) return false;
    if (cutoff == null) return true;
    const ts = Date.parse(entry.updatedAt || '');
    if (!Number.isFinite(ts)) return true;
    return ts >= cutoff;
  });
  filtered.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || '') || 0;
    const bTime = Date.parse(b.updatedAt || '') || 0;
    return bTime - aTime;
  });
  const kept = [];
  let totalBytes = 0;
  for (const entry of filtered) {
    const nextBytes = entry.sizeBytes || 0;
    if (Number.isFinite(maxBytes) && maxBytes > 0 && (totalBytes + nextBytes) > maxBytes) {
      continue;
    }
    totalBytes += nextBytes;
    kept.push(entry);
  }
  return { entries: kept, totalBytes };
};

/**
 * Create (or load) a VFS cold-start cache for disk-backed virtual documents.
 * @param {{cacheRoot?:string|null,indexSignature?:string|null,manifestHash?:string|null,config?:object|null}} input
 * @returns {Promise<{get:(input:{virtualPath:string,docHash:string})=>string|null,set:(input:{virtualPath:string,docHash:string,diskPath:string,sizeBytes:number})=>void,flush:()=>Promise<void>,size:()=>number}|null>}
 */
export const createVfsColdStartCache = async ({
  cacheRoot = null,
  indexSignature = null,
  manifestHash = null,
  config = null
} = {}) => {
  const resolved = resolveColdStartConfig(config);
  if (!resolved.enabled) return null;
  const resolvedCacheRoot = cacheRoot ? path.resolve(cacheRoot) : resolved.cacheRoot;
  if (!resolvedCacheRoot || !indexSignature || !manifestHash) return null;

  const { baseDir, metaPath, dataPath } = resolveVfsColdStartPaths(resolvedCacheRoot);
  let entries = [];
  if (fs.existsSync(metaPath) && fs.existsSync(dataPath)) {
    const meta = readJsonFile(metaPath);
    if (meta?.indexSignature === indexSignature && meta?.manifestHash === manifestHash) {
      for await (const row of readJsonlRows(dataPath)) {
        const normalized = normalizeColdStartEntry(row);
        if (normalized) entries.push(normalized);
      }
    }
  }

  const maxAgeMs = resolved.maxAgeDays > 0 ? resolved.maxAgeDays * 86400000 : null;
  const compacted = compactColdStartEntries(entries, {
    maxBytes: resolved.maxBytes,
    maxAgeMs
  });
  const map = new Map(compacted.entries.map((entry) => [entry.virtualPath, entry]));
  let dirty = false;

  const get = ({ virtualPath, docHash }) => {
    if (!virtualPath || !docHash) return null;
    const entry = map.get(virtualPath);
    if (!entry || entry.docHash !== docHash) return null;
    if (!path.isAbsolute(entry.diskPath)) return null;
    if (!fs.existsSync(entry.diskPath)) return null;
    return entry.diskPath;
  };

  const set = ({ virtualPath, docHash, diskPath, sizeBytes }) => {
    if (!virtualPath || !docHash || !diskPath) return;
    if (!path.isAbsolute(diskPath)) return;
    const normalized = normalizeColdStartEntry({
      virtualPath,
      docHash,
      diskPath,
      sizeBytes,
      updatedAt: new Date().toISOString()
    });
    if (!normalized) return;
    map.set(virtualPath, normalized);
    dirty = true;
  };

  const flush = async () => {
    if (!dirty) return;
    const payload = compactColdStartEntries(Array.from(map.values()), {
      maxBytes: resolved.maxBytes,
      maxAgeMs
    });
    await fsPromises.mkdir(baseDir, { recursive: true });
    await writeJsonLinesFile(dataPath, payload.entries, { atomic: true, compression: null });
    await writeJsonObjectFile(metaPath, {
      fields: {
        schemaVersion: VFS_COLD_START_SCHEMA_VERSION,
        indexSignature,
        manifestHash,
        createdAt: new Date().toISOString(),
        entries: payload.entries.length,
        bytes: payload.totalBytes
      },
      atomic: true
    });
    dirty = false;
  };

  return {
    get,
    set,
    flush,
    size: () => map.size
  };
};

/**
 * Load a VFS manifest index (.vfsidx) into a map.
 * @param {{indexPath:string}} input
 * @returns {Promise<Map<string,{virtualPath:string,offset:number,bytes:number}>>}
 */
export const loadVfsManifestIndex = async ({ indexPath }) => {
  const map = new Map();
  const stream = fs.createReadStream(indexPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch (err) {
        const message = err?.message || 'JSON parse error';
        throw new Error(`Invalid vfs_manifest index JSON at ${indexPath}:${lineNumber}: ${message}`);
      }
      if (!entry?.virtualPath) continue;
      map.set(entry.virtualPath, entry);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return map;
};

/**
 * Read a single JSONL row by byte offset and length.
 * @param {{manifestPath:string,offset:number,bytes:number}} input
 * @returns {Promise<object|null>}
 */
export const readVfsManifestRowAtOffset = async ({ manifestPath, offset, bytes }) => {
  if (!Number.isFinite(offset) || !Number.isFinite(bytes) || bytes <= 0) return null;
  const handle = await fsPromises.open(manifestPath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const result = await handle.read(buffer, 0, bytes, offset);
    if (!result?.bytesRead) return null;
    const line = buffer.slice(0, result.bytesRead).toString('utf8').trim();
    if (!line) return null;
    return JSON.parse(line);
  } finally {
    await handle.close();
  }
};

/**
 * Load a VFS manifest row by virtualPath using a vfsidx file.
 * @param {{manifestPath:string,indexPath?:string,index?:Map<string,object>,virtualPath:string,bloomPath?:string,bloom?:object,allowScan?:boolean}} input
 * @returns {Promise<object|null>}
 */
export const loadVfsManifestRowByPath = async ({
  manifestPath,
  indexPath = null,
  index = null,
  virtualPath,
  bloomPath = null,
  bloom = null,
  allowScan = false
}) => {
  if (!virtualPath) return null;
  const resolvedBloom = bloom || (bloomPath ? await loadVfsManifestBloomFilter({ bloomPath }) : null);
  if (resolvedBloom && !resolvedBloom.has(virtualPath)) return null;
  const resolvedIndex = index || (indexPath ? await loadVfsManifestIndex({ indexPath }) : null);
  if (resolvedIndex) {
    const entry = resolvedIndex.get(virtualPath);
    if (!entry) return null;
    return readVfsManifestRowAtOffset({
      manifestPath,
      offset: entry.offset,
      bytes: entry.bytes
    });
  }
  if (!allowScan) return null;
  return scanVfsManifestRowByPath({ manifestPath, virtualPath });
};
