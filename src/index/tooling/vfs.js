import path from 'node:path';
import { checksumString } from '../../shared/hash.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { toPosix } from '../../shared/files.js';
import { buildChunkRef } from '../../shared/identity.js';
import { LANGUAGE_ID_EXT } from '../segments/config.js';

const VFS_PREFIX = '.poc-vfs/';
const MAX_ROW_BYTES = 32 * 1024;

const encodeContainerPath = (value) => {
  const posixPath = toPosix(value || '');
  return posixPath.replace(/%/g, '%25').replace(/#/g, '%23');
};

export const resolveEffectiveExt = ({ languageId, containerExt }) => {
  if (languageId && LANGUAGE_ID_EXT.has(languageId)) {
    return LANGUAGE_ID_EXT.get(languageId);
  }
  return containerExt || '';
};

export const buildVfsVirtualPath = ({ containerPath, segmentUid, effectiveExt }) => {
  const encoded = encodeContainerPath(containerPath);
  if (!segmentUid) return `${VFS_PREFIX}${encoded}`;
  return `${VFS_PREFIX}${encoded}#seg:${segmentUid}${effectiveExt || ''}`;
};

const resolveTextSource = (fileTextByPath, containerPath) => {
  if (!fileTextByPath) return null;
  if (typeof fileTextByPath.get === 'function') return fileTextByPath.get(containerPath) || null;
  if (typeof fileTextByPath === 'function') return fileTextByPath(containerPath);
  return null;
};

const computeDocHash = async (text) => {
  const hash = await checksumString(text || '');
  return hash?.value ? `xxh64:${hash.value}` : 'xxh64:';
};

const normalizeLanguageId = (value, fallback = null) => {
  if (!value) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const sortTargets = (a, b) => {
  const keyA = `${a.virtualPath}:${a.chunkRef?.chunkUid || ''}`;
  const keyB = `${b.virtualPath}:${b.chunkRef?.chunkUid || ''}`;
  return keyA.localeCompare(keyB);
};

const sortDocuments = (a, b) => {
  return String(a.virtualPath || '').localeCompare(String(b.virtualPath || ''));
};

export const buildToolingVirtualDocuments = async ({
  chunks,
  fileTextByPath,
  strict = true,
  maxVirtualFileBytes = null,
  log = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) {
    return { documents: [], targets: [] };
  }
  const docMap = new Map();
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
    if (segment && !segmentUid && strict) {
      throw new Error(`Missing segmentUid for ${containerPath}`);
    }
    const segmentStart = segment ? segment.start : 0;
    const segmentEnd = segment ? segment.end : fileText.length;
    const segmentKey = `${containerPath}::${segmentUid || ''}`;
    if (!docMap.has(segmentKey)) {
      const languageId = normalizeLanguageId(
        chunk.lang || segment?.languageId || containerLanguageId,
        'unknown'
      );
      const effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
      const text = segment ? fileText.slice(segmentStart, segmentEnd) : fileText;
      if (Number.isFinite(maxVirtualFileBytes) && maxVirtualFileBytes > 0) {
        const textBytes = Buffer.byteLength(text, 'utf8');
        if (textBytes > maxVirtualFileBytes) {
          const message = `[vfs] virtual document exceeds maxVirtualFileBytes (${textBytes} > ${maxVirtualFileBytes}) for ${containerPath}`;
          if (strict) throw new Error(message);
          if (log) log(message);
          docMap.set(segmentKey, null);
          continue;
        }
      }
      const docHash = await computeDocHash(text);
      const virtualPath = buildVfsVirtualPath({
        containerPath,
        segmentUid,
        effectiveExt
      });
      docMap.set(segmentKey, {
        virtualPath,
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
    const virtualStart = segment ? chunk.start - segmentStart : chunk.start;
    const virtualEnd = segment ? chunk.end - segmentStart : chunk.end;
    const inBounds = virtualStart >= 0
      && virtualEnd >= virtualStart
      && virtualEnd <= doc.text.length;
    if (!inBounds) {
      const message = `Invalid virtualRange for ${containerPath} (${virtualStart}-${virtualEnd})`;
      if (strict) throw new Error(message);
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
      virtualRange: { start: virtualStart, end: virtualEnd },
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
  strict = true,
  log = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  if (typeof fileText !== 'string') {
    if (strict) throw new Error(`Missing file text for ${containerPath}`);
    return [];
  }
  const resolvedLineIndex = lineIndex || buildLineIndex(fileText);
  const groupMap = new Map();
  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const segment = chunk.segment || null;
    const segmentUid = segment?.segmentUid || null;
    const key = `${segmentUid || ''}`;
    if (groupMap.has(key)) continue;
    const segmentStart = segment ? segment.start : 0;
    const segmentEnd = segment ? segment.end : fileText.length;
    const languageId = normalizeLanguageId(chunk.lang || segment?.languageId || containerLanguageId, 'unknown');
    const effectiveExt = segment?.ext || resolveEffectiveExt({ languageId, containerExt });
    const segmentText = segment ? fileText.slice(segmentStart, segmentEnd) : fileText;
    const docHash = await computeDocHash(segmentText);
    const virtualPath = buildVfsVirtualPath({
      containerPath: toPosix(containerPath),
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
      containerPath: toPosix(containerPath),
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
  rows.sort((a, b) => {
    if (a.containerPath !== b.containerPath) return a.containerPath.localeCompare(b.containerPath);
    if (a.segmentStart !== b.segmentStart) return a.segmentStart - b.segmentStart;
    if (a.segmentEnd !== b.segmentEnd) return a.segmentEnd - b.segmentEnd;
    if (a.languageId !== b.languageId) return a.languageId.localeCompare(b.languageId);
    if (a.effectiveExt !== b.effectiveExt) return a.effectiveExt.localeCompare(b.effectiveExt);
    const segA = a.segmentUid || '';
    const segB = b.segmentUid || '';
    if (segA !== segB) return segA.localeCompare(segB);
    return a.virtualPath.localeCompare(b.virtualPath);
  });
  const filtered = [];
  for (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (bytes > MAX_ROW_BYTES) {
      if (log) log(`[vfs] vfs_manifest row exceeded 32KB for ${row.containerPath}`);
      continue;
    }
    filtered.push(row);
  }
  return filtered;
};

export const resolveVfsDiskPath = ({ baseDir, virtualPath }) => {
  const parts = String(virtualPath || '').split('/');
  const safeParts = parts.map((part) => part.replace(/[:*?"<>|]/g, (ch) => encodeURIComponent(ch)));
  const relative = safeParts.join(path.sep);
  return path.join(baseDir, relative);
};
