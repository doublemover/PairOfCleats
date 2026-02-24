import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { createTempPath, replaceFile } from './atomic.js';
import { createFflateGzipStream, createZstdStream, normalizeHighWaterMark } from './compress.js';
import { createAbortError } from './runtime.js';

const JSON_STREAM_WAIT_TIMEOUT_SYMBOL = Symbol.for('pairofcleats.json_stream_wait_timeout_ms');
const DEFAULT_JSON_STREAM_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

const coerceOptionalNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const resolveJsonStreamWaitTimeoutMs = (value = null) => (
  coerceOptionalNonNegativeInt(value)
  ?? coerceOptionalNonNegativeInt(process.env.PAIROFCLEATS_JSON_STREAM_WAIT_TIMEOUT_MS)
  ?? DEFAULT_JSON_STREAM_WAIT_TIMEOUT_MS
);

const createStreamWaitTimeoutError = ({ event, timeoutMs, label = null } = {}) => {
  const target = label || event || 'stream-wait';
  const err = new Error(`[json-stream] ${target} timed out after ${timeoutMs}ms.`);
  err.code = 'JSON_STREAM_WAIT_TIMEOUT';
  err.retryable = false;
  err.meta = { event: event || null, timeoutMs, label: label || null };
  return err;
};

const waitForEventWithTimeout = async ({ stream, event, timeoutMs, label = null }) => {
  const waitPromise = once(stream, event);
  if (!Number.isFinite(Number(timeoutMs)) || timeoutMs <= 0) {
    await waitPromise;
    return;
  }
  let timer = null;
  try {
    await Promise.race([
      waitPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(createStreamWaitTimeoutError({ event, timeoutMs, label }));
        }, timeoutMs);
        if (typeof timer?.unref === 'function') timer.unref();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Await one stream event with bounded timeout.
 *
 * @param {import('node:events').EventEmitter} stream
 * @param {string} event
 * @param {{timeoutMs?:number|null,label?:string|null}} [options]
 * @returns {Promise<void>}
 */
export const waitForStreamEvent = async (stream, event, options = {}) => {
  const timeoutMs = resolveJsonStreamWaitTimeoutMs(
    options?.timeoutMs ?? stream?.[JSON_STREAM_WAIT_TIMEOUT_SYMBOL]
  );
  await waitForEventWithTimeout({
    stream,
    event,
    timeoutMs,
    label: typeof options?.label === 'string' && options.label.trim()
      ? options.label.trim()
      : `stream.${event}`
  });
};

/**
 * Write one chunk while honoring writable backpressure.
 *
 * @param {import('node:stream').Writable} stream
 * @param {string|Buffer|Uint8Array} chunk
 * @returns {Promise<void>}
 */
export const writeChunk = async (stream, chunk) => {
  if (!stream.write(chunk)) {
    await waitForStreamEvent(stream, 'drain', { label: 'writeChunk.drain' });
  }
};

/**
 * Await stream completion event (`finish` or `close`).
 *
 * @param {import('node:stream').Writable} stream
 * @param {boolean} [requireClose]
 * @returns {Promise<void>}
 */
const waitForFinish = async (stream, requireClose = false, timeoutMs = 0, label = null) => {
  const event = requireClose ? 'close' : 'finish';
  await waitForEventWithTimeout({
    stream,
    event,
    timeoutMs,
    label: label || (requireClose ? 'stream.close' : 'stream.finish')
  });
};

/**
 * Await stream close, swallowing close-race errors.
 *
 * @param {import('node:stream').Writable|null} stream
 * @returns {Promise<void>}
 */
const waitForClose = (stream, timeoutMs = 0) => {
  if (!stream) return Promise.resolve();
  if (stream.closed) return Promise.resolve();
  return waitForEventWithTimeout({
    stream,
    event: 'close',
    timeoutMs,
    label: 'stream.close'
  }).catch(() => {});
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENOTEMPTY']);
let pendingDeleteCounter = 0;
const MAX_PREALLOCATE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Clamp preallocation bytes to supported range.
 *
 * @param {unknown} value
 * @returns {number}
 */
const resolvePreallocateBytes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_PREALLOCATE_BYTES, Math.max(0, Math.floor(parsed)));
};

/**
 * Build a target-scoped tombstone name used when direct deletion fails.
 * Including the base file name prevents cleanup from touching unrelated files.
 *
 * @param {string} targetPath
 * @returns {string}
 */
const createPendingDeletePath = (targetPath) => {
  pendingDeleteCounter = (pendingDeleteCounter + 1) >>> 0;
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const nonce = `${Date.now()}-${process.pid}-${pendingDeleteCounter.toString(16)}`;
  return path.join(dir, `pending-delete-${base}-${nonce}`);
};

/**
 * Remove path with retries and fallback tombstone cleanup.
 *
 * @param {string} target
 * @param {{attempts?:number,baseDelayMs?:number,recursive?:boolean}} [options]
 * @returns {Promise<boolean>}
 */
const removePathWithRetry = async (target, {
  attempts = 40,
  baseDelayMs = 20,
  recursive = false
} = {}) => {
  const maxAttempts = Number.isFinite(Number(attempts)) ? Math.max(1, Math.floor(Number(attempts))) : 20;
  const delayBase = Number.isFinite(Number(baseDelayMs)) ? Math.max(1, Math.floor(Number(baseDelayMs))) : 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fsPromises.rm(target, { force: true, recursive });
      if (!fs.existsSync(target)) return true;
    } catch (err) {
      if (err?.code === 'ENOENT') return true;
      if (!RETRYABLE_RM_CODES.has(err?.code)) {
        break;
      }
    }
    await delay(Math.min(1000, delayBase * (attempt + 1)));
  }
  if (!fs.existsSync(target)) return true;
  const tombstone = createPendingDeletePath(target);
  try {
    await fsPromises.rename(target, tombstone);
    await fsPromises.rm(tombstone, { force: true, recursive: true });
    if (!fs.existsSync(tombstone) && !fs.existsSync(target)) return true;
  } catch {}
  return !fs.existsSync(target);
};

/**
 * Remove stale tombstones created for a single target path only.
 * The matcher intentionally excludes generic `pending-delete-*` patterns
 * to avoid deleting unrelated files that happen to share that prefix.
 *
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
const cleanupPendingDeleteTombstones = async (targetPath) => {
  try {
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    const legacyPrefix = `${base}.pending-delete-`;
    const globalPrefix = `pending-delete-${base}-`;
    const legacyPrefixLower = legacyPrefix.toLowerCase();
    const globalPrefixLower = globalPrefix.toLowerCase();
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    const matches = entries
      .filter((entry) => {
        if (!entry?.isFile?.() || typeof entry.name !== 'string') return false;
        const nameLower = entry.name.toLowerCase();
        return nameLower.startsWith(legacyPrefixLower)
          || nameLower.startsWith(globalPrefixLower);
      })
      .map((entry) => path.join(dir, entry.name));
    for (const tombstonePath of matches) {
      await removePathWithRetry(tombstonePath, { recursive: false, attempts: 10, baseDelayMs: 30 });
    }
  } catch {}
};

/**
 * Create unique temp output stream for atomic write-replace flow.
 *
 * @param {string} filePath
 * @param {number|null} highWaterMark
 * @param {number} [preallocateBytes]
 * @returns {{tempPath:string,fileStream:import('node:fs').WriteStream}}
 */
const createExclusiveAtomicFileStream = (filePath, highWaterMark, preallocateBytes = 0) => {
  const preallocate = resolvePreallocateBytes(preallocateBytes);
  let lastErr = null;
  let preferFallback = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tempPath = createTempPath(filePath, { preferFallback });
    try {
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      const fd = fs.openSync(tempPath, 'wx');
      if (preallocate > 0) {
        try {
          fs.ftruncateSync(fd, preallocate);
        } catch (err) {
          try { fs.closeSync(fd); } catch {}
          throw err;
        }
      }
      const fileStream = fs.createWriteStream(tempPath, {
        fd,
        autoClose: true,
        ...(highWaterMark ? { highWaterMark } : {})
      });
      return { tempPath, fileStream };
    } catch (err) {
      if (err?.code === 'EEXIST') {
        lastErr = err;
        continue;
      }
      if (err?.code === 'EACCES' || err?.code === 'EPERM') {
        lastErr = err;
        // Retry with TEMP-based fallback paths after permission failures.
        preferFallback = true;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`Failed to allocate unique atomic temp file for ${filePath}`);
};

/**
 * Create direct output stream with optional size preallocation.
 *
 * @param {string} targetPath
 * @param {number|null} highWaterMark
 * @param {number} [preallocateBytes]
 * @returns {import('node:fs').WriteStream}
 */
const createPreallocatedFileStream = (targetPath, highWaterMark, preallocateBytes = 0) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const fd = fs.openSync(targetPath, 'w');
  const preallocate = resolvePreallocateBytes(preallocateBytes);
  if (preallocate > 0) {
    try {
      fs.ftruncateSync(fd, preallocate);
    } catch (err) {
      try { fs.closeSync(fd); } catch {}
      throw err;
    }
  }
  return fs.createWriteStream(targetPath, {
    fd,
    autoClose: true,
    ...(highWaterMark ? { highWaterMark } : {})
  });
};

/**
 * Build transform that counts bytes and optional checksum while enforcing cap.
 *
 * @param {number|null} maxBytes
 * @param {number|null} highWaterMark
 * @param {string|null} [checksumAlgo]
 * @returns {{counter:Transform,getBytes:()=>number,isOverLimit:()=>boolean,checksumAlgo:string|null,getChecksum:()=>string|null}}
 */
const createByteCounter = (maxBytes, highWaterMark, checksumAlgo = null) => {
  let bytes = 0;
  let overLimit = false;
  const resolvedChecksumAlgo = typeof checksumAlgo === 'string' && checksumAlgo.trim()
    ? checksumAlgo.trim().toLowerCase()
    : null;
  const checksumHash = resolvedChecksumAlgo ? crypto.createHash(resolvedChecksumAlgo) : null;
  let checksumValue = null;
  const counter = new Transform({
    ...(highWaterMark ? { highWaterMark } : {}),
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (Number.isFinite(Number(maxBytes)) && maxBytes > 0 && bytes > maxBytes) {
        overLimit = true;
        callback(new Error(`JSON stream exceeded maxBytes (${bytes} > ${maxBytes}).`));
        return;
      }
      if (checksumHash) {
        checksumHash.update(chunk);
      }
      callback(null, chunk);
    }
  });
  return {
    counter,
    getBytes: () => bytes,
    isOverLimit: () => overLimit,
    checksumAlgo: resolvedChecksumAlgo,
    getChecksum: () => {
      if (!checksumHash) return null;
      if (checksumValue == null) {
        checksumValue = checksumHash.digest('hex');
      }
      return checksumValue;
    }
  };
};

/**
 * Create JSON write stream wrapper with compression/atomic/checksum options.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @returns {{stream:import('node:stream').Writable,getBytesWritten:()=>number,checksumAlgo:string|null,getChecksum:()=>string|null,done:Promise<void>}}
 */
export const createJsonWriteStream = (filePath, options = {}) => {
  const {
    compression = null,
    atomic = false,
    signal = null,
    maxBytes = null,
    checksumAlgo = null,
    preallocateBytes = null,
    waitTimeoutMs = null
  } = options;
  const resolvedWaitTimeoutMs = resolveJsonStreamWaitTimeoutMs(waitTimeoutMs);
  const highWaterMark = normalizeHighWaterMark(options.highWaterMark);
  const resolvedPreallocateBytes = compression
    ? 0
    : resolvePreallocateBytes(preallocateBytes);
  if (signal?.aborted) {
    throw createAbortError();
  }
  const tempRef = atomic
    ? createExclusiveAtomicFileStream(filePath, highWaterMark, resolvedPreallocateBytes)
    : null;
  const targetPath = atomic ? tempRef.tempPath : filePath;
  const fileStream = atomic
    ? tempRef.fileStream
    : createPreallocatedFileStream(targetPath, highWaterMark, resolvedPreallocateBytes);
  const {
    counter,
    getBytes,
    isOverLimit,
    checksumAlgo: resolvedChecksumAlgo,
    getChecksum
  } = createByteCounter(maxBytes, highWaterMark, checksumAlgo);
  let writer = null;
  let committed = false;
  const streams = [];
  const attachAbortHandler = () => {
    if (!signal) return () => {};
    const handler = () => {
      const err = createAbortError();
      if (writer) writer.destroy(err);
      counter.destroy(err);
      fileStream.destroy(err);
    };
    signal.addEventListener('abort', handler, { once: true });
    return () => signal.removeEventListener('abort', handler);
  };
  const detachAbort = attachAbortHandler();
  const removeTempFile = async () => {
    if (!atomic) return;
    await waitForClose(fileStream, resolvedWaitTimeoutMs);
    await removePathWithRetry(targetPath, { recursive: false });
    // Last guard: if the specific temp path still exists, keep retrying a bit
    // before letting callers observe stale ".tmp-" files.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (!fs.existsSync(targetPath)) break;
      await removePathWithRetry(targetPath, { recursive: false, attempts: 3, baseDelayMs: 50 });
      if (!fs.existsSync(targetPath)) break;
      await delay(Math.min(1000, 50 * (attempt + 1)));
    }
    if (fs.existsSync(targetPath)) {
      // Final fallback: tombstone + delete to avoid stale temp files
      // when antivirus/indexers briefly hold the file handle on Windows.
      const tombstone = createPendingDeletePath(targetPath);
      try {
        await fsPromises.rename(targetPath, tombstone);
        await removePathWithRetry(tombstone, { recursive: false, attempts: 6, baseDelayMs: 50 });
      } catch {}
    }
    await cleanupPendingDeleteTombstones(targetPath);
  };
  const attachPipelineErrorHandlers = () => {
    const forwardToFile = (err) => {
      if (!fileStream.destroyed) fileStream.destroy(err);
    };
    const forwardToWriter = (err) => {
      if (writer && !writer.destroyed) writer.destroy(err);
      if (counter && counter !== writer && !counter.destroyed) counter.destroy(err);
    };
    if (writer) writer.on('error', forwardToFile);
    if (counter && counter !== writer) counter.on('error', forwardToFile);
    fileStream.on('error', forwardToWriter);
  };
  if (compression === 'gzip') {
    const gzip = createFflateGzipStream(options);
    writer = gzip;
    writer[JSON_STREAM_WAIT_TIMEOUT_SYMBOL] = resolvedWaitTimeoutMs;
    gzip.pipe(counter).pipe(fileStream);
    streams.push(gzip, counter, fileStream);
    attachPipelineErrorHandlers();
    return {
      stream: gzip,
      getBytesWritten: getBytes,
      checksumAlgo: resolvedChecksumAlgo,
      getChecksum,
      done: Promise.all([...new Set(streams)].map((entry) => (
        waitForFinish(entry, entry === fileStream, resolvedWaitTimeoutMs, `json-stream.${entry === fileStream ? 'close' : 'finish'}`)
      )))
        .then(async () => {
          if (isOverLimit()) {
            throw new Error('JSON stream exceeded maxBytes.');
          }
          if (resolvedPreallocateBytes > 0) {
            await fsPromises.truncate(targetPath, getBytes());
          }
          if (atomic) {
            await replaceFile(targetPath, filePath);
            committed = true;
          }
        })
        .catch(async (err) => {
          await removeTempFile();
          throw err;
        })
        .finally(async () => {
          if (atomic && !committed) {
            await removeTempFile();
          }
          detachAbort();
        })
    };
  }
  if (compression === 'zstd') {
    const zstd = createZstdStream(options);
    writer = zstd;
    writer[JSON_STREAM_WAIT_TIMEOUT_SYMBOL] = resolvedWaitTimeoutMs;
    zstd.pipe(counter).pipe(fileStream);
    streams.push(zstd, counter, fileStream);
    attachPipelineErrorHandlers();
    return {
      stream: zstd,
      getBytesWritten: getBytes,
      checksumAlgo: resolvedChecksumAlgo,
      getChecksum,
      done: Promise.all([...new Set(streams)].map((entry) => (
        waitForFinish(entry, entry === fileStream, resolvedWaitTimeoutMs, `json-stream.${entry === fileStream ? 'close' : 'finish'}`)
      )))
        .then(async () => {
          if (isOverLimit()) {
            throw new Error('JSON stream exceeded maxBytes.');
          }
          if (resolvedPreallocateBytes > 0) {
            await fsPromises.truncate(targetPath, getBytes());
          }
          if (atomic) {
            await replaceFile(targetPath, filePath);
            committed = true;
          }
        })
        .catch(async (err) => {
          await removeTempFile();
          throw err;
        })
        .finally(async () => {
          if (atomic && !committed) {
            await removeTempFile();
          }
          detachAbort();
        })
    };
  }
  writer = counter;
  writer[JSON_STREAM_WAIT_TIMEOUT_SYMBOL] = resolvedWaitTimeoutMs;
  counter.pipe(fileStream);
  streams.push(counter, fileStream);
  attachPipelineErrorHandlers();
  return {
    stream: counter,
    getBytesWritten: getBytes,
    checksumAlgo: resolvedChecksumAlgo,
    getChecksum,
    done: Promise.all([...new Set(streams)].map((entry) => (
      waitForFinish(entry, entry === fileStream, resolvedWaitTimeoutMs, `json-stream.${entry === fileStream ? 'close' : 'finish'}`)
    )))
      .then(async () => {
        if (isOverLimit()) {
          throw new Error('JSON stream exceeded maxBytes.');
        }
        if (resolvedPreallocateBytes > 0) {
          await fsPromises.truncate(targetPath, getBytes());
        }
        if (atomic) {
          await replaceFile(targetPath, filePath);
          committed = true;
        }
      })
      .catch(async (err) => {
        await removeTempFile();
        throw err;
      })
      .finally(async () => {
        if (atomic && !committed) {
          await removeTempFile();
        }
        detachAbort();
      })
  };
};
