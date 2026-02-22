/**
 * Normalize a numeric value to a finite number or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Clamp a numeric value between inclusive bounds.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Clamp a value to an integer range, using a fallback when invalid.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback=min]
 * @returns {number}
 */
export const clampInt = (value, min, max, fallback = min) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.floor(parsed), min, max);
};

/**
 * Normalize an integer value to a finite integer or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

/**
 * Normalize a value to a non-negative integer or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
};

/**
 * Normalize a value to a non-negative integer, falling back when invalid.
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeNonNegativeInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

/**
 * Normalize a value to a positive number, falling back when invalid.
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizePositiveNumber = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

/**
 * Normalize a value to a positive integer, falling back when invalid.
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizePositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

/**
 * Normalize a cap value to a non-negative integer.
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeCap = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

/**
 * Normalize a depth value to a non-negative integer.
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeDepth = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

/**
 * Normalize a limit value to a non-negative integer.
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeLimit = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

/**
 * Normalize an optional limit value to a non-negative integer or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalLimit = (value) => (
  normalizeOptionalNonNegativeInt(value)
);

/**
 * Normalize a cap, treating 0 or false as "no cap".
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeCapNullOnZero = (value, fallback = null) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};
