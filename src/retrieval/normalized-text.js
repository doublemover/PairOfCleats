const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Query/source matching shares the analyzer's NFKD spelling. */
export const normalizeMatchSpelling = (value, { caseSensitive = false } = {}) => {
  const text = String(value ?? '').normalize('NFKD');
  return caseSensitive ? text : text.toLowerCase();
};

export const containsNormalizedText = (value, tokens) => {
  const normalized = normalizeMatchSpelling(value);
  return tokens.some(token => {
    const spelling = normalizeMatchSpelling(token);
    return spelling.length > 0 && normalized.includes(spelling);
  });
};

/** Map normalized UTF-16 matches back to complete original graphemes. */
export const projectNormalizedText = (value, { caseSensitive = true } = {}) => {
  const text = String(value ?? ''), starts = [], ends = [];
  for (const { segment, index } of graphemes.segment(text)) {
    const spelling = normalizeMatchSpelling(segment, { caseSensitive });
    for (let offset = 0; offset < spelling.length; offset++) {
      starts.push(index); ends.push(index + segment.length);
    }
  }
  // Whole-string case conversion also preserves contextual forms (e.g. final sigma).
  return { normalized: normalizeMatchSpelling(text, { caseSensitive }), starts, ends };
};

/** Find the earliest token and map only its span; clipping needs no full offset arrays. */
export const findNormalizedTextRange = (value, tokens) => {
  const text = String(value ?? ''), normalized = normalizeMatchSpelling(text);
  let match = null;
  for (const token of tokens) {
    const spelling = normalizeMatchSpelling(token);
    if (!spelling) continue;
    const index = normalized.indexOf(spelling);
    if (index >= 0 && (!match || index < match.index)) match = { index, end: index + spelling.length };
  }
  if (!match) return null;
  let offset = 0, start = 0;
  for (const { segment, index } of graphemes.segment(text)) {
    const end = offset + normalizeMatchSpelling(segment).length;
    if (offset <= match.index && match.index < end) start = index;
    if (end >= match.end) return { start, end: index + segment.length };
    offset = end;
  }
  return null;
};
