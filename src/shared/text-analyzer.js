export const TEXT_ANALYZER_VERSION = 'literal-unicode.v2';
/** Ordered literal words; no stemming, stopword removal or scoring expansions. */
export const analyzeLiteralText = (text, {caseSensitive = false} = {}) =>
  (String(text ?? '').normalize('NFC').replace(/([a-z])([A-Z])/g, '$1 $2').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .flatMap(word => word.split(/(?<=.)(?=[A-Z])/u))
    .map(word => caseSensitive ? word : word.toLowerCase());
