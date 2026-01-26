import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
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

const warnOnce = (() => {
  const seen = new Set();
  return (key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    try {
      process.stderr.write(`${message}\n`);
    } catch {}
  };
})();

const createAbortError = () => {
  const err = new Error('Operation aborted');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
};

const throwIfAborted = (signal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

export const createTempPath = (filePath) => {
  const suffix = `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tempPath = `${filePath}${suffix}`;
  if (process.platform !== 'win32' || tempPath.length <= 240) {
    return tempPath;
  }
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath) || '.bin';
  const shortName = `.tmp-${Math.random().toString(16).slice(2, 10)}${ext}`;
  return path.join(dir, shortName);
};

const normalizeGzipOptions = (input) => {
  const output = input && typeof input === 'object' ? { ...input } : {};
  const supported = new Set(['level', 'mem', 'mtime']);
  for (const key of Object.keys(output)) {
    if (!supported.has(key)) {
      warnOnce(`gzip-option-${key}`, `[json-stream] ignoring unsupported gzip option: ${key}`);
      delete output[key];
    }
  }
  const levelRaw = output.level;
  let level = Number.isFinite(Number(levelRaw)) ? Math.floor(Number(levelRaw)) : 6;
  if (level < 0 || level > 9) {
    warnOnce('gzip-option-level', '[json-stream] gzip level must be between 0-9; clamping.');
    level = Math.min(9, Math.max(0, level));
  }
  output.level = level;
  if (!Number.isFinite(Number(output.mtime))) {
    output.mtime = 0;
  }
  return output;
};

const createFflateGzipStream = (options = {}) => {
  const gzipOptions = normalizeGzipOptions(options.gzipOptions);
  const gzip = new Gzip(gzipOptions);
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

export const replaceFile = async (tempPath, finalPath, options = {}) => {
  const keepBackup = options.keepBackup === true;
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
    if (!keepBackup && backupAvailable) {
      try { await fsPromises.rm(bakPath, { force: true }); } catch {}
    }
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
      if (!keepBackup && backupAvailable) {
        try { await fsPromises.rm(bakPath, { force: true }); } catch {}
      }
    } catch (renameErr) {
      if (await copyFallback()) return;
      throw renameErr;
    }
  }
};

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

const createJsonWriteStream = (filePath, options = {}) => {
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

const stringifyJsonValue = (value) => {
  const normalized = normalizeJsonValue(value);
  if (normalized === null || typeof normalized !== 'object') {
    if (normalized === undefined || typeof normalized === 'function' || typeof normalized === 'symbol') {
      return 'null';
    }
    return JSON.stringify(normalized);
  }
  if (ArrayBuffer.isView(normalized) && !(normalized instanceof DataView)) {
    const items = [];
    for (let i = 0; i < normalized.length; i += 1) {
      items.push(JSON.stringify(normalized[i]));
    }
    return `[${items.join(',')}]`;
  }
  if (Array.isArray(normalized)) {
    const items = normalized.map((item) => stringifyJsonValue(item));
    return `[${items.join(',')}]`;
  }
  const entries = [];
  for (const [key, entry] of Object.entries(normalized)) {
    const entryValue = normalizeJsonValue(entry);
    if (entryValue === undefined || typeof entryValue === 'function' || typeof entryValue === 'symbol') {
      continue;
    }
    entries.push(`${JSON.stringify(key)}:${stringifyJsonValue(entryValue)}`);
  }
  return `{${entries.join(',')}}`;
};

const writeArrayItems = async (stream, items, signal = null) => {
  let first = true;
  for (const item of items) {
    throwIfAborted(signal);
    if (!first) await writeChunk(stream, ',');
    await writeJsonValue(stream, item);
    first = false;
  }
};

/**
 * Stream JSON lines to disk (one JSON object per line).
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,signal?:AbortSignal}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonLinesFile(filePath, items, options = {}) {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    signal = null
  } = options;
  const { stream, done } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    signal
  });
  try {
    for (const item of items) {
      throwIfAborted(signal);
      await writeJsonValue(stream, item);
      await writeChunk(stream, '\n');
    }
    stream.end();
    await done;
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}

/**
 * Stream JSON lines into sharded JSONL files.
 * @param {{dir:string,partsDirName:string,partPrefix:string,items:Iterable<any>,maxBytes:number,maxItems?:number,atomic?:boolean,compression?:string|null,gzipOptions?:object,signal?:AbortSignal}} input
 * @returns {Promise<{parts:string[],counts:number[],bytes:number[],total:number,totalBytes:number,partsDir:string,maxPartRecords:number,maxPartBytes:number,targetMaxBytes:number|null}>}
 */
export async function writeJsonLinesSharded(input) {
  const {
    dir,
    partsDirName,
    partPrefix,
    items,
    maxBytes,
    maxItems = 0,
    atomic = false,
    compression = null,
    gzipOptions = null,
    signal = null
  } = input || {};
  const resolvedMaxBytes = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
  const resolvedMaxItems = Number.isFinite(Number(maxItems)) ? Math.max(0, Math.floor(Number(maxItems))) : 0;
  const partsDir = path.join(dir, partsDirName);
  await fsPromises.rm(partsDir, { recursive: true, force: true });
  await fsPromises.mkdir(partsDir, { recursive: true });

  const resolveJsonlExtension = (value) => {
    if (value === 'gzip') return 'jsonl.gz';
    if (value === 'zstd') return 'jsonl.zst';
    return 'jsonl';
  };
  const extension = resolveJsonlExtension(compression);

  const parts = [];
  const counts = [];
  const bytes = [];
  let total = 0;
  let totalBytes = 0;
  let partIndex = -1;
  let partCount = 0;
  let partBytes = 0;
  let current = null;
  let currentPath = null;

  const closePart = async () => {
    if (!current) return;
    current.stream.end();
    await current.done;
    if (currentPath) {
      try {
        const stat = await fsPromises.stat(currentPath);
        bytes[bytes.length - 1] = stat.size;
        totalBytes += stat.size;
      } catch {}
    }
    current = null;
    currentPath = null;
  };

  const openPart = () => {
    partIndex += 1;
    partCount = 0;
    partBytes = 0;
    const partName = `${partPrefix}${String(partIndex).padStart(5, '0')}.${extension}`;
    const absPath = path.join(partsDir, partName);
    const relPath = path.posix.join(partsDirName, partName);
    parts.push(relPath);
    counts.push(0);
    bytes.push(0);
    current = createJsonWriteStream(absPath, {
      atomic,
      compression,
      gzipOptions,
      signal
    });
    currentPath = absPath;
  };

  const iterator = items?.[Symbol.iterator] ? items[Symbol.iterator]() : null;
  if (!iterator) {
    throw new Error('writeJsonLinesSharded requires a synchronous iterable.');
  }
  let next = iterator.next();
  try {
    while (!next.done) {
      throwIfAborted(signal);
      const item = next.value;
      next = iterator.next();
      const hasMore = !next.done;
      const line = stringifyJsonValue(item);
      const needsNewPart = current
        && ((resolvedMaxItems && partCount >= resolvedMaxItems)
          || (resolvedMaxBytes && partBytes >= resolvedMaxBytes));
      if (!current || needsNewPart) {
        await closePart();
        openPart();
      }
      await writeChunk(current.stream, line);
      await writeChunk(current.stream, '\n');
      partCount += 1;
      partBytes = current.getBytesWritten();
      total += 1;
      counts[counts.length - 1] = partCount;
      if (resolvedMaxBytes && partBytes > resolvedMaxBytes && partCount === 1) {
        const err = new Error(
          `JSONL entry exceeds maxBytes (${partBytes} > ${resolvedMaxBytes}) in ${partsDirName}`
        );
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      if (resolvedMaxBytes && partBytes >= resolvedMaxBytes && hasMore) {
        await closePart();
        openPart();
      }
    }
    await closePart();
  } catch (err) {
    if (current?.stream) {
      try { current.stream.destroy(err); } catch {}
      try { await current.done; } catch {}
    }
    throw err;
  }

  const maxPartRecords = counts.length ? Math.max(...counts) : 0;
  const maxPartBytes = bytes.length ? Math.max(...bytes) : 0;
  const targetMaxBytes = resolvedMaxBytes > 0 ? resolvedMaxBytes : null;
  return {
    parts,
    counts,
    bytes,
    total,
    totalBytes,
    partsDir,
    maxPartRecords,
    maxPartBytes,
    targetMaxBytes
  };
}

/**
 * Stream a JSON array to disk without holding the full string in memory.       
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,signal?:AbortSignal}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonArrayFile(filePath, items, options = {}) {
  const {
    trailingNewline = true,
    compression = null,
    atomic = false,
    gzipOptions = null,
    signal = null
  } = options;
  const { stream, done } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    signal
  });
  try {
    await writeChunk(stream, '[');
    await writeArrayItems(stream, items, signal);
    await writeChunk(stream, ']');
    if (trailingNewline) await writeChunk(stream, '\n');
    stream.end();
    await done;
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}

/**
 * Stream a JSON object with one or more array fields to disk.
 * @param {string} filePath
 * @param {{fields?:object,arrays?:object,trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,signal?:AbortSignal}} input
 * @returns {Promise<void>}
 */
export async function writeJsonObjectFile(filePath, input = {}) {
  const {
    fields = {},
    arrays = {},
    trailingNewline = true,
    compression = null,
    atomic = false,
    gzipOptions = null,
    signal = null
  } = input;
  const { stream, done } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    signal
  });
  try {
    await writeChunk(stream, '{');
    let first = true;
    for (const [key, value] of Object.entries(fields)) {
      throwIfAborted(signal);
      if (!first) await writeChunk(stream, ',');
      await writeChunk(stream, `${JSON.stringify(key)}:`);
      await writeJsonValue(stream, value);
      first = false;
    }
    for (const [key, items] of Object.entries(arrays)) {
      throwIfAborted(signal);
      const header = `${JSON.stringify(key)}:[`;
      await writeChunk(stream, `${first ? '' : ','}${header}`);
      first = false;
      await writeArrayItems(stream, items, signal);
      await writeChunk(stream, ']');
    }
    await writeChunk(stream, '}');
    if (trailingNewline) await writeChunk(stream, '\n');
    stream.end();
    await done;
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}
