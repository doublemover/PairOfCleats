import fs from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import * as istextorbinary from 'istextorbinary';
import { CSS_EXTS, HTML_EXTS, JS_EXTS } from '../constants.js';
import { normalizePositiveNumber } from '../../shared/limits.js';
import { MINIFIED_NAME_REGEX } from './watch/shared.js';

const MINIFIED_SAMPLE_EXTS = new Set([...JS_EXTS, ...CSS_EXTS, ...HTML_EXTS]);
const KNOWN_TEXT_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.def',
  '.m',
  '.mm',
  '.swift',
  '.java',
  '.kt',
  '.kts',
  '.go',
  '.rs',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.gradle',
  '.cmake',
  '.md',
  '.markdown',
  '.txt',
  '.rst',
  '.py',
  '.pyi',
  '.rb',
  '.php',
  '.lua',
  '.pl',
  '.pm',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.proto'
]);

const normalizeLimit = (value, fallback) => normalizePositiveNumber(value, fallback);

/**
 * Fast-path filename heuristic for minified assets.
 *
 * This is intentionally cheap and used before content sampling.
 *
 * @param {string} baseName
 * @returns {boolean}
 */
export const isMinifiedName = (baseName) => {
  if (!baseName) return false;
  return MINIFIED_NAME_REGEX.test(baseName.toLowerCase());
};

/**
 * Read a bounded prefix sample from disk for lightweight file classification.
 *
 * @param {string} absPath
 * @param {number} sampleSizeBytes
 * @returns {Promise<Buffer|null>}
 */
export const readFileSample = async (absPath, sampleSizeBytes) => {
  if (!sampleSizeBytes) return null;
  const handle = await fs.open(absPath, 'r');
  try {
    const buffer = Buffer.alloc(sampleSizeBytes);
    const { bytesRead } = await handle.read(buffer, 0, sampleSizeBytes, 0);
    return bytesRead > 0 ? buffer.subarray(0, bytesRead) : null;
  } finally {
    await handle.close();
  }
};

const isLikelyBinary = (buffer, maxNonTextRatio) => {
  if (!buffer || !buffer.length) return false;
  let nonText = 0;
  for (const byte of buffer) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) nonText += 1;
  }
  return nonText / buffer.length > maxNonTextRatio;
};

const resolveTextOrBinary = async (absPath, buffer) => {
  const syncFn = istextorbinary?.isBinarySync;
  if (typeof syncFn === 'function') {
    try {
      return syncFn(absPath, buffer);
    } catch {
      return null;
    }
  }
  const asyncFn = istextorbinary?.isBinary;
  if (typeof asyncFn !== 'function') return null;
  try {
    const result = asyncFn(absPath, buffer);
    if (typeof result === 'boolean') return result;
    if (result && typeof result.then === 'function') {
      return await result;
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Detect whether a sampled buffer should be treated as binary.
 *
 * Runs `file-type` first, then `istextorbinary`, then a minimal byte-level
 * fallback so we do not miss obvious binary files.
 *
 * @param {{absPath:string,buffer:Buffer,maxNonTextRatio:number}} input
 * @returns {Promise<{reason:string,method:string,mime?:string,ext?:string}|null>}
 */
export const detectBinary = async ({ absPath, buffer, maxNonTextRatio }) => {
  if (!buffer || !buffer.length) return null;
  try {
    const type = await fileTypeFromBuffer(buffer);
    if (type?.mime) {
      const mime = String(type.mime).toLowerCase();
      if (!mime.startsWith('text/')) {
        return { reason: 'binary', method: 'file-type', mime, ext: type.ext || null };
      }
    }
  } catch {}
  const binaryResult = await resolveTextOrBinary(absPath, buffer);
  if (binaryResult === true) {
    return { reason: 'binary', method: 'istextorbinary' };
  }
  // Even if istextorbinary says "text", run a lightweight heuristic as a backstop.
  // This catches obvious binary signals (e.g., NUL bytes) that can slip through.
  if (isLikelyBinary(buffer, maxNonTextRatio)) {
    return { reason: 'binary', method: 'heuristic' };
  }
  if (binaryResult === false) return null;
  return null;
};

const isLikelyMinifiedText = (text, config) => {
  if (!text || text.length < (config.minChars || 0)) return false;
  let lines = 1;
  let whitespace = 0;
  let maxLine = 0;
  let currentLine = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      lines += 1;
      if (currentLine > maxLine) maxLine = currentLine;
      currentLine = 0;
      continue;
    }
    currentLine += 1;
    if (code === 9 || code === 11 || code === 12 || code === 13 || code === 32) {
      whitespace += 1;
    }
  }
  if (currentLine > maxLine) maxLine = currentLine;
  const avgLine = text.length / lines;
  const whitespaceRatio = whitespace / text.length;
  if (config.singleLineChars && text.length >= config.singleLineChars && lines <= 1) {
    return true;
  }
  if (!config.avgLineThreshold || !config.maxLineThreshold) return false;
  return avgLine > config.avgLineThreshold
    && maxLine > config.maxLineThreshold
    && whitespaceRatio < config.maxWhitespaceRatio;
};

/**
 * Build a reusable scanner for binary/minified pre-discovery screening.
 *
 * The scanner intentionally works from bounded samples so discovery can avoid
 * large-file reads in the hot path while still making high-confidence skip
 * decisions.
 *
 * @param {object} [fileScanConfig]
 * @returns {{
 *   scanFile: (input:{absPath:string,stat?:{size?:number},ext?:string,readSample:(absPath:string,bytes:number)=>Promise<Buffer|null>}) => Promise<object>,
 *   sampleSizeBytes:number,
 *   minified:object,
 *   binary:object,
 *   normalizeBaseName:(absPath:string)=>string,
 *   shouldSampleBinary:(size:number)=>boolean,
 *   shouldSampleMinified:(size:number,ext:string)=>boolean
 * }}
 */
export function createFileScanner(fileScanConfig = {}) {
  const config = fileScanConfig && typeof fileScanConfig === 'object' ? fileScanConfig : {};
  const sampleSizeBytes = normalizeLimit(config.sampleBytes, 8192);
  const minifiedConfig = config.minified || {};
  const binaryConfig = config.binary || {};
  const minified = {
    sampleMinBytes: normalizeLimit(minifiedConfig.sampleMinBytes, 4096),
    minChars: normalizeLimit(minifiedConfig.minChars, 1024),
    singleLineChars: normalizeLimit(minifiedConfig.singleLineChars, 4096),
    avgLineThreshold: normalizeLimit(minifiedConfig.avgLineThreshold, 300),
    maxLineThreshold: normalizeLimit(minifiedConfig.maxLineThreshold, 600),
    maxWhitespaceRatio: Number.isFinite(Number(minifiedConfig.maxWhitespaceRatio))
      ? Number(minifiedConfig.maxWhitespaceRatio)
      : 0.2
  };
  const binary = {
    sampleMinBytes: normalizeLimit(binaryConfig.sampleMinBytes, 65536),
    maxNonTextRatio: Number.isFinite(Number(binaryConfig.maxNonTextRatio))
      ? Number(binaryConfig.maxNonTextRatio)
      : 0.3
  };
  const fileTypeSampleBytes = sampleSizeBytes
    ? Math.min(sampleSizeBytes, 4100)
    : 0;
  const shouldSampleBinary = (size) => binary.sampleMinBytes && size >= binary.sampleMinBytes;
  const shouldSampleMinified = (size, ext) => minified.sampleMinBytes
    && size >= minified.sampleMinBytes
    && MINIFIED_SAMPLE_EXTS.has(ext);
  const scanFile = async ({ absPath, stat, ext, readSample }) => {
    const size = stat?.size || 0;
    const normalizedExt = String(ext || '').toLowerCase();
    const wantsBinary = shouldSampleBinary(size);
    const wantsMinified = shouldSampleMinified(size, normalizedExt);
    const skipBinaryProbe = !wantsBinary && KNOWN_TEXT_EXTS.has(normalizedExt);
    const shouldProbeBinary = !skipBinaryProbe;
    const result = {
      checkedBinary: false,
      checkedMinified: false,
      skip: null,
      sampleBuffer: null
    };
    if (!sampleSizeBytes || (!shouldProbeBinary && !wantsMinified && !wantsBinary)) return result;
    const sampleBytes = Math.max(
      shouldProbeBinary ? fileTypeSampleBytes : 0,
      wantsBinary || wantsMinified ? sampleSizeBytes : 0
    );
    if (!sampleBytes) return result;
    let sampleBuffer = null;
    try {
      sampleBuffer = await readSample(absPath, sampleBytes);
    } catch {
      sampleBuffer = null;
    }
    if (!sampleBuffer) return result;
    result.sampleBuffer = sampleBuffer;
    if (shouldProbeBinary) {
      const binarySkip = await detectBinary({
        absPath,
        buffer: sampleBuffer,
        maxNonTextRatio: binary.maxNonTextRatio
      });
      if (binarySkip) {
        result.checkedBinary = true;
        result.skip = { ...binarySkip, bytes: size };
        return result;
      }
      if (wantsBinary) result.checkedBinary = true;
    }
    if (wantsMinified) {
      result.checkedMinified = true;
      const sampleText = sampleBuffer.toString('utf8');
      if (isLikelyMinifiedText(sampleText, minified)) {
        result.skip = { reason: 'minified', method: 'content' };
        return result;
      }
    }
    return result;
  };
  const normalizeBaseName = (absPath) => path.basename(absPath);
  return {
    scanFile,
    sampleSizeBytes,
    minified,
    binary,
    normalizeBaseName,
    shouldSampleBinary,
    shouldSampleMinified
  };
}
