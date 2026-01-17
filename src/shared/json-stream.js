import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { Gzip } from 'fflate';
import { tryRequire } from './optional-deps.js';

const writeChunk = async (stream, chunk) => {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
};

const waitForFinish = (stream) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.on('finish', resolve);
});

const createTempPath = (filePath) => (
  `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
);

const createFflateGzipStream = (options = {}) => {
  const level = Number.isFinite(Number(options.level)) ? Math.floor(Number(options.level)) : 6;
  const gzip = new Gzip({ level });
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      try {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
        gzip.push(buffer, false);
        callback();
      } catch (err) {
        callback(err);
      }
    },
    flush(callback) {
      try {
        gzip.push(new Uint8Array(0), true);
        callback();
      } catch (err) {
        callback(err);
      }
    }
  });
  gzip.ondata = (chunk) => {
    if (chunk && chunk.length) {
      stream.push(Buffer.from(chunk));
    }
  };
  return stream;
};

const resolveZstd = (options = {}) => {
  const result = tryRequire('@mongodb-js/zstd', options);
  if (result.ok) return result.mod;
  const message = result.reason === 'missing'
    ? '@mongodb-js/zstd is not installed.'
    : 'Failed to load @mongodb-js/zstd.';
  throw new Error(`zstd compression requested but ${message}`);
};

const normalizeZstdChunkSize = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return 256 * 1024;
  return Math.max(64 * 1024, Math.floor(size));
};

const toBuffer = (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value));

const createZstdStream = (options = {}) => {
  const zstd = resolveZstd(options);
  const level = Number.isFinite(Number(options.level)) ? Math.floor(Number(options.level)) : 3;
  const chunkSize = normalizeZstdChunkSize(options.chunkSize);
  let pending = Buffer.alloc(0);
  let stream;
  const compressChunk = async (chunk) => {
    if (!chunk?.length) return;
    const compressed = await zstd.compress(chunk, level);
    if (compressed?.length) {
      stream.push(toBuffer(compressed));
    }
  };
  const drainBuffer = async (flush) => {
    while (pending.length >= chunkSize || (flush && pending.length)) {
      const size = flush ? pending.length : chunkSize;
      const slice = pending.subarray(0, size);
      pending = pending.subarray(size);
      await compressChunk(slice);
    }
  };
  stream = new Transform({
    transform(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      pending = pending.length ? Buffer.concat([pending, buffer]) : buffer;
      (async () => {
        await drainBuffer(false);
      })()
        .then(() => callback())
        .catch(callback);
    },
    flush(callback) {
      (async () => {
        await drainBuffer(true);
      })()
        .then(() => callback())
        .catch(callback);
    }
  });
  return stream;
};

const getBakPath = (filePath) => `${filePath}.bak`;

const replaceFile = async (tempPath, finalPath) => {
  const bakPath = getBakPath(finalPath);
  const finalExists = fs.existsSync(finalPath);
  let backupAvailable = fs.existsSync(bakPath);
  const copyFallback = async () => {
    try {
      await fsPromises.copyFile(tempPath, finalPath);
      await fsPromises.rm(tempPath, { force: true });
      return true;
    } catch {
      return false;
    }
  };
  if (finalExists && !backupAvailable) {
    try {
      await fsPromises.rename(finalPath, bakPath);
      backupAvailable = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fs.existsSync(bakPath);
      }
    }
  }
  try {
    await fsPromises.rename(tempPath, finalPath);
  } catch (err) {
    if (err?.code !== 'EEXIST'
      && err?.code !== 'EPERM'
      && err?.code !== 'ENOTEMPTY'
      && err?.code !== 'EACCES'
      && err?.code !== 'EXDEV') {
      throw err;
    }
    if (!backupAvailable) {
      if (await copyFallback()) return;
      throw err;
    }
    try {
      await fsPromises.rm(finalPath, { force: true });
    } catch {}
    try {
      await fsPromises.rename(tempPath, finalPath);
    } catch (renameErr) {
      if (await copyFallback()) return;
      throw renameErr;
    }
  }
};

const createJsonWriteStream = (filePath, options = {}) => {
  const { compression = null, atomic = false } = options;
  const targetPath = atomic ? createTempPath(filePath) : filePath;
  const fileStream = fs.createWriteStream(targetPath);
  if (compression === 'gzip') {
    const gzip = createFflateGzipStream();
    gzip.pipe(fileStream);
    return {
      stream: gzip,
      done: Promise.all([waitForFinish(gzip), waitForFinish(fileStream)])
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
    };
  }
  if (compression === 'zstd') {
    const zstd = createZstdStream(options);
    zstd.pipe(fileStream);
    return {
      stream: zstd,
      done: Promise.all([waitForFinish(zstd), waitForFinish(fileStream)])
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
    };
  }
  return {
    stream: fileStream,
    done: waitForFinish(fileStream)
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
  };
};

const normalizeJsonValue = (value) => {
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
    try {
      return value.toJSON();
    } catch {
      return value;
    }
  }
  return value;
};

const writeJsonValue = async (stream, value) => {
  const normalized = normalizeJsonValue(value);
  if (normalized === null || typeof normalized !== 'object') {
    if (normalized === undefined || typeof normalized === 'function' || typeof normalized === 'symbol') {
      await writeChunk(stream, 'null');
      return;
    }
    await writeChunk(stream, JSON.stringify(normalized));
    return;
  }
  // Treat TypedArrays (e.g. Uint8Array) as JSON arrays.
  // This lets us keep large numeric payloads (like quantized embeddings)
  // out of V8's old-space while still emitting schema-compatible JSON.
  if (ArrayBuffer.isView(normalized) && !(normalized instanceof DataView)) {
    await writeChunk(stream, '[');
    let first = true;
    for (let i = 0; i < normalized.length; i += 1) {
      if (!first) await writeChunk(stream, ',');
      await writeChunk(stream, JSON.stringify(normalized[i]));
      first = false;
    }
    await writeChunk(stream, ']');
    return;
  }
  if (Array.isArray(normalized)) {
    await writeChunk(stream, '[');
    let first = true;
    for (const item of normalized) {
      if (!first) await writeChunk(stream, ',');
      const itemValue = normalizeJsonValue(item);
      if (itemValue === undefined || typeof itemValue === 'function' || typeof itemValue === 'symbol') {
        await writeChunk(stream, 'null');
      } else {
        await writeJsonValue(stream, itemValue);
      }
      first = false;
    }
    await writeChunk(stream, ']');
    return;
  }
  await writeChunk(stream, '{');
  let first = true;
  for (const [key, entry] of Object.entries(normalized)) {
    const entryValue = normalizeJsonValue(entry);
    if (entryValue === undefined || typeof entryValue === 'function' || typeof entryValue === 'symbol') {
      continue;
    }
    if (!first) await writeChunk(stream, ',');
    await writeChunk(stream, `${JSON.stringify(key)}:`);
    await writeJsonValue(stream, entryValue);
    first = false;
  }
  await writeChunk(stream, '}');
};

const writeArrayItems = async (stream, items) => {
  let first = true;
  for (const item of items) {
    if (!first) await writeChunk(stream, ',');
    await writeJsonValue(stream, item);
    first = false;
  }
};

/**
 * Stream JSON lines to disk (one JSON object per line).
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonLinesFile(filePath, items, options = {}) {
  const { compression = null, atomic = false } = options;
  const { stream, done } = createJsonWriteStream(filePath, { compression, atomic });
  for (const item of items) {
    await writeJsonValue(stream, item);
    await writeChunk(stream, '\n');
  }
  stream.end();
  await done;
}

/**
 * Stream a JSON array to disk without holding the full string in memory.       
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonArrayFile(filePath, items, options = {}) {
  const { trailingNewline = true, compression = null, atomic = false } = options;
  const { stream, done } = createJsonWriteStream(filePath, { compression, atomic });
  await writeChunk(stream, '[');
  await writeArrayItems(stream, items);
  await writeChunk(stream, ']');
  if (trailingNewline) await writeChunk(stream, '\n');
  stream.end();
  await done;
}

/**
 * Stream a JSON object with one or more array fields to disk.
 * @param {string} filePath
 * @param {{fields?:object,arrays?:object,trailingNewline?:boolean}} input
 * @returns {Promise<void>}
 */
export async function writeJsonObjectFile(filePath, input = {}) {
  const {
    fields = {},
    arrays = {},
    trailingNewline = true,
    compression = null,
    atomic = false
  } = input;
  const { stream, done } = createJsonWriteStream(filePath, { compression, atomic });
  await writeChunk(stream, '{');
  let first = true;
  for (const [key, value] of Object.entries(fields)) {
    if (!first) await writeChunk(stream, ',');
    await writeChunk(stream, `${JSON.stringify(key)}:`);
    await writeJsonValue(stream, value);
    first = false;
  }
  for (const [key, items] of Object.entries(arrays)) {
    const header = `${JSON.stringify(key)}:[`;
    await writeChunk(stream, `${first ? '' : ','}${header}`);
    first = false;
    await writeArrayItems(stream, items);
    await writeChunk(stream, ']');
  }
  await writeChunk(stream, '}');
  if (trailingNewline) await writeChunk(stream, '\n');
  stream.end();
  await done;
}
