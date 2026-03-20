import { performance } from 'node:perf_hooks';
import { MAX_JSON_BYTES } from '../constants.js';
import { cleanupBak, getBakPath } from '../cache.js';
import {
  collectCompressedCandidates,
  decompressBuffer,
  detectCompression,
  readBuffer
} from '../compression.js';
import {
  canUseFallbackAfterPrimaryError,
  captureFallbackReadError,
  resolvePreferredReadError
} from './fallback.js';
import {
  shouldAbortForHeap,
  shouldTreatAsTooLarge,
  toJsonTooLargeError
} from '../limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from '../telemetry.js';

const parseJsonBuffer = (buffer, sourcePath, maxBytes) => {
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

const readJsonSource = (targetPath, maxBytes, { compression = null, cleanup = false } = {}) => {
  const shouldMeasure = hasArtifactReadObserver();
  const start = shouldMeasure ? performance.now() : 0;
  const buffer = readBuffer(targetPath, maxBytes);
  const resolvedCompression = compression || detectCompression(targetPath) || null;
  const decompressed = decompressBuffer(buffer, resolvedCompression, maxBytes, targetPath);
  const parsed = parseJsonBuffer(decompressed, targetPath, maxBytes);
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
  const bakPath = getBakPath(filePath);
  let primaryErr = null;
  try {
    return readJsonSource(filePath, maxBytes, { cleanup: true });
  } catch (err) {
    primaryErr = err;
    if (!canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback)) {
      throw primaryErr;
    }
  }

  let fallbackErr = null;
  if (filePath.endsWith('.json')) {
    for (const candidate of collectCompressedCandidates(filePath)) {
      try {
        return readJsonSource(candidate.path, maxBytes, {
          compression: candidate.compression,
          cleanup: candidate.cleanup
        });
      } catch (err) {
        fallbackErr = captureFallbackReadError(fallbackErr, err);
      }
    }
  }

  try {
    return readJsonSource(bakPath, maxBytes);
  } catch (bakErr) {
    fallbackErr = captureFallbackReadError(fallbackErr, bakErr);
  }

  const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
  if (preferredErr) throw preferredErr;
  throw new Error(`Missing JSON artifact: ${filePath}`);
};
