import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { assertNoSymlinkPath, verifyContainedFileHandle } from '../../../src/shared/contained-file.js';

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
  assertNoSymlinkPath(parentDir, parentDir);
  const directory = await fsp.mkdtemp(path.join(parentDir, '.stage3-vector-spool-'));
  const bytesPerWindow = Math.max(dims, Math.floor(Math.min(MAX_WINDOW_BYTES, windowBytes) / dims) * dims);
  const rowsPerWindow = Math.max(1, Math.floor(bytesPerWindow / dims));
  const handles = {}, filenames = {}, presence = {}, seals = {}, windows = {};
  const reserved = Buffer.alloc(Math.ceil(count / 8)), occupied = Buffer.alloc(reserved.length);
  const operations = new Set();
  let sealed = false, closed = false, firstFailure = null, closing = null;
  let durabilityFlush = null, requestedDurability = 0, settledDurability = 0;
  let writeBuffered = 0;
  const work = { count, dims, logicalPayloadBytes: count * dims * 3, bitmapBytes: reserved.length * 5,
    rowsWritten: 0, writeCalls: 0, bytesWritten: 0, readCalls: 0, bytesRead: 0, durabilityBatches: 0,
    peakWriteBufferedBytes: 0, readWindowBytes: bytesPerWindow, currentReadBufferedBytes: 0,
    peakReadBufferedBytes: 0, retainedCorpusVectorBytes: 0, presentRows: { code: 0, doc: 0, merged: 0 } };
  const assertOpen = () => { throwIfAborted(signal); if (closed) throw failure('Vector spool is closed.'); };
  const removeOwnedDirectory = async () => {
    // Recursive removal always checks the exact nonce directory in its named
    // parent; never reconstruct a deletion target from artifact metadata.
    assertNoSymlinkPath(parentDir, directory, { allowMissing: true });
    if (path.dirname(directory) !== path.resolve(parentDir) || !path.basename(directory).startsWith('.stage3-vector-spool-')) throw failure('Vector spool cleanup escaped its attempt parent.');
    await fsp.rm(directory, { recursive: true, force: true });
  };
  try {
    for (const channel of CHANNELS) {
      const filename = path.join(directory, `${channel}.uint8`);
      filenames[channel] = filename;
      assertNoSymlinkPath(parentDir, filename, { allowMissing: true });
      handles[channel] = await fsp.open(filename, 'wx+', 0o600);
      verifyContainedFileHandle(handles[channel], parentDir, filename);
      await handles[channel].truncate(count * dims);
      presence[channel] = Buffer.alloc(reserved.length);
    }
  } catch (error) {
    const cleanup = [];
    for (const handle of Object.values(handles)) try { await handle.close(); } catch (cause) { cleanup.push(cause); }
    try { await removeOwnedDirectory(); } catch (cause) { cleanup.push(cause); }
    if (cleanup.length) {
      error.spoolCleanupErrors = cleanup; error.cacheOwnershipPending = true;
      error.vectorSpoolPath = directory; error.vectorSpoolHandles = Object.values(handles);
    }
    throw error;
  }
  const transferDurableOwnership = async () => {
    const target = ++requestedDurability;
    while (settledDurability < target) {
      if (!durabilityFlush) durabilityFlush = (async () => {
        // Coalesce completed files in one dispatcher turn; an in-flight file
        // joins a later durability boundary after all its own writes finish.
        await yieldEventLoop(); assertOpen();
        const current = requestedDurability;
        for (const channel of CHANNELS) await handles[channel].sync();
        work.durabilityBatches++; settledDurability = current;
      })().finally(() => { durabilityFlush = null; });
      await durabilityFlush;
    }
  };

  const writeRows = async (items, vectors) => {
    assertOpen();
    if (sealed || firstFailure) throw firstFailure || failure('Cannot write a sealed vector spool.');
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
            const handle = handles[channel], position = items[cursor].index * dims;
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
    } catch (error) { firstFailure ||= error; throw error; }
  };

  const read = (channel, index) => {
    assertOpen();
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
  return {
    directory, vectors,
    writeFile(items, channels) {
      const operation = writeRows(items, channels).catch(error => { error.vectorSpoolFailure = true; throw error; }); operations.add(operation);
      operation.then(() => operations.delete(operation), () => operations.delete(operation));
      return operation;
    },
    async seal() {
      assertOpen();
      if (firstFailure) throw firstFailure;
      if (operations.size) throw failure('Cannot seal while file writes still own spool ranges.');
      if (sealed) return;
      for (const channel of CHANNELS) {
        await handles[channel].sync();
        verifyContainedFileHandle(handles[channel], parentDir, filenames[channel]);
        seals[channel] = await handles[channel].stat({ bigint: true });
        if (seals[channel].size !== BigInt(count * dims)) throw failure('Vector spool sealed length disagrees with its identity.');
      }
      throwIfAborted(signal); sealed = true;
    },
    stats: () => ({ ...work, presentRows: { ...work.presentRows }, sealed, closed, pendingWrites: operations.size }),
    close() {
      if (!closing) closing = (async () => {
        closed = true;
        await Promise.allSettled([...operations]);
        const cleanup = [];
        for (const handle of Object.values(handles)) try { await handle.close(); } catch (error) { cleanup.push(error); }
        if (!cleanup.length) try { await removeOwnedDirectory(); } catch (error) { cleanup.push(error); }
        for (const channel of CHANNELS) delete windows[channel];
        work.currentReadBufferedBytes = 0;
        if (cleanup.length) throw Object.assign(new AggregateError(cleanup, 'Vector spool cleanup failed.'), { vectorSpoolPath: directory, cacheOwnershipPending: true });
      })();
      return closing;
    }
  };
};
