import { shouldTreatAsTooLarge, toJsonTooLargeError } from '../limits.js';

/**
 * Classify filesystem misses that should trigger fallback resolution.
 *
 * ENOENT covers missing files; ENOTDIR covers invalid path segments while
 * probing sibling artifacts.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export const isMissingReadError = (err) => (
  err?.code === 'ENOENT' || err?.code === 'ENOTDIR'
);

/**
 * Re-map runtime/OOM style failures to the canonical artifact size error.
 *
 * @param {unknown} err
 * @param {string} targetPath
 * @param {number} byteSize
 */
export const rethrowIfTooLargeLike = (err, targetPath, byteSize) => {
  if (err?.code === 'ERR_JSON_TOO_LARGE') throw err;
  if (shouldTreatAsTooLarge(err)) {
    throw toJsonTooLargeError(targetPath, byteSize);
  }
};
