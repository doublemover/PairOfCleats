import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createTempPath, replaceFile } from './atomic.js';
import { createByteCounter } from './byte-counter.js';
import { createFflateGzipStream, createZstdStream, normalizeHighWaterMark } from './compress.js';
import { createAbortError } from './runtime.js';
import { getEnvConfig } from '../env.js';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { createContainedFileResource } from '../contained-file-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';

const JSON_STREAM_WAIT_TIMEOUT_SYMBOL = Symbol.for('pairofcleats.json_stream_wait_timeout_ms');
const DEFAULT_JSON_STREAM_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

const coerceOptionalNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const resolveJsonStreamWaitTimeoutMs = (value = null) => (
  coerceOptionalNonNegativeInt(value)
  ?? coerceOptionalNonNegativeInt(getEnvConfig().jsonStreamWaitTimeoutMs)
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
  await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      stream.removeListener(event, onEvent);
      if (event !== 'error') {
        stream.removeListener('error', onError);
      }
    };
    const finish = (handler) => (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const onEvent = finish(() => resolve());
    const onError = finish((error) => reject(error));
    stream.once(event, onEvent);
    if (event !== 'error') {
      stream.once('error', onError);
    }
    if (Number.isFinite(Number(timeoutMs)) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(createStreamWaitTimeoutError({ event, timeoutMs, label }));
      }, timeoutMs);
    }
  });
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
  if (event === 'close' && stream.closed) return;
  if (event === 'finish' && stream.writableFinished) return;
  if (event !== 'error' && stream.errored) throw stream.errored;
  if (event === 'drain' && (stream.destroyed || stream.writableEnded)) {
    throw Object.assign(new Error('JSON output closed before writable drain.'), { code: 'ERR_STREAM_DESTROYED' });
  }
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
export const writeChunkIfNeeded = (stream, chunk) => {
  if (stream.errored) throw stream.errored;
  if (stream.destroyed || stream.writableEnded) {
    throw Object.assign(new Error('JSON output is closed.'), { code: 'ERR_STREAM_DESTROYED' });
  }
  if (!stream.write(chunk)) {
    return waitForStreamEvent(stream, 'drain', { label: 'writeChunk.drain' });
  }
  return null;
};

/** Compatibility wrapper for callers requiring a Promise on accepted writes. */
export const writeChunk = async (stream, chunk) => {
  const pending = writeChunkIfNeeded(stream, chunk);
  if (pending) await pending;
};

/**
 * Write one chunk while exposing direct-write and backpressure wait timing.
 *
 * @param {import('node:stream').Writable} stream
 * @param {string|Buffer|Uint8Array} chunk
 * @returns {Promise<{flushMs:number,backpressureWaitMs:number}>}
 */
export const writeChunkWithTiming = async (stream, chunk) => {
  const writeStartedAt = Date.now();
  const accepted = stream.write(chunk);
  const flushMs = Math.max(0, Date.now() - writeStartedAt);
  if (accepted) {
    return {
      flushMs,
      backpressureWaitMs: 0
    };
  }
  const waitStartedAt = Date.now();
  await waitForStreamEvent(stream, 'drain', { label: 'writeChunk.drain' });
  return {
    flushMs,
    backpressureWaitMs: Math.max(0, Date.now() - waitStartedAt)
  };
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
  // An error is diagnostic data, not evidence that the descriptor closed.
  // Pipeline owners keep observing errors while this waits for actual close.
  return new Promise((resolve, reject) => {
    let timer = null;
    const close = () => { if (timer) clearTimeout(timer); resolve(); };
    stream.once('close', close);
    if (timeoutMs > 0) timer = setTimeout(() => {
      stream.removeListener('close', close);
      reject(createStreamWaitTimeoutError({ event: 'close', timeoutMs, label: 'stream.close' }));
    }, timeoutMs);
  });
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
const createOpenedFileStream = (targetPath, flags, highWaterMark, preallocateBytes, removeOnFailure) => {
  const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync, truncate: fs.ftruncateSync };
  const fd = fs.openSync(targetPath, flags);
  const owner = createContainedFileResource({ fd, sync: true, methods, additionalMethods: ['truncate'] });
  if (owner.hasFailure()) return owner.runSync(() => {});
  try {
    if (preallocateBytes > 0) owner.operations.truncate(preallocateBytes);
    const fileStream = fs.createWriteStream(targetPath, {
      fd, autoClose: true, ...(highWaterMark ? { highWaterMark } : {})
    });
    owner.detach();
    return fileStream;
  } catch (error) {
    owner.remember(error);
    let primary = error;
    try { owner.runSync(() => {}); } catch (failure) { primary = failure; }
    // An unconfirmed close retains the original descriptor and private file.
    // Recovery through that owner never replays truncate, construction or data.
    if (removeOnFailure && owner.isSettled()) {
      try { fs.rmSync(targetPath, { force: true }); } catch (cleanupError) {
        primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
      }
    }
    throw primary;
  }
};

const createExclusiveAtomicFileStream = (filePath, highWaterMark, preallocateBytes = 0) => {
  const preallocate = resolvePreallocateBytes(preallocateBytes);
  let lastErr = null;
  let preferFallback = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tempPath = createTempPath(filePath, { preferFallback });
    try {
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      const fileStream = createOpenedFileStream(tempPath, 'wx', highWaterMark, preallocate, true);
      return { tempPath, fileStream };
    } catch (err) {
      observeStorageResource(err, { phase: 'json-output-file-admission' }).requireSettled();
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
  const preallocate = resolvePreallocateBytes(preallocateBytes);
  return createOpenedFileStream(targetPath, 'w', highWaterMark, preallocate, false);
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
    waitTimeoutMs = null,
    settleBeforePublish = null
  } = options;
  if (settleBeforePublish != null && typeof settleBeforePublish !== 'function') {
    throw new TypeError('JSON stream publication settlement must be a function.');
  }
  const resolvedWaitTimeoutMs = resolveJsonStreamWaitTimeoutMs(waitTimeoutMs);
  const highWaterMark = normalizeHighWaterMark(options.highWaterMark);
  const resolvedPreallocateBytes = compression
    ? 0
    : resolvePreallocateBytes(preallocateBytes);
  if (signal?.aborted) {
    throw createAbortError();
  }
  if (compression && !['none', 'gzip', 'zstd'].includes(compression)) throw new TypeError('Unsupported JSON stream compression.');
  // Construct/validate the codec and checksum before opening an output FD.
  const codec = compression === 'gzip' ? createFflateGzipStream(options)
    : compression === 'zstd' ? createZstdStream(options) : null;
  let counting;
  try { counting = createByteCounter(maxBytes, highWaterMark, checksumAlgo); }
  catch (error) { codec?.destroy(); throw error; }
  let tempRef, fileStream;
  try {
    tempRef = atomic ? createExclusiveAtomicFileStream(filePath, highWaterMark, resolvedPreallocateBytes) : null;
    fileStream = atomic ? tempRef.fileStream : createPreallocatedFileStream(filePath, highWaterMark, resolvedPreallocateBytes);
  } catch (error) {
    codec?.destroy(); counting.counter.destroy(); throw error;
  }
  const targetPath = atomic ? tempRef.tempPath : filePath;
  const {
    counter,
    getBytes,
    isOverLimit,
    checksumAlgo: resolvedChecksumAlgo,
    getChecksum
  } = counting;
  let writer = null;
  const streams = [];
  const streamErrors = new Set();
  for (const owned of [codec, counter, fileStream].filter(Boolean)) owned.on('error', error => {
    streamErrors.add(error);
    if (owned.errored) streamErrors.add(owned.errored);
  });
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
  const createWriteStreamResult = (stream) => {
    const ownedStreams = [...new Set(streams)];
    const done = Promise.all(ownedStreams.map((entry) => (
      waitForFinish(entry, entry === fileStream, resolvedWaitTimeoutMs, `json-stream.${entry === fileStream ? 'close' : 'finish'}`)
    )))
      .then(async () => {
        await Promise.all(ownedStreams.map(entry => waitForClose(entry, resolvedWaitTimeoutMs)));
        if (streamErrors.size) throw streamErrors.values().next().value;
        if (isOverLimit()) {
          throw new Error('JSON stream exceeded maxBytes.');
        }
        if (resolvedPreallocateBytes > 0) {
          await fsPromises.truncate(targetPath, getBytes());
        }
        // Output is sealed and all descriptors are closed. The enclosing
        // producer still owns delegated work that must settle before commit.
        if (signal?.aborted) throw createAbortError();
        if (settleBeforePublish) await settleBeforePublish();
        if (signal?.aborted) throw createAbortError();
        if (atomic) {
          await replaceFile(targetPath, filePath);
        }
      })
      .catch(async (err) => {
        let primary = err;
        for (const owned of ownedStreams) {
          try { if (!owned.destroyed) owned.destroy(err); }
          catch (error) { streamErrors.add(error); }
        }
        const settled = await Promise.allSettled(ownedStreams.map(entry => waitForClose(entry, resolvedWaitTimeoutMs)));
        for (const outcome of settled) if (outcome.status === 'rejected') streamErrors.add(outcome.reason);
        for (const error of streamErrors) if (error !== err) {
          primary = addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
        }
        try { await removeTempFile(); } catch (error) {
          primary = addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
        }
        throw primary;
      })
      .finally(() => { detachAbort(); });
    // A producer can be awaiting its next row when the destination fails.
    // Observe the finalizer immediately; callers still receive its exact error.
    done.catch(() => {});
    return { stream, getBytesWritten: getBytes, checksumAlgo: resolvedChecksumAlgo, getChecksum, done };
  };
  if (compression === 'gzip') {
    const gzip = codec;
    writer = gzip;
    writer[JSON_STREAM_WAIT_TIMEOUT_SYMBOL] = resolvedWaitTimeoutMs;
    gzip.pipe(counter).pipe(fileStream);
    streams.push(gzip, counter, fileStream);
    attachPipelineErrorHandlers();
    return createWriteStreamResult(gzip);
  }
  if (compression === 'zstd') {
    const zstd = codec;
    writer = zstd;
    writer[JSON_STREAM_WAIT_TIMEOUT_SYMBOL] = resolvedWaitTimeoutMs;
    zstd.pipe(counter).pipe(fileStream);
    streams.push(zstd, counter, fileStream);
    attachPipelineErrorHandlers();
    return createWriteStreamResult(zstd);
  }
  writer = counter;
  writer[JSON_STREAM_WAIT_TIMEOUT_SYMBOL] = resolvedWaitTimeoutMs;
  counter.pipe(fileStream);
  streams.push(counter, fileStream);
  attachPipelineErrorHandlers();
  return createWriteStreamResult(counter);
};
