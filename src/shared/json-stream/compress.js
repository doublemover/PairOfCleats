import { Transform } from 'node:stream';
import { Gzip } from 'fflate';
import { tryRequire } from '../optional-deps.js';
import { warnOnce } from './runtime.js';

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

export const createFflateGzipStream = (options = {}) => {
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

export const createZstdStream = (options = {}) => {
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
