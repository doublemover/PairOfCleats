const PUNCT_RE = /[=<>!:+\-*/%&|^~.?]{1,4}|[()[\]{}.,;:]/g;
export const PUNCTUATION_TOKEN_LIMIT = 20000;

export function capturePunctuationTokens(text) {
  PUNCT_RE.lastIndex = 0;
  const out = [];
  let truncated = false;
  let match;
  while (text && (match = PUNCT_RE.exec(text)) !== null) {
    if (out.length === PUNCTUATION_TOKEN_LIMIT) { truncated = true; break; }
    out.push(match[0]);
    if (!match[0]) PUNCT_RE.lastIndex += 1;
  }
  return { tokens: out, coverage: { limit: PUNCTUATION_TOKEN_LIMIT, emitted: out.length, truncated } };
}

export const extractPunctuationTokens = text => capturePunctuationTokens(text).tokens;

export function extractNgrams(tokens, nStart = 2, nEnd = 4) {
  const grams = [];
  for (let n = nStart; n <= nEnd; ++n) {
    for (let i = 0; i <= tokens.length - n; i++) {
      grams.push(tokens.slice(i, i + n).join('\u0001'));
    }
  }
  return grams;
}

export function tri(w, n = 3) {
  const s = `\u27ec${w}\u27ed`;
  const g = [];
  for (let i = 0; i <= s.length - n; i++) {
    g.push(s.slice(i, i + n));
  }
  return g;
}
