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
  const retryRemovePath = async (target) => {
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await fsPromises.rm(target, { force: true });
        return !fs.existsSync(target);
      } catch (err) {
        if (err?.code === 'ENOENT') return true;
        if (!['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENOTEMPTY'].includes(err?.code)) {
          break;
        }
        await delay(Math.min(1000, 30 * (attempt + 1)));
      }
    }
    try {
      await fsPromises.unlink(target);
    } catch {}
    return !fs.existsSync(target);
  };
  const removeTempFile = async () => {
    if (!atomic) return;
    await waitForClose(fileStream);
    await retryRemovePath(targetPath);
    // Last guard: if the specific temp path still exists, keep retrying a bit
    // before letting callers observe stale ".tmp-" files.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!fs.existsSync(targetPath)) break;
      await retryRemovePath(targetPath);
      if (!fs.existsSync(targetPath)) break;
      await delay(Math.min(1000, 50 * (attempt + 1)));
    }
    if (fs.existsSync(targetPath)) {
      // Final fallback: tombstone + delete to avoid stale temp files
      // when antivirus/indexers briefly hold the file handle on Windows.
      const tombstone = `${targetPath}.pending-delete-${Date.now()}-${process.pid}`;
      try {
        await fsPromises.rename(targetPath, tombstone);
        await retryRemovePath(tombstone);
      } catch {}
    }
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
