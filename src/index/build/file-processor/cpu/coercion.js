import { normalizeOptionalNumber, normalizePositiveNumber } from '../../../../shared/limits.js';

/**
 * Resolve a value to a positive finite number, with fallback.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export const resolvePositiveNumber = (value, fallback) => (
  normalizePositiveNumber(value, fallback)
);

/**
 * Resolve a value to a finite non-negative number, with fallback.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export const resolveNonNegativeNumber = (value, fallback) => {
  const parsed = normalizeOptionalNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};
