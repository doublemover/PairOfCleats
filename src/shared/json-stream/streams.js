import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { createTempPath, replaceFile } from './atomic.js';
import { createFflateGzipStream, createZstdStream } from './compress.js';
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

const createByteCounter = (maxBytes) => {
  let bytes = 0;
  let overLimit = false;
  const counter = new Transform({
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
  if (signal?.aborted) {
    throw createAbortError();
  }
  const targetPath = atomic ? createTempPath(filePath) : filePath;
  const fileStream = fs.createWriteStream(targetPath);
  const { counter, getBytes, isOverLimit } = createByteCounter(maxBytes);
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
  if (compression === 'gzip') {
    const gzip = createFflateGzipStream(options);
    writer = gzip;
    gzip.pipe(counter).pipe(fileStream);
    streams.push(gzip, counter, fileStream);
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
          if (atomic) {
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
          }
          throw err;
        })
        .finally(async () => {
          if (atomic && !committed) {
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
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
          if (atomic) {
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
          }
          throw err;
        })
        .finally(async () => {
          if (atomic && !committed) {
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
          }
          detachAbort();
        })
    };
  }
  writer = counter;
  counter.pipe(fileStream);
  streams.push(counter, fileStream);
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
        if (atomic) {
          try { await fsPromises.rm(targetPath, { force: true }); } catch {}
        }
        throw err;
      })
      .finally(async () => {
        if (atomic && !committed) {
          try { await fsPromises.rm(targetPath, { force: true }); } catch {}
        }
        detachAbort();
      })
  };
};
