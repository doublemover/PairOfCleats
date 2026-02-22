import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak, resolvePathOrBak } from '../fs.js';
import { decodeBinaryRowFrameLengths, decodeU64Offsets } from '../binary-columnar.js';
import { decodeVarint64List } from '../varint.js';
import { readJsonFileCached } from './shared.js';

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
  count
}) => {
  if (!existsOrBak(dataPath) || !existsOrBak(offsetsPath) || !existsOrBak(lengthsPath)) {
    return null;
  }
  const resolvedDataPath = resolvePathOrBak(dataPath);
  const resolvedOffsetsPath = resolvePathOrBak(offsetsPath);
  const resolvedLengthsPath = resolvePathOrBak(lengthsPath);
  const dataBuffer = fs.readFileSync(resolvedDataPath);
  const offsets = decodeU64Offsets(fs.readFileSync(resolvedOffsetsPath));
  const lengths = decodeBinaryRowFrameLengths(fs.readFileSync(resolvedLengthsPath));
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
    if (end > dataBuffer.length) {
      throw new Error('Binary-columnar data truncated');
    }
    rows[i] = dataBuffer.subarray(start, end);
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
    count
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
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const arrays = metaRaw?.arrays && typeof metaRaw.arrays === 'object' ? metaRaw.arrays : {};
  const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
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
    count
  });
  if (!payloads) return null;
  const postings = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    postings[i] = decodePostingPairsVarint(payloads[i]);
  }
  const vocab = Array.isArray(arrays.vocab) ? arrays.vocab : [];
  const vocabIds = Array.isArray(arrays.vocabIds) ? arrays.vocabIds : [];
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
