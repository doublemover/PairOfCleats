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
  let pendingBytes = 0;
  const pendingChunks = [];
  let stream;
  const compressChunk = async (chunk) => {
    if (!chunk?.length) return;
    const compressed = await zstd.compress(chunk, level);
    if (compressed?.length) {
      stream.push(toBuffer(compressed));
    }
  };
  const appendPending = (buffer) => {
    if (!buffer?.length) return;
    pendingChunks.push(buffer);
    pendingBytes += buffer.length;
  };
  const readPending = (size) => {
    const target = Math.min(size, pendingBytes);
    if (target <= 0) return null;
    const out = Buffer.allocUnsafe(target);
    let offset = 0;
    while (offset < target && pendingChunks.length) {
      const head = pendingChunks[0];
      const take = Math.min(head.length, target - offset);
      head.copy(out, offset, 0, take);
      offset += take;
      if (take === head.length) {
        pendingChunks.shift();
      } else {
        pendingChunks[0] = head.subarray(take);
      }
    }
    pendingBytes -= target;
    return out;
  };
  const drainBuffer = async (flush) => {
    while (pendingBytes >= chunkSize || (flush && pendingBytes)) {
      const size = flush ? pendingBytes : chunkSize;
      const slice = readPending(size);
      if (slice) await compressChunk(slice);
    }
  };
  stream = new Transform({
    transform(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      appendPending(buffer);
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
