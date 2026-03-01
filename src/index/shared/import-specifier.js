const PSEUDO_TOKEN_RE = /^(?:anchor|alias|dependency|namespace):/i;
const CONTROL_CHAR_RE = /[\u0000-\u001f]/;

/**
 * Normalize and sanity-check an import-like token emitted by scanners.
 *
 * @param {unknown} value
 * @param {{
 *   maxLength?: number,
 *   stripSurroundingQuotes?: boolean,
 *   stripTrailingPunctuation?: boolean
 * }} [options]
 * @returns {string}
 */
export const sanitizeImportSpecifier = (
  value,
  {
    maxLength = 4096,
    stripSurroundingQuotes = true,
    stripTrailingPunctuation = true
  } = {}
) => {
  if (value == null) return '';
  let token = String(value).trim();
  if (!token) return '';
  if (token.length > maxLength) return '';
  if (CONTROL_CHAR_RE.test(token)) return '';

  if (stripSurroundingQuotes) {
    token = token
      .replace(/^[`"']/, '')
      .replace(/[`"']$/, '');
  }
  if (stripTrailingPunctuation) {
    token = token.replace(/[);,]+$/g, '');
  }

  token = token.trim();
  if (!token) return '';
  if (token.length > maxLength) return '';
  if (CONTROL_CHAR_RE.test(token)) return '';
  if (PSEUDO_TOKEN_RE.test(token)) return '';
  return token;
};

/**
 * Deterministic, deduplicated import token normalization.
 *
 * @param {unknown[]} list
 * @returns {string[]}
 */
export const normalizeImportSpecifiers = (list) => {
  if (!Array.isArray(list) || list.length === 0) return [];
  const set = new Set();
  for (const entry of list) {
    const token = sanitizeImportSpecifier(entry);
    if (!token) continue;
    set.add(token);
  }
  const output = Array.from(set);
  output.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  return output;
};

