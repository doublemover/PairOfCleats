import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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
  if (stream.closed || stream.destroyed) return Promise.resolve();
  return once(stream, 'close').then(() => {}).catch(() => {});
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const targetPath = atomic ? createTempPath(filePath) : filePath;
  const fileStream = fs.createWriteStream(
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fsPromises.rm(targetPath, { force: true });
        return;
      } catch (err) {
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(err?.code)) {
          return;
        }
        await delay(25 * (attempt + 1));
      }
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
            try { await fsPromises.rm(targetPath, { force: true }); } catch {}
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
          try { await fsPromises.rm(targetPath, { force: true }); } catch {}
        }
        detachAbort();
      })
  };
};
