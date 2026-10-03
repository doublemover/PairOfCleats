import fs from 'node:fs';
import { existsOrBak, resolvePathOrBak } from '../fs.js';
import { decodeBinaryRowFrameLengths, decodeU64Offsets } from '../binary-columnar.js';
import { joinPathSafe } from '../../path-normalize.js';
import {
  INTEGER_COERCE_MODE_STRICT,
  coerceNonNegativeInt
} from '../../number-coerce.js';
import { resolveArtifactMetaEnvelope } from './shared.js';

const SUPPORTED_BINARY_COLUMNAR_FORMAT = 'binary-columnar-v1';
const SUPPORTED_BINARY_BYTE_ORDER = new Set(['le', 'little', 'little-endian']);

const coerceStrictNonNegativeSafeInt = (value) => {
  const parsed = coerceNonNegativeInt(value, { mode: INTEGER_COERCE_MODE_STRICT });
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const resolveStrictNonNegativeSafeInt = (value, label) => {
  const parsed = coerceStrictNonNegativeSafeInt(value);
  if (parsed == null) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return parsed;
};

const toPositiveFinite = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const assertWithinMaxBytes = (bytes, maxBytes, label) => {
  const max = toPositiveFinite(maxBytes);
  if (!max) return;
  if (Number(bytes) > max) {
    throw new Error(`${label} exceeds maxBytes (${bytes} > ${max})`);
  }
};

const shouldDegradeUnsupportedMeta = (error) => {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return false;
  return message.includes('unsupported') && (
    message.includes('byteorder')
    || message.includes('format')
  );
};

const assertSupportedBinaryColumnarMeta = (metaRaw, label) => {
  const { fields } = resolveArtifactMetaEnvelope(metaRaw);
  const format = typeof fields?.format === 'string' ? fields.format.trim().toLowerCase() : '';
  if (format && format !== SUPPORTED_BINARY_COLUMNAR_FORMAT) {
    throw new Error(
      `Unsupported ${label} format: ${fields.format}; expected ${SUPPORTED_BINARY_COLUMNAR_FORMAT}`
    );
  }
  const byteOrderRaw = typeof fields?.byteOrder === 'string'
    ? fields.byteOrder.trim().toLowerCase()
    : '';
  if (byteOrderRaw && !SUPPORTED_BINARY_BYTE_ORDER.has(byteOrderRaw)) {
    throw new Error(`Unsupported ${label} byteOrder: ${fields.byteOrder}`);
  }
};

const resolveBinaryColumnarFrameMetadata = ({
  offsetsPath,
  lengthsPath,
  count,
  offsetsBuffer = null,
  lengthsBuffer = null,
  maxBytes = null
}) => {
  const hasOffsetsBuffer = Buffer.isBuffer(offsetsBuffer) || offsetsBuffer instanceof Uint8Array;
  const hasLengthsBuffer = Buffer.isBuffer(lengthsBuffer) || lengthsBuffer instanceof Uint8Array;
  if (!hasOffsetsBuffer && !existsOrBak(offsetsPath)) {
    return null;
  }
  if (!hasLengthsBuffer && !existsOrBak(lengthsPath)) {
    return null;
  }
  const resolvedOffsetsPath = hasOffsetsBuffer ? null : resolvePathOrBak(offsetsPath);
  const resolvedLengthsPath = hasLengthsBuffer ? null : resolvePathOrBak(lengthsPath);
  const resolvedOffsetsBuffer = hasOffsetsBuffer
    ? (Buffer.isBuffer(offsetsBuffer) ? offsetsBuffer : Buffer.from(offsetsBuffer))
    : fs.readFileSync(resolvedOffsetsPath);
  const resolvedLengthsBuffer = hasLengthsBuffer
    ? (Buffer.isBuffer(lengthsBuffer) ? lengthsBuffer : Buffer.from(lengthsBuffer))
    : fs.readFileSync(resolvedLengthsPath);
  assertWithinMaxBytes(resolvedOffsetsBuffer.length, maxBytes, 'Binary-columnar offsets');
  assertWithinMaxBytes(resolvedLengthsBuffer.length, maxBytes, 'Binary-columnar lengths');
  const offsets = decodeU64Offsets(resolvedOffsetsBuffer);
  const lengths = decodeBinaryRowFrameLengths(resolvedLengthsBuffer);
  const resolvedCount = resolveStrictNonNegativeSafeInt(count, 'binary-columnar row count');
  if (offsets.length < resolvedCount || lengths.length < resolvedCount) {
    throw new Error('Binary-columnar frame metadata count mismatch');
  }
  return {
    offsets,
    lengths,
    count: resolvedCount
  };
};

const resolveSafeLayoutPath = (dir, candidate, fallback, label) => {
  const relPath = typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : fallback;
  const resolved = joinPathSafe(dir, [relPath]);
  if (!resolved) {
    throw new Error(`Invalid ${label} path: ${String(relPath)}`);
  }
  return resolved;
};

/**
 * Load framed binary-columnar row payload slices.
 *
 * @param {{
 *   dataPath: string,
 *   offsetsPath: string,
 *   lengthsPath: string,
 *   count: number
 * }} input
 * @returns {Buffer[]|null}
 */
const loadBinaryColumnarRowPayloads = ({
  dataPath,
  offsetsPath,
  lengthsPath,
  count,
  dataBuffer = null,
  offsetsBuffer = null,
  lengthsBuffer = null,
  maxBytes = null,
  enforceDataBudget = true
}) => {
  const resolvedCount = resolveStrictNonNegativeSafeInt(count, 'binary-columnar row count');
  const hasDataBuffer = Buffer.isBuffer(dataBuffer) || dataBuffer instanceof Uint8Array;
  if (!hasDataBuffer && !existsOrBak(dataPath)) {
    return null;
  }
  const resolvedDataPath = hasDataBuffer ? null : resolvePathOrBak(dataPath);
  const resolvedDataBuffer = hasDataBuffer
    ? (Buffer.isBuffer(dataBuffer) ? dataBuffer : Buffer.from(dataBuffer))
    : fs.readFileSync(resolvedDataPath);
  const metadata = resolveBinaryColumnarFrameMetadata({
    offsetsPath,
    lengthsPath,
    count: resolvedCount,
    offsetsBuffer,
    lengthsBuffer,
    maxBytes
  });
  if (!metadata) return null;
  const { offsets, lengths, count: metadataCount } = metadata;
  if (enforceDataBudget) {
    assertWithinMaxBytes(resolvedDataBuffer.length, maxBytes, 'Binary-columnar data');
  }
  const rows = new Array(metadataCount);
  for (let i = 0; i < metadataCount; i += 1) {
    const slice = resolveBinaryColumnarRowSlice({
      start: offsets[i],
      length: lengths[i],
      dataSize: resolvedDataBuffer.length
    });
    rows[i] = resolvedDataBuffer.subarray(slice.start, slice.end);
  }
  return rows;
};

const resolveBinaryColumnarRowSlice = ({
  start,
  length,
  dataSize,
  max = null,
  enforceRowBudget = false,
  requireSafeEnd = false
}) => {
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new Error(`Invalid binary-columnar row offset: ${start}`);
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Invalid binary-columnar row length: ${length}`);
  }
  if (enforceRowBudget && max && length > max) {
    throw new Error(`Binary-columnar row exceeds maxBytes (${length} > ${max})`);
  }
  const end = start + length;
  if ((requireSafeEnd && !Number.isSafeInteger(end)) || end > dataSize) {
    throw new Error('Binary-columnar data truncated');
  }
  return { start, end };
};

/**
 * Iterate framed binary-columnar row payloads without materializing full data blobs.
 *
 * @param {{
 *   dataPath: string,
 *   offsetsPath: string,
 *   lengthsPath: string,
 *   count: number,
 *   offsetsBuffer?: Buffer|Uint8Array|null,
 *   lengthsBuffer?: Buffer|Uint8Array|null,
 *   maxBytes?: number|null,
 *   enforceDataBudget?: boolean
 * }} input
 * @returns {Generator<Buffer, void, unknown>|null}
 */
const iterateBinaryColumnarRowPayloads = ({
  dataPath,
  offsetsPath,
  lengthsPath,
  count,
  offsetsBuffer = null,
  lengthsBuffer = null,
  maxBytes = null,
  enforceDataBudget = false
}) => {
  const resolvedCount = resolveStrictNonNegativeSafeInt(count, 'binary-columnar row count');
  if (!existsOrBak(dataPath)) return null;
  const metadata = resolveBinaryColumnarFrameMetadata({
    offsetsPath,
    lengthsPath,
    count: resolvedCount,
    offsetsBuffer,
    lengthsBuffer,
    maxBytes
  });
  if (!metadata) return null;
  const { offsets, lengths, count: metadataCount } = metadata;
  const resolvedDataPath = resolvePathOrBak(dataPath);
  const max = toPositiveFinite(maxBytes);
  return (function* () {
    const dataHandle = fs.openSync(resolvedDataPath, 'r');
    try {
      const dataSize = Number(fs.fstatSync(dataHandle)?.size || 0);
      if (enforceDataBudget) {
        assertWithinMaxBytes(dataSize, maxBytes, 'Binary-columnar data');
      }
      for (let i = 0; i < metadataCount; i += 1) {
        const { start, end } = resolveBinaryColumnarRowSlice({
          start: offsets[i],
          length: lengths[i],
          dataSize,
          max,
          enforceRowBudget: enforceDataBudget,
          requireSafeEnd: true
        });
        const length = end - start;
        const row = Buffer.allocUnsafe(length);
        let readOffset = 0;
        while (readOffset < length) {
          const bytesRead = fs.readSync(dataHandle, row, readOffset, length - readOffset, start + readOffset);
          if (!Number.isFinite(bytesRead) || bytesRead <= 0) {
            throw new Error('Binary-columnar data truncated');
          }
          readOffset += bytesRead;
        }
        yield row;
      }
    } finally {
      fs.closeSync(dataHandle);
    }
  })();
};

export {
  assertSupportedBinaryColumnarMeta,
  coerceStrictNonNegativeSafeInt,
  loadBinaryColumnarRowPayloads,
  iterateBinaryColumnarRowPayloads,
  resolveSafeLayoutPath,
  resolveStrictNonNegativeSafeInt,
  shouldDegradeUnsupportedMeta
};
