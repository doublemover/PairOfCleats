/**
 * Normalize unknown input into an array.
 *
 * Arrays are returned as-is. Strings are treated as scalar values (not
 * iterable lists), and non-iterables resolve to an empty list.
 *
 * @param {unknown} value
 * @returns {any[]}
 */
export const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null || typeof value === 'string') return [];
  const iterator = value?.[Symbol.iterator];
  if (typeof iterator !== 'function') return [];
  try {
    return Array.from(value);
  } catch {
    return [];
  }
};

/**
 * Normalize unknown input into a filtered list of strings.
 *
 * @param {unknown} value
 * @param {{trim?:boolean,lower?:boolean,allowEmpty?:boolean}} [options]
 * @returns {string[]}
 */
export const toStringArray = (value, options = {}) => {
  const trim = options.trim !== false;
  const lower = options.lower === true;
  const allowEmpty = options.allowEmpty === true;
  const out = [];
  for (const entry of toArray(value)) {
    if (typeof entry !== 'string') continue;
    const normalized = trim ? entry.trim() : entry;
    if (!allowEmpty && !normalized) continue;
    out.push(lower ? normalized.toLowerCase() : normalized);
  }
  return out;
};
