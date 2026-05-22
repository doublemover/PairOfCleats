/**
 * Build a line start offset index for a string.
 * @param {string} text
 * @returns {number[]}
 */
export function buildLineIndex(text) {
  const index = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') index.push(i + 1);
  }
  return index;
}

/**
 * Count newline-delimited lines without splitting the whole string.
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

/**
 * Build a 0-based line accessor backed by a line-start index.
 * @param {string} text
 * @param {number[]|null} lineIndex
 * @returns {{length:number,getLine:(idx:number)=>string}}
 */
export function createLineAccessor(text, lineIndex) {
  const index = Array.isArray(lineIndex) ? lineIndex : buildLineIndex(text);
  const lineCount = index.length;
  return {
    length: lineCount,
    getLine: (idx) => {
      if (!Number.isFinite(idx) || idx < 0 || idx >= lineCount) return '';
      const start = index[idx] ?? 0;
      const end = index[idx + 1] ?? text.length;
      let line = text.slice(start, end);
      if (line.endsWith('\n')) line = line.slice(0, -1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      return line;
    }
  };
}

/**
 * Convert a character offset into a 1-based line number.
 * @param {number[]} lineIndex
 * @param {number} offset
 * @returns {number}
 */
export function offsetToLine(lineIndex, offset) {
  let lo = 0;
  let hi = lineIndex.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineIndex[mid] <= offset) {
      if (mid === lineIndex.length - 1 || lineIndex[mid + 1] > offset) {
        return mid + 1;
      }
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return 1;
}

/**
 * Convert a 1-based line/column to a character offset.
 * @param {number[]} lineIndex
 * @param {number} line
 * @param {number} col
 * @returns {number}
 */
export function lineColToOffset(lineIndex, line, col) {
  const lineIdx = Math.max(1, Number(line) || 1) - 1;
  const base = lineIndex[lineIdx] ?? lineIndex[lineIndex.length - 1] ?? 0;
  return base + (Number.isFinite(Number(col)) ? Number(col) : 0);
}
