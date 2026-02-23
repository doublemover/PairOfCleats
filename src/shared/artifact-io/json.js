import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { MAX_JSON_BYTES } from './constants.js';
import { cleanupBak, readCache, writeCache } from './cache.js';
import {
  decompressBuffer,
  detectCompression,
  readBuffer
} from './compression.js';
import { parseJsonlLine } from './jsonl.js';
import {
  parseJsonlStreamEntries,
  scanJsonlBuffer,
  scanJsonlStream
} from './json/line-scan.js';
import { scanJsonlBufferAsync } from './json/line-scan-async.js';
import { createRowQueue } from './json/row-queue.js';
import {
  resolveOptionalZstd,
  resolveJsonlReadPlan,
  SMALL_JSONL_BYTES,
  ZSTD_STREAM_THRESHOLD
} from './json/read-plan.js';
import {
  resolveJsonlArraySyncFallback,
  resolveJsonlIteratorSources
} from './json/fallback-rules.js';
import { isMissingReadError, rethrowIfTooLargeLike } from './json/error-classification.js';
import { readBufferFromStat, readUtf8FromStat, statWithinLimit, toInclusiveByteRange } from './json/io.js';
import { shouldAbortForHeap, toJsonTooLargeError } from './limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from './telemetry.js';
export { readJsonFile } from './json/read-json-file.js';
export { readJsonLinesEach } from './json/read-json-lines-each.js';

/**
 * Read a single JSONL source as an async iterator with bounded buffering.
 *
 * Uses `createRowQueue` to apply producer-side backpressure when
 * `maxInFlight > 0`.
 *
 * @param {string} targetPath
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   maxInFlight?: number,
 *   onBackpressure?: ((pending:number) => void)|null,
 *   onResume?: ((pending:number) => void)|null,
 *   byteRange?: {start:number,end:number}|null
 * }} [options]
 * @returns {AsyncGenerator<any, void, unknown>}
 */
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
  const pushEntry = async (entry) => {
    await queue.push(entry);
  };
  const finalizeSuccess = () => {
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
  };

  /**
   * Producer coroutine that discovers source candidate, parses rows, and pushes
   * entries into the bounded consumer queue.
   *
   * @returns {Promise<void>}
   */
  const producer = (async () => {
    try {
      const sources = resolveJsonlIteratorSources(targetPath);
      let lastErr = null;
      for (const candidate of sources) {
        try {
          sourcePath = candidate.path;
          compression = candidate.compression ?? detectCompression(candidate.path);
          cleanup = candidate.cleanup;
          const stat = statWithinLimit(sourcePath, maxBytes);
          rawBytes = stat.size;
          const range = toInclusiveByteRange(byteRange);
          const plan = resolveJsonlReadPlan(stat.size);
          if (!range && (plan.smallFile || (compression === 'gzip' && stat.size <= SMALL_JSONL_BYTES))) {
            if (compression === 'gzip') {
              const buffer = readBufferFromStat(sourcePath, maxBytes, stat);
              const decompressed = decompressBuffer(buffer, 'gzip', maxBytes, sourcePath);
              ({ rows, bytes } = await scanJsonlBufferAsync(decompressed, sourcePath, {
                maxBytes,
                requiredKeys,
                validationMode,
                onEntry: pushEntry
              }));
              finalizeSuccess();
              return;
            }
            if (!compression) {
              const buffer = readBufferFromStat(sourcePath, maxBytes, stat);
              ({ rows, bytes } = await scanJsonlBufferAsync(buffer, sourcePath, {
                maxBytes,
                requiredKeys,
                validationMode,
                onEntry: pushEntry
              }));
              finalizeSuccess();
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
              const buffer = readBufferFromStat(sourcePath, maxBytes, stat);
              const decoded = await zstd.decompress(buffer);
              const payload = Buffer.isBuffer(decoded) ? decoded : Buffer.from(decoded);
              ({ rows, bytes } = await scanJsonlBufferAsync(payload, sourcePath, {
                maxBytes,
                requiredKeys,
                validationMode,
                onEntry: pushEntry
              }));
              finalizeSuccess();
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
        onEntry: pushEntry
      }));
      finalizeSuccess();
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

/**
 * Create an async iterator over one or more JSONL sources.
 *
 * @param {string|string[]} filePath
 * @param {object} [options]
 * @returns {AsyncGenerator<any, void, unknown>}
 */
export const readJsonLinesIterator = function (filePath, options = {}) {
  const paths = Array.isArray(filePath) ? filePath : [filePath];
  return (async function* () {
    for (const sourcePath of paths) {
      yield* readJsonLinesIteratorSingle(sourcePath, options);
    }
  })();
};

/**
 * Iterate JSONL rows and await `onEntry` serially for each parsed row.
 *
 * @param {string|string[]} filePath
 * @param {(entry:any)=>Promise<void>} onEntry
 * @param {{maxBytes?: number, requiredKeys?: string[]|null, validationMode?: 'strict'|'trusted'}} [options]
 * @returns {Promise<void>}
 */
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


/**
 * Materialize JSONL entries from one or more sources.
 *
 * Uses compression-aware fast paths for small files and bounded parallelism
 * when multiple input files are supplied.
 *
 * @param {string|string[]} filePath
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   concurrency?: number|null
 * }} [options]
 * @returns {Promise<any[]>}
 */
export const readJsonLinesArray = async (
  filePath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    concurrency = null
  } = {}
) => {
  /**
   * Materialize JSONL rows from a single source path.
   *
   * @param {string} targetPath
   * @returns {Promise<any[]>}
   */
  const readJsonLinesArraySingle = async (targetPath) => {
    /**
     * Parse JSONL rows from in-memory payload.
     *
     * @param {Buffer|string} buffer
     * @param {string} sourcePath
     * @returns {any[]}
     */
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
    /**
     * Parse JSONL rows from stream source and return accumulated rows.
     *
     * @param {string} sourcePath
     * @param {import('stream').Readable} stream
     * @param {{rawBytes?:number,compression?:string|null,cleanup?:boolean}} [options]
     * @returns {Promise<any[]>}
     */
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
        rethrowIfTooLargeLike(err, sourcePath, bytes || rawBytes || maxBytes);
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
    /**
     * Attempt in-memory zstd decode path for smaller JSONL payloads.
     *
     * @param {string} sourcePath
     * @param {boolean} [cleanup=false]
     * @returns {Promise<any[]|null>}
     */
    const readJsonlFromZstdBuffer = async (sourcePath, cleanup = false) => {
      const zstd = resolveOptionalZstd();
      if (!zstd) return null;
      const stat = statWithinLimit(sourcePath, maxBytes);
      if (stat.size > ZSTD_STREAM_THRESHOLD) return null;
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      try {
        const buffer = readBufferFromStat(sourcePath, maxBytes, stat);
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
        rethrowIfTooLargeLike(err, sourcePath, stat.size);
        throw err;
      }
    };
    /**
     * Parse gzip-compressed JSONL for one source path.
     *
     * @param {string} sourcePath
     * @param {boolean} [cleanup=false]
     * @returns {Promise<any[]>}
     */
    const readJsonlFromGzipStream = async (sourcePath, cleanup = false) => {
      const stat = statWithinLimit(sourcePath, maxBytes);
      if (stat.size <= SMALL_JSONL_BYTES) {
        const shouldMeasure = hasArtifactReadObserver();
        const start = shouldMeasure ? performance.now() : 0;
        const buffer = readBufferFromStat(sourcePath, maxBytes, stat);
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

    /**
     * Parse zstd-compressed JSONL for one source path.
     *
     * @param {string} sourcePath
     * @param {boolean} [cleanup=false]
     * @returns {Promise<any[]>}
     */
    const readJsonlFromZstdStream = async (sourcePath, cleanup = false) => {
      const stat = statWithinLimit(sourcePath, maxBytes);
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

    /**
     * Read one source path with compression-aware decode and telemetry.
     *
     * @param {string} sourcePath
     * @param {boolean} [cleanup=false]
     * @returns {Promise<any[]>}
     */
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
        const stat = statWithinLimit(sourcePath, maxBytes);
        const buffer = readBufferFromStat(sourcePath, maxBytes, stat);
        const decompressed = decompressBuffer(buffer, compression, maxBytes, sourcePath);
        const parsed = readJsonlFromBuffer(decompressed, sourcePath);
        if (cleanup) cleanupBak(sourcePath);
        if (shouldMeasure) {
          recordArtifactRead({
            path: sourcePath,
            format: 'jsonl',
            compression,
            rawBytes: stat.size,
            bytes: decompressed.length,
            rows: parsed.length,
            durationMs: performance.now() - start
          });
        }
        return parsed;
      }
      const stat = statWithinLimit(sourcePath, maxBytes);
      const plan = resolveJsonlReadPlan(stat.size);
      if (plan.smallFile) {
        const shouldMeasure = hasArtifactReadObserver();
        const start = shouldMeasure ? performance.now() : 0;
        const buffer = readBufferFromStat(sourcePath, maxBytes, stat);
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

    const fallback = resolveJsonlArraySyncFallback(targetPath);
    try {
      return await tryRead(fallback.primary.path, fallback.primary.cleanup);
    } catch (primaryErr) {
      if (!isMissingReadError(primaryErr)) {
        try {
          return await tryRead(fallback.backup.path, fallback.backup.cleanup);
        } catch (bakErr) {
          if (!isMissingReadError(bakErr)) throw bakErr;
        }
        throw primaryErr;
      }
    }
    try {
      return await tryRead(fallback.backup.path, fallback.backup.cleanup);
    } catch (bakErr) {
      if (!isMissingReadError(bakErr)) throw bakErr;
    }
    if (fallback.compressed.length) {
      let lastErr = null;
      for (const candidate of fallback.compressed) {
        try {
          return await tryRead(candidate.path, candidate.cleanup);
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
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
  /**
   * Parallel worker for multi-path JSONL reads.
   *
   * @returns {Promise<void>}
   */
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


/**
 * Synchronously materialize JSONL entries from a single source.
 *
 * Cache behavior:
 * - Cache is used only when `requiredKeys` is not specified.
 * - Successful primary reads may cleanup stale `.bak` files.
 *
 * @param {string} filePath
 * @param {{maxBytes?: number, requiredKeys?: string[]|null, validationMode?: 'strict'|'trusted'}} [options]
 * @returns {any[]}
 */
export const readJsonLinesArraySync = (
  filePath,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null, validationMode = 'strict' } = {}
) => {
  const useCache = !requiredKeys;
  /**
   * Resolve sync JSONL cache hit when cache is enabled.
   *
   * @param {string} targetPath
   * @returns {any[]|null}
   */
  const readCached = (targetPath) => (useCache ? readCache(targetPath) : null);
  /**
   * Parse sync JSONL payload from buffer.
   *
   * @param {Buffer} buffer
   * @param {string} sourcePath
   * @returns {any[]}
   */
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
  /**
   * Read one sync JSONL source candidate with optional cleanup.
   *
   * @param {string} targetPath
   * @param {boolean} [cleanup=false]
   * @returns {any[]}
   */
  const tryRead = (targetPath, cleanup = false) => {
    const cached = readCached(targetPath);
    if (cached) return cached;
    const stat = statWithinLimit(targetPath, maxBytes);
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const compression = detectCompression(targetPath);
    if (compression) {
      const buffer = readBufferFromStat(targetPath, maxBytes, stat);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const parsed = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (useCache) writeCache(targetPath, parsed);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression,
          rawBytes: stat.size,
          bytes: decompressed.length,
          durationMs: performance.now() - start
        });
      }
      return parsed;
    }
    const raw = readUtf8FromStat(targetPath, maxBytes, stat);
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
  const fallback = resolveJsonlArraySyncFallback(filePath);
  try {
    return tryRead(fallback.primary.path, fallback.primary.cleanup);
  } catch (primaryErr) {
    if (!isMissingReadError(primaryErr)) {
      try {
        return tryRead(fallback.backup.path, fallback.backup.cleanup);
      } catch (bakErr) {
        if (!isMissingReadError(bakErr)) throw bakErr;
      }
      throw primaryErr;
    }
  }
  try {
    return tryRead(fallback.backup.path, fallback.backup.cleanup);
  } catch (bakErr) {
    if (!isMissingReadError(bakErr)) throw bakErr;
  }
  if (fallback.compressed.length) {
    let lastErr = null;
    for (const candidate of fallback.compressed) {
      try {
        return tryRead(candidate.path, candidate.cleanup);
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};
