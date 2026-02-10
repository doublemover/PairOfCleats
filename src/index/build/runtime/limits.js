/**
 * Select the smallest positive limit from a list of values.
 * @param {...number} values
 * @returns {number|null}
 */
export const pickMinLimit = (...values) => {
  const candidates = values.filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : null;
};
