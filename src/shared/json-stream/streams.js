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

const waitForFinish = (stream) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.on('finish', resolve);
});

const createByteCounter = () => {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    }
  });
  return {
    counter,
    getBytes: () => bytes
  };
};

export const createJsonWriteStream = (filePath, options = {}) => {
  const { compression = null, atomic = false, signal = null } = options;
  if (signal?.aborted) {
    throw createAbortError();
  }
  const targetPath = atomic ? createTempPath(filePath) : filePath;
  const fileStream = fs.createWriteStream(targetPath);
  const { counter, getBytes } = createByteCounter();
  let writer = null;
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
      done: Promise.all([...new Set(streams)].map((entry) => waitForFinish(entry)))
        .then(async () => {
          if (atomic) {
            await replaceFile(targetPath, filePath);
          }
        })
        .catch(async (err) => {
          if (atomic) {
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
          }
          throw err;
        })
        .finally(detachAbort)
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
      done: Promise.all([...new Set(streams)].map((entry) => waitForFinish(entry)))
        .then(async () => {
          if (atomic) {
            await replaceFile(targetPath, filePath);
          }
        })
        .catch(async (err) => {
          if (atomic) {
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
          }
          throw err;
        })
        .finally(detachAbort)
    };
  }
  writer = counter;
  counter.pipe(fileStream);
  streams.push(counter, fileStream);
  return {
    stream: counter,
    getBytesWritten: getBytes,
    done: Promise.all([...new Set(streams)].map((entry) => waitForFinish(entry)))
      .then(async () => {
        if (atomic) {
          await replaceFile(targetPath, filePath);
        }
      })
      .catch(async (err) => {
        if (atomic) {
          try { await fsPromises.rm(targetPath, { force: true }); } catch {}
        }
        throw err;
      })
      .finally(detachAbort)
  };
};
