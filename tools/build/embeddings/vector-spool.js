import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { verifyContainedFileHandle } from '../../../src/shared/contained-file.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { allocateVectorSpoolLifetime } from './vector-spool-lifetime.js';

const CHANNELS = ['code', 'doc', 'merged'];
const MAX_WINDOW_BYTES = 16 * 1024 * 1024;
const MAX_BITMAP_BYTES = 16 * 1024 * 1024;
const empty = new Uint8Array(0);
const failure = message => Object.assign(new Error(message), { code: 'ERR_EMBEDDING_VECTOR_SPOOL' });
const bit = (bits, index) => Boolean(bits[index >> 3] & (1 << (index & 7)));
const set = (bits, index) => { bits[index >> 3] |= 1 << (index & 7); };
const sameStat = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const indexKey = property => typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property) ? Number(property) : null;

/** An attempt-owned fixed-width spool. No vector payload array grows with N.
 * Input rows remain borrowed/read-only until writeFile settles; each written
 * window copies bytes without transferring or detaching caller buffers.
 */
export const createEmbeddingVectorSpool = async ({ parentDir, count, dims, signal = null,
  windowBytes = 1024 * 1024 } = {}) => {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(dims) || dims <= 0 || dims > MAX_WINDOW_BYTES
    || !Number.isSafeInteger(count * dims) || !Number.isSafeInteger(windowBytes) || windowBytes <= 0
    || Math.ceil(count / 8) * 5 > MAX_BITMAP_BYTES) throw failure('Vector spool dimensions/count/window exceed bounded authority.');
  throwIfAborted(signal);
  parentDir = path.resolve(parentDir);
  const bytesPerWindow = Math.max(dims, Math.floor(Math.min(MAX_WINDOW_BYTES, windowBytes) / dims) * dims);
  const rowsPerWindow = Math.max(1, Math.floor(bytesPerWindow / dims));
  const handles = {}, fileOwners = {}, fileOperations = {}, filenames = {}, presence = {}, seals = {}, windows = {};
  const reserved = Buffer.alloc(Math.ceil(count / 8)), occupied = Buffer.alloc(reserved.length);
  const operations = new Set();
  let sealed = false, closed = false, firstFailure = null, hasWriteFailure = false, closing = null;
  let durabilityFlush = null, requestedDurability = 0, settledDurability = 0;
  let writeBuffered = 0;
  const work = { count, dims, logicalPayloadBytes: count * dims * 3, bitmapBytes: reserved.length * 5,
    rowsWritten: 0, writeCalls: 0, bytesWritten: 0, readCalls: 0, bytesRead: 0, durabilityBatches: 0,
    peakWriteBufferedBytes: 0, readWindowBytes: bytesPerWindow, currentReadBufferedBytes: 0,
    peakReadBufferedBytes: 0, retainedCorpusVectorBytes: 0, presentRows: { code: 0, doc: 0, merged: 0 } };
  const assertOpen = () => { throwIfAborted(signal); if (closed) throw failure('Vector spool is closed.'); };
  const lifetime = await allocateVectorSpoolLifetime(parentDir, async () => {
    closed = true;
    await Promise.allSettled([...operations]);
  });
  const directory = lifetime.directory;
  try {
    for (const channel of CHANNELS) {
      const opened = await lifetime.open(channel);
      filenames[channel] = opened.filename; handles[channel] = opened.handle;
      fileOwners[channel] = opened.resource; fileOperations[channel] = opened.operations;
      await opened.operations.truncate(count * dims);
      presence[channel] = Buffer.alloc(reserved.length);
    }
  } catch (error) {
    lifetime.remember(error);
    try { await lifetime.close(); }
    catch (cleanup) { throw lifetime.retain(error, [cleanup]); }
    throw lifetime.retain(error);
  }
  const transferDurableOwnership = async () => {
    const target = ++requestedDurability;
    while (settledDurability < target) {
      if (!durabilityFlush) durabilityFlush = (async () => {
        // Coalesce completed files in one dispatcher turn; an in-flight file
        // joins a later durability boundary after all its own writes finish.
        await yieldEventLoop(); assertOpen();
        const current = requestedDurability;
        for (const channel of CHANNELS) await fileOperations[channel].sync();
        work.durabilityBatches++; settledDurability = current;
      })().finally(() => { durabilityFlush = null; });
      await durabilityFlush;
    }
  };

  const writeRows = async (items, vectors) => {
    assertOpen();
    if (hasWriteFailure) throw firstFailure;
    if (sealed) throw failure('Cannot write a sealed vector spool.');
    if (!Array.isArray(items) || CHANNELS.some(channel => !Array.isArray(vectors[channel]) || vectors[channel].length !== items.length)) throw failure('Spool file channel counts disagree.');
    const local = new Set();
    for (let offset = 0; offset < items.length; offset++) {
      const index = items[offset]?.index;
      if (!Number.isSafeInteger(index) || index < 0 || index >= count || bit(reserved, index) || local.has(index)) throw failure('Duplicate or invalid spool ordinal.');
      local.add(index);
      for (const channel of CHANNELS) {
        const vector = vectors[channel][offset];
        if (!Array.isArray(vector) && !(ArrayBuffer.isView(vector) && !(vector instanceof DataView))) throw failure('Spool input is not a quantized row.');
        if (vector.length && vector.length !== dims) throw failure('Spool input width disagrees with selected dimensions.');
        for (const value of vector) if (!Number.isInteger(value) || value < 0 || value > 255) throw failure('Spool input contains invalid uint8 values.');
      }
    }
    for (const index of local) set(reserved, index);
    try {
      for (const channel of CHANNELS) {
        for (let cursor = 0; cursor < items.length;) {
          assertOpen();
          let stop = cursor + 1;
          while (stop < items.length && stop - cursor < rowsPerWindow && items[stop].index === items[stop - 1].index + 1) stop++;
          const buffer = Buffer.alloc((stop - cursor) * dims);
          writeBuffered += buffer.length;
          work.peakWriteBufferedBytes = Math.max(work.peakWriteBufferedBytes, writeBuffered);
          try {
            for (let row = cursor; row < stop; row++) if (vectors[channel][row].length) buffer.set(vectors[channel][row], (row - cursor) * dims);
            const handle = fileOperations[channel], position = items[cursor].index * dims;
            let offset = 0;
            while (offset < buffer.length) {
              assertOpen();
              const remaining = buffer.length - offset;
              const { bytesWritten } = await handle.write(buffer, offset, remaining, position + offset);
              if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) throw failure('Vector spool write made invalid forward progress.');
              offset += bytesWritten; work.writeCalls++; work.bytesWritten += bytesWritten;
            }
            for (let row = cursor; row < stop; row++) if (vectors[channel][row].length) {
              set(presence[channel], items[row].index); work.presentRows[channel]++;
            }
          } finally { writeBuffered -= buffer.length; }
          cursor = stop;
        }
      }
      await transferDurableOwnership();
      for (const index of local) set(occupied, index);
      work.rowsWritten += items.length;
    } catch (error) { if (!hasWriteFailure) { firstFailure = error; hasWriteFailure = true; } throw error; }
  };

  const read = (channel, index) => {
    assertOpen();
    return fileOwners[channel].inspect(() => {
      if (!sealed) throw failure('Vector spool cannot be read before durable sealing.');
      if (index < 0 || index >= count || !Number.isSafeInteger(index)) return undefined;
      if (!bit(occupied, index) || !bit(presence[channel], index)) return empty;
      let window = windows[channel];
      const start = Math.floor(index / rowsPerWindow) * rowsPerWindow;
      if (!window || window.start !== start) {
        const handle = handles[channel], filename = filenames[channel];
        verifyContainedFileHandle(handle, parentDir, filename);
        if (!sameStat(seals[channel], fs.fstatSync(handle.fd, { bigint: true }))) throw failure('Sealed vector spool changed during consumption.');
        const rows = Math.min(rowsPerWindow, count - start), buffer = Buffer.alloc(rows * dims);
        let offset = 0;
        while (offset < buffer.length) {
          throwIfAborted(signal);
          const remaining = buffer.length - offset;
          const readBytes = fs.readSync(handle.fd, buffer, offset, remaining, start * dims + offset);
          if (!Number.isSafeInteger(readBytes) || readBytes <= 0 || readBytes > remaining) throw failure('Vector spool read made invalid forward progress.');
          offset += readBytes; work.readCalls++; work.bytesRead += readBytes;
        }
        verifyContainedFileHandle(handle, parentDir, filename);
        if (!sameStat(seals[channel], fs.fstatSync(handle.fd, { bigint: true }))) throw failure('Sealed vector spool changed during its range read.');
        work.currentReadBufferedBytes += buffer.length - (window?.buffer.length || 0);
        work.peakReadBufferedBytes = Math.max(work.peakReadBufferedBytes, work.currentReadBufferedBytes);
        // Never overwrite a previous window: consumers may still own its views.
        window = { start, buffer }; windows[channel] = window;
      }
      return new Uint8Array(window.buffer.buffer, window.buffer.byteOffset + (index - start) * dims, dims);
    });
  };
  // Read-only virtual arrays preserve existing ordinal/iterator consumers and
  // Array.isArray contracts without allocating N slots or retaining N row views.
  const vectors = Object.fromEntries(CHANNELS.map(channel => [channel, new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') return count;
      if (property === 'ranges') return function* ranges() {
        assertOpen();
        if (!sealed) throw failure('Vector spool cannot be read before durable sealing.');
        for (let start = 0; start < count; start += rowsPerWindow) {
          const stop = Math.min(count, start + rowsPerWindow);
          yield { start, count: stop - start, *[Symbol.iterator]() {
            for (let index = start; index < stop; index++) yield read(channel, index);
          } };
        }
      };
      const index = indexKey(property);
      return index !== null ? read(channel, index) : Reflect.get(target, property, receiver);
    },
    has(target, property) { const index = indexKey(property); return index !== null ? index < count : Reflect.has(target, property); },
    set() { throw failure('Spool vector sequences are read-only; write through completed file admission.'); },
    defineProperty() { throw failure('Spool vector sequences are read-only.'); },
    deleteProperty() { throw failure('Spool vector sequences are read-only.'); }
  })]));
  const releaseWindows = () => {
    for (const channel of CHANNELS) delete windows[channel];
    work.currentReadBufferedBytes = 0;
  };
  return Object.freeze({
    directory, vectors,
    isSettled: lifetime.isSettled,
    isRetiring: () => closed,
    writeFile(items, channels) {
      if (closed) return Promise.reject(addStorageFailureContext(failure('Vector spool is closed.'), { vectorSpoolFailure: true }));
      const operation = writeRows(items, channels).catch(error => {
        lifetime.remember(error);
        const context = addStorageFailureContext(error, { vectorSpoolFailure: true });
        if (hasWriteFailure && firstFailure === error) firstFailure = context;
        throw context;
      }); operations.add(operation);
      operation.then(() => operations.delete(operation), () => operations.delete(operation));
      return operation;
    },
    async seal() {
      assertOpen();
      if (hasWriteFailure) throw firstFailure;
      if (operations.size) throw failure('Cannot seal while file writes still own spool ranges.');
      if (sealed) return;
      for (const channel of CHANNELS) {
        await fileOperations[channel].sync();
        fileOwners[channel].inspect(() => verifyContainedFileHandle(handles[channel], parentDir, filenames[channel]));
        seals[channel] = await fileOperations[channel].stat({ bigint: true });
        if (seals[channel].size !== BigInt(count * dims)) throw failure('Vector spool sealed length disagrees with its identity.');
      }
      throwIfAborted(signal); sealed = true;
    },
    stats: () => ({ ...work, presentRows: { ...work.presentRows }, sealed, closed: lifetime.isSettled(), retiring: closed, pendingWrites: operations.size }),
    close() {
      closed = true;
      if (!closing) closing = lifetime.close().then(releaseWindows);
      return lifetime.isSettled() ? Promise.resolve() : closing;
    },
    async recoverAfterClose() {
      closed = true;
      const receipt = await lifetime.recoverAfterClose(); releaseWindows(); return receipt;
    }
  });
};
