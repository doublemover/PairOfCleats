import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { MAX_JSON_BYTES } from './constants.js';
import { cleanupBak, getBakPath, readCache, writeCache } from './cache.js';
import {
  collectCompressedCandidates,
  collectCompressedJsonlCandidates,
  decompressBuffer,
  detectCompression,
  readBuffer
} from './compression.js';
import { parseJsonlLine } from './jsonl.js';
import { tryRequire } from '../optional-deps.js';
import { shouldAbortForHeap, shouldTreatAsTooLarge, toJsonTooLargeError } from './limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from './telemetry.js';

let cachedZstd = null;
let checkedZstd = false;
const SMALL_JSONL_BYTES = 128 * 1024;
const MEDIUM_JSONL_BYTES = 8 * 1024 * 1024;
const JSONL_HIGH_WATERMARK_SMALL = 64 * 1024;
const JSONL_HIGH_WATERMARK_MEDIUM = 256 * 1024;
const JSONL_HIGH_WATERMARK_LARGE = 1024 * 1024;
const ZSTD_STREAM_THRESHOLD = 8 * 1024 * 1024;
const resolveOptionalZstd = () => {
  if (checkedZstd) return cachedZstd;
  checkedZstd = true;
  const result = tryRequire('@mongodb-js/zstd');
  if (result.ok && typeof result.mod?.decompress === 'function') {
    cachedZstd = result.mod;
  }
  return cachedZstd;
};

const resolveJsonlReadPlan = (byteSize) => {
  if (byteSize <= SMALL_JSONL_BYTES) {
    return { highWaterMark: JSONL_HIGH_WATERMARK_SMALL, chunkSize: JSONL_HIGH_WATERMARK_SMALL, smallFile: true };
  }
  if (byteSize <= MEDIUM_JSONL_BYTES) {
    return { highWaterMark: JSONL_HIGH_WATERMARK_MEDIUM, chunkSize: JSONL_HIGH_WATERMARK_MEDIUM, smallFile: false };
  }
  return { highWaterMark: JSONL_HIGH_WATERMARK_LARGE, chunkSize: JSONL_HIGH_WATERMARK_LARGE, smallFile: false };
};

const scanJsonlBuffer = (
  buffer,
  sourcePath,
  {
    maxBytes,
    requiredKeys = null,
    validationMode = 'strict',
    onEntry = null,
    collect = null
  } = {}
) => {
  if (buffer.length > maxBytes) {
    throw toJsonTooLargeError(sourcePath, buffer.length);
  }
  const raw = buffer.toString('utf8');
  if (!raw.trim()) return { rows: 0, bytes: buffer.length };
  const lines = raw.split(/\r?\n/);
  let rows = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseJsonlLine(lines[i], sourcePath, i + 1, maxBytes, requiredKeys, validationMode);
    if (entry !== null) {
      rows += 1;
      if (onEntry) onEntry(entry);
      if (collect) collect.push(entry);
    }
  }
  return { rows, bytes: buffer.length };
};

const scanJsonlStream = async (
  stream,
  {
    targetPath,
    maxBytes,
    requiredKeys = null,
    validationMode = 'strict',
    onEntry = null,
    collect = null
  } = {}
) => {
  let buffer = '';
  let lineNumber = 0;
  let rows = 0;
  let bytes = 0;
  const pushLine = (line) => {
    lineNumber += 1;
    const entry = parseJsonlLine(line, targetPath, lineNumber, maxBytes, requiredKeys, validationMode);
    if (entry !== null) {
      rows += 1;
      if (onEntry) onEntry(entry);
      if (collect) collect.push(entry);
    }
  };
  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    bytes += typeof chunk === 'string' ? Buffer.byteLength(text, 'utf8') : chunk.length;
    if (bytes > maxBytes) {
      throw toJsonTooLargeError(targetPath, bytes);
    }
    buffer += text;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      pushLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(targetPath, Buffer.byteLength(buffer, 'utf8'));
    }
  }
  if (buffer.length) {
    pushLine(buffer);
  }
  return { rows, bytes };
};

export const readJsonFile = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const parseBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    if (shouldAbortForHeap(buffer.length)) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(sourcePath, buffer.length);
      }
      throw err;
    }
  };
  const tryRead = (targetPath, options = {}) => {
    const { compression = null, cleanup = false } = options;
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const buffer = readBuffer(targetPath, maxBytes);
    const resolvedCompression = compression || detectCompression(targetPath) || null;
    const decompressed = decompressBuffer(buffer, resolvedCompression, maxBytes, targetPath);
    const parsed = parseBuffer(decompressed, targetPath);
    if (cleanup) cleanupBak(targetPath);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'json',
        compression: resolvedCompression,
        rawBytes: buffer.length,
        bytes: decompressed.length,
        durationMs: performance.now() - start
      });
    }
    return parsed;
  };
  const bakPath = getBakPath(filePath);
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, { cleanup: true });
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return tryRead(bakPath);
      }
      throw err;
    }
  }
  if (filePath.endsWith('.json')) {
    const candidates = collectCompressedCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, {
            compression: candidate.compression,
            cleanup: candidate.cleanup
          });
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  if (fs.existsSync(bakPath)) {
    return tryRead(bakPath);
  }
  throw new Error(`Missing JSON artifact: ${filePath}`);
};

export const readJsonLinesEach = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null, validationMode = 'strict' } = {}
) => {
  if (typeof onEntry !== 'function') return;
  const readJsonlFromBuffer = (buffer, sourcePath) => (
    scanJsonlBuffer(buffer, sourcePath, {
      maxBytes,
      requiredKeys,
      validationMode,
      onEntry
    })
  );
  const readJsonlFromStream = async (targetPath, stream, { rawBytes, compression, cleanup = false } = {}) => {
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    let rows = 0;
    let bytes = 0;
    try {
      ({ rows, bytes } = await scanJsonlStream(stream, {
        targetPath,
        maxBytes,
        requiredKeys,
        validationMode,
        onEntry
      }));
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        throw err;
      }
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, bytes || rawBytes || maxBytes);
      }
      throw err;
    } finally {
      stream.destroy();
    }
    if (cleanup) cleanupBak(targetPath);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'jsonl',
        compression: compression ?? null,
        rawBytes: rawBytes ?? bytes,
        bytes,
        rows,
        durationMs: performance.now() - start
      });
    }
  };
  const readJsonlFromGzipStream = async (targetPath, cleanup = false) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    if (stat.size <= SMALL_JSONL_BYTES) {
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, 'gzip', maxBytes, targetPath);
      const { rows, bytes } = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression: 'gzip',
          rawBytes: stat.size,
          bytes,
          rows,
          durationMs: performance.now() - start
        });
      }
      return;
    }
    const plan = resolveJsonlReadPlan(stat.size);
    const stream = fs.createReadStream(targetPath, { highWaterMark: plan.highWaterMark });
    const gunzip = createGunzip({ chunkSize: plan.chunkSize });
    stream.on('error', (err) => gunzip.destroy(err));
    stream.pipe(gunzip);
    gunzip.setEncoding('utf8');
    try {
      await readJsonlFromStream(targetPath, gunzip, {
        rawBytes: stat.size,
        compression: 'gzip',
        cleanup
      });
    } finally {
      gunzip.destroy();
      stream.destroy();
    }
  };

  const readJsonlFromZstdStream = async (targetPath, cleanup = false) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const plan = resolveJsonlReadPlan(stat.size);
    const stream = fs.createReadStream(targetPath, { highWaterMark: plan.highWaterMark });
    let zstd;
    try {
      zstd = createZstdDecompress({ chunkSize: plan.chunkSize });
    } catch (err) {
      stream.destroy();
      throw err;
    }
    stream.on('error', (err) => zstd.destroy(err));
    stream.pipe(zstd);
    zstd.setEncoding('utf8');
    try {
      await readJsonlFromStream(targetPath, zstd, {
        rawBytes: stat.size,
        compression: 'zstd',
        cleanup
      });
    } finally {
      zstd.destroy();
      stream.destroy();
    }
  };
  const readJsonlFromZstdBuffer = async (targetPath, cleanup = false) => {
    const zstd = resolveOptionalZstd();
    if (!zstd) return null;
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    if (stat.size > ZSTD_STREAM_THRESHOLD) return null;
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    let payload;
    try {
      const buffer = readBuffer(targetPath, maxBytes);
      const decoded = await zstd.decompress(buffer);
      payload = Buffer.isBuffer(decoded) ? decoded : Buffer.from(decoded);
      if (payload.length > maxBytes || shouldAbortForHeap(payload.length)) {
        throw toJsonTooLargeError(targetPath, payload.length);
      }
      const { rows, bytes } = readJsonlFromBuffer(payload, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression: 'zstd',
          rawBytes: stat.size,
          bytes,
          rows,
          durationMs: performance.now() - start
        });
      }
      return true;
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, stat.size);
      }
      throw err;
    }
  };

  const tryRead = async (targetPath, cleanup = false) => {
    const compression = detectCompression(targetPath);
    if (compression) {
      if (compression === 'gzip') {
        await readJsonlFromGzipStream(targetPath, cleanup);
        return;
      }
      if (compression === 'zstd') {
        const usedBuffer = await readJsonlFromZstdBuffer(targetPath, cleanup);
        if (usedBuffer) return;
        await readJsonlFromZstdStream(targetPath, cleanup);
        return;
      }
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const { rows } = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression,
          rawBytes: buffer.length,
          bytes: decompressed.length,
          rows,
          durationMs: performance.now() - start
        });
      }
      return;
    }
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const plan = resolveJsonlReadPlan(stat.size);
    if (plan.smallFile) {
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBuffer(targetPath, maxBytes);
      const { rows, bytes } = readJsonlFromBuffer(buffer, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression: null,
          rawBytes: stat.size,
          bytes,
          rows,
          durationMs: performance.now() - start
        });
      }
      return;
    }
    const stream = fs.createReadStream(targetPath, { highWaterMark: plan.highWaterMark });
    stream.setEncoding('utf8');
    await readJsonlFromStream(targetPath, stream, { rawBytes: stat.size, compression: null, cleanup });
  };

  const bakPath = getBakPath(filePath);
  if (fs.existsSync(filePath)) {
    try {
      await tryRead(filePath, true);
      return;
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        await tryRead(bakPath);
        return;
      }
      throw err;
    }
  }
  if (fs.existsSync(bakPath)) {
    await tryRead(bakPath);
    return;
  }
  if (filePath.endsWith('.jsonl')) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          await tryRead(candidate.path, candidate.cleanup);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};

const createRowQueue = ({ maxPending = 0, onBackpressure = null, onResume = null } = {}) => {
  const buffer = [];
  const waiters = [];
  let drainResolver = null;
  let done = false;
  let error = null;
  let backpressured = false;
  const maxBuffer = Number.isFinite(maxPending) ? Math.max(0, maxPending) : 0;

  const resolveDrain = () => {
    if (!drainResolver) return;
    if (maxBuffer && buffer.length >= maxBuffer) return;
    const resolve = drainResolver;
    drainResolver = null;
    if (backpressured) {
      backpressured = false;
      if (typeof onResume === 'function') onResume(buffer.length);
    }
    resolve();
  };

  const push = async (value) => {
    if (done) return;
    if (waiters.length) {
      const waiter = waiters.shift();
      waiter({ value, done: false });
      return;
    }
    buffer.push(value);
    if (maxBuffer && buffer.length >= maxBuffer) {
      if (!backpressured && typeof onBackpressure === 'function') {
        backpressured = true;
        onBackpressure(buffer.length);
      }
      await new Promise((resolve) => {
        drainResolver = resolve;
      });
    }
  };

  const finish = (err = null) => {
    if (done) return;
    done = true;
    error = err;
    if (drainResolver) {
      const resolve = drainResolver;
      drainResolver = null;
      resolve();
    }
    while (waiters.length) {
      const waiter = waiters.shift();
      waiter({ value: undefined, done: true });
    }
  };

  const iterator = async function* () {
    while (true) {
      if (buffer.length) {
        const value = buffer.shift();
        resolveDrain();
        yield value;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      const result = await new Promise((resolve) => {
        waiters.push(resolve);
      });
      if (result.done) {
        if (error) throw error;
        return;
      }
      yield result.value;
    }
  };

  return { push, finish, cancel: finish, iterator };
};

const parseJsonlBufferEntries = (buffer, sourcePath, { maxBytes, requiredKeys, validationMode } = {}) => {
  if (buffer.length > maxBytes) {
    throw toJsonTooLargeError(sourcePath, buffer.length);
  }
  const raw = buffer.toString('utf8');
  if (!raw.trim()) return { entries: [], bytes: buffer.length };
  const lines = raw.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseJsonlLine(lines[i], sourcePath, i + 1, maxBytes, requiredKeys, validationMode);
    if (entry !== null) entries.push(entry);
  }
  return { entries, bytes: buffer.length };
};

const parseJsonlStreamEntries = async (stream, {
  targetPath,
  maxBytes,
  requiredKeys,
  validationMode,
  onEntry
} = {}) => {
  let buffer = '';
  let lineNumber = 0;
  let rows = 0;
  let bytes = 0;
  const pushLine = async (line) => {
    lineNumber += 1;
    const entry = parseJsonlLine(line, targetPath, lineNumber, maxBytes, requiredKeys, validationMode);
    if (entry !== null) {
      rows += 1;
      await onEntry(entry);
    }
  };
  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    bytes += typeof chunk === 'string' ? Buffer.byteLength(text, 'utf8') : chunk.length;
    if (bytes > maxBytes) {
      throw toJsonTooLargeError(targetPath, bytes);
    }
    buffer += text;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      await pushLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(targetPath, Buffer.byteLength(buffer, 'utf8'));
    }
  }
  if (buffer.length) {
    await pushLine(buffer);
  }
  return { rows, bytes };
};

const readJsonLinesIteratorSingle = async function* (
  targetPath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys,
    validationMode = 'strict',
    maxInFlight = 0,
    onBackpressure = null,
    onResume = null,
    byteRange = null
  } = {}
) {
  const shouldMeasure = hasArtifactReadObserver();
  const start = shouldMeasure ? performance.now() : 0;
  let rows = 0;
  let bytes = 0;
  let rawBytes = null;
  let compression = null;
  let cleanup = null;
  let stream = null;
  let sourcePath = targetPath;
  const queue = createRowQueue({
    maxPending: maxInFlight,
    onBackpressure,
    onResume
  });

  const producer = (async () => {
    try {
      const candidates = targetPath.endsWith('.jsonl')
        ? collectCompressedJsonlCandidates(targetPath)
        : [];
      const sources = candidates.length
        ? candidates
        : [{ path: targetPath, compression: detectCompression(targetPath), cleanup: false }];
      let lastErr = null;
      for (const candidate of sources) {
        try {
          sourcePath = candidate.path;
          compression = candidate.compression ?? detectCompression(candidate.path);
          cleanup = candidate.cleanup;
          const stat = fs.statSync(sourcePath);
          rawBytes = stat.size;
          if (stat.size > maxBytes) {
            throw toJsonTooLargeError(sourcePath, stat.size);
          }
          const hasRange = byteRange && Number.isFinite(byteRange.start) && Number.isFinite(byteRange.end);
          const range = hasRange
            ? { start: Math.max(0, byteRange.start), end: Math.max(0, byteRange.end - 1) }
            : null;
          const plan = resolveJsonlReadPlan(stat.size);
          if (!range && (plan.smallFile || (compression === 'gzip' && stat.size <= SMALL_JSONL_BYTES))) {
            if (compression === 'gzip') {
              const buffer = readBuffer(sourcePath, maxBytes);
              const decompressed = decompressBuffer(buffer, 'gzip', maxBytes, sourcePath);
              const parsed = parseJsonlBufferEntries(decompressed, sourcePath, {
                maxBytes,
                requiredKeys,
                validationMode
              });
              rows = parsed.entries.length;
              bytes = parsed.bytes;
              for (const entry of parsed.entries) {
                await queue.push(entry);
              }
              if (cleanup) cleanupBak(sourcePath);
              queue.finish();
              if (shouldMeasure) {
                recordArtifactRead({
                  path: sourcePath,
                  format: 'jsonl',
                  compression,
                  rawBytes: rawBytes ?? bytes,
                  bytes,
                  rows,
                  durationMs: performance.now() - start
                });
              }
              return;
            }
            if (!compression) {
              const buffer = readBuffer(sourcePath, maxBytes);
              const parsed = parseJsonlBufferEntries(buffer, sourcePath, {
                maxBytes,
                requiredKeys,
                validationMode
              });
              rows = parsed.entries.length;
              bytes = parsed.bytes;
              for (const entry of parsed.entries) {
                await queue.push(entry);
              }
              if (cleanup) cleanupBak(sourcePath);
              queue.finish();
              if (shouldMeasure) {
                recordArtifactRead({
                  path: sourcePath,
                  format: 'jsonl',
                  compression,
                  rawBytes: rawBytes ?? bytes,
                  bytes,
                  rows,
                  durationMs: performance.now() - start
                });
              }
              return;
            }
          }
          stream = fs.createReadStream(sourcePath, range || undefined);
          if (compression === 'gzip') {
            const gunzip = createGunzip();
            stream = stream.pipe(gunzip);
          } else if (compression === 'zstd') {
            const zstd = resolveOptionalZstd();
            if (zstd && rawBytes <= ZSTD_STREAM_THRESHOLD) {
              const buffer = readBuffer(sourcePath, maxBytes);
              const decoded = await zstd.decompress(buffer);
              const payload = Buffer.isBuffer(decoded) ? decoded : Buffer.from(decoded);
              const parsed = parseJsonlBufferEntries(payload, sourcePath, {
                maxBytes,
                requiredKeys,
                validationMode
              });
              rows = parsed.entries.length;
              bytes = parsed.bytes;
              for (const entry of parsed.entries) {
                await queue.push(entry);
              }
              if (cleanup) cleanupBak(sourcePath);
              queue.finish();
              if (shouldMeasure) {
                recordArtifactRead({
                  path: sourcePath,
                  format: 'jsonl',
                  compression,
                  rawBytes: rawBytes ?? bytes,
                  bytes,
                  rows,
                  durationMs: performance.now() - start
                });
              }
              return;
            }
            const zstdStream = createZstdDecompress();
            stream = stream.pipe(zstdStream);
          }
          break;
        } catch (err) {
          lastErr = err;
          stream = null;
        }
      }
      if (!stream) {
        throw lastErr || new Error(`Missing JSONL artifact: ${targetPath}`);
      }
      ({ rows, bytes } = await parseJsonlStreamEntries(stream, {
        targetPath: sourcePath,
        maxBytes,
        requiredKeys,
        validationMode,
        onEntry: async (entry) => {
          await queue.push(entry);
        }
      }));
      if (cleanup) cleanupBak(sourcePath);
      queue.finish();
      if (shouldMeasure) {
        recordArtifactRead({
          path: sourcePath,
          format: 'jsonl',
          compression,
          rawBytes: rawBytes ?? bytes,
          bytes,
          rows,
          durationMs: performance.now() - start
        });
      }
    } catch (err) {
      queue.finish(err);
    } finally {
      if (stream) stream.destroy();
    }
  })();

  try {
    for await (const entry of queue.iterator()) {
      yield entry;
    }
  } finally {
    queue.cancel();
    if (stream) stream.destroy();
    await producer.catch(() => {});
  }
};

export const readJsonLinesIterator = function (filePath, options = {}) {
  const paths = Array.isArray(filePath) ? filePath : [filePath];
  return (async function* () {
    for (const sourcePath of paths) {
      yield* readJsonLinesIteratorSingle(sourcePath, options);
    }
  })();
};

export const readJsonLinesEachAwait = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null, validationMode = 'strict' } = {}
) => {
  if (typeof onEntry !== 'function') return;
  for await (const entry of readJsonLinesIterator(filePath, { maxBytes, requiredKeys, validationMode })) {
    await onEntry(entry);
  }
};


export const readJsonLinesArray = async (
  filePath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    concurrency = null
  } = {}
) => {
  const readJsonLinesArraySingle = async (targetPath) => {
    const readJsonlFromBuffer = (buffer, sourcePath) => {
      const parsed = [];
      scanJsonlBuffer(buffer, sourcePath, {
        maxBytes,
        requiredKeys,
        validationMode,
        collect: parsed
      });
      return parsed;
    };
    const readJsonlFromStream = async (sourcePath, stream, { rawBytes, compression, cleanup = false } = {}) => {
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const parsed = [];
      let rows = 0;
      let bytes = 0;
      try {
        ({ rows, bytes } = await scanJsonlStream(stream, {
          targetPath: sourcePath,
          maxBytes,
          requiredKeys,
          validationMode,
          collect: parsed
        }));
      } catch (err) {
        if (err?.code === 'ERR_JSON_TOO_LARGE') {
          throw err;
        }
        if (shouldTreatAsTooLarge(err)) {
          throw toJsonTooLargeError(sourcePath, bytes || rawBytes || maxBytes);
        }
        throw err;
      } finally {
        stream.destroy();
      }
      if (cleanup) cleanupBak(sourcePath);
      if (shouldMeasure) {
        recordArtifactRead({
          path: sourcePath,
          format: 'jsonl',
          compression: compression ?? null,
          rawBytes: rawBytes ?? bytes,
          bytes,
          rows,
          durationMs: performance.now() - start
        });
      }
      return parsed;
    };
    const readJsonlFromZstdBuffer = async (sourcePath, cleanup = false) => {
      const zstd = resolveOptionalZstd();
      if (!zstd) return null;
      const stat = fs.statSync(sourcePath);
      if (stat.size > maxBytes) {
        throw toJsonTooLargeError(sourcePath, stat.size);
      }
      if (stat.size > ZSTD_STREAM_THRESHOLD) return null;
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      try {
        const buffer = readBuffer(sourcePath, maxBytes);
        const decoded = await zstd.decompress(buffer);
        const payload = Buffer.isBuffer(decoded) ? decoded : Buffer.from(decoded);
        if (payload.length > maxBytes || shouldAbortForHeap(payload.length)) {
          throw toJsonTooLargeError(sourcePath, payload.length);
        }
        const parsed = readJsonlFromBuffer(payload, sourcePath);
        if (cleanup) cleanupBak(sourcePath);
        if (shouldMeasure) {
          recordArtifactRead({
            path: sourcePath,
            format: 'jsonl',
            compression: 'zstd',
            rawBytes: stat.size,
            bytes: payload.length,
            rows: parsed.length,
            durationMs: performance.now() - start
          });
        }
        return parsed;
      } catch (err) {
        if (shouldTreatAsTooLarge(err)) {
          throw toJsonTooLargeError(sourcePath, stat.size);
        }
        throw err;
      }
    };
    const readJsonlFromGzipStream = async (sourcePath, cleanup = false) => {
      const stat = fs.statSync(sourcePath);
      if (stat.size > maxBytes) {
        throw toJsonTooLargeError(sourcePath, stat.size);
      }
      if (stat.size <= SMALL_JSONL_BYTES) {
        const shouldMeasure = hasArtifactReadObserver();
        const start = shouldMeasure ? performance.now() : 0;
        const buffer = readBuffer(sourcePath, maxBytes);
        const decompressed = decompressBuffer(buffer, 'gzip', maxBytes, sourcePath);
        const parsed = readJsonlFromBuffer(decompressed, sourcePath);
        if (cleanup) cleanupBak(sourcePath);
        if (shouldMeasure) {
          recordArtifactRead({
            path: sourcePath,
            format: 'jsonl',
            compression: 'gzip',
            rawBytes: stat.size,
            bytes: decompressed.length,
            rows: parsed.length,
            durationMs: performance.now() - start
          });
        }
        return parsed;
      }
      const plan = resolveJsonlReadPlan(stat.size);
      const stream = fs.createReadStream(sourcePath, { highWaterMark: plan.highWaterMark });
      const gunzip = createGunzip({ chunkSize: plan.chunkSize });
      stream.on('error', (err) => gunzip.destroy(err));
      stream.pipe(gunzip);
      gunzip.setEncoding('utf8');
      try {
        return await readJsonlFromStream(sourcePath, gunzip, {
          rawBytes: stat.size,
          compression: 'gzip',
          cleanup
        });
      } finally {
        gunzip.destroy();
        stream.destroy();
      }
    };

    const readJsonlFromZstdStream = async (sourcePath, cleanup = false) => {
      const stat = fs.statSync(sourcePath);
      if (stat.size > maxBytes) {
        throw toJsonTooLargeError(sourcePath, stat.size);
      }
      const plan = resolveJsonlReadPlan(stat.size);
      const stream = fs.createReadStream(sourcePath, { highWaterMark: plan.highWaterMark });
      let zstd;
      try {
        zstd = createZstdDecompress({ chunkSize: plan.chunkSize });
      } catch (err) {
        stream.destroy();
        throw err;
      }
      stream.on('error', (err) => zstd.destroy(err));
      stream.pipe(zstd);
      zstd.setEncoding('utf8');
      try {
        return await readJsonlFromStream(sourcePath, zstd, {
          rawBytes: stat.size,
          compression: 'zstd',
          cleanup
        });
      } finally {
        zstd.destroy();
        stream.destroy();
      }
    };

    const tryRead = async (sourcePath, cleanup = false) => {
      const compression = detectCompression(sourcePath);
      if (compression) {
        if (compression === 'gzip') {
          return await readJsonlFromGzipStream(sourcePath, cleanup);
        }
        if (compression === 'zstd') {
          const parsed = await readJsonlFromZstdBuffer(sourcePath, cleanup);
          if (parsed !== null) return parsed;
          return await readJsonlFromZstdStream(sourcePath, cleanup);
        }
        const shouldMeasure = hasArtifactReadObserver();
        const start = shouldMeasure ? performance.now() : 0;
        const buffer = readBuffer(sourcePath, maxBytes);
        const decompressed = decompressBuffer(buffer, compression, maxBytes, sourcePath);
        const parsed = readJsonlFromBuffer(decompressed, sourcePath);
        if (cleanup) cleanupBak(sourcePath);
        if (shouldMeasure) {
          recordArtifactRead({
            path: sourcePath,
            format: 'jsonl',
            compression,
            rawBytes: buffer.length,
            bytes: decompressed.length,
            rows: parsed.length,
            durationMs: performance.now() - start
          });
        }
        return parsed;
      }
      const stat = fs.statSync(sourcePath);
      if (stat.size > maxBytes) {
        throw toJsonTooLargeError(sourcePath, stat.size);
      }
      const plan = resolveJsonlReadPlan(stat.size);
      if (plan.smallFile) {
        const shouldMeasure = hasArtifactReadObserver();
        const start = shouldMeasure ? performance.now() : 0;
        const buffer = readBuffer(sourcePath, maxBytes);
        const parsed = readJsonlFromBuffer(buffer, sourcePath);
        if (cleanup) cleanupBak(sourcePath);
        if (shouldMeasure) {
          recordArtifactRead({
            path: sourcePath,
            format: 'jsonl',
            compression: null,
            rawBytes: stat.size,
            bytes: stat.size,
            rows: parsed.length,
            durationMs: performance.now() - start
          });
        }
        return parsed;
      }
      const stream = fs.createReadStream(sourcePath, { highWaterMark: plan.highWaterMark });
      stream.setEncoding('utf8');
      return await readJsonlFromStream(sourcePath, stream, { rawBytes: stat.size, compression: null, cleanup });
    };

    const bakPath = getBakPath(targetPath);
    if (fs.existsSync(targetPath)) {
      try {
        return await tryRead(targetPath, true);
      } catch (err) {
        if (fs.existsSync(bakPath)) {
          return await tryRead(bakPath);
        }
        throw err;
      }
    }
    if (fs.existsSync(bakPath)) {
      return await tryRead(bakPath);
    }
    if (targetPath.endsWith('.jsonl')) {
      const candidates = collectCompressedJsonlCandidates(targetPath);
      if (candidates.length) {
        let lastErr = null;
        for (const candidate of candidates) {
          try {
            return await tryRead(candidate.path, candidate.cleanup);
          } catch (err) {
            lastErr = err;
          }
        }
        if (lastErr) throw lastErr;
      }
    }
    throw new Error(`Missing JSONL artifact: ${targetPath}`);
  };

  const paths = Array.isArray(filePath) ? filePath : [filePath];
  if (paths.length === 1) {
    return await readJsonLinesArraySingle(paths[0]);
  }
  const resolvedConcurrency = Math.max(1, Math.min(Number(concurrency) || 4, paths.length));
  const results = new Array(paths.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= paths.length) return;
      results[index] = await readJsonLinesArraySingle(paths[index]);
    }
  };
  await Promise.all(new Array(resolvedConcurrency).fill(0).map(() => worker()));
  const out = [];
  for (const part of results) {
    if (Array.isArray(part)) {
      for (const entry of part) {
        out.push(entry);
      }
    }
  }
  return out;
};


export const readJsonLinesArraySync = (
  filePath,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null, validationMode = 'strict' } = {}
) => {
  const useCache = !requiredKeys;
  const readCached = (targetPath) => (useCache ? readCache(targetPath) : null);
  const readJsonlFromBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    const parsed = [];
    const raw = buffer.toString('utf8');
    if (!raw.trim()) return parsed;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const entry = parseJsonlLine(
        lines[i],
        sourcePath,
        i + 1,
        maxBytes,
        requiredKeys,
        validationMode
      );
      if (entry !== null) parsed.push(entry);
    }
    return parsed;
  };
  const tryRead = (targetPath, cleanup = false) => {
    const cached = readCached(targetPath);
    if (cached) return cached;
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const compression = detectCompression(targetPath);
    if (compression) {
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const parsed = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (useCache) writeCache(targetPath, parsed);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression,
          rawBytes: buffer.length,
          bytes: decompressed.length,
          durationMs: performance.now() - start
        });
      }
      return parsed;
    }
    let raw = '';
    try {
      raw = fs.readFileSync(targetPath, 'utf8');
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, stat.size);
      }
      throw err;
    }
    if (!raw.trim()) return [];
    const parsed = [];
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const lineNumber = i + 1;
      const entry = parseJsonlLine(
        lines[i],
        targetPath,
        lineNumber,
        maxBytes,
        requiredKeys,
        validationMode
      );
      if (entry !== null) parsed.push(entry);
    }
    if (cleanup) cleanupBak(targetPath);
    if (useCache) writeCache(targetPath, parsed);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'jsonl',
        compression: null,
        rawBytes: stat.size,
        bytes: stat.size,
        durationMs: performance.now() - start
      });
    }
    return parsed;
  };
  const bakPath = getBakPath(filePath);
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, true);
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return tryRead(bakPath);
      }
      throw err;
    }
  }
  if (fs.existsSync(bakPath)) {
    return tryRead(bakPath);
  }
  if (filePath.endsWith('.jsonl')) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, candidate.cleanup);
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};
