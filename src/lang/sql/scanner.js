const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_VTAB = 11;
const CHAR_FF = 12;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_0 = 48;
const CHAR_9 = 57;
const CHAR_A = 65;
const CHAR_Z = 90;
const CHAR_UNDERSCORE = 95;
const CHAR_a = 97;
const CHAR_z = 122;

/**
 * @param {number} code
 * @returns {boolean}
 */
function isAsciiWhitespaceCode(code) {
  return code === CHAR_TAB
    || code === CHAR_LF
    || code === CHAR_VTAB
    || code === CHAR_FF
    || code === CHAR_CR
    || code === CHAR_SPACE;
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isSqlIdentStartCode(code) {
  return (code >= CHAR_A && code <= CHAR_Z)
    || (code >= CHAR_a && code <= CHAR_z)
    || code === CHAR_UNDERSCORE;
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isSqlIdentCode(code) {
  return isSqlIdentStartCode(code) || (code >= CHAR_0 && code <= CHAR_9);
}

/**
 * ASCII-only lowercase conversion.
 * @param {number} code
 * @returns {number}
 */
function lowerAsciiCode(code) {
  if (code >= CHAR_A && code <= CHAR_Z) return code + 32;
  return code;
}

/**
 * Case-insensitive ASCII token match at offset.
 * @param {string} text
 * @param {number} offset
 * @param {string} lowerToken
 * @returns {boolean}
 */
function equalsLowerAsciiAt(text, offset, lowerToken) {
  if ((offset + lowerToken.length) > text.length) return false;
  for (let i = 0; i < lowerToken.length; i += 1) {
    if (lowerAsciiCode(text.charCodeAt(offset + i)) !== lowerToken.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Check whether a slice contains non-whitespace characters.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function hasNonWhitespace(text, start, end) {
  for (let i = start; i < end; i += 1) {
    if (!isAsciiWhitespaceCode(text.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * Parse PostgreSQL dollar-quoted string delimiters (`$$` or `$tag$`).
 * @param {string} text
 * @param {number} start
 * @returns {string|null}
 */
function readDollarTag(text, start) {
  if (text.charCodeAt(start) !== 36) return null;
  const second = text.charCodeAt(start + 1);
  if (second === 36) return '$$';
  if (!isSqlIdentStartCode(second)) return null;
  let i = start + 2;
  while (i < text.length && isSqlIdentCode(text.charCodeAt(i))) i += 1;
  if (text.charCodeAt(i) !== 36) return null;
  return text.slice(start, i + 1);
}

/**
 * Delimiter matcher optimized for common single-character delimiters.
 * @param {string} text
 * @param {number} offset
 * @param {string} delimiter
 * @param {number} delimiterLength
 * @param {number} delimiterFirstCode
 * @returns {boolean}
 */
function matchesDelimiterAt(text, offset, delimiter, delimiterLength, delimiterFirstCode) {
  if (!delimiterLength || (offset + delimiterLength) > text.length) return false;
  if (delimiterLength === 1) return text.charCodeAt(offset) === delimiterFirstCode;
  return text.startsWith(delimiter, offset);
}

/**
 * Split SQL text into statement ranges while honoring:
 * - single/double-quoted strings
 * - line/block comments
 * - postgres dollar-quoted blocks
 * - client `DELIMITER` directive overrides
 *
 * @param {string} text
 * @returns {Array<{start:number,end:number}>}
 */
export function splitSqlStatements(text) {
  const statements = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;
  let delimiter = ';';
  let delimiterLength = delimiter.length;
  let delimiterFirstCode = delimiter.charCodeAt(0);

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    const lineStart = i === 0 || text[i - 1] === '\n' || text[i - 1] === '\r';

    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }

    if (lineStart && !inSingle && !inDouble) {
      let j = i;
      while (j < text.length) {
        const code = text.charCodeAt(j);
        if (code !== CHAR_SPACE && code !== CHAR_TAB) break;
        j += 1;
      }
      if (equalsLowerAsciiAt(text, j, 'delimiter') && isAsciiWhitespaceCode(text.charCodeAt(j + 9))) {
        let k = j + 9;
        while (k < text.length) {
          const code = text.charCodeAt(k);
          if (code !== CHAR_SPACE && code !== CHAR_TAB) break;
          k += 1;
        }
        let endLine = text.indexOf('\n', k);
        if (endLine === -1) endLine = text.length;
        const rawDelimiter = text.slice(k, endLine).trim();
        if (rawDelimiter) {
          delimiter = rawDelimiter;
          delimiterLength = delimiter.length;
          delimiterFirstCode = delimiter.charCodeAt(0);
        }
        start = Math.max(start, endLine + 1);
        i = endLine;
        continue;
      }
    }

    if (!inDouble && ch === '\'') {
      if (inSingle) {
        if (next === '\'') {
          i += 1;
          continue;
        }
        if (text[i - 1] !== '\\') {
          inSingle = false;
          continue;
        }
      } else {
        inSingle = true;
        continue;
      }
    }

    if (!inSingle && ch === '"') {
      if (inDouble) {
        if (next === '"') {
          i += 1;
          continue;
        }
        if (text[i - 1] !== '\\') {
          inDouble = false;
          continue;
        }
      } else {
        inDouble = true;
        continue;
      }
    }

    if (!inSingle && !inDouble) {
      if (matchesDelimiterAt(text, i, delimiter, delimiterLength, delimiterFirstCode)) {
        const end = i + delimiterLength;
        if (hasNonWhitespace(text, start, end)) statements.push({ start, end });
        start = end;
        i = end - 1;
        continue;
      }

      if (ch === '$') {
        const tag = readDollarTag(text, i);
        if (tag) {
          dollarTag = tag;
          i += tag.length - 1;
          continue;
        }
      }
    }
  }

  if (start < text.length && hasNonWhitespace(text, start, text.length)) {
    statements.push({ start, end: text.length });
  }

  return statements;
}

/**
 * Remove SQL comments while preserving quoted literal content.
 * @param {string} text
 * @returns {string}
 */
export function stripSqlComments(text) {
  const out = [];
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out.push(ch);
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }

    if (!inDouble && ch === '\'') {
      if (inSingle) {
        if (next === '\'') {
          out.push("''");
          i += 1;
          continue;
        }
        if (text[i - 1] !== '\\') inSingle = false;
      } else {
        inSingle = true;
      }
    } else if (!inSingle && ch === '"') {
      if (inDouble) {
        if (next === '"') {
          out.push('""');
          i += 1;
          continue;
        }
        if (text[i - 1] !== '\\') inDouble = false;
      } else {
        inDouble = true;
      }
    }

    out.push(ch);
  }

  return out.join('');
}
