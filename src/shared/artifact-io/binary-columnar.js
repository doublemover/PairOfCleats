import fs from 'node:fs/promises';

import { decodeVarint64List, encodeVarint64, encodeVarint64List } from './varint.js';
import { toArray } from '../iterables.js';
import { createTempPath, replaceFile } from '../io/atomic-persistence.js';

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
  const maxPreallocateBytes = input?.maxPreallocateBytes == null
    ? MAX_BINARY_COLUMNAR_PREALLOCATE_BYTES
    : toBoundedNonNegativeInt(
      input.maxPreallocateBytes,
      MAX_BINARY_COLUMNAR_PREALLOCATE_BYTES
    );
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
    for (const row of toArray(rows)) {
      yield row;
    }
  })();
};

const writeAllToHandle = async (handle, payload, position) => {
  let offset = 0;
  while (offset < payload.length) {
    const result = await handle.write(
      payload,
      offset,
      payload.length - offset,
      Number.isFinite(position) ? position + offset : null
    );
    const bytesWritten = Number(result?.bytesWritten || 0);
    if (bytesWritten <= 0) {
      const err = new Error('Failed to write full binary payload: zero-byte write.');
      err.code = 'ERR_BINARY_COLUMNAR_SHORT_WRITE';
      throw err;
    }
    offset += bytesWritten;
  }
};

const removeTempPathIfPresent = async (targetPath) => {
  if (!targetPath) return;
  await fs.rm(targetPath, { force: true }).catch(() => {});
};

const replaceTempBinarySidecar = async (tempPath, targetPath) => {
  try {
    await replaceFile(tempPath, targetPath, { keepBackup: false });
  } catch (error) {
    await removeTempPathIfPresent(tempPath);
    throw error;
  }
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
  let cursor = 0;
  let count = 0;
  let flushMs = 0;
  let fsyncMs = 0;
  let publishMs = 0;
  const tempDataPath = createTempPath(dataPath);
  const tempOffsetsPath = createTempPath(offsetsPath);
  const tempLengthsPath = createTempPath(lengthsPath);
  const [dataHandle, offsetsHandle, lengthsHandle] = await Promise.all([
    fs.open(tempDataPath, 'wx'),
    fs.open(tempOffsetsPath, 'wx'),
    fs.open(tempLengthsPath, 'wx')
  ]);
  let wrotePayload = false;
  try {
    if (resolvedPreallocateBytes > 0) {
      await dataHandle.truncate(resolvedPreallocateBytes);
    }
    for await (const row of toAsyncIterable(rowBuffers)) {
      const payload = Buffer.isBuffer(row) ? row : Buffer.from(row || '');
      const rowOffset = cursor;
      cursor += payload.length;
      if (payload.length) {
        const payloadWriteStartedAt = Date.now();
        await writeAllToHandle(dataHandle, payload, rowOffset);
        flushMs += Math.max(0, Date.now() - payloadWriteStartedAt);
      }
      const offsetBuffer = Buffer.allocUnsafe(OFFSET_BYTES);
      offsetBuffer.writeBigUInt64LE(BigInt(rowOffset));
      const offsetWriteStartedAt = Date.now();
      await writeAllToHandle(offsetsHandle, offsetBuffer, null);
      flushMs += Math.max(0, Date.now() - offsetWriteStartedAt);
      const lengthWriteStartedAt = Date.now();
      await writeAllToHandle(lengthsHandle, encodeVarint64(payload.length), null);
      flushMs += Math.max(0, Date.now() - lengthWriteStartedAt);
      count += 1;
    }
    if (resolvedPreallocateBytes > 0 && cursor !== resolvedPreallocateBytes) {
      await dataHandle.truncate(cursor);
    }
    wrotePayload = true;
    const syncStartedAt = Date.now();
    await Promise.all([
      dataHandle.sync(),
      offsetsHandle.sync(),
      lengthsHandle.sync()
    ]);
    fsyncMs += Math.max(0, Date.now() - syncStartedAt);
  } finally {
    await Promise.allSettled([
      dataHandle.close(),
      offsetsHandle.close(),
      lengthsHandle.close()
    ]);
  }
  if (!wrotePayload) {
    await Promise.allSettled([
      removeTempPathIfPresent(tempDataPath),
      removeTempPathIfPresent(tempOffsetsPath),
      removeTempPathIfPresent(tempLengthsPath)
    ]);
    throw new Error('Failed to materialize binary-columnar payload.');
  }
  try {
    const publishStartedAt = Date.now();
    await replaceTempBinarySidecar(tempOffsetsPath, offsetsPath);
    await replaceTempBinarySidecar(tempLengthsPath, lengthsPath);
    await replaceTempBinarySidecar(tempDataPath, dataPath);
    publishMs += Math.max(0, Date.now() - publishStartedAt);
  } catch (error) {
    await Promise.allSettled([
      removeTempPathIfPresent(tempDataPath),
      removeTempPathIfPresent(tempOffsetsPath),
      removeTempPathIfPresent(tempLengthsPath)
    ]);
    throw error;
  }
  return {
    count,
    totalBytes: cursor,
    preallocatedBytes: resolvedPreallocateBytes,
    phaseTimings: {
      computeMs: 0,
      serializationMs: 0,
      compressionMs: 0,
      flushMs,
      fsyncMs,
      publishMs,
      manifestWaitMs: 0,
      backpressureWaitMs: 0
    }
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
