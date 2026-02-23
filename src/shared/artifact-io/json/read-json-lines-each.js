import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { MAX_JSON_BYTES } from '../constants.js';
import { cleanupBak } from '../cache.js';
import { decompressBuffer, detectCompression } from '../compression.js';
import { scanJsonlBuffer, scanJsonlStream } from './line-scan.js';
import {
  resolveOptionalZstd,
  resolveJsonlReadPlan,
  SMALL_JSONL_BYTES,
  ZSTD_STREAM_THRESHOLD
} from './read-plan.js';
import { resolveJsonlEachFallback } from './fallback-rules.js';
import { isMissingReadError, rethrowIfTooLargeLike } from './error-classification.js';
import { readBufferFromStat, statWithinLimit } from './io.js';
import { shouldAbortForHeap, toJsonTooLargeError } from '../limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from '../telemetry.js';

/**
 * Stream JSONL entries and invoke `onEntry` for each parsed row.
 *
 * Parsing invariants:
 * - Honors strict/trusted validation mode.
 * - Enforces `maxBytes` on compressed and decompressed paths.
 * - Uses `.bak` and compressed-candidate fallbacks when primary files fail.
 *
 * @param {string} filePath
 * @param {(entry:any)=>void|Promise<void>} onEntry
 * @param {{maxBytes?: number, requiredKeys?: string[]|null, validationMode?: 'strict'|'trusted'}} [options]
 * @returns {Promise<void>}
 */
export const readJsonLinesEach = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null, validationMode = 'strict' } = {}
) => {
  if (typeof onEntry !== 'function') return;
  /**
   * Parse JSONL rows from an in-memory payload buffer.
   *
   * @param {Buffer|string} buffer
   * @param {string} sourcePath
   * @returns {{rows:number,bytes:number}}
   */
  const readJsonlFromBuffer = (buffer, sourcePath) => (
    scanJsonlBuffer(buffer, sourcePath, {
      maxBytes,
      requiredKeys,
      validationMode,
      onEntry
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
      rethrowIfTooLargeLike(err, targetPath, bytes || rawBytes || maxBytes);
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
  const readJsonlFromGzipStream = async (targetPath, cleanup = false) => {
    const stat = statWithinLimit(targetPath, maxBytes);
    if (stat.size <= SMALL_JSONL_BYTES) {
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBufferFromStat(targetPath, maxBytes, stat);
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

  /**
   * Read zstd-compressed JSONL via streaming decompression.
   *
   * @param {string} targetPath
   * @param {boolean} [cleanup=false]
   * @returns {Promise<void>}
   */
  const readJsonlFromZstdStream = async (targetPath, cleanup = false) => {
    const stat = statWithinLimit(targetPath, maxBytes);
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
  /**
   * Attempt small zstd JSONL decode via in-memory decompression.
   *
   * @param {string} targetPath
   * @param {boolean} [cleanup=false]
   * @returns {Promise<boolean|null>}
   */
  const readJsonlFromZstdBuffer = async (targetPath, cleanup = false) => {
    const zstd = resolveOptionalZstd();
    if (!zstd) return null;
    const stat = statWithinLimit(targetPath, maxBytes);
    if (stat.size > ZSTD_STREAM_THRESHOLD) return null;
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    let payload;
    try {
      const buffer = readBufferFromStat(targetPath, maxBytes, stat);
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
      rethrowIfTooLargeLike(err, targetPath, stat.size);
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
      const stat = statWithinLimit(targetPath, maxBytes);
      const buffer = readBufferFromStat(targetPath, maxBytes, stat);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const { rows } = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression,
          rawBytes: stat.size,
          bytes: decompressed.length,
          rows,
          durationMs: performance.now() - start
        });
      }
      return;
    }
    const stat = statWithinLimit(targetPath, maxBytes);
    const plan = resolveJsonlReadPlan(stat.size);
    if (plan.smallFile) {
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBufferFromStat(targetPath, maxBytes, stat);
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

  const fallback = resolveJsonlEachFallback(filePath);
  let primaryErr = null;
  try {
    await tryRead(fallback.primary.path, fallback.primary.cleanup);
    return;
  } catch (err) {
    primaryErr = err;
  }
  try {
    await tryRead(fallback.backup.path, fallback.backup.cleanup);
    return;
  } catch (bakErr) {
    if (!isMissingReadError(bakErr)) throw bakErr;
  }
  if (fallback.compressed.length) {
    let lastErr = null;
    for (const candidate of fallback.compressed) {
      try {
        await tryRead(candidate.path, candidate.cleanup);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr && (primaryErr == null || isMissingReadError(primaryErr))) {
      primaryErr = lastErr;
    }
  }
  if (primaryErr && !isMissingReadError(primaryErr)) {
    throw primaryErr;
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};
