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

export function createSqlScannerState(options = {}) {
  const dialect = String(options.dialect || 'generic').trim().toLowerCase() || 'generic';
  return {
    inSingle: false,
    inDouble: false,
    inBacktick:false,
    inLineComment: false,
    inBlockComment: false,
    dollarTag: null,
    blockDepth:0,
    nestedComments:['generic','postgres','postgresql','pg'].includes(dialect),
    mysqlEscapes:['mysql','mariadb'].includes(dialect),
    standardConformingStrings:options.standardConformingStrings !== false,
    singleBackslashEscape:false
  };
}

function consumeActiveSqlState(text, index, state, { preserveLineCommentNewline = false, emitDollarQuoteText = false } = {}) {
  const ch = text[index];
  const next = text[index + 1];

  if (state.dollarTag) {
    if (text.startsWith(state.dollarTag, index)) {
      const emit = emitDollarQuoteText ? state.dollarTag : null;
      const nextIndex = index + state.dollarTag.length - 1;
      state.dollarTag = null;
      return { handled: true, nextIndex, emit };
    }
    return { handled: true, nextIndex: index, emit: emitDollarQuoteText ? ch : null };
  }

  if (state.inLineComment) {
    if (ch === '\n' || ch === '\r') {
      state.inLineComment = false;
      return { handled: true, nextIndex: index, emit: preserveLineCommentNewline ? ch : null };
    }
    return { handled: true, nextIndex: index, emit: null };
  }

  if (state.inBlockComment) {
    if (state.nestedComments && ch === '/' && next === '*') {state.blockDepth++;return {handled:true,nextIndex:index+1,emit:null};}
    if (ch === '*' && next === '/') {
      state.inBlockComment = --state.blockDepth > 0;
      return { handled: true, nextIndex: index + 1, emit: null };
    }
    return { handled: true, nextIndex: index, emit: null };
  }

  return { handled: false, nextIndex: index, emit: null };
}

function enterSqlCommentState(text, index, state) {
  if (state.inSingle || state.inDouble || state.inBacktick) return { handled: false, nextIndex: index };

  const ch = text[index];
  const next = text[index + 1];
  if (ch === '-' && next === '-') {
    state.inLineComment = true;
    return { handled: true, nextIndex: index + 1 };
  }
  if (ch === '/' && next === '*') {
    state.inBlockComment = true;
    state.blockDepth = 1;
    return { handled: true, nextIndex: index + 1 };
  }
  return { handled: false, nextIndex: index };
}

function advanceSqlQuoteState(text, index, state, { emitQuoteText = false } = {}) {
  const ch = text[index];
  const next = text[index + 1];

  const escaped = () => {
    let count = 0;
    for(let cursor=index-1;cursor>=0 && text[cursor] === '\\';cursor--) count++;
    return count % 2 === 1;
  };
  if (!state.inSingle && !state.inDouble && ch === '`') {
    if(state.inBacktick && next === '`') return {handled:true,nextIndex:index+1,emit:emitQuoteText?'``':null};
    state.inBacktick=!state.inBacktick;
    return {handled:true,nextIndex:index,emit:emitQuoteText?ch:null};
  }
  if(state.inBacktick) return {handled:true,nextIndex:index,emit:emitQuoteText?ch:null};
  if (!state.inDouble && ch === '\'') {
    if (state.inSingle) {
      if (next === '\'') {
        return { handled: true, nextIndex: index + 1, emit: emitQuoteText ? "''" : null };
      }
      if (!state.singleBackslashEscape || !escaped()) state.inSingle = false;
    } else {
      state.inSingle = true;
      state.singleBackslashEscape = state.mysqlEscapes || !state.standardConformingStrings
        || /[eE]/.test(text[index-1] || '') && !/[A-Za-z0-9_]/.test(text[index-2] || '');
    }
    return { handled: true, nextIndex: index, emit: emitQuoteText ? ch : null };
  }

  if (!state.inSingle && ch === '"') {
    if (state.inDouble) {
      if (next === '"') {
        return { handled: true, nextIndex: index + 1, emit: emitQuoteText ? '""' : null };
      }
      if (!state.mysqlEscapes || !escaped()) state.inDouble = false;
    } else {
      state.inDouble = true;
    }
    return { handled: true, nextIndex: index, emit: emitQuoteText ? ch : null };
  }

  return { handled: false, nextIndex: index, emit: null };
}

function enterDollarQuoteState(text, index, state, { emitDollarQuoteText = false } = {}) {
  if (state.inSingle || state.inDouble || state.inBacktick || text[index] !== '$') {
    return { handled: false, nextIndex: index, emit: null };
  }

  const tag = readDollarTag(text, index);
  if (!tag) return { handled: false, nextIndex: index, emit: null };

  state.dollarTag = tag;
  return {
    handled: true,
    nextIndex: index + tag.length - 1,
    emit: emitDollarQuoteText ? tag : null
  };
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
export function splitSqlStatements(text,options = {}) {
  const statements = [];
  let start = 0;
  const state = createSqlScannerState(options);
  let delimiter = ';';
  let delimiterLength = delimiter.length;
  let delimiterFirstCode = delimiter.charCodeAt(0);

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const lineStart = i === 0 || text[i - 1] === '\n' || text[i - 1] === '\r';

    const active = consumeActiveSqlState(text, i, state);
    if (active.handled) {
      i = active.nextIndex;
      continue;
    }

    const comment = enterSqlCommentState(text, i, state);
    if (comment.handled) {
      i = comment.nextIndex;
      continue;
    }

    if (lineStart && !state.inSingle && !state.inDouble && !state.inBacktick) {
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
        let endLine = k;
        while (endLine < text.length && text[endLine] !== '\r' && text[endLine] !== '\n') endLine += 1;
        const nextLine = endLine + (text[endLine] === '\r' && text[endLine + 1] === '\n' ? 2 : endLine < text.length ? 1 : 0);
        const rawDelimiter = text.slice(k, endLine).trim();
        if (rawDelimiter) {
          delimiter = rawDelimiter;
          delimiterLength = delimiter.length;
          delimiterFirstCode = delimiter.charCodeAt(0);
        }
        start = Math.max(start, nextLine);
        i = nextLine - 1;
        continue;
      }
    }

    const quote = advanceSqlQuoteState(text, i, state);
    if (quote.handled) {
      i = quote.nextIndex;
      continue;
    }

    if (!state.inSingle && !state.inDouble && !state.inBacktick) {
      if (matchesDelimiterAt(text, i, delimiter, delimiterLength, delimiterFirstCode)) {
        const end = i + delimiterLength;
        if (hasNonWhitespace(text, start, end)) statements.push({ start, end });
        start = end;
        i = end - 1;
        continue;
      }

      const dollarQuote = enterDollarQuoteState(text, i, state);
      if (dollarQuote.handled) {
        i = dollarQuote.nextIndex;
        continue;
      }
    }
  }

  if (start < text.length && hasNonWhitespace(text, start, text.length)) {
    statements.push({ start, end: text.length });
  }

  return statements;
}

/** Shared passive lexical cursor for include admission at client line boundaries. */
export const advanceSqlScannerState = (text,index,state) => {
  const active = consumeActiveSqlState(text,index,state);
  if(active.handled) return active.nextIndex;
  const comment = enterSqlCommentState(text,index,state);
  if(comment.handled) return comment.nextIndex;
  const quote = advanceSqlQuoteState(text,index,state);
  if(quote.handled) return quote.nextIndex;
  const dollar = enterDollarQuoteState(text,index,state);
  return dollar.handled ? dollar.nextIndex : index;
};

/**
 * Remove SQL comments while preserving quoted literal content.
 * @param {string} text
 * @param {{dialect?:string,standardConformingStrings?:boolean}} [options]
 * @returns {string}
 */
export function stripSqlComments(text, options = {}) {
  const out = [];
  const state = createSqlScannerState(options);

  for (let i = 0; i < text.length; i += 1) {
    const active = consumeActiveSqlState(text, i, state, {
      preserveLineCommentNewline: true,
      emitDollarQuoteText: true
    });
    if (active.handled) {
      if (active.emit) out.push(active.emit);
      i = active.nextIndex;
      continue;
    }

    const dollarQuote = enterDollarQuoteState(text, i, state, { emitDollarQuoteText: true });
    if (dollarQuote.handled) {
      out.push(dollarQuote.emit);
      i = dollarQuote.nextIndex;
      continue;
    }

    const comment = enterSqlCommentState(text, i, state);
    if (comment.handled) {
      i = comment.nextIndex;
      continue;
    }

    const quote = advanceSqlQuoteState(text, i, state, { emitQuoteText: true });
    if (quote.handled) {
      if (quote.emit) out.push(quote.emit);
      i = quote.nextIndex;
      continue;
    }

    out.push(text[i]);
  }

  return out.join('');
}
