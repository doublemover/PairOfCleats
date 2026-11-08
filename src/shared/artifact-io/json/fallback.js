import { getContainedFileSession } from '../../contained-file-resource.js';
import { observeStorageResource } from '../../storage/failure-observation.js';

const observations = new WeakMap();
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });

/** Capture once at an actual catch boundary, including every falsey thrown
 * value. This is diagnostic observation, never descriptor release authority.
 */
export const normalizeArtifactReadFailure = value => {
  const error = asError(value);
  if (!observations.has(error)) observations.set(error, {
    original: observeStorageResource(error, { phase: 'artifact-read-fallback' }), fields: new Map()
  });
  return error;
};
export const requireArtifactReadFailureSettled = value => {
  const error = normalizeArtifactReadFailure(value);
  if (getContainedFileSession(error)) throw error;
  observations.get(error).original.requireSettled();
  return error;
};
export const retainArtifactReadFailure = value => {
  const error = normalizeArtifactReadFailure(value);
  return observations.get(error).original.retain();
};
export const readArtifactFailureField = (value, key) => {
  if (key !== 'code' && key !== 'message') throw new TypeError('Unsupported artifact failure diagnostic.');
  const error = requireArtifactReadFailureSettled(value), state = observations.get(error);
  if (!state.fields.has(key)) {
    let field, failure, failed = false;
    try { field = error[key]; } catch (inspection) {
      failed = true; failure = state.original.retain(inspection, { inspectionPresent: true });
    }
    state.fields.set(key, { field, failure, failed });
  }
  const result = state.fields.get(key);
  if (result.failed) throw result.failure;
  state.original.requireSettled();
  return result.field;
};

/**
 * Detect filesystem "not found" read errors for fallback routing.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export const isMissingReadError = err => {
  const code = readArtifactFailureField(err, 'code');
  return code === 'ENOENT' || code === 'ENOTDIR';
};

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
export const canUseFallbackAfterPrimaryError = (primaryErr, recoveryFallback) => {
  if (primaryErr == null) return true;
  requireArtifactReadFailureSettled(primaryErr);
  return recoveryFallback === true || isMissingReadError(primaryErr);
};

/**
 * Capture the first non-missing fallback error so we can keep probing later
 * candidates, then throw a deterministic error if all candidates fail.
 *
 * @param {unknown} currentErr
 * @param {unknown} candidateErr
 * @returns {unknown}
 */
export const captureFallbackReadError = (currentErr, candidateErr) => {
  const candidate = requireArtifactReadFailureSettled(candidateErr);
  if (currentErr !== null && currentErr !== undefined) return requireArtifactReadFailureSettled(currentErr);
  if (isMissingReadError(candidate)) return null;
  return candidate;
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
  if (primaryErr !== null && primaryErr !== undefined && !isMissingReadError(primaryErr)) return primaryErr;
  return fallbackErr !== null && fallbackErr !== undefined ? requireArtifactReadFailureSettled(fallbackErr) : null;
};
