import fs from 'node:fs/promises';
import path from 'node:path';

import { decodeVarint64List, encodeVarint64Into, encodeVarint64List } from './varint.js';
import { throwIfAborted } from '../abort.js';
import { createContainedFileResource } from '../contained-file-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../io/file-identity.js';
import { assertDirectoryIdentity, syncParentDirectory } from '../io/directory-sync.js';
import { readPersistenceFailureCode, retainPersistenceFailure } from '../io/persistence-helpers.js';

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

const unconfirmed = message => Object.assign(new Error(message), { cacheOwnershipPending: true });
const sameObject = (stat, sealed) => {
  const current = persistenceFileIdentity(stat);
  if (['dev', 'ino', 'mode', 'birthtime'].some(field => current[field] !== sealed[field])) throw Object.assign(
    new Error('Binary frame path no longer identifies its original created file.'), { code: 'ERR_BINARY_COLUMNAR_FILE_CHANGED' });
  return current;
};
const openRowSource = rows => {
  const asyncFactory = rows?.[Symbol.asyncIterator];
  const asynchronous = typeof asyncFactory === 'function';
  const syncFactory = asynchronous ? null : rows?.[Symbol.iterator];
  const iterator = asynchronous ? asyncFactory.call(rows) : typeof syncFactory === 'function' ? syncFactory.call(rows) : [][Symbol.iterator]();
  let closed = false, returnAttempted = false;
  const next = iterator.next, close = iterator.return;
  if (typeof next !== 'function' || close != null && typeof close !== 'function') throw new TypeError('Invalid binary row iterator methods.');
  const step = async method => {
    const result = await method.call(iterator);
    if (result === null || !['object', 'function'].includes(typeof result)) throw unconfirmed('Binary row iterator returned an unconfirmed protocol result.');
    const done = Boolean(result.done);
    const value = asynchronous ? result.value : await result.value;
    return { done, value };
  };
  return Object.freeze({
    isClosed: () => closed,
    next: async () => { const result = await step(next); if (result.done) closed = true; return result; },
    close: async () => {
      if (closed) return;
      if (returnAttempted) throw unconfirmed('Original binary row iterator return cannot be implicitly retried.');
      returnAttempted = true;
      if (close == null) { closed = true; return; }
      const result = await step(close);
      if (!result.done) throw unconfirmed('Original binary row iterator return did not confirm completion.');
      closed = true;
    }
  });
};
const writeAllToHandle = async (handle, payload, position) => {
  let offset = 0;
  while (offset < payload.length) {
    const result = await handle.write(payload, offset, payload.length - offset,
      Number.isFinite(position) ? position + offset : null);
    const bytesWritten = result?.bytesWritten;
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > payload.length - offset) throw Object.assign(
      new Error('Failed to write full binary payload: invalid write progress.'), { code: 'ERR_BINARY_COLUMNAR_SHORT_WRITE' });
    offset += bytesWritten;
  }
};

/**
 * Stream bounded row frames and sidecars through their original descriptor owners.
 * This preserves individual publication boundaries, not a multi-file transaction.
 */
export const writeBinaryRowFrames = async ({
  rowBuffers, dataPath, offsetsPath, lengthsPath, preallocateBytes = null, writeHints = null, signal = null
}) => {
  const { createTempPath } = await import('../io/temp-path.js');
  const { replaceFile } = await import('../io/replace-file.js');
  const resolvedPreallocateBytes = toBoundedNonNegativeInt(preallocateBytes ?? writeHints?.preallocateBytes, MAX_BINARY_COLUMNAR_PREALLOCATE_BYTES);
  const entries = [], observations = [], errors = [];
  let source = null, sourceClosed = true, primaryPresent = false, primary, observationOverflow = false;
  let originalPrerequisites = Object.freeze([]), originalOverflow = false;
  const sourceRecovery = [];
  let cursor = 0, count = 0, totalLengthBytes = 0, flushMs = 0, fsyncMs = 0, publishMs = 0;
  const overflow = unconfirmed('Binary frame original failure history exceeded its bounded limit.');
  const remember = (error, phase) => {
    if (!primaryPresent) { primaryPresent = true; primary = error; }
    if (observations.length === 128) { observationOverflow = true; return; }
    errors.push(error); observations.push(observeStorageResource(error, { phase }));
  };
  const requireOriginals = () => {
    if (observationOverflow) throw overflow;
    for (const observation of observations) observation.requireSettled();
  };
  const requireMetadata = () => {
    requireOriginals();
    if (!sourceClosed || entries.some(entry => entry.owner && !entry.owner.isSettled())) {
      const previous = Object.freeze([...observations]);
      throw Object.assign(new Error('Original binary frame source or descriptor work prohibits publication/cleanup.'), {
        cacheOwnershipPending: true, cacheOwnershipReleased: () => sourceClosed && !observationOverflow
          && entries.every(entry => !entry.owner || entry.owner.isSettled()) && previous.every(observation => observation.isSettled())
      });
    }
  };
  const create = async final => {
    const temp = createTempPath(final), entry = { temp, final, owner: null, original: null, sealed: null, published: false, expectedBytes: null };
    entries.push(entry); requireOriginals();
    entry.tempParent = await fs.lstat(path.dirname(temp), { bigint: true }); assertDirectoryIdentity(entry.tempParent);
    entry.finalParent = await fs.lstat(path.dirname(final), { bigint: true }); assertDirectoryIdentity(entry.finalParent);
    const handle = await fs.open(temp, 'wx');
    entry.owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['write', 'sync', 'truncate'] });
    if (entry.owner.hasFailure()) throw new Error('Original binary descriptor methods were not completely captured.');
    entry.original = persistenceFileIdentity(await entry.owner.operations.stat({ bigint: true }));
    if (entry.original.size !== '0') throw new Error('Binary staging file was not admitted as empty.');
    return entry;
  };
  const voidResult = (value, operation) => { if (value !== undefined) throw unconfirmed('Original binary frame ' + operation + ' did not confirm its standard void result.'); };
  try {
    throwIfAborted(signal); sourceClosed = false; source = openRowSource(rowBuffers); sourceClosed = source.isClosed();
    const data = await create(dataPath), offsets = await create(offsetsPath), lengths = await create(lengthsPath);
    const dataHandle = data.owner.operations, offsetsHandle = offsets.owner.operations, lengthsHandle = lengths.owner.operations;
    if (resolvedPreallocateBytes > 0) voidResult(await dataHandle.truncate(resolvedPreallocateBytes), 'preallocation');
    const dataBlock = Buffer.allocUnsafe(1024 * 1024), offsetBlock = Buffer.allocUnsafe(256 * OFFSET_BYTES), lengthBlock = Buffer.allocUnsafe(256 * 10);
    let dataUsed = 0, batchRows = 0, lengthUsed = 0, batchStart = 0;
    const flush = async () => {
      if (!batchRows) return;
      throwIfAborted(signal); requireOriginals(); const started = Date.now();
      if (dataUsed) await writeAllToHandle(dataHandle, dataBlock.subarray(0, dataUsed), batchStart);
      await writeAllToHandle(offsetsHandle, offsetBlock.subarray(0, batchRows * OFFSET_BYTES), null);
      await writeAllToHandle(lengthsHandle, lengthBlock.subarray(0, lengthUsed), null);
      totalLengthBytes += lengthUsed; flushMs += Math.max(0, Date.now() - started);
      dataUsed = 0; batchRows = 0; lengthUsed = 0; batchStart = cursor;
    };
    for (;;) {
      throwIfAborted(signal); requireOriginals(); const next = await source.next();
      if (next.done) { sourceClosed = true; break; }
      const payload = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value || '');
      if (batchRows && (batchRows === 256 || dataUsed + payload.length > dataBlock.length)) await flush();
      const rowOffset = cursor; cursor += payload.length;
      if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(count + 1)) throw new RangeError('Binary row offsets exceed safe numeric bounds.');
      if (payload.length > dataBlock.length) {
        const started = Date.now(); await writeAllToHandle(dataHandle, payload, rowOffset); flushMs += Math.max(0, Date.now() - started);
      } else { payload.copy(dataBlock, dataUsed); dataUsed += payload.length; }
      offsetBlock.writeBigUInt64LE(BigInt(rowOffset), batchRows * OFFSET_BYTES);
      lengthUsed += encodeVarint64Into(payload.length, lengthBlock, lengthUsed); batchRows++; count++;
      if (payload.length > dataBlock.length) await flush();
    }
    await flush();
    if (resolvedPreallocateBytes > 0 && cursor !== resolvedPreallocateBytes) voidResult(await dataHandle.truncate(cursor), 'truncate');
    data.expectedBytes = cursor; offsets.expectedBytes = count * OFFSET_BYTES; lengths.expectedBytes = totalLengthBytes;
    const started = Date.now();
    const synced = await Promise.allSettled(entries.map(async entry => {
      voidResult(await entry.owner.operations.sync(), 'sync');
      const stat = await entry.owner.operations.stat({ bigint: true }); sameObject(stat, entry.original);
      if (stat.size !== BigInt(entry.expectedBytes)) throw new Error('Binary frame descriptor extent differs from its completed payload.');
    }));
    for (const result of synced) if (result.status === 'rejected') remember(result.reason, 'binary-frame-sync');
    fsyncMs += Math.max(0, Date.now() - started);
  } catch (error) { remember(error, 'binary-frame-materialize'); }
  finally {
    if (source && !sourceClosed) {
      try { requireOriginals(); await source.close(); sourceClosed = source.isClosed(); }
      catch (error) { remember(error, 'binary-frame-source-close'); }
    }
    // Freeze only original operation/source prerequisites. Later same-owner
    // outward close failures must never be fed back into their own close guards.
    originalPrerequisites = Object.freeze([...observations]); originalOverflow = observationOverflow;
    const prerequisite = Object.freeze({ cacheOwnershipPending: true,
      cacheOwnershipReleased: () => sourceClosed && !originalOverflow && originalPrerequisites.every(observation => observation.isSettled())
        && sourceRecovery.every(observation => observation.isSettled()) });
    if (originalPrerequisites.length || !sourceClosed || originalOverflow) {
      for (const entry of entries) entry.owner?.remember(prerequisite);
    }
    const closed = await Promise.allSettled(entries.filter(entry => entry.owner).map(entry => entry.owner.run(() => undefined)));
    for (const result of closed) if (result.status === 'rejected') remember(result.reason, 'binary-frame-close');
  }
  const cleanup = async entry => {
    if (entry.published || !entry.original) return;
    requireMetadata(); assertDirectoryIdentity(await fs.lstat(path.dirname(entry.temp), { bigint: true }), entry.tempParent);
    let stat;
    try { stat = await fs.lstat(entry.temp, { bigint: true }); }
    catch (error) { if (readPersistenceFailureCode(error) === 'ENOENT') { requireMetadata(); return; } throw error; }
    requireMetadata(); sameObject(stat, entry.original);
    assertDirectoryIdentity(await fs.lstat(path.dirname(entry.temp), { bigint: true }), entry.tempParent); requireMetadata();
    voidResult(await fs.rm(entry.temp, { force: true }), 'cleanup'); requireMetadata();
  };
  if (!primaryPresent) {
    try {
      requireMetadata(); throwIfAborted(signal);
      for (const entry of entries) {
        const stat = await fs.lstat(entry.temp, { bigint: true }); requireMetadata();
        entry.sealed = sameObject(stat, entry.original);
        if (stat.size !== BigInt(entry.expectedBytes)) throw new Error('Closed binary frame extent changed before publication.');
      }
      const started = Date.now();
      // Preserve existing offsets, lengths, data publication order.
      for (const entry of [entries[1], entries[2], entries[0]]) {
        requireMetadata(); throwIfAborted(signal);
        assertDirectoryIdentity(await fs.lstat(path.dirname(entry.temp), { bigint: true }), entry.tempParent);
        assertDirectoryIdentity(await fs.lstat(path.dirname(entry.final), { bigint: true }), entry.finalParent);
        requireMetadata(); assertPersistenceFileIdentity(await fs.lstat(entry.temp, { bigint: true }), entry.sealed); requireMetadata();
        await replaceFile(entry.temp, entry.final, { keepBackup: false, requireSettled: requireMetadata }); entry.published = true;
        await syncParentDirectory(entry.final, { expectedParent: entry.finalParent }); requireMetadata();
      }
      publishMs += Math.max(0, Date.now() - started);
    } catch (error) { remember(error, 'binary-frame-publication'); }
  }
  if (primaryPresent) {
    for (const entry of entries) {
      try { await cleanup(entry); } catch (error) { remember(error, 'binary-frame-cleanup'); }
    }
    const sourceClose = Object.freeze({ isClosed: () => sourceClosed, close: async () => {
      if (sourceClosed) return { closed: true };
      if (!source) throw new Error('Original binary row iterator methods were not captured; closure cannot be reconstructed.');
      try {
        if (originalOverflow) throw overflow;
        for (const observation of [...originalPrerequisites, ...sourceRecovery]) observation.requireSettled();
        await source.close(); sourceClosed = source.isClosed(); return { closed: sourceClosed };
      } catch (error) {
        if (sourceRecovery.length === 64) { observationOverflow = true; throw overflow; }
        sourceRecovery.push(observeStorageResource(error, { phase: 'binary-frame-source-recovery' })); throw error;
      }
    } });
    const failure = retainPersistenceFailure(primary, [...errors.filter(error => error !== primary),
      ...observations.map(observation => observation.retain()), ...(observationOverflow ? [overflow] : [])], {
      binaryColumnarTemporaryPaths: Object.freeze(entries.filter(entry => !entry.published).map(entry => entry.temp)),
      binaryColumnarPublishedPaths: Object.freeze(entries.filter(entry => entry.published).map(entry => entry.final)),
      binaryColumnarSourceClosed: sourceClosed, binaryColumnarSourceClose: sourceClose,
      cacheOwnershipPending: true, cacheOwnershipReleased: () => sourceClosed && !observationOverflow
        && sourceRecovery.every(observation => observation.isSettled())
    });
    Object.defineProperty(failure, 'binaryColumnarSourceClose', { value: sourceClose, configurable: false, writable: false, enumerable: false });
    throw failure;
  }
  return { count, totalBytes: cursor, preallocatedBytes: resolvedPreallocateBytes, phaseTimings: {
    computeMs: 0, serializationMs: 0, compressionMs: 0, flushMs, fsyncMs, publishMs, manifestWaitMs: 0, backpressureWaitMs: 0
  } };
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
