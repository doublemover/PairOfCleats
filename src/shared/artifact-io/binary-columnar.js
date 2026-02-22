import fs from 'node:fs/promises';

import { decodeVarint64List, encodeVarint64List } from './varint.js';

const OFFSET_BYTES = 8;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_BINARY_COLUMNAR_PREALLOCATE_BYTES = 1024 * 1024 * 1024;

const toSafeNonNegativeInt = (value, label) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
};

const toBoundedNonNegativeInt = (value, maxValue = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), Math.floor(maxValue));
};

/**
 * Resolve optional binary-columnar write hints for large row-frame payloads.
 *
 * @param {{estimatedBytes?:number,rowCount?:number,presize?:boolean,maxPreallocateBytes?:number}} [input]
 * @returns {{rowCount:number,estimatedBytes:number,preallocateBytes:number}}
 */
export const resolveBinaryColumnarWriteHints = (input = {}) => {
  const rowCount = toBoundedNonNegativeInt(input?.rowCount);
  const estimatedBytes = toBoundedNonNegativeInt(input?.estimatedBytes);
  const preallocateEnabled = input?.presize !== false;
  const maxPreallocateBytes = toBoundedNonNegativeInt(
    input?.maxPreallocateBytes,
    MAX_BINARY_COLUMNAR_PREALLOCATE_BYTES
  ) || MAX_BINARY_COLUMNAR_PREALLOCATE_BYTES;
  const preallocateBytes = preallocateEnabled && estimatedBytes > 0
    ? Math.min(maxPreallocateBytes, estimatedBytes)
    : 0;
  return {
    rowCount,
    estimatedBytes,
    preallocateBytes
  };
};

/**
 * Encode numeric offsets as packed little-endian uint64 values.
 * @param {Array<number>} offsets
 * @returns {Buffer}
 */
export const encodeU64Offsets = (offsets) => {
  const list = Array.isArray(offsets) ? offsets : [];
  const buffer = Buffer.allocUnsafe(list.length * OFFSET_BYTES);
  for (let i = 0; i < list.length; i += 1) {
    const value = toSafeNonNegativeInt(list[i], 'offset');
    buffer.writeBigUInt64LE(BigInt(value), i * OFFSET_BYTES);
  }
  return buffer;
};

/**
 * Decode packed little-endian uint64 offsets into JS numbers.
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer
 * @returns {number[]}
 */
export const decodeU64Offsets = (buffer) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const count = Math.floor(bytes.length / OFFSET_BYTES);
  const offsets = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = bytes.readBigUInt64LE(i * OFFSET_BYTES);
    if (value > MAX_SAFE_BIGINT) {
      throw new Error(`Offset exceeds Number.MAX_SAFE_INTEGER: ${value.toString()}`);
    }
    offsets[i] = Number(value);
  }
  return offsets;
};

/**
 * Build packed row-frame payload plus offset/length sidecars.
 * @param {Array<Buffer|Uint8Array|string>} rowBuffers
 * @returns {{count:number,dataBuffer:Buffer,offsets:number[],offsetsBuffer:Buffer,lengths:number[],lengthsBuffer:Buffer}}
 */
export const encodeBinaryRowFrames = (rowBuffers) => {
  const rows = Array.isArray(rowBuffers) ? rowBuffers : [];
  const offsets = new Array(rows.length);
  const lengths = new Array(rows.length);
  let cursor = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const payload = Buffer.isBuffer(rows[i]) ? rows[i] : Buffer.from(rows[i] || '');
    offsets[i] = cursor;
    lengths[i] = payload.length;
    cursor += payload.length;
  }
  const dataBuffer = Buffer.concat(
    rows.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(entry || ''))),
    cursor
  );
  return {
    count: rows.length,
    dataBuffer,
    offsets,
    offsetsBuffer: encodeU64Offsets(offsets),
    lengths,
    lengthsBuffer: encodeVarint64List(lengths)
  };
};

const toAsyncIterable = (rows) => {
  if (rows && typeof rows[Symbol.asyncIterator] === 'function') return rows;
  return (async function* rowIterator() {
    for (const row of rows || []) {
      yield row;
    }
  })();
};

/**
 * Stream row-frame payloads to disk while generating offset/length sidecars.
 * This avoids materializing a full in-memory data buffer for large artifacts.
 *
 * @param {{rowBuffers:Iterable<Buffer|Uint8Array|string>|AsyncIterable<Buffer|Uint8Array|string>,dataPath:string,offsetsPath:string,lengthsPath:string,preallocateBytes?:number,writeHints?:{preallocateBytes?:number}}} input
 * @returns {Promise<{count:number,totalBytes:number,preallocatedBytes:number}>}
 */
export const writeBinaryRowFrames = async ({
  rowBuffers,
  dataPath,
  offsetsPath,
  lengthsPath,
  preallocateBytes = null,
  writeHints = null
}) => {
  const resolvedPreallocateBytes = toBoundedNonNegativeInt(
    preallocateBytes ?? writeHints?.preallocateBytes,
    MAX_BINARY_COLUMNAR_PREALLOCATE_BYTES
  );
  const offsets = [];
  const lengths = [];
  let cursor = 0;
  let count = 0;
  const handle = await fs.open(dataPath, 'w');
  try {
    if (resolvedPreallocateBytes > 0) {
      await handle.truncate(resolvedPreallocateBytes);
    }
    for await (const row of toAsyncIterable(rowBuffers)) {
      const payload = Buffer.isBuffer(row) ? row : Buffer.from(row || '');
      offsets.push(cursor);
      lengths.push(payload.length);
      cursor += payload.length;
      if (payload.length) {
        await handle.write(payload);
      }
      count += 1;
    }
    if (resolvedPreallocateBytes > 0 && cursor !== resolvedPreallocateBytes) {
      await handle.truncate(cursor);
    }
  } finally {
    await handle.close();
  }
  await fs.writeFile(offsetsPath, encodeU64Offsets(offsets));
  await fs.writeFile(lengthsPath, encodeVarint64List(lengths));
  return {
    count,
    totalBytes: cursor,
    preallocatedBytes: resolvedPreallocateBytes
  };
};

/**
 * Decode varint64-packed row lengths into JS numbers.
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer
 * @returns {number[]}
 */
export const decodeBinaryRowFrameLengths = (buffer) => {
  const decoded = decodeVarint64List(buffer);
  const lengths = new Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    const value = decoded[i];
    if (value > MAX_SAFE_BIGINT) {
      throw new Error(`Row length exceeds Number.MAX_SAFE_INTEGER: ${value.toString()}`);
    }
    lengths[i] = Number(value);
  }
  return lengths;
};
