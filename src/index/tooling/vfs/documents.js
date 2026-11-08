import { buildLineIndex, offsetToLine } from '../../../shared/lines.js';
import { toPosix } from '../../../shared/file-paths.js';
import { buildChunkRef } from '../../../shared/identity.js';
import { runWithConcurrency } from '../../../shared/concurrency/run-with-queue.js';
import { buildDocHashCacheKey, computeDocHash } from './doc-hash.js';
import { VFS_MANIFEST_MAX_ROW_BYTES } from './constants.js';
import { admitVfsSourceSpan, createVfsSourceAdmission } from './source-span.js';
import { readSegmentContent, embeddedContentIdentity } from '../../../shared/embedded-content.js';
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
  if (typeof fileTextByPath.get === 'function') return fileTextByPath.get(containerPath) ?? null;
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
  if (trimmed.extensions) {
    if (trimmed.extensions.embeddedContent) trimmed.extensions = { embeddedContent: trimmed.extensions.embeddedContent };
    else delete trimmed.extensions;
  }
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
  const documentAuthority = new Map(), coalescedUids = new Map();
  const skippedSegments = new Set();
  const targets = [];
  const textSourceByPath = new Map();
  const sourceAdmission = createVfsSourceAdmission({ strict, inputChunks: chunks.length, log });
  const admitted = [];
  for (const chunk of chunks) {
    const containerPath = chunk?.file ? toPosix(chunk.file) : null;
    let fileText;
    if (textSourceByPath.has(containerPath)) {
      fileText = textSourceByPath.get(containerPath);
    } else {
      fileText = resolveTextSource(fileTextByPath, containerPath);
      textSourceByPath.set(containerPath, fileText);
    }
    try {
      const span = admitVfsSourceSpan(chunk, fileText, containerPath);
      if (chunk.segment && !chunk.segment.segmentUid && strict) throw new Error(`Missing segmentUid for ${containerPath}`);
      const chunkRef = buildChunkRef(chunk);
      if (!chunkRef?.chunkUid && strict) throw new Error(`Missing chunkUid for ${containerPath}`);
      admitted.push({ chunk, span, chunkRef, fileText, containerPath });
      sourceAdmission.accept();
    } catch (error) { sourceAdmission.reject(error); }
  }
  sourceAdmission.report();
  const coalescedMap = coalesceSegments ? buildCoalescedSegmentMap(admitted.map(entry => entry.chunk)) : null;
  for (const { chunk, span, chunkRef, fileText, containerPath } of admitted) {
    const containerExt = chunk.ext || null;
    const containerLanguageId = chunk.containerLanguageId || null;
    const segment = chunk.segment || null;
    const baseSegmentStart = span.segmentStart;
    const baseSegmentEnd = span.segmentEnd;
    let languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
    let effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
    let segmentStart = baseSegmentStart;
    let segmentEnd = baseSegmentEnd;
    let segmentUid = segment?.segmentUid || null;
    let segmentId = segment?.segmentId || null;
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
        if (!coalescedUids.has(group)) coalescedUids.set(group, await ensureCoalescedSegmentUid(group, fileText));
        segmentUid = coalescedUids.get(group);
        segmentId = group.coalesced ? null : segmentId;
      }
    }
    if (segment && !segmentUid && strict) {
      throw new Error(`Missing segmentUid for ${containerPath}`);
    }
    const fileHash = chunk.fileHash || chunk.metaV2?.fileHash || null;
    const fileHashAlgo = chunk.fileHashAlgo || chunk.metaV2?.fileHashAlgo || null;
    const segmentKey = JSON.stringify([containerPath, segmentUid, segmentStart, segmentEnd, languageId, effectiveExt]);
    if (skippedSegments.has(segmentKey)) continue;
    const authority = JSON.stringify([fileHash, fileHashAlgo, containerExt, containerLanguageId, segmentId,
      segment?.contentView ? embeddedContentIdentity(segment.contentView) : null]);
    let doc = docMap.get(segmentKey);
    if (doc && documentAuthority.get(segmentKey) !== authority) {
      const message = `[vfs] inconsistent document occurrence metadata for ${containerPath}`;
      if (strict) throw new Error(message);
      if (log) log(message);
      continue;
    }
    if (!doc) {
      const text = segment?.contentView ? readSegmentContent(fileText, segment) : segment ? fileText.slice(segmentStart, segmentEnd) : fileText;
      if (Number.isFinite(maxVirtualFileBytes) && maxVirtualFileBytes > 0) {
        const textBytes = Buffer.byteLength(text, 'utf8');
        if (textBytes > maxVirtualFileBytes) {
          const message = `[vfs] virtual document exceeds maxVirtualFileBytes (${textBytes} > ${maxVirtualFileBytes}) for ${containerPath}`;
          if (strict) throw new Error(message);
          if (log) log(message);
          skippedSegments.add(segmentKey);
          continue;
        }
      }
      const docHashCacheKey = buildDocHashCacheKey({ fileHash, fileHashAlgo, languageId, effectiveExt, segmentStart, segmentEnd,
        contentIdentity: segment?.contentView ? embeddedContentIdentity(segment.contentView) : null });
      const docHash = await computeDocHash(text, docHashCacheKey);
      const virtualPath = resolveVfsVirtualPath({ containerPath, segmentUid, languageId, effectiveExt, docHash, hashRouting, segmentStart, segmentEnd });
      const legacyVirtualPath = hashRouting ? buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt, segmentStart, segmentEnd }) : null;
      doc = {
        virtualPath,
        legacyVirtualPath: legacyVirtualPath && legacyVirtualPath !== virtualPath ? legacyVirtualPath : null,
        containerPath, containerExt, containerLanguageId, languageId, effectiveExt,
        segmentUid, segmentId, segmentRange: { start: segmentStart, end: segmentEnd },
        ...(segment?.contentView ? { contentView: segment.contentView, mappingIdentity: embeddedContentIdentity(segment.contentView) } : {}),
        text, docHash, lineIndex: buildLineIndex(text), _sortKey: String(virtualPath || '')
      };
      docMap.set(segmentKey, doc); documentAuthority.set(segmentKey, authority);
    }

    const virtualRange = span.localRange || { start: span.start - segmentStart, end: span.end - segmentStart };
    if (chunkRef && span.frame === 'segment') chunkRef.range = { start: span.start, end: span.end };
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
  return { documents, targets, sourceAdmission: sourceAdmission.receipt };
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
  const sourceAdmission = createVfsSourceAdmission({ strict, inputChunks: chunks.length, log });
  if (typeof fileText !== 'string') {
    for (const chunk of chunks) {
      try { admitVfsSourceSpan(chunk, fileText, containerPath, { requireTarget: false }); }
      catch (error) { sourceAdmission.reject(error); }
    }
    sourceAdmission.report();
    return Object.defineProperty([], 'sourceAdmission', { value: sourceAdmission.receipt });
  }
  const resolvedLineIndex = lineIndex || buildLineIndex(fileText);
  const safeContainerPath = toPosix(containerPath);
  const seen = new Map();
  const groups = [];
  for (const chunk of chunks) {
    let span;
    try { span = admitVfsSourceSpan(chunk, fileText, safeContainerPath, { requireTarget: false }); sourceAdmission.accept(); }
    catch (error) { sourceAdmission.reject(error); continue; }
    const segment = chunk.segment || null;
    const segmentStart = span.segmentStart;
    const segmentEnd = span.segmentEnd;
    const languageId = resolveEffectiveLanguageId({ chunk, segment, containerLanguageId });
    const effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
    let segmentUid = segment?.segmentUid || null;
    if (segment && !segmentUid) {
      if (strict) throw new Error(`Missing segmentUid for ${containerPath}`);
      segmentUid = `seg:auto:${segmentStart}:${segmentEnd}:${languageId || ''}:${effectiveExt || ''}`;
    }
    const key = JSON.stringify([segmentUid, segmentStart, segmentEnd, languageId, effectiveExt]);
    const contentIdentity = segment?.contentView ? embeddedContentIdentity(segment.contentView) : null;
    if (seen.has(key)) {
      if (seen.get(key) !== contentIdentity) sourceAdmission.reject(Object.assign(new RangeError('Conflicting VFS content maps.'), {
        code: 'ERR_VFS_SOURCE_SPAN', reason: 'content-view-conflict', containerPath, chunkUid: chunk.chunkUid || null
      }));
      continue;
    }
    const entry = {
      key,
      segment,
      segmentUid,
      segmentStart,
      segmentEnd,
      languageId,
      effectiveExt
    };
    seen.set(key, contentIdentity);
    groups.push(entry);
  }
  sourceAdmission.report();
  const buildRow = async (entry) => {
    const segmentText = entry.segment
      ? readSegmentContent(fileText, entry.segment)
      : fileText;
    const docHashCacheKey = buildDocHashCacheKey({
      fileHash,
      fileHashAlgo,
      languageId: entry.languageId,
      effectiveExt: entry.effectiveExt,
      segmentStart: entry.segmentStart,
      segmentEnd: entry.segmentEnd,
      contentIdentity: entry.segment?.contentView ? embeddedContentIdentity(entry.segment.contentView) : null
    });
    const docHash = await computeDocHash(segmentText, docHashCacheKey);
    const virtualPath = buildVfsVirtualPath({
      containerPath: safeContainerPath,
      segmentUid: entry.segmentUid,
      effectiveExt: entry.effectiveExt,
      segmentStart: entry.segmentStart,
      segmentEnd: entry.segmentEnd
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
      lineEnd,
      ...(entry.segment?.contentView ? { extensions: { embeddedContent: entry.segment.contentView } } : {})
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
  Object.defineProperty(filtered, 'sourceAdmission', { value: sourceAdmission.receipt });
  return filtered;
};
