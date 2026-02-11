import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { createTempPath, replaceFile } from './atomic.js';
import { createFflateGzipStream, createZstdStream, normalizeHighWaterMark } from './compress.js';
import { createAbortError } from './runtime.js';

export const writeChunk = async (stream, chunk) => {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
};

const waitForFinish = (stream, requireClose = false) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  const event = requireClose ? 'close' : 'finish';
  stream.on(event, resolve);
});

const waitForClose = (stream) => {
  if (!stream) return Promise.resolve();
  if (stream.closed) return Promise.resolve();
  return once(stream, 'close').then(() => {}).catch(() => {});
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENOTEMPTY']);
let pendingDeleteCounter = 0;

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

const createExclusiveAtomicFileStream = (filePath, highWaterMark) => {
  let lastErr = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tempPath = createTempPath(filePath);
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    try {
      const fd = fs.openSync(tempPath, 'wx');
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
      throw err;
    }
  }
  throw lastErr || new Error(`Failed to allocate unique atomic temp file for ${filePath}`);
};

const createByteCounter = (maxBytes, highWaterMark) => {
  let bytes = 0;
  let overLimit = false;
  const counter = new Transform({
    ...(highWaterMark ? { highWaterMark } : {}),
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (Number.isFinite(Number(maxBytes)) && maxBytes > 0 && bytes > maxBytes) {
        overLimit = true;
        callback(new Error(`JSON stream exceeded maxBytes (${bytes} > ${maxBytes}).`));
        return;
      }
      callback(null, chunk);
    }
  });
  return {
    counter,
    getBytes: () => bytes,
    isOverLimit: () => overLimit
  };
};

export const createJsonWriteStream = (filePath, options = {}) => {
  const { compression = null, atomic = false, signal = null, maxBytes = null } = options;
  const highWaterMark = normalizeHighWaterMark(options.highWaterMark);
  if (signal?.aborted) {
    throw createAbortError();
  }
  const tempRef = atomic ? createExclusiveAtomicFileStream(filePath, highWaterMark) : null;
  const targetPath = atomic ? tempRef.tempPath : filePath;
  if (!atomic) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  const fileStream = atomic
    ? tempRef.fileStream
    : fs.createWriteStream(
      targetPath,
      highWaterMark ? { highWaterMark } : undefined
    );
  const { counter, getBytes, isOverLimit } = createByteCounter(maxBytes, highWaterMark);
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
    await waitForClose(fileStream);
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
    gzip.pipe(counter).pipe(fileStream);
    streams.push(gzip, counter, fileStream);
    attachPipelineErrorHandlers();
    return {
      stream: gzip,
      getBytesWritten: getBytes,
      done: Promise.all([...new Set(streams)].map((entry) => (
        waitForFinish(entry, entry === fileStream)
      )))
        .then(async () => {
          if (isOverLimit()) {
            throw new Error('JSON stream exceeded maxBytes.');
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
    zstd.pipe(counter).pipe(fileStream);
    streams.push(zstd, counter, fileStream);
    attachPipelineErrorHandlers();
    return {
      stream: zstd,
      getBytesWritten: getBytes,
      done: Promise.all([...new Set(streams)].map((entry) => (
        waitForFinish(entry, entry === fileStream)
      )))
        .then(async () => {
          if (isOverLimit()) {
            throw new Error('JSON stream exceeded maxBytes.');
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
  counter.pipe(fileStream);
  streams.push(counter, fileStream);
  attachPipelineErrorHandlers();
  return {
    stream: counter,
    getBytesWritten: getBytes,
    done: Promise.all([...new Set(streams)].map((entry) => (
      waitForFinish(entry, entry === fileStream)
    )))
      .then(async () => {
        if (isOverLimit()) {
          throw new Error('JSON stream exceeded maxBytes.');
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
