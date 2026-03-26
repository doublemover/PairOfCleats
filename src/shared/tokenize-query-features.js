const PUNCT_RE = /[=<>!:+\-*/%&|^~.?]{1,4}|[()[\]{}.,;:]/g;
const MAX_PUNCT_TOKENS = 20000;

export function extractPunctuationTokens(text) {
  if (!text) return [];
  PUNCT_RE.lastIndex = 0;
  const out = [];
  let match;
  while ((match = PUNCT_RE.exec(text)) !== null) {
    out.push(match[0]);
    if (out.length >= MAX_PUNCT_TOKENS) break;
    if (!match[0]) PUNCT_RE.lastIndex += 1;
  }
  return out;
}

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
