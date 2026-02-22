export const BOOLEAN_TRUE_TOKENS = Object.freeze(['1', 'true', 'yes', 'on']);
export const BOOLEAN_FALSE_TOKENS = Object.freeze(['0', 'false', 'no', 'off']);

export const BOOLEAN_TRUE_TOKENS_NO_ON = Object.freeze(['1', 'true', 'yes']);
export const BOOLEAN_FALSE_TOKENS_NO_OFF = Object.freeze(['0', 'false', 'no']);

const hasToken = (tokens, token) => (
  Array.isArray(tokens)
    ? tokens.includes(token)
    : false
);

/**
 * Normalize loose boolean-like input with configurable fallback behavior.
 * @param {unknown} value
 * @param {{
 *   fallback?: boolean|null,
 *   nullish?: boolean|null,
 *   empty?: boolean|null,
 *   trueTokens?: string[],
 *   falseTokens?: string[]
 * }} [options]
 * @returns {boolean|null}
 */
export const normalizeBooleanString = (
  value,
  {
    fallback = null,
    nullish = fallback,
    empty = fallback,
    trueTokens = BOOLEAN_TRUE_TOKENS,
    falseTokens = BOOLEAN_FALSE_TOKENS
  } = {}
) => {
  if (value == null) return nullish;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return empty;
  if (hasToken(trueTokens, normalized)) return true;
  if (hasToken(falseTokens, normalized)) return false;
  return fallback;
};
