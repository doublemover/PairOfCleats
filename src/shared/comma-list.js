/**
 * Parse comma-separated list values into trimmed entries.
 * @param {string|undefined|null} value
 * @returns {string[]}
 */
export function parseCommaList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
