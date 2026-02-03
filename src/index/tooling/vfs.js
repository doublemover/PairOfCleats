import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { checksumString } from '../../shared/hash.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { toPosix } from '../../shared/files.js';
import { buildChunkRef } from '../../shared/identity.js';
import { LANGUAGE_ID_EXT } from '../segments/config.js';

const VFS_PREFIX = '.poc-vfs/';
const VFS_HASH_PREFIX = `${VFS_PREFIX}by-hash/`;
export const VFS_MANIFEST_MAX_ROW_BYTES = 32 * 1024;
const VFS_DISK_CACHE = new Map();
const VFS_DOC_HASH_CACHE = new Map();
const VFS_DOC_HASH_CACHE_MAX = 50000;

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
 * @returns {Promise<{documents:Array,targets:Array}>}
 */
export const buildToolingVirtualDocuments = async ({
  chunks,
  fileTextByPath,
  strict = true,
  maxVirtualFileBytes = null,
  hashRouting = false,
  log = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) {
    return { documents: [], targets: [] };
  }
  const docMap = new Map();
  const skippedSegments = new Set();
  const targets = [];

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
    const segmentUid = segment?.segmentUid || null;
    const segmentKeyBase = `${containerPath}::${segmentUid || ''}`;
    if (skippedSegments.has(segmentKeyBase)) continue;
    if (segment && !segmentUid && strict) {
      throw new Error(`Missing segmentUid for ${containerPath}`);
    }
    const segmentStart = segment ? segment.start : 0;
    const segmentEnd = segment ? segment.end : fileText.length;
    const languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
    const effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
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
        segmentId: segment?.segmentId || null,
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
  log = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  if (typeof fileText !== 'string') {
    if (strict) throw new Error(`Missing file text for ${containerPath}`);
    return [];
  }
  const resolvedLineIndex = lineIndex || buildLineIndex(fileText);
  const safeContainerPath = toPosix(containerPath);
  const groupMap = new Map();
  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const segment = chunk.segment || null;
    const segmentUid = segment?.segmentUid || null;
    const key = `${segmentUid || ''}`;
    if (groupMap.has(key)) continue;
    const segmentStart = segment ? segment.start : 0;
    const segmentEnd = segment ? segment.end : fileText.length;
    const languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
    const effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
    const segmentText = segment ? fileText.slice(segmentStart, segmentEnd) : fileText;
    const docHashCacheKey = buildDocHashCacheKey({
      fileHash,
      fileHashAlgo,
      languageId,
      effectiveExt,
      segmentStart,
      segmentEnd
    });
    const docHash = await computeDocHash(segmentText, docHashCacheKey);
    const virtualPath = buildVfsVirtualPath({
      containerPath: safeContainerPath,
      segmentUid,
      effectiveExt
    });
    const lineStart = offsetToLine(resolvedLineIndex, segmentStart);
    const endOffset = segmentEnd > segmentStart ? segmentEnd - 1 : segmentStart;
    const lineEnd = offsetToLine(resolvedLineIndex, endOffset);
    groupMap.set(key, {
      schemaVersion: '1.0.0',
      virtualPath,
      docHash,
      containerPath: safeContainerPath,
      containerExt: containerExt || null,
      containerLanguageId: containerLanguageId || null,
      languageId,
      effectiveExt,
      segmentUid,
      segmentId: segment?.segmentId || null,
      segmentStart,
      segmentEnd,
      lineStart,
      lineEnd
    });
  }
  const rows = Array.from(groupMap.values());
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
export const ensureVfsDiskDocument = async ({ baseDir, virtualPath, text = '', docHash = null }) => {
  const absPath = resolveVfsDiskPath({ baseDir, virtualPath });
  const cacheKey = `${baseDir}::${virtualPath}`;
  const cached = VFS_DISK_CACHE.get(cacheKey);
  if (cached && cached.docHash === docHash) {
    try {
      await fsPromises.access(absPath);
      return { path: absPath, cacheHit: true };
    } catch {}
  }
  await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
  await fsPromises.writeFile(absPath, text || '', 'utf8');
  VFS_DISK_CACHE.set(cacheKey, { path: absPath, docHash });
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
 * @param {{manifestPath:string,indexPath?:string,index?:Map<string,object>,virtualPath:string}} input
 * @returns {Promise<object|null>}
 */
export const loadVfsManifestRowByPath = async ({
  manifestPath,
  indexPath = null,
  index = null,
  virtualPath
}) => {
  if (!virtualPath) return null;
  const resolvedIndex = index || (indexPath ? await loadVfsManifestIndex({ indexPath }) : null);
  if (!resolvedIndex) return null;
  const entry = resolvedIndex.get(virtualPath);
  if (!entry) return null;
  return readVfsManifestRowAtOffset({
    manifestPath,
    offset: entry.offset,
    bytes: entry.bytes
  });
};
