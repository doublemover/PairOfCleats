import { performance } from 'node:perf_hooks';
import { MAX_JSON_BYTES } from '../constants.js';
import { cleanupBak } from '../cache.js';
import {
  decompressBuffer,
  detectCompression,
  readBuffer
} from '../compression.js';
import { resolveJsonReadFallback } from './fallback-rules.js';
import { isMissingReadError, rethrowIfTooLargeLike } from './error-classification.js';
import { shouldAbortForHeap, toJsonTooLargeError } from '../limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from '../telemetry.js';

/**
 * Read and parse a JSON artifact with compression and backup fallbacks.
 *
 * Fallback order:
 * 1. `filePath` (and cleanup stale `.bak` when successful)
 * 2. compressed sibling candidates for `.json` targets
 * 3. `filePath.bak`
 *
 * @param {string} filePath
 * @param {{maxBytes?: number}} [options]
 * @returns {any}
 */
export const readJsonFile = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
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
      rethrowIfTooLargeLike(err, sourcePath, buffer.length);
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
  const fallback = resolveJsonReadFallback(filePath);
  let primaryErr = null;
  try {
    return tryRead(fallback.primary.path, fallback.primary);
  } catch (err) {
    primaryErr = err;
  }
  if (fallback.compressed.length) {
    let lastErr = null;
    for (const candidate of fallback.compressed) {
      try {
        return tryRead(candidate.path, candidate);
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr && (primaryErr == null || isMissingReadError(primaryErr))) {
      primaryErr = lastErr;
    }
  }
  try {
    return tryRead(fallback.backup.path, fallback.backup);
  } catch (bakErr) {
    if (!isMissingReadError(bakErr)) throw bakErr;
  }
  if (primaryErr && !isMissingReadError(primaryErr)) {
    throw primaryErr;
  }
  throw new Error(`Missing JSON artifact: ${filePath}`);
};
