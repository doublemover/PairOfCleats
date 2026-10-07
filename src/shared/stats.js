/**
 * Mean of finite numeric values.
 * @param {number[]} values
 * @returns {number}
 */
export function mean(values) {
  const nums = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

/**
 * Mean of finite numeric values, null when no finite values exist.
 * @param {number[]} values
 * @returns {number|null}
 */
export function meanNullable(values) {
  const nums = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}
