const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_VTAB = 11;
const CHAR_FF = 12;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_SEMICOLON = 59;
const CHAR_A = 65;
const CHAR_Z = 90;

function isAsciiWhitespaceCode(code) {
  return code === CHAR_TAB
    || code === CHAR_LF
    || code === CHAR_VTAB
    || code === CHAR_FF
    || code === CHAR_CR
    || code === CHAR_SPACE;
}

function lowerAsciiCode(code) {
  if (code >= CHAR_A && code <= CHAR_Z) return code + 32;
  return code;
}

function skipSpaces(text, start) {
  let i = start;
  while (i < text.length && isAsciiWhitespaceCode(text.charCodeAt(i))) i += 1;
  return i;
}

function readPathToken(text, start) {
  let end = start;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    if (isAsciiWhitespaceCode(code) || code === CHAR_SEMICOLON) break;
    end += 1;
  }
  if (end <= start) return '';
  return text.slice(start, end);
}

function startsWithLowerAscii(text, start, lowerToken) {
  if ((start + lowerToken.length) > text.length) return false;
  for (let i = 0; i < lowerToken.length; i += 1) {
    if (lowerAsciiCode(text.charCodeAt(start + i)) !== lowerToken.charCodeAt(i)) return false;
  }
  return true;
}

function parseImportDirective(line) {
  if (!line) return '';
  let i = skipSpaces(line, 0);
  if (i >= line.length) return '';

  if (line[i] === '\\') {
    i += 1;
    if (i >= line.length || lowerAsciiCode(line.charCodeAt(i)) !== 105) return '';
    i += 1;
    if (i < line.length && lowerAsciiCode(line.charCodeAt(i)) === 114) i += 1;
    if (i >= line.length || !isAsciiWhitespaceCode(line.charCodeAt(i))) return '';
    i = skipSpaces(line, i);
    return readPathToken(line, i);
  }

  if (line[i] === '@' && line[i + 1] === '@') {
    i = skipSpaces(line, i + 2);
    return readPathToken(line, i);
  }

  if (startsWithLowerAscii(line, i, 'source')) {
    const next = i + 6;
    if (next >= line.length || !isAsciiWhitespaceCode(line.charCodeAt(next))) return '';
    i = skipSpaces(line, next);
    return readPathToken(line, i);
  }

  return '';
}

/**
 * Collect imports from SQL source.
 * @returns {string[]}
 */
export function collectSqlImports(text = '') {
  const source = String(text || '');
  const imports = new Set();
  const line = [];
  let inBlockComment = false;

  const flushLine = () => {
    if (!line.length) return;
    const path = parseImportDirective(line.join(''));
    if (path) imports.add(path);
    line.length = 0;
  };

  for (let i = 0; i <= source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    const atEnd = i === source.length;
    const lineBreak = ch === '\n' || ch === '\r';

    if (atEnd || lineBreak) {
      flushLine();
      if (ch === '\r' && next === '\n') i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '-' && next === '-') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i += 1;
      i -= 1;
      continue;
    }

    line.push(ch);
  }

  return Array.from(imports);
}
