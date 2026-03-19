/**
 * Detect filesystem "not found" read errors for fallback routing.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export const isMissingReadError = (err) => (
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
export const canUseFallbackAfterPrimaryError = (primaryErr, recoveryFallback) => (
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
export const captureFallbackReadError = (currentErr, candidateErr) => {
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
export const resolvePreferredReadError = (primaryErr, fallbackErr) => {
  if (primaryErr && !isMissingReadError(primaryErr)) return primaryErr;
  return fallbackErr || null;
};
