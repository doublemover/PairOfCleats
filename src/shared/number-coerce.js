/**
 * Coerce a value to a positive integer.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export const coercePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

/**
 * Coerce a value to a non-negative integer.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export const coerceNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

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

