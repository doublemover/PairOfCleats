/**
 * Escape regex metacharacters in a literal string.
 * @param {string} value
 * @returns {string}
 */
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
