import { STOP } from './constants.js';

/**
 * Generate a short headline for a chunk from doc/meta or token frequency.
 * @param {object} chunk
 * @param {string[]} tokens
 * @param {number} [n]
 * @param {number} [tokenMaxLen]
 * @param {number} [headlineMaxLen]
 * @returns {string}
 */
export function getHeadline(chunk, tokens, n = 7, tokenMaxLen = 30, headlineMaxLen = 120) {
  if (chunk.docmeta && chunk.docmeta.doc) {
    return chunk.docmeta.doc.split(/\s+/).slice(0, n).join(' ');
  }

  if (chunk.name && chunk.name !== 'blob' && chunk.name !== 'root') return chunk.name;
  if (chunk.codeRelations && chunk.codeRelations.name) {
    return chunk.codeRelations.name;
  }

  const codeStop = new Set([
    'x', 'y', 'z', 'dx', 'dy', 'dt',
    'width', 'height', 'start', 'end',
    'left', 'right', 'top', 'bottom',
    'i', 'j', 'k', 'n', 'm', 'idx', 'val',
    'value', 'array', 'count', 'len', 'index',
    'file', 'path', 'data', 'object', 'this',
    'name', 'id', 'type', 'kind', 'ctx',
    'row', 'col', 'page', 'block', 'section',
    'input', 'output', 'temp', 'tmp', 'buffer'
  ]);

  const freq = {};
  tokens.forEach((t) => {
    if (STOP.has(t)) return;
    if (codeStop.has(t)) return;
    if (t.length === 1) return;
    if (/^[0-9]+$/.test(t)) return;
    freq[t] = (freq[t] || 0) + 1;
  });

  const parts = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0].slice(0, tokenMaxLen))
    .slice(0, n);

  let headline = parts.join(' ');
  if (headline.length > headlineMaxLen) {
    headline = headline.slice(0, headlineMaxLen).trim() + '\u2026';
  }

  return headline || '(no headline)';
}
