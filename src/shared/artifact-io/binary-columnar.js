import fs from 'node:fs/promises';

import { decodeVarint64List, encodeVarint64Into, encodeVarint64List } from './varint.js';
import { throwIfAborted } from '../abort.js';

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
    const iterable = rows && typeof rows[Symbol.iterator] === 'function' ? rows : [];
    for (const row of iterable) {
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
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > payload.length-offset) {
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
  const { replaceFile } = await import('../io/replace-file.js');
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
  writeHints = null,
  signal = null
}) => {
  const { createTempPath } = await import('../io/temp-path.js');
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
  let dataHandle=null,offsetsHandle=null,lengthsHandle=null,primaryError=null;
  let wrotePayload = false;
  try {
    throwIfAborted(signal);
    dataHandle=await fs.open(tempDataPath,'wx');
    offsetsHandle=await fs.open(tempOffsetsPath,'wx');
    lengthsHandle=await fs.open(tempLengthsPath,'wx');
    if (resolvedPreallocateBytes > 0) {
      await dataHandle.truncate(resolvedPreallocateBytes);
    }
    const dataBlock=Buffer.allocUnsafe(1024*1024),offsetBlock=Buffer.allocUnsafe(256*OFFSET_BYTES),lengthBlock=Buffer.allocUnsafe(256*10);
    let dataUsed=0,batchRows=0,lengthUsed=0,batchStart=0;
    const flush=async()=>{
      if(!batchRows)return;
      throwIfAborted(signal);
      const started=Date.now();
      if(dataUsed)await writeAllToHandle(dataHandle,dataBlock.subarray(0,dataUsed),batchStart);
      await writeAllToHandle(offsetsHandle,offsetBlock.subarray(0,batchRows*OFFSET_BYTES),null);
      await writeAllToHandle(lengthsHandle,lengthBlock.subarray(0,lengthUsed),null);
      flushMs+=Math.max(0,Date.now()-started);
      dataUsed=0;batchRows=0;lengthUsed=0;batchStart=cursor;
    };
    for await (const row of toAsyncIterable(rowBuffers)) {
      throwIfAborted(signal);
      const payload = Buffer.isBuffer(row) ? row : Buffer.from(row || '');
      if(batchRows && (batchRows===256 || dataUsed+payload.length>dataBlock.length))await flush();
      const rowOffset = cursor;
      cursor += payload.length;
      if (payload.length>dataBlock.length) {
        const payloadWriteStartedAt = Date.now();
        await writeAllToHandle(dataHandle, payload, rowOffset);
        flushMs += Math.max(0, Date.now() - payloadWriteStartedAt);
      }else{payload.copy(dataBlock,dataUsed);dataUsed+=payload.length;}
      offsetBlock.writeBigUInt64LE(BigInt(rowOffset),batchRows*OFFSET_BYTES);
      lengthUsed+=encodeVarint64Into(payload.length,lengthBlock,lengthUsed);
      batchRows+=1;
      count += 1;
      if(payload.length>dataBlock.length)await flush();
    }
    await flush();
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
  } catch(error) { primaryError=error; }
  finally {
    const closed=await Promise.allSettled([dataHandle,offsetsHandle,lengthsHandle].filter(Boolean).map(handle=>handle.close()));
    const closeErrors=closed.filter(result=>result.status==='rejected').map(result=>result.reason);
    if(closeErrors.length){if(primaryError)primaryError.cleanupErrors=[...(primaryError.cleanupErrors||[]),...closeErrors];
    else primaryError=new AggregateError(closeErrors,'Binary row frame close failed.');}
  }
  if (primaryError || !wrotePayload) {
    await Promise.allSettled([
      removeTempPathIfPresent(tempDataPath),
      removeTempPathIfPresent(tempOffsetsPath),
      removeTempPathIfPresent(tempLengthsPath)
    ]);
    throw primaryError || new Error('Failed to materialize binary-columnar payload.');
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
