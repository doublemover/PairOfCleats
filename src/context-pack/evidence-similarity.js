/** Versioned bounded lexical features, shared by selection and post-hoc reports.
 * Callers charge each visited term/comparison to their original work owner. */
export const contextEvidenceTerms = (text, onWork = () => {}) => {
  const terms = new Set();
  for (const match of text.slice(0, 4096).matchAll(/[\p{L}\p{N}_]+/gu)) {
    onWork(); terms.add(match[0].toLowerCase()); if (terms.size === 128) break;
  }
  return terms;
};
export const contextEvidenceJaccard = (left, right, onWork = () => {}) => {
  let shared = 0;
  for (const term of left) { onWork(); if (right.has(term)) shared++; }
  const size = left.size + right.size - shared;
  return size ? shared / size : 0;
};
