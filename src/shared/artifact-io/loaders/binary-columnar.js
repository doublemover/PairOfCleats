import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak, resolvePathOrBak } from '../fs.js';
import { decodeBinaryRowFrameLengths, decodeU64Offsets } from '../binary-columnar.js';
import { decodeVarint64List } from '../varint.js';
import { readJsonFileCached } from './shared.js';

const SUPPORTED_BINARY_COLUMNAR_FORMAT = 'binary-columnar-v1';
const SUPPORTED_BINARY_BYTE_ORDER = new Set(['le', 'little', 'little-endian']);

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
  maxBytes = null
}) => {
  const hasDataBuffer = Buffer.isBuffer(dataBuffer) || dataBuffer instanceof Uint8Array;
  const hasOffsetsBuffer = Buffer.isBuffer(offsetsBuffer) || offsetsBuffer instanceof Uint8Array;
  const hasLengthsBuffer = Buffer.isBuffer(lengthsBuffer) || lengthsBuffer instanceof Uint8Array;
  if (!hasDataBuffer && !existsOrBak(dataPath)) {
    return null;
  }
  if (!hasOffsetsBuffer && !existsOrBak(offsetsPath)) {
    return null;
  }
  if (!hasLengthsBuffer && !existsOrBak(lengthsPath)) {
    return null;
  }
  const resolvedDataPath = hasDataBuffer ? null : resolvePathOrBak(dataPath);
  const resolvedOffsetsPath = hasOffsetsBuffer ? null : resolvePathOrBak(offsetsPath);
  const resolvedLengthsPath = hasLengthsBuffer ? null : resolvePathOrBak(lengthsPath);
  const resolvedDataBuffer = hasDataBuffer
    ? (Buffer.isBuffer(dataBuffer) ? dataBuffer : Buffer.from(dataBuffer))
    : fs.readFileSync(resolvedDataPath);
  const resolvedOffsetsBuffer = hasOffsetsBuffer
    ? (Buffer.isBuffer(offsetsBuffer) ? offsetsBuffer : Buffer.from(offsetsBuffer))
    : fs.readFileSync(resolvedOffsetsPath);
  const resolvedLengthsBuffer = hasLengthsBuffer
    ? (Buffer.isBuffer(lengthsBuffer) ? lengthsBuffer : Buffer.from(lengthsBuffer))
    : fs.readFileSync(resolvedLengthsPath);
  assertWithinMaxBytes(resolvedDataBuffer.length, maxBytes, 'Binary-columnar data');
  assertWithinMaxBytes(resolvedOffsetsBuffer.length, maxBytes, 'Binary-columnar offsets');
  assertWithinMaxBytes(resolvedLengthsBuffer.length, maxBytes, 'Binary-columnar lengths');
  const offsets = decodeU64Offsets(resolvedOffsetsBuffer);
  const lengths = decodeBinaryRowFrameLengths(resolvedLengthsBuffer);
  if (!Number.isFinite(count) || count < 0) return null;
  if (offsets.length < count || lengths.length < count) {
    throw new Error('Binary-columnar frame metadata count mismatch');
  }
  const rows = new Array(count);
  for (let i = 0; i < count; i += 1) {
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
 * Attempt to load `chunk_meta` from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number }} [options]
 * @returns {object[]|null}
 */
const tryLoadChunkMetaBinaryColumnar = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
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
  const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
  if (!count) return [];
  const dataPath = path.join(dir, typeof meta?.data === 'string' ? meta.data : 'chunk_meta.binary-columnar.bin');
  const offsetsPath = path.join(
    dir,
    typeof meta?.offsets === 'string' ? meta.offsets : 'chunk_meta.binary-columnar.offsets.bin'
  );
  const lengthsPath = path.join(
    dir,
    typeof meta?.lengths === 'string' ? meta.lengths : 'chunk_meta.binary-columnar.lengths.varint'
  );
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count,
    maxBytes
  });
  if (!payloads) return null;
  const rows = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    const row = JSON.parse(payloads[i].toString('utf8'));
    if (row && Number.isInteger(row.fileRef) && (row.file == null)) {
      row.file = fileTable[row.fileRef] ?? null;
      delete row.fileRef;
    }
    rows[i] = row;
  }
  return rows;
};

/**
 * Decode varint delta/tf pairs into `[docId, tf]` postings.
 *
 * @param {Uint8Array|Buffer} payload
 * @returns {Array<[number, number]>}
 */
const decodePostingPairsVarint = (payload) => {
  const values = decodeVarint64List(payload);
  const postings = [];
  let docId = 0;
  for (let i = 0; i + 1 < values.length; i += 2) {
    const delta = Number(values[i]);
    const tf = Number(values[i + 1]);
    if (!Number.isFinite(delta) || !Number.isFinite(tf)) continue;
    docId += Math.max(0, Math.floor(delta));
    postings.push([docId, Math.max(0, Math.floor(tf))]);
  }
  return postings;
};

/**
 * Attempt to load `token_postings` from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number }} [options]
 * @returns {object|null}
 */
const tryLoadTokenPostingsBinaryColumnar = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
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
  const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
  const vocab = Array.isArray(arrays.vocab) ? arrays.vocab : [];
  const vocabIds = Array.isArray(arrays.vocabIds) ? arrays.vocabIds : [];
  if (count > 0 && vocab.length === 0) return null;
  if (vocabIds.length > 0 && vocabIds.length !== vocab.length) return null;
  const dataPath = path.join(dir, typeof meta?.data === 'string' ? meta.data : 'token_postings.binary-columnar.bin');
  const offsetsPath = path.join(
    dir,
    typeof meta?.offsets === 'string' ? meta.offsets : 'token_postings.binary-columnar.offsets.bin'
  );
  const lengthsPath = path.join(
    dir,
    typeof meta?.lengths === 'string' ? meta.lengths : 'token_postings.binary-columnar.lengths.varint'
  );
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count,
    maxBytes
  });
  if (!payloads) return null;
  const postings = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    postings[i] = decodePostingPairsVarint(payloads[i]);
  }
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
  tryLoadChunkMetaBinaryColumnar,
  decodePostingPairsVarint,
  tryLoadTokenPostingsBinaryColumnar
};
