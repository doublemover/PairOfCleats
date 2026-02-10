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
 * Escape a value for use in a RegExp.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const resolveLinesAccessor = (lines) => {
  if (Array.isArray(lines)) {
    return {
      getLine: (idx) => lines[idx] ?? '',
      length: lines.length
    };
  }
  if (lines && typeof lines.getLine === 'function') {
    const length = Number.isFinite(lines.length)
      ? lines.length
      : (Number.isFinite(lines.lineCount) ? lines.lineCount : 0);
    return {
      getLine: (idx) => lines.getLine(idx) ?? '',
      length
    };
  }
  return {
    getLine: () => '',
    length: 0
  };
};

/**
 * Extract a doc comment immediately above a declaration.
 * Supports configurable line/block styles.
 * @param {string[]|{getLine:(idx:number)=>string,length?:number,lineCount?:number}} lines
 * @param {number} startLineIdx
 * @param {{linePrefixes?:string[]|string,blockStarts?:string[]|string,blockEnd?:string,skipLine?:(line:string)=>boolean}} [options]
 * @returns {string}
 */
export function extractDocComment(lines, startLineIdx, options = {}) {
  const accessor = resolveLinesAccessor(lines);
  const linePrefixesRaw = options.linePrefixes ?? ['///'];
  const blockStartsRaw = options.blockStarts ?? ['/**'];
  const linePrefixes = Array.isArray(linePrefixesRaw) ? linePrefixesRaw.filter(Boolean) : [linePrefixesRaw].filter(Boolean);
  const blockStarts = Array.isArray(blockStartsRaw) ? blockStartsRaw.filter(Boolean) : [blockStartsRaw].filter(Boolean);
  const blockEnd = options.blockEnd ?? '*/';
  const skipLine = typeof options.skipLine === 'function' ? options.skipLine : null;
  let i = startLineIdx - 1;
  while (i >= 0 && accessor.getLine(i).trim() === '') i--;
  if (i < 0) return '';
  const trimmed = accessor.getLine(i).trim();
  if (linePrefixes.length) {
    const initialPrefix = linePrefixes.find((prefix) => trimmed.startsWith(prefix));
    if (initialPrefix) {
      const out = [];
      while (i >= 0) {
        const line = accessor.getLine(i).trim();
        if (skipLine && skipLine(line)) {
          i--;
          continue;
        }
        const matchedPrefix = linePrefixes.find((prefix) => line.startsWith(prefix));
        if (!matchedPrefix) break;
        const prefixRegex = new RegExp(`^\\s*${escapeRegExp(matchedPrefix)}\\s?`);
        out.unshift(line.replace(prefixRegex, '').trim());
        i--;
      }
      return out.join('\n').trim();
    }
  }

  if (blockEnd && trimmed.includes(blockEnd) && blockStarts.length) {
    const raw = [];
    let foundStart = false;
    while (i >= 0) {
      const line = accessor.getLine(i);
      raw.unshift(line);
      if (blockStarts.some((start) => line.includes(start))) {
        foundStart = true;
        break;
      }
      i--;
    }
    if (!foundStart) return '';
    return raw
      .map((line) => {
        let cleaned = line;
        for (const start of blockStarts) {
          const startRegex = new RegExp(`^\\s*${escapeRegExp(start)}`);
          cleaned = cleaned.replace(startRegex, '');
        }
        if (blockEnd) {
          const endRegex = new RegExp(`${escapeRegExp(blockEnd)}\\s*$`);
          cleaned = cleaned.replace(endRegex, '');
        }
        cleaned = cleaned.replace(/^\s*\*\s?/, '');
        return cleaned.trim();
      })
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
  const accessor = resolveLinesAccessor(lines);
  const attrs = new Set();
  const attrRe = /@([A-Za-z_][A-Za-z0-9_]*)/g;
  const addLine = (line) => {
    attrRe.lastIndex = 0;
    let match;
    while ((match = attrRe.exec(line)) !== null) {
      attrs.add(match[1]);
    }
  };
  if (signature) addLine(signature);
  let i = startLineIdx - 1;
  while (i >= 0) {
    const trimmed = accessor.getLine(i).trim();
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
