/**
 * Normalize ownership key fragments used in daemon/subprocess attribution tags.
 *
 * @param {unknown} value
 * @param {string} [fallback='unknown']
 * @returns {string}
 */
export const normalizeOwnershipSegment = (value, fallback = 'unknown') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^a-zA-Z0-9._:-]+/g, '_');
};
