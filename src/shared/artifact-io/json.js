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
import {
  parseJsonlBufferEntries,
  parseJsonlStreamEntries,
  scanJsonlBuffer,
  scanJsonlStream
} from './json/line-scan.js';
import { createRowQueue } from './json/row-queue.js';
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

/**
 * Resolve optional userland zstd bindings once and memoize the result.
 *
 * @returns {{decompress:(buffer:Buffer)=>Promise<Buffer|Uint8Array>}|null}
 */
const resolveOptionalZstd = () => {
  if (checkedZstd) return cachedZstd;
  checkedZstd = true;
  const result = tryRequire('@mongodb-js/zstd');
  if (result.ok && typeof result.mod?.decompress === 'function') {
    cachedZstd = result.mod;
  }
  return cachedZstd;
};

/**
 * Choose stream chunk sizes based on compressed/plain JSONL file size.
 *
 * @param {number} byteSize
 * @returns {{highWaterMark:number,chunkSize:number,smallFile:boolean}}
 */
const resolveJsonlReadPlan = (byteSize) => {
  if (byteSize <= SMALL_JSONL_BYTES) {
    return { highWaterMark: JSONL_HIGH_WATERMARK_SMALL, chunkSize: JSONL_HIGH_WATERMARK_SMALL, smallFile: true };
  }
  if (byteSize <= MEDIUM_JSONL_BYTES) {
    return { highWaterMark: JSONL_HIGH_WATERMARK_MEDIUM, chunkSize: JSONL_HIGH_WATERMARK_MEDIUM, smallFile: false };
  }
  return { highWaterMark: JSONL_HIGH_WATERMARK_LARGE, chunkSize: JSONL_HIGH_WATERMARK_LARGE, smallFile: false };
};

/**
 * Detect filesystem \"not found\" read errors for fallback routing.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
const isMissingReadError = (err) => (
  err?.code === 'ENOENT' || err?.code === 'ENOTDIR'
);

/**
 * Decide whether fallback sources are allowed after primary failure.
 *
 * Strict mode only permits fallback when the primary artifact is missing.
 * Recovery mode permits fallback for any primary failure.
 *
 * @param {unknown} primaryErr
 * @param {boolean} recoveryFallback
 * @returns {boolean}
 */
const canUseFallbackAfterPrimaryError = (primaryErr, recoveryFallback) => (
  recoveryFallback === true || primaryErr == null || isMissingReadError(primaryErr)
);

/**
 * Capture the first non-missing fallback error so we can keep probing later
 * candidates, then throw a deterministic error if all candidates fail.
 *
 * @param {unknown} currentErr
 * @param {unknown} candidateErr
 * @returns {unknown}
 */
const captureFallbackReadError = (currentErr, candidateErr) => {
  if (currentErr) return currentErr;
  if (isMissingReadError(candidateErr)) return null;
  return candidateErr;
};

/**
 * Prefer non-missing primary failures (when fallback mode allows probing) and
 * otherwise surface the first non-missing fallback failure.
 *
 * @param {unknown} primaryErr
 * @param {unknown} fallbackErr
 * @returns {unknown}
 */
const resolvePreferredReadError = (primaryErr, fallbackErr) => {
  if (primaryErr && !isMissingReadError(primaryErr)) return primaryErr;
  return fallbackErr || null;
};

/**
 * Read and parse a JSON artifact with compression and backup fallbacks.
 *
 * Fallback order:
 * 1. `filePath` (and cleanup stale `.bak` when successful)
 * 2. compressed sibling candidates for `.json` targets
 * 3. `filePath.bak`
 *
 * Fallback policy:
 * - default (`recoveryFallback=false`): only fallback when primary is missing
 * - recovery mode (`recoveryFallback=true`): fallback on any primary failure
 *
 * @param {string} filePath
 * @param {{maxBytes?: number,recoveryFallback?:boolean}} [options]
 * @returns {any}
 */
export const readJsonFile = (
  filePath,
  { maxBytes = MAX_JSON_BYTES, recoveryFallback = false } = {}
) => {
  /**
   * Parse JSON payload buffer with size/heap guards.
   *
   * @param {Buffer} buffer
   * @param {string} sourcePath
   * @returns {any}
   */
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
  /**
   * Read one JSON source candidate and record read metrics.
   *
   * @param {string} targetPath
   * @param {{compression?:string|null,cleanup?:boolean}} [options]
   * @returns {any}
   */
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
  let primaryErr = null;
  try {
    return tryRead(filePath, { cleanup: true });
  } catch (err) {
    primaryErr = err;
    const allowFallback = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
    if (!allowFallback) {
      throw primaryErr;
    }
  }
  const allowFallback = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
  let fallbackErr = null;
  if (filePath.endsWith('.json') && allowFallback) {
    const candidates = collectCompressedCandidates(filePath);
    if (candidates.length) {
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, {
            compression: candidate.compression,
            cleanup: candidate.cleanup
          });
        } catch (err) {
          fallbackErr = captureFallbackReadError(fallbackErr, err);
        }
      }
    }
  }
  if (allowFallback) {
    try {
      return tryRead(bakPath);
    } catch (bakErr) {
      fallbackErr = captureFallbackReadError(fallbackErr, bakErr);
    }
  }
  const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
  if (preferredErr) throw preferredErr;
  throw new Error(`Missing JSON artifact: ${filePath}`);
};

/**
 * Stream JSONL entries and invoke `onEntry` for each parsed row.
 *
 * Parsing invariants:
 * - Honors strict/trusted validation mode.
 * - Enforces `maxBytes` on compressed and decompressed paths.
 * - Uses `.bak` and compressed-candidate fallbacks when primary files fail in
 *   recovery mode, or when primaries are missing in strict mode.
 *
 * @param {string} filePath
 * @param {(entry:any)=>void|Promise<void>} onEntry
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {Promise<void>}
 */
export const readJsonLinesEach = async (
  filePath,
  onEntry,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    recoveryFallback = false
  } = {}
) => {
  if (typeof onEntry !== 'function') return;
  /**
   * Parse JSONL rows from an in-memory payload buffer.
   *
   * @param {Buffer|string} buffer
   * @param {string} sourcePath
   * @returns {{rows:number,bytes:number}}
   */
  const readJsonlFromBuffer = (buffer, sourcePath, emitEntry = onEntry) => (
    scanJsonlBuffer(buffer, sourcePath, {
      maxBytes,
      requiredKeys,
      validationMode,
      onEntry: emitEntry
    })
  );
  /**
   * Parse JSONL rows from a stream and emit telemetry.
   *
   * @param {string} targetPath
   * @param {import('stream').Readable} stream
   * @param {{rawBytes?:number,compression?:string|null,cleanup?:boolean}} [options]
   * @returns {Promise<void>}
   */
  const readJsonlFromStream = async (
    targetPath,
    stream,
    { rawBytes, compression, cleanup = false, emitEntry = onEntry } = {}
  ) => {
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
        onEntry: emitEntry
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
  /**
   * Read gzip-compressed JSONL via buffered or streaming path.
   *
   * @param {string} targetPath
   * @param {boolean} [cleanup=false]
   * @returns {Promise<void>}
   */
  const readJsonlFromGzipStream = async (
    targetPath,
    cleanup = false,
    emitEntry = onEntry
  ) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    if (stat.size <= SMALL_JSONL_BYTES) {
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, 'gzip', maxBytes, targetPath);
      const { rows, bytes } = readJsonlFromBuffer(decompressed, targetPath, emitEntry);
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
        cleanup,
        emitEntry
      });
    } finally {
      gunzip.destroy();
      stream.destroy();
    }
  };

  /**
   * Read zstd-compressed JSONL via streaming decompression.
   *
   * @param {string} targetPath
   * @param {boolean} [cleanup=false]
   * @returns {Promise<void>}
   */
  const readJsonlFromZstdStream = async (
    targetPath,
    cleanup = false,
    emitEntry = onEntry
  ) => {
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
        cleanup,
        emitEntry
      });
    } finally {
      zstd.destroy();
      stream.destroy();
    }
  };
  /**
   * Attempt small zstd JSONL decode via in-memory decompression.
   *
   * @param {string} targetPath
   * @param {boolean} [cleanup=false]
   * @returns {Promise<boolean|null>}
   */
  const readJsonlFromZstdBuffer = async (
    targetPath,
    cleanup = false,
    emitEntry = onEntry
  ) => {
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
      const { rows, bytes } = readJsonlFromBuffer(payload, targetPath, emitEntry);
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

  /**
   * Read one JSONL source candidate with compression-aware strategy.
   *
   * @param {string} targetPath
   * @param {boolean} [cleanup=false]
   * @returns {Promise<void>}
   */
  const tryRead = async (targetPath, cleanup = false, emitEntry = onEntry) => {
    const compression = detectCompression(targetPath);
    if (compression) {
      if (compression === 'gzip') {
        await readJsonlFromGzipStream(targetPath, cleanup, emitEntry);
        return;
      }
      if (compression === 'zstd') {
        const usedBuffer = await readJsonlFromZstdBuffer(targetPath, cleanup, emitEntry);
        if (usedBuffer) return;
        await readJsonlFromZstdStream(targetPath, cleanup, emitEntry);
        return;
      }
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const { rows } = readJsonlFromBuffer(decompressed, targetPath, emitEntry);
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
      const { rows, bytes } = readJsonlFromBuffer(buffer, targetPath, emitEntry);
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
    await readJsonlFromStream(targetPath, stream, {
      rawBytes: stat.size,
      compression: null,
      cleanup,
      emitEntry
    });
  };

  const attemptTrackedRead = async (targetPath, cleanup = false) => {
    let emitted = 0;
    const emitEntry = async (entry) => {
      emitted += 1;
      await onEntry(entry);
    };
    try {
      await tryRead(targetPath, cleanup, emitEntry);
      return { ok: true, emitted, error: null };
    } catch (error) {
      return { ok: false, emitted, error };
    }
  };
  const bakPath = getBakPath(filePath);
  let primaryErr = null;
  const primaryAttempt = await attemptTrackedRead(filePath, true);
  if (primaryAttempt.ok) return;
  primaryErr = primaryAttempt.error;
  const allowFallback = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
  if (primaryAttempt.emitted > 0 || !allowFallback) {
    throw primaryErr;
  }
  let fallbackErr = null;
  if (allowFallback) {
    const bakAttempt = await attemptTrackedRead(bakPath);
    if (bakAttempt.ok) return;
    if (bakAttempt.emitted > 0) {
      throw bakAttempt.error;
    }
    fallbackErr = captureFallbackReadError(fallbackErr, bakAttempt.error);
  }
  if (filePath.endsWith('.jsonl') && allowFallback) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      for (const candidate of candidates) {
        const candidateAttempt = await attemptTrackedRead(candidate.path, candidate.cleanup);
        if (candidateAttempt.ok) return;
        if (candidateAttempt.emitted > 0) {
          throw candidateAttempt.error;
        }
        fallbackErr = captureFallbackReadError(fallbackErr, candidateAttempt.error);
      }
    }
  }
  const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
  if (preferredErr) throw preferredErr;
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};

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
 *   byteRange?: {start:number,end:number}|null,
 *   recoveryFallback?:boolean
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
    byteRange = null,
    recoveryFallback = false
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

  /**
   * Producer coroutine that discovers source candidate, parses rows, and pushes
   * entries into the bounded consumer queue.
   *
   * @returns {Promise<void>}
   */
  const producer = (async () => {
    try {
      const hasRange = byteRange && Number.isFinite(byteRange.start) && Number.isFinite(byteRange.end);
      const range = hasRange
        ? { start: Math.max(0, byteRange.start), end: Math.max(0, byteRange.end - 1) }
        : null;
      const primaryCandidate = {
        path: targetPath,
        compression: detectCompression(targetPath),
        cleanup: true
      };
      const fallbackCandidates = [
        {
          path: getBakPath(targetPath),
          compression: detectCompression(getBakPath(targetPath)),
          cleanup: false
        }
      ];
      if (!hasRange && targetPath.endsWith('.jsonl')) {
        fallbackCandidates.push(...collectCompressedJsonlCandidates(targetPath));
      }
      const sources = [primaryCandidate, ...fallbackCandidates];
      let primaryErr = null;
      let fallbackEnabled = true;
      let fallbackErr = null;
      let lastErr = null;
      for (let index = 0; index < sources.length; index += 1) {
        const candidate = sources[index];
        if (index > 0 && !fallbackEnabled) break;
        let emittedForCandidate = 0;
        const pushEntry = async (entry) => {
          emittedForCandidate += 1;
          await queue.push(entry);
        };
        try {
          sourcePath = candidate.path;
          compression = candidate.compression ?? detectCompression(candidate.path);
          cleanup = candidate.cleanup;
          if (range && compression) {
            throw new Error(
              `[artifact-io] byteRange requires an uncompressed JSONL source: ${sourcePath}`
            );
          }
          const stat = fs.statSync(sourcePath);
          rawBytes = stat.size;
          if (stat.size > maxBytes) {
            throw toJsonTooLargeError(sourcePath, stat.size);
          }
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
                await pushEntry(entry);
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
                await pushEntry(entry);
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
                await pushEntry(entry);
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
          if (emittedForCandidate > 0) {
            throw err;
          }
          if (index === 0) {
            primaryErr = err;
            fallbackEnabled = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
            if (!fallbackEnabled) {
              throw primaryErr;
            }
          } else {
            fallbackErr = captureFallbackReadError(fallbackErr, err);
          }
          lastErr = err;
          stream = null;
        }
      }
      if (!stream) {
        const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
        throw preferredErr || lastErr || primaryErr || new Error(`Missing JSONL artifact: ${targetPath}`);
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

/**
 * Create an async iterator over one or more JSONL sources.
 *
 * @param {string|string[]} filePath
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   maxInFlight?: number,
 *   onBackpressure?: ((pending:number) => void)|null,
 *   onResume?: ((pending:number) => void)|null,
 *   byteRange?: {start:number,end:number}|null,
 *   recoveryFallback?:boolean
 * }} [options]
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
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {Promise<void>}
 */
export const readJsonLinesEachAwait = async (
  filePath,
  onEntry,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    recoveryFallback = false
  } = {}
) => {
  if (typeof onEntry !== 'function') return;
  for await (const entry of readJsonLinesIterator(filePath, {
    maxBytes,
    requiredKeys,
    validationMode,
    recoveryFallback
  })) {
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
 *   concurrency?: number|null,
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {Promise<any[]>}
 */
export const readJsonLinesArray = async (
  filePath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    concurrency = null,
    recoveryFallback = false
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
    /**
     * Parse gzip-compressed JSONL for one source path.
     *
     * @param {string} sourcePath
     * @param {boolean} [cleanup=false]
     * @returns {Promise<any[]>}
     */
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

    /**
     * Parse zstd-compressed JSONL for one source path.
     *
     * @param {string} sourcePath
     * @param {boolean} [cleanup=false]
     * @returns {Promise<any[]>}
     */
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
    let primaryErr = null;
    if (fs.existsSync(targetPath)) {
      try {
        return await tryRead(targetPath, true);
      } catch (err) {
        primaryErr = err;
        const allowFallback = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
        if (!allowFallback) {
          throw primaryErr;
        }
      }
    }
    const allowFallback = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
    let fallbackErr = null;
    if (allowFallback && fs.existsSync(bakPath)) {
      try {
        return await tryRead(bakPath);
      } catch (err) {
        fallbackErr = captureFallbackReadError(fallbackErr, err);
      }
    }
    if (targetPath.endsWith('.jsonl') && allowFallback) {
      const candidates = collectCompressedJsonlCandidates(targetPath);
      if (candidates.length) {
        for (const candidate of candidates) {
          try {
            return await tryRead(candidate.path, candidate.cleanup);
          } catch (err) {
            fallbackErr = captureFallbackReadError(fallbackErr, err);
          }
        }
      }
    }
    const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
    if (preferredErr) throw preferredErr;
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
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {any[]}
 */
export const readJsonLinesArraySync = (
  filePath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    recoveryFallback = false
  } = {}
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
  let primaryErr = null;
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, true);
    } catch (err) {
      primaryErr = err;
      const allowFallback = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
      if (!allowFallback) {
        throw primaryErr;
      }
    }
  }
  const allowFallback = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
  let fallbackErr = null;
  if (allowFallback && fs.existsSync(bakPath)) {
    try {
      return tryRead(bakPath);
    } catch (err) {
      fallbackErr = captureFallbackReadError(fallbackErr, err);
    }
  }
  if (filePath.endsWith('.jsonl') && allowFallback) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, candidate.cleanup);
        } catch (err) {
          fallbackErr = captureFallbackReadError(fallbackErr, err);
        }
      }
    }
  }
  const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
  if (preferredErr) throw preferredErr;
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};
