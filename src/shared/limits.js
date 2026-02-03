/**
 * Normalize an optional numeric value (finite number or null).
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Normalize an optional integer (finite number or null).
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

/**
 * Normalize an optional non-negative integer.
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
};

/**
 * Normalize a non-negative integer with fallback.
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
 * Normalize a positive number with fallback.
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
 * Normalize a positive integer with fallback.
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
 * Normalize a cap value (non-negative int).
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeCap = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

/**
 * Normalize a depth value (non-negative int).
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeDepth = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

/**
 * Normalize a limit value (non-negative int).
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const normalizeLimit = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

/**
 * Normalize an optional limit value.
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalLimit = (value) => (
  normalizeOptionalNonNegativeInt(value)
);

/**
 * Normalize a cap value, treating 0/false as "no cap".
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
