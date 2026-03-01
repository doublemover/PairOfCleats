/**
 * Coerce a value to a finite number.
 *
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export const coerceFiniteNumber = (value, fallback = null) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  if (fallback == null) return null;
  const fallbackParsed = Number(fallback);
  return Number.isFinite(fallbackParsed) ? fallbackParsed : null;
};

export const INTEGER_COERCE_MODE_TRUNCATE = 'truncate';
export const INTEGER_COERCE_MODE_STRICT = 'strict';

const resolveIntegerCoerceMode = (options = {}) => (
  options?.mode === INTEGER_COERCE_MODE_STRICT
    ? INTEGER_COERCE_MODE_STRICT
    : INTEGER_COERCE_MODE_TRUNCATE
);

const coerceIntegerWithMode = (value, minimum, options = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const mode = resolveIntegerCoerceMode(options);
  if (mode === INTEGER_COERCE_MODE_STRICT && !Number.isInteger(parsed)) return null;
  const integer = mode === INTEGER_COERCE_MODE_STRICT ? parsed : Math.floor(parsed);
  return integer >= minimum ? integer : null;
};

/**
 * Coerce a value to a positive integer.
 *
 * @param {unknown} value
 * @param {{mode?:'truncate'|'strict'}} [options]
 * @returns {number|null}
 */
export const coercePositiveInt = (value, options = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const mode = resolveIntegerCoerceMode(options);
  if (mode === INTEGER_COERCE_MODE_STRICT) {
    return Number.isInteger(parsed) ? parsed : null;
  }
  return Math.floor(parsed);
};

/**
 * Coerce a value to a positive integer, clamping fractional positive values
 * to at least `1`.
 *
 * @param {unknown} value
 * @param {{mode?:'truncate'|'strict'}} [options]
 * @returns {number|null}
 */
export const coercePositiveIntMinOne = (value, options = {}) => {
  const coerced = coercePositiveInt(value, options);
  if (coerced == null) return null;
  return Math.max(1, coerced);
};

/**
 * Coerce a value to a finite number and clamp it to a minimum threshold.
 *
 * @param {unknown} value
 * @param {number} [min=0]
 * @returns {number|null}
 */
export const coerceNumberAtLeast = (value, min = 0) => {
  const parsed = coerceFiniteNumber(value);
  if (parsed == null) return null;
  const floor = Number.isFinite(Number(min)) ? Number(min) : 0;
  return Math.max(floor, parsed);
};

/**
 * Coerce a value to an integer and clamp it to a minimum threshold.
 *
 * @param {unknown} value
 * @param {number} [min=0]
 * @param {{mode?:'truncate'|'strict'}} [options]
 * @returns {number|null}
 */
export const coerceIntAtLeast = (value, min = 0, options = {}) => {
  const coerced = coerceNumberAtLeast(value, min);
  if (coerced == null) return null;
  const mode = resolveIntegerCoerceMode(options);
  if (mode === INTEGER_COERCE_MODE_STRICT) {
    return Number.isInteger(coerced) ? coerced : null;
  }
  return Math.floor(coerced);
};

/**
 * Coerce a value to a non-negative integer.
 *
 * @param {unknown} value
 * @param {{mode?:'truncate'|'strict'}} [options]
 * @returns {number|null}
 */
export const coerceNonNegativeInt = (value, options = {}) => coerceIntegerWithMode(value, 0, options);

/**
 * Coerce and clamp a numeric fraction to a bounded range.
 *
 * @param {unknown} value
 * @param {{min?:number,max?:number,allowZero?:boolean}} [options]
 * @returns {number|null}
 */
export const coerceClampedFraction = (
  value,
  { min = 0, max = 1, allowZero = true } = {}
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (allowZero ? parsed < 0 : parsed <= 0) return null;
  const floor = Number.isFinite(min) ? Number(min) : 0;
  const ceil = Number.isFinite(max) ? Number(max) : 1;
  const lower = Math.min(floor, ceil);
  const upper = Math.max(floor, ceil);
  return Math.max(lower, Math.min(upper, parsed));
};

/**
 * Coerce a utilization ratio to the scheduler-safe unit interval.
 *
 * @param {unknown} value
 * @param {{min?:number,max?:number}} [options]
 * @returns {number|null}
 */
export const coerceUnitFraction = (
  value,
  { min = 0.25, max = 0.99 } = {}
) => coerceClampedFraction(value, { min, max, allowZero: false });

