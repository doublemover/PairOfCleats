const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
export const DICTIONARY_IDENTIFIER_VERSION = 'dictionary-identifiers.v1';
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Preserve each whole identifier/acronym, with optional component search aliases. */
export function dictionaryIdentifierTerms(text) {
  const result = new Set();
  for (const raw of String(text ?? '').normalize('NFKC').match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []) {
    result.add(normalize(raw));
    const parts = raw.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').split(/_+|\s+/u);
    for (const part of parts) {
      if (!part) continue;
      result.add(normalize(part));
      for (const row of segmenter.segment(part)) if (row.isWordLike) result.add(normalize(row.segment));
    }
  }
  return [...result].filter(Boolean);
}

/** Count one occurrence per alias per source identifier, including Unicode identifiers. */
export function countDictionaryIdentifiers(text, counts = new Map()) {
  for (const raw of String(text ?? '').match(/[\p{L}][\p{L}\p{M}\p{N}_]*/gu) ?? []) {
    for (const word of dictionaryIdentifierTerms(raw)) {
      if ([...word].length >= 3) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}
export const sortedDictionaryCounts = (counts, minCount = 3) => [...counts]
  .filter(([, count]) => count >= minCount)
  .sort(([a, ac], [b, bc]) => bc - ac || (a < b ? -1 : a > b ? 1 : 0));
