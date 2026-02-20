import { buildLineIndex, offsetToLine } from '../../../shared/lines.js';
import { toPosix } from '../../../shared/files.js';
import { buildChunkRef } from '../../../shared/identity.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import { buildDocHashCacheKey, computeDocHash } from './doc-hash.js';
import { VFS_MANIFEST_MAX_ROW_BYTES } from './constants.js';
import {
  buildCoalescedSegmentMap,
  ensureCoalescedSegmentUid,
  resolveEffectiveLanguageId,
  resolveSegmentLookupKey
} from './segments.js';
import {
  buildVfsVirtualPath,
  resolveEffectiveExt,
  resolveVfsVirtualPath
} from './virtual-path.js';

const resolveTextSource = (fileTextByPath, containerPath) => {
  if (!fileTextByPath) return null;
  if (typeof fileTextByPath.get === 'function') return fileTextByPath.get(containerPath) || null;
  if (typeof fileTextByPath === 'function') return fileTextByPath(containerPath);
  return null;
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

const sortTargets = (a, b) => (a._sortKey || '').localeCompare(b._sortKey || '');

const sortDocuments = (a, b) => (a._sortKey || '').localeCompare(b._sortKey || '');

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
      const lookupKey = resolveSegmentLookupKey({
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
        lineIndex: buildLineIndex(text),
        _sortKey: String(virtualPath || '')
      });
    }
    const doc = docMap.get(segmentKey) || null;
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
      symbolHint: chunk.name || chunk.kind ? { name: chunk.name, kind: chunk.kind } : null,
      _sortKey: `${doc.virtualPath}:${chunkRef?.chunkUid || ''}`
    });
  }

  const documents = Array.from(docMap.values());
  documents.sort(sortDocuments);
  targets.sort(sortTargets);
  for (const doc of documents) delete doc._sortKey;
  for (const target of targets) delete target._sortKey;
  return { documents, targets };
};

/**
 * Build VFS manifest rows for a single container file.
 * @param {object} input
 * @param {Array<object>} input.chunks
 * @param {string} input.fileText
 * @param {string} input.containerPath
 * @param {string|null} [input.containerExt]
 * @param {string|null} [input.containerLanguageId]
 * @param {Array<number>|null} [input.lineIndex]
 * @param {string|null} [input.fileHash]
 * @param {string|null} [input.fileHashAlgo]
 * @param {boolean} [input.strict]
 * @param {Function|null} [input.log]
 * @param {number|null} [input.concurrency]
 * @returns {Promise<Array<object>>}
 */
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
    if (!chunk) continue;
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
