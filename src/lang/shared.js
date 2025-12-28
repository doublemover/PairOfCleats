/**
 * Slice a declaration signature from raw text.
 * @param {string} text
 * @param {number} start
 * @param {number} bodyStart
 * @returns {string}
 */
export function sliceSignature(text, start, bodyStart) {
  let end = bodyStart > start ? bodyStart : text.indexOf('\n', start);
  if (end === -1) end = text.length;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Extract a doc comment immediately above a declaration.
 * Supports /// and /** block comment styles.
 * @param {string[]} lines
 * @param {number} startLineIdx
 * @returns {string}
 */
export function extractDocComment(lines, startLineIdx) {
  let i = startLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return '';
  const trimmed = lines[i].trim();
  if (trimmed.startsWith('///')) {
    const out = [];
    while (i >= 0 && lines[i].trim().startsWith('///')) {
      out.unshift(lines[i].trim().replace(/^\/\/\/\s?/, ''));
      i--;
    }
    return out.join('\n').trim();
  }
  if (trimmed.includes('*/')) {
    const raw = [];
    while (i >= 0) {
      raw.unshift(lines[i]);
      if (lines[i].includes('/**')) break;
      i--;
    }
    return raw
      .map((line) =>
        line
          .replace(/^\s*\/\*\*?/, '')
          .replace(/\*\/\s*$/, '')
          .replace(/^\s*\*\s?/, '')
          .trim()
      )
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

/**
 * Collect attributes/annotations near a declaration.
 * @param {string[]} lines
 * @param {number} startLineIdx
 * @param {string} signature
 * @returns {string[]}
 */
export function collectAttributes(lines, startLineIdx, signature) {
  const attrs = new Set();
  const addLine = (line) => {
    for (const match of line.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) {
      attrs.add(match[1]);
    }
  };
  if (signature) addLine(signature);
  let i = startLineIdx - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (attrs.size) break;
      i--;
      continue;
    }
    if (trimmed.startsWith('@')) {
      addLine(trimmed);
      i--;
      continue;
    }
    if (trimmed.startsWith('///') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      i--;
      continue;
    }
    break;
  }
  return Array.from(attrs);
}

/**
 * Check if a line is a comment-only line.
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}
