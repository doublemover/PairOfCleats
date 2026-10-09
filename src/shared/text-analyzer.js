export const TEXT_ANALYZER_VERSION = 'literal-unicode.v1';
/** Ordered literal words; no stemming, stopword removal or scoring expansions. */
export const analyzeLiteralText = (text, {caseSensitive = false} = {}) =>
  (String(text ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').match(/[\p{L}\p{N}]+/gu) ?? [])
    .flatMap(word => word.split(/(?<=.)(?=[A-Z])/u))
    .map(word => caseSensitive ? word : word.toLowerCase());
