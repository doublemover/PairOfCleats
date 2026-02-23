import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { extractDocComment } from '../shared.js';
import { buildTreeSitterChunks } from '../tree-sitter.js';
import { SQL_DOC_OPTIONS } from './constants.js';
import { splitSqlStatements } from './scanner.js';

const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_0 = 48;
const CHAR_9 = 57;
const CHAR_A = 65;
const CHAR_Z = 90;
const CHAR_UNDERSCORE = 95;
const CHAR_BACKTICK = 96;
const CHAR_DQUOTE = 34;
const CHAR_DOT = 46;
const CHAR_a = 97;
const CHAR_z = 122;

const SQL_KIND_MAP = {
  table: 'TableDeclaration',
  view: 'ViewDeclaration',
  'materialized view': 'ViewDeclaration',
  function: 'FunctionDeclaration',
  procedure: 'ProcedureDeclaration',
  trigger: 'TriggerDeclaration',
  index: 'IndexDeclaration',
  schema: 'SchemaDeclaration',
  database: 'DatabaseDeclaration'
};

const SQL_CREATE_KINDS = ['table', 'view', 'function', 'procedure', 'trigger', 'index', 'schema', 'database'];

/**
 * ASCII-only lowercase conversion for keyword scanning.
 * @param {number} code
 * @returns {number}
 */
function lowerAsciiCode(code) {
  if (code >= CHAR_A && code <= CHAR_Z) return code + 32;
  return code;
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isAsciiWhitespaceCode(code) {
  return code === CHAR_TAB || code === CHAR_LF || code === CHAR_CR || code === CHAR_SPACE || code === 12 || code === 11;
}

/**
 * SQL token character check (ASCII word characters).
 * @param {number} code
 * @returns {boolean}
 */
function isSqlWordCode(code) {
  return (code >= CHAR_A && code <= CHAR_Z)
    || (code >= CHAR_a && code <= CHAR_z)
    || (code >= CHAR_0 && code <= CHAR_9)
    || code === CHAR_UNDERSCORE;
}

/**
 * SQL identifier token check, including quoted identifiers and dotted paths.
 * @param {number} code
 * @returns {boolean}
 */
function isSqlNameCode(code) {
  return isSqlWordCode(code) || code === CHAR_DQUOTE || code === CHAR_BACKTICK || code === CHAR_DOT;
}

/**
 * Skip ASCII whitespace from offset.
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function skipWhitespace(text, start) {
  let i = start;
  while (i < text.length && isAsciiWhitespaceCode(text.charCodeAt(i))) i += 1;
  return i;
}

/**
 * Keyword boundary match using ASCII lowercase compare.
 * @param {string} text
 * @param {number} start
 * @param {string} lowerKeyword
 * @returns {boolean}
 */
function startsWithKeyword(text, start, lowerKeyword) {
  if ((start + lowerKeyword.length) > text.length) return false;
  for (let i = 0; i < lowerKeyword.length; i += 1) {
    if (lowerAsciiCode(text.charCodeAt(start + i)) !== lowerKeyword.charCodeAt(i)) return false;
  }
  const boundary = text.charCodeAt(start + lowerKeyword.length);
  if (Number.isFinite(boundary) && isSqlWordCode(boundary)) return false;
  return true;
}

/**
 * Consume keyword from current cursor, returning `-1` when unmatched.
 * @param {string} text
 * @param {number} start
 * @param {string} lowerKeyword
 * @returns {number}
 */
function consumeKeyword(text, start, lowerKeyword) {
  if (!startsWithKeyword(text, start, lowerKeyword)) return -1;
  return start + lowerKeyword.length;
}

/**
 * Skip leading whitespace and SQL comments.
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function skipLeadingComments(text, start) {
  let i = start;
  while (i < text.length) {
    i = skipWhitespace(text, i);
    if (text[i] === '-' && text[i + 1] === '-') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return text.length;
      i = end + 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Remove identifier quotes used by SQL dialects.
 * @param {string} token
 * @returns {string}
 */
function stripSqlNameQuotes(token) {
  if (!token) return '';
  let out = '';
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch !== '"' && ch !== '`') out += ch;
  }
  return out;
}

/**
 * Read one SQL name token starting at offset.
 * @param {string} text
 * @param {number} start
 * @returns {string}
 */
function readSqlNameToken(text, start) {
  let end = start;
  while (end < text.length && isSqlNameCode(text.charCodeAt(end))) end += 1;
  if (end <= start) return '';
  return text.slice(start, end);
}

/**
 * Classify SQL statement declarations from leading `CREATE ...` forms.
 *
 * This is intentionally heuristic and conservative; unknown statements are
 * returned as generic `Statement` chunks.
 *
 * @param {string} statement
 * @returns {{kind:string,name:string}}
 */
function classifySqlStatement(statement) {
  let idx = skipLeadingComments(statement, 0);
  idx = skipWhitespace(statement, idx);

  idx = consumeKeyword(statement, idx, 'create');
  if (idx < 0) return { kind: 'Statement', name: 'statement' };
  idx = skipWhitespace(statement, idx);

  const afterOr = consumeKeyword(statement, idx, 'or');
  if (afterOr >= 0) {
    const replaceStart = skipWhitespace(statement, afterOr);
    const afterReplace = consumeKeyword(statement, replaceStart, 'replace');
    if (afterReplace >= 0) idx = skipWhitespace(statement, afterReplace);
  }

  let kindKey = '';
  const afterMaterialized = consumeKeyword(statement, idx, 'materialized');
  if (afterMaterialized >= 0) {
    const viewStart = skipWhitespace(statement, afterMaterialized);
    const afterView = consumeKeyword(statement, viewStart, 'view');
    if (afterView >= 0) {
      kindKey = 'materialized view';
      idx = afterView;
    }
  }

  if (!kindKey) {
    for (const keyword of SQL_CREATE_KINDS) {
      const next = consumeKeyword(statement, idx, keyword);
      if (next >= 0) {
        kindKey = keyword;
        idx = next;
        break;
      }
    }
  }

  if (!kindKey) return { kind: 'Statement', name: 'statement' };
  idx = skipWhitespace(statement, idx);
  const nameToken = readSqlNameToken(statement, idx);
  if (!nameToken) return { kind: 'Statement', name: 'statement' };

  return {
    kind: SQL_KIND_MAP[kindKey] || 'Statement',
    name: stripSqlNameQuotes(nameToken)
  };
}

/**
 * Return the first non-empty logical line.
 * @param {string} text
 * @returns {string}
 */
function firstNonEmptyLine(text) {
  if (!text) return '';
  let start = 0;
  while (start < text.length) {
    while (start < text.length && isAsciiWhitespaceCode(text.charCodeAt(start))) start += 1;
    if (start >= text.length) break;
    let end = start;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1;
    const line = text.slice(start, end).trim();
    if (line) return line;
    start = end + 1;
  }
  return '';
}

/**
 * Normalize SQL block-comment doc text to plain lines.
 * @param {string[]} rawLines
 * @returns {string}
 */
function cleanBlockDoc(rawLines) {
  const cleaned = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    let line = rawLines[i].trim();
    if (!line) continue;

    if (i === 0 && line.startsWith('/*')) {
      let j = 0;
      while (j < line.length && line[j] === '/') j += 1;
      while (j < line.length && line[j] === '*') j += 1;
      line = line.slice(j).trimStart();
    }

    const close = line.indexOf('*/');
    if (close !== -1) line = line.slice(0, close).trimEnd();

    if (line.startsWith('*')) {
      line = line.slice(1);
      if (line.startsWith(' ')) line = line.slice(1);
    }

    line = line.trim();
    if (line) cleaned.push(line);
  }
  return cleaned.join('\n').trim();
}

/**
 * Extract docstring/signature from leading comment prologue within statement.
 * @param {string} statementText
 * @returns {{docstring:string,signature:string}}
 */
function extractSqlLeadingDoc(statementText) {
  if (!statementText || (!statementText.includes('--') && !statementText.includes('/*'))) {
    return { docstring: '', signature: firstNonEmptyLine(statementText) };
  }

  const lines = statementText.split('\n');
  const docLines = [];
  let signature = '';
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('--')) {
      docLines.push(trimmed.slice(2).trimStart());
      i += 1;
      continue;
    }

    if (trimmed.startsWith('/*')) {
      const raw = [];
      while (i < lines.length) {
        raw.push(lines[i]);
        if (lines[i].includes('*/')) break;
        i += 1;
      }
      const cleaned = cleanBlockDoc(raw);
      if (cleaned) docLines.push(cleaned);
      i += 1;
      continue;
    }

    signature = trimmed;
    break;
  }

  if (!signature) signature = firstNonEmptyLine(statementText);
  return { docstring: docLines.join('\n').trim(), signature };
}

/**
 * Build chunk metadata for SQL statements with parser-first fallback.
 *
 * Fallback order:
 * 1. Use tree-sitter chunks when available and at least as complete as scanner
 *    output for this file.
 * 2. Otherwise split statements heuristically and classify `CREATE` forms.
 * 3. Return `null` only when no statements are found at all.
 *
 * @param {string} text
 * @param {{dialect?:string,[key:string]:any}} [options]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>|null}
 */
export function buildSqlChunks(text, options = {}) {
  const statements = splitSqlStatements(text);
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'sql', options });

  if (treeChunks && treeChunks.length) {
    if (!statements.length || treeChunks.length >= statements.length) {
      const dialect = options.dialect || 'generic';
      return treeChunks.map((chunk) => ({
        ...chunk,
        meta: {
          ...(chunk.meta || {}),
          dialect
        }
      }));
    }
  }

  if (!statements.length) return null;

  const dialect = options.dialect || 'generic';
  const lineIndex = buildLineIndex(text);
  const lines = text.includes('--') || text.includes('/*')
    ? text.split('\n')
    : null;
  const decls = [];

  for (const stmt of statements) {
    const stmtText = text.slice(stmt.start, stmt.end);
    const { kind, name } = classifySqlStatement(stmtText);
    const startLine = offsetToLine(lineIndex, stmt.start);
    const endLine = offsetToLine(lineIndex, stmt.end);
    const leading = extractSqlLeadingDoc(stmtText);
    const docstring = (lines ? extractDocComment(lines, startLine - 1, SQL_DOC_OPTIONS) : '') || leading.docstring;

    decls.push({
      start: stmt.start,
      end: stmt.end,
      name,
      kind,
      meta: {
        startLine,
        endLine,
        signature: leading.signature || firstNonEmptyLine(stmtText),
        docstring,
        dialect
      }
    });
  }

  return decls;
}
