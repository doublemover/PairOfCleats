import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak, resolvePathOrBak } from '../fs.js';
import { decodeBinaryRowFrameLengths, decodeU64Offsets } from '../binary-columnar.js';
import { decodeVarint64List } from '../varint.js';
import { joinPathSafe } from '../../path-normalize.js';
import {
  INTEGER_COERCE_MODE_STRICT,
  coerceNonNegativeInt
} from '../../number-coerce.js';
import { readJsonFileCached } from './shared.js';

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
  const fields = metaRaw?.fields && typeof metaRaw.fields === 'object'
    ? metaRaw.fields
    : metaRaw;
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
    const start = offsets[i];
    const length = lengths[i];
    if (!Number.isSafeInteger(start) || start < 0) {
      throw new Error(`Invalid binary-columnar row offset: ${start}`);
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`Invalid binary-columnar row length: ${length}`);
    }
    const end = start + length;
    if (end > resolvedDataBuffer.length) {
      throw new Error('Binary-columnar data truncated');
    }
    rows[i] = resolvedDataBuffer.subarray(start, end);
  }
  return rows;
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
        const start = offsets[i];
        const length = lengths[i];
        if (!Number.isSafeInteger(start) || start < 0) {
          throw new Error(`Invalid binary-columnar row offset: ${start}`);
        }
        if (!Number.isSafeInteger(length) || length < 0) {
          throw new Error(`Invalid binary-columnar row length: ${length}`);
        }
        if (max && length > max) {
          throw new Error(`Binary-columnar row exceeds maxBytes (${length} > ${max})`);
        }
        const end = start + length;
        if (!Number.isSafeInteger(end) || end > dataSize) {
          throw new Error('Binary-columnar data truncated');
        }
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

const resolveChunkMetaBinaryColumnarLayout = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
  if (!existsOrBak(metaPath)) return null;
  const metaRaw = readJsonFileCached(resolvePathOrBak(metaPath), { maxBytes });
  try {
    assertSupportedBinaryColumnarMeta(metaRaw, 'chunk_meta binary-columnar');
  } catch (error) {
    if (shouldDegradeUnsupportedMeta(error)) return null;
    throw error;
  }
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const fileTable = Array.isArray(metaRaw?.arrays?.fileTable) ? metaRaw.arrays.fileTable : [];
  const count = meta?.count == null
    ? 0
    : resolveStrictNonNegativeSafeInt(meta.count, 'chunk_meta binary-columnar count');
  const dataPath = resolveSafeLayoutPath(
    dir,
    meta?.data,
    'chunk_meta.binary-columnar.bin',
    'chunk_meta binary-columnar data'
  );
  const offsetsPath = resolveSafeLayoutPath(
    dir,
    meta?.offsets,
    'chunk_meta.binary-columnar.offsets.bin',
    'chunk_meta binary-columnar offsets'
  );
  const lengthsPath = resolveSafeLayoutPath(
    dir,
    meta?.lengths,
    'chunk_meta.binary-columnar.lengths.varint',
    'chunk_meta binary-columnar lengths'
  );
  return {
    count,
    fileTable,
    dataPath,
    offsetsPath,
    lengthsPath
  };
};

/**
 * Attempt to iterate `chunk_meta` rows from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number, enforceDataBudget?: boolean }} [options]
 * @returns {Generator<object, void, unknown>|null}
 */
const iterateChunkMetaBinaryColumnarRows = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    enforceDataBudget = false
  } = {}
) => {
  const layout = resolveChunkMetaBinaryColumnarLayout(dir, { maxBytes });
  if (!layout) return null;
  const {
    count,
    fileTable,
    dataPath,
    offsetsPath,
    lengthsPath
  } = layout;
  if (!count) return (function* () {})();
  const payloads = iterateBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count,
    maxBytes,
    enforceDataBudget
  });
  if (!payloads) return null;
  return (function* () {
    for (const payload of payloads) {
      const row = JSON.parse(payload.toString('utf8'));
      if (row && Number.isInteger(row.fileRef) && (row.file == null)) {
        row.file = fileTable[row.fileRef] ?? null;
        delete row.fileRef;
      }
      yield row;
    }
  })();
};

/**
 * Attempt to load `chunk_meta` from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number }} [options]
 * @returns {object[]|null}
 */
const tryLoadChunkMetaBinaryColumnar = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const rows = iterateChunkMetaBinaryColumnarRows(dir, { maxBytes, enforceDataBudget: true });
  if (!rows) return null;
  return Array.from(rows);
};

/**
 * Decode varint delta/tf pairs into `[docId, tf]` postings.
 *
 * @param {Uint8Array|Buffer} payload
 * @returns {Array<[number, number]>}
 */
const decodePostingPairsVarint = (payload) => {
  const values = decodeVarint64List(payload);
  if (values.length % 2 !== 0) {
    throw new Error('Invalid token_postings binary-columnar payload: odd varint pair count');
  }
  const postings = [];
  let docId = 0;
  for (let i = 0; i < values.length; i += 2) {
    const delta = coerceStrictNonNegativeSafeInt(values[i]);
    const tf = coerceStrictNonNegativeSafeInt(values[i + 1]);
    if (delta == null || tf == null) {
      throw new Error('Invalid token_postings binary-columnar payload: non-integer delta/tf');
    }
    docId = resolveStrictNonNegativeSafeInt(docId + delta, 'token_postings decoded docId');
    postings.push([docId, tf]);
  }
  return postings;
};

const assertTokenPostingsCardinalityInvariant = ({
  count,
  vocab,
  postings,
  vocabIds,
  contextLabel
}) => {
  const diagnostics = [];
  const vocabCount = Array.isArray(vocab) ? vocab.length : 0;
  const postingsCount = Array.isArray(postings) ? postings.length : 0;
  const vocabIdsCount = Array.isArray(vocabIds) ? vocabIds.length : 0;
  if (count !== vocabCount) {
    diagnostics.push(`count=${count} does not match vocab=${vocabCount}`);
  }
  if (postingsCount !== vocabCount) {
    diagnostics.push(`postings=${postingsCount} does not match vocab=${vocabCount}`);
  }
  if (vocabIdsCount > 0 && vocabIdsCount !== vocabCount) {
    diagnostics.push(`vocabIds=${vocabIdsCount} does not match vocab=${vocabCount}`);
  }
  if (!diagnostics.length) return;
  const error = new Error(
    `[artifact-io] ${contextLabel} cardinality invariant failed: ${diagnostics.join('; ')}`
  );
  error.code = 'ERR_ARTIFACT_INVALID';
  error.diagnostics = diagnostics;
  throw error;
};

/**
 * Attempt to load `token_postings` from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number, enforceDataBudget?: boolean }} [options]
 * @returns {object|null}
 */
const tryLoadTokenPostingsBinaryColumnar = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    enforceDataBudget = true
  } = {}
) => {
  const metaPath = path.join(dir, 'token_postings.binary-columnar.meta.json');
  if (!existsOrBak(metaPath)) return null;
  const metaRaw = readJsonFileCached(resolvePathOrBak(metaPath), { maxBytes });
  try {
    assertSupportedBinaryColumnarMeta(metaRaw, 'token_postings binary-columnar');
  } catch (error) {
    if (shouldDegradeUnsupportedMeta(error)) return null;
    throw error;
  }
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const arrays = metaRaw?.arrays && typeof metaRaw.arrays === 'object' ? metaRaw.arrays : {};
  const vocab = Array.isArray(arrays.vocab) ? arrays.vocab : [];
  const count = meta?.count == null
    ? vocab.length
    : resolveStrictNonNegativeSafeInt(meta.count, 'token_postings binary-columnar count');
  const vocabIds = Array.isArray(arrays.vocabIds) ? arrays.vocabIds : [];
  const dataPath = resolveSafeLayoutPath(
    dir,
    meta?.data,
    'token_postings.binary-columnar.bin',
    'token_postings binary-columnar data'
  );
  const offsetsPath = resolveSafeLayoutPath(
    dir,
    meta?.offsets,
    'token_postings.binary-columnar.offsets.bin',
    'token_postings binary-columnar offsets'
  );
  const lengthsPath = resolveSafeLayoutPath(
    dir,
    meta?.lengths,
    'token_postings.binary-columnar.lengths.varint',
    'token_postings binary-columnar lengths'
  );
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count,
    maxBytes,
    enforceDataBudget
  });
  if (!payloads) return null;
  const postings = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    postings[i] = decodePostingPairsVarint(payloads[i]);
  }
  assertTokenPostingsCardinalityInvariant({
    count,
    vocab,
    postings,
    vocabIds,
    contextLabel: 'token_postings binary-columnar'
  });
  const docLengths = Array.isArray(arrays.docLengths) ? arrays.docLengths : [];
  return {
    ...meta,
    vocab,
    ...(vocabIds.length ? { vocabIds } : {}),
    postings,
    docLengths
  };
};

export {
  loadBinaryColumnarRowPayloads,
  iterateBinaryColumnarRowPayloads,
  iterateChunkMetaBinaryColumnarRows,
  tryLoadChunkMetaBinaryColumnar,
  decodePostingPairsVarint,
  tryLoadTokenPostingsBinaryColumnar
};
