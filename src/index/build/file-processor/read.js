import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSpecialCodeExt } from '../../constants.js';
import { fileExt } from '../../../shared/files.js';
import { decodeTextBuffer } from '../../../shared/encoding.js';
import { pickMinLimit } from '../runtime/limits.js';

export { pickMinLimit };

/**
 * Resolve file size/line caps for a file based on ext/language/mode.
 * @param {object} fileCaps
 * @param {string} ext
 * @param {string|null} [languageId]
 * @param {string|null} [mode]
 * @returns {{maxBytes:number|null,maxLines:number|null}}
 */
export const resolveFileCaps = (fileCaps, ext, languageId = null, mode = null) => {
  const extKey = typeof ext === 'string' ? ext.toLowerCase() : '';
  const languageKey = typeof languageId === 'string' ? languageId.toLowerCase() : '';
  const modeKey = typeof mode === 'string' ? mode.toLowerCase() : '';
  const modeCaps = modeKey ? fileCaps?.byMode?.[modeKey] : null;
  const defaultCaps = modeCaps || fileCaps?.default || {};
  const extCaps = extKey ? fileCaps?.byExt?.[extKey] : null;
  const langCaps = languageKey ? fileCaps?.byLanguage?.[languageKey] : null;
  return {
    maxBytes: pickMinLimit(defaultCaps.maxBytes, extCaps?.maxBytes, langCaps?.maxBytes),
    maxLines: pickMinLimit(defaultCaps.maxLines, extCaps?.maxLines, langCaps?.maxLines)
  };
};

/**
 * Truncate a string to a byte limit, preserving UTF-8 boundaries.
 * @param {string} value
 * @param {number} maxBytes
 * @returns {{text:string,truncated:boolean,bytes:number}}
 */
export const truncateByBytes = (value, maxBytes) => {
  const text = typeof value === 'string' ? value : '';
  const limit = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : 0;
  if (!limit || Buffer.byteLength(text, 'utf8') <= limit) {
    return { text, truncated: false, bytes: Buffer.byteLength(text, 'utf8') };
  }
  const buffer = Buffer.from(text, 'utf8');
  const resolveUtf8Boundary = (buf, end) => {
    let cursor = Math.min(end, buf.length);
    if (cursor <= 0 || cursor === buf.length) return cursor;
    let start = cursor;
    while (start > 0 && (buf[start] & 0xc0) === 0x80) {
      start -= 1;
    }
    if (start === cursor) return cursor;
    const lead = buf[start];
    let expected = 1;
    if ((lead & 0x80) === 0) expected = 1;
    else if ((lead & 0xe0) === 0xc0) expected = 2;
    else if ((lead & 0xf0) === 0xe0) expected = 3;
    else if ((lead & 0xf8) === 0xf0) expected = 4;
    else return start;
    return (start + expected <= cursor) ? cursor : start;
  };
  const safeEnd = resolveUtf8Boundary(buffer, limit);
  const sliced = buffer.toString('utf8', 0, safeEnd);
  return {
    text: sliced,
    truncated: true,
    bytes: safeEnd
  };
};

/**
 * Read text with a hard byte cap using streamed reads to avoid materializing
 * oversized files in memory.
 * @param {{absPath:string,maxBytes:number,chunkSizeBytes?:number,stat?:import('node:fs').Stats|null}} input
 * @returns {Promise<{text:string,encoding:string|null,usedFallback:boolean,confidence:number|null,buffer:Buffer,truncated:boolean,bytes:number}>}
 */
export const readTextFileWithStreamingCap = async ({
  absPath,
  maxBytes,
  chunkSizeBytes = 64 * 1024,
  stat = null
}) => {
  const cap = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
  if (!cap) {
    const buffer = await fs.readFile(absPath);
    const decoded = decodeTextBuffer(buffer);
    return {
      ...decoded,
      buffer,
      truncated: false,
      bytes: buffer.length
    };
  }

  const chunkSize = Number.isFinite(Number(chunkSizeBytes))
    ? Math.max(1024, Math.floor(Number(chunkSizeBytes)))
    : 64 * 1024;
  const handle = await fs.open(absPath, 'r');
  try {
    let remaining = cap;
    let total = 0;
    const buffers = [];
    while (remaining > 0) {
      const nextSize = Math.min(chunkSize, remaining);
      const chunk = Buffer.allocUnsafe(nextSize);
      const { bytesRead } = await handle.read(chunk, 0, nextSize, total);
      if (!bytesRead) break;
      total += bytesRead;
      remaining -= bytesRead;
      buffers.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
      if (bytesRead < nextSize) break;
    }
    const buffer = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers, total);
    const decoded = decodeTextBuffer(buffer);
    let truncated = false;
    if (total >= cap) {
      if (Number.isFinite(stat?.size)) {
        truncated = stat.size > total;
      } else {
        const probe = Buffer.allocUnsafe(1);
        const { bytesRead: probeRead } = await handle.read(probe, 0, 1, total);
        truncated = probeRead > 0;
      }
    }
    return {
      ...decoded,
      buffer,
      truncated,
      bytes: total
    };
  } finally {
    await handle.close();
  }
};

/**
 * Resolve file extension, honoring special code extensions.
 * @param {string} absPath
 * @returns {string}
 */
export const resolveExt = (absPath) => {
  const baseName = path.basename(absPath);
  const specialExt = resolveSpecialCodeExt(baseName);
  if (specialExt) return specialExt;
  return fileExt(absPath);
};
