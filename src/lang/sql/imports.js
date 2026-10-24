import { createSqlScannerState, advanceSqlScannerState } from './scanner.js';

const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_VTAB = 11;
const CHAR_FF = 12;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_SEMICOLON = 59;
const CHAR_A = 65;
const CHAR_Z = 90;

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
 * ASCII-only lowercase conversion.
 * @param {number} code
 * @returns {number}
 */
function lowerAsciiCode(code) {
  if (code >= CHAR_A && code <= CHAR_Z) return code + 32;
  return code;
}

/**
 * Skip leading spaces/tabs/newlines.
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function skipSpaces(text, start) {
  let i = start;
  while (i < text.length && isAsciiWhitespaceCode(text.charCodeAt(i))) i += 1;
  return i;
}

/**
 * Read an import path token until whitespace/semicolon.
 * @param {string} text
 * @param {number} start
 * @returns {string}
 */
function readPathToken(text, start) {
  if(text[start] === "'" || text[start] === '"') {
    const quote=text[start];let value='';
    for(let cursor=start+1;cursor<text.length;cursor++) {
      if(text[cursor] === quote) {
        if(text[cursor+1] === quote) {value+=quote;cursor++;continue;}
        return /[$`]/u.test(value) || value.startsWith(':') ? '' : value;
      }
      value+=text[cursor];
    }
    return '';
  }
  let end = start;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    if (isAsciiWhitespaceCode(code) || code === CHAR_SEMICOLON) break;
    end += 1;
  }
  if (end <= start) return '';
  const value=text.slice(start,end);
  return /[$`]/u.test(value) || value.startsWith(':') ? '' : value;
}

/**
 * Case-insensitive ASCII prefix check.
 * @param {string} text
 * @param {number} start
 * @param {string} lowerToken
 * @returns {boolean}
 */
function startsWithLowerAscii(text, start, lowerToken) {
  if ((start + lowerToken.length) > text.length) return false;
  for (let i = 0; i < lowerToken.length; i += 1) {
    if (lowerAsciiCode(text.charCodeAt(start + i)) !== lowerToken.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Parse one SQL import directive line (`\i`, `\ir`, `@@`, `source`).
 * @param {string} line
 * @returns {string}
 */
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
 *
 * Scanner semantics:
 * 1. Ignore block and line comments before directive parsing.
 * 2. Parse directives line-by-line to match common SQL client include forms.
 *
 * @param {string} [text='']
 * @returns {string[]}
 */
export function collectSqlImports(text = '',options = {}) {
  const source = String(text || '');
  const imports = new Set();
  const state=createSqlScannerState(options);
  for(let index=0;index<source.length;index++) {
    const lineStart=index === 0 || /[\r\n]/u.test(source[index-1]);
    if(lineStart && !state.inSingle && !state.inDouble && !state.inBacktick
      && !state.inLineComment && !state.inBlockComment && !state.dollarTag) {
      let end=index;while(end<source.length && !/[\r\n]/u.test(source[end])) end++;
      const line=source.slice(index,end), path=parseImportDirective(line);
      if(path) {imports.add(path);index=end-1;continue;}
    }
    index=advanceSqlScannerState(source,index,state);
  }

  return Array.from(imports);
}
