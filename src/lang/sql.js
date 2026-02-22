import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment } from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { createRequire } from 'node:module';
import { buildTreeSitterChunks } from './tree-sitter.js';

const require = createRequire(import.meta.url);
let sqlParserInstance = null;
let sqlParserLoadFailed = false;

const SQL_PARSER_DIALECTS = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite'
};

export const SQL_RESERVED_WORDS_COMMON = new Set([
  'add',
  'all',
  'alter',
  'and',
  'any',
  'as',
  'asc',
  'begin',
  'between',
  'by',
  'case',
  'cast',
  'check',
  'column',
  'commit',
  'constraint',
  'create',
  'cross',
  'current',
  'cursor',
  'database',
  'declare',
  'default',
  'delete',
  'desc',
  'distinct',
  'drop',
  'else',
  'elseif',
  'elsif',
  'end',
  'escape',
  'except',
  'exists',
  'false',
  'fetch',
  'foreign',
  'for',
  'from',
  'full',
  'function',
  'grant',
  'group',
  'having',
  'if',
  'in',
  'index',
  'inner',
  'insert',
  'intersect',
  'into',
  'is',
  'join',
  'key',
  'left',
  'like',
  'limit',
  'loop',
  'materialized',
  'not',
  'null',
  'offset',
  'on',
  'or',
  'order',
  'outer',
  'over',
  'partition',
  'primary',
  'procedure',
  'raise',
  'references',
  'repeat',
  'return',
  'returns',
  'revoke',
  'right',
  'rollback',
  'row',
  'rows',
  'schema',
  'select',
  'set',
  'signal',
  'table',
  'then',
  'transaction',
  'trigger',
  'true',
  'union',
  'unique',
  'until',
  'update',
  'values',
  'view',
  'when',
  'where',
  'while',
  'with'
]);

export const POSTGRES_RESERVED_WORDS = new Set([
  'analyse',
  'analyze',
  'array',
  'bigint',
  'bigserial',
  'bit',
  'boolean',
  'bytea',
  'cascade',
  'character',
  'collate',
  'comment',
  'concurrently',
  'current_catalog',
  'current_date',
  'current_schema',
  'current_time',
  'current_timestamp',
  'current_user',
  'cycle',
  'deallocate',
  'do',
  'explain',
  'extension',
  'generated',
  'identity',
  'ilike',
  'immutable',
  'inherits',
  'language',
  'listen',
  'local',
  'lock',
  'notify',
  'numeric',
  'owner',
  'prepare',
  'prepared',
  'reindex',
  'release',
  'rename',
  'restrict',
  'returning',
  'role',
  'savepoint',
  'security',
  'serial',
  'session_user',
  'setof',
  'share',
  'similar',
  'stable',
  'temp',
  'temporary',
  'timestamp',
  'unlogged',
  'uuid',
  'vacuum',
  'varying',
  'verbose',
  'volatile'
]);

export const MYSQL_RESERVED_WORDS = new Set([
  'after',
  'auto_increment',
  'before',
  'binary',
  'blob',
  'charset',
  'collate',
  'columns',
  'engine',
  'enum',
  'force',
  'fulltext',
  'generated',
  'high_priority',
  'ignore',
  'keys',
  'low_priority',
  'modify',
  'replace',
  'spatial',
  'sql_calc_found_rows',
  'sql_no_cache',
  'straight_join',
  'unsigned',
  'zerofill'
]);

export const SQLITE_RESERVED_WORDS = new Set([
  'abort',
  'action',
  'after',
  'attach',
  'autoincrement',
  'before',
  'cascade',
  'conflict',
  'deferred',
  'detach',
  'each',
  'exclusive',
  'fail',
  'glob',
  'immediate',
  'indexed',
  'initially',
  'instead',
  'isnull',
  'match',
  'notnull',
  'plan',
  'pragma',
  'query',
  'raise',
  'recursive',
  'release',
  'rename',
  'replace',
  'rowid',
  'temp',
  'temporary',
  'vacuum',
  'virtual',
  'without'
]);

export const SQL_RESERVED_WORDS = new Set([
  ...SQL_RESERVED_WORDS_COMMON,
  ...POSTGRES_RESERVED_WORDS,
  ...MYSQL_RESERVED_WORDS,
  ...SQLITE_RESERVED_WORDS
]);

/**
 * SQL language chunking and relations.
 * Statement-based parser for schema objects.
 */

function hasNonWhitespace(text, start, end) {
  for (let i = start; i < end; i += 1) {
    const code = text.charCodeAt(i);
    // Common ASCII whitespace: tab, lf, cr, space, form-feed.
    if (code !== 9 && code !== 10 && code !== 13 && code !== 32 && code !== 12) return true;
  }
  return false;
}

function splitSqlStatements(text) {
  const statements = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;
  let delimiter = ';';

  for (let i = 0; i < text.length; i++) {
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
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }
    if (lineStart && !inSingle && !inDouble && !inLineComment && !inBlockComment) {
      let j = i;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
      if (text.slice(j, j + 9).toLowerCase() === 'delimiter' && /\s/.test(text[j + 9] || '')) {
        let k = j + 9;
        while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
        let endLine = text.indexOf('\n', k);
        if (endLine === -1) endLine = text.length;
        const rawDelimiter = text.slice(k, endLine).trim();
        if (rawDelimiter) delimiter = rawDelimiter;
        start = Math.max(start, endLine + 1);
        i = endLine;
        continue;
      }
    }
    if (!inDouble && ch === '\'') {
      if (inSingle) {
        if (next === '\'') {
          i++;
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
          i++;
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
      if (delimiter && text.startsWith(delimiter, i)) {
        const end = i + delimiter.length;
        if (hasNonWhitespace(text, start, end)) statements.push({ start, end });
        start = end;
        i = end - 1;
        continue;
      }
      if (ch === '$') {
        const end = text.indexOf('$', i + 1);
        if (end !== -1) {
          const tag = text.slice(i, end + 1);
          if (tag === '$$' || /^\$[A-Za-z_][A-Za-z0-9_]*\$$/.test(tag)) {
            dollarTag = tag;
            i = end;
            continue;
          }
        }
      }
    }
  }
  if (start < text.length && hasNonWhitespace(text, start, text.length)) {
    statements.push({ start, end: text.length });
  }
  return statements;
}

function stripSqlComments(text) {
  // Build via array-join to avoid quadratic string concatenation for large statements.
  const out = [];
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
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
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }
    if (!inDouble && ch === '\'') {
      if (inSingle) {
        if (next === '\'') {
          out.push("''");
          i++;
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
          i++;
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

const SQL_FLOW_SKIP = new Set();
const SQL_FLOW_SKIP_WORDS = Array.from(SQL_RESERVED_WORDS);
const addSqlSkip = (keyword) => {
  if (!keyword) return;
  SQL_FLOW_SKIP.add(keyword);
  SQL_FLOW_SKIP.add(keyword.toUpperCase());
  SQL_FLOW_SKIP.add(keyword[0].toUpperCase() + keyword.slice(1));
};
SQL_FLOW_SKIP_WORDS.forEach(addSqlSkip);

const SQL_CONTROL_FLOW = {
  branchKeywords: ['case', 'when', 'then', 'else', 'if', 'elseif', 'elsif'],
  loopKeywords: ['loop', 'while', 'repeat', 'until', 'for', 'foreach'],
  returnKeywords: ['return'],
  breakKeywords: ['break', 'leave', 'exit'],
  continueKeywords: ['continue'],
  throwKeywords: ['raise', 'signal']
};

const SQL_DOC_OPTIONS = {
  linePrefixes: ['--'],
  blockStarts: ['/*'],
  blockEnd: '*/'
};

function firstNonEmptyLine(text) {
  if (!text) return '';
  let start = 0;
  while (start < text.length) {
    while (start < text.length && (text[start] === '\n' || text[start] === '\r' || text[start] === ' ' || text[start] === '\t')) {
      start += 1;
    }
    if (start >= text.length) break;
    let end = start;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1;
    const line = text.slice(start, end).trim();
    if (line) return line;
    start = end + 1;
  }
  return '';
}

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
      i++;
      continue;
    }
    if (trimmed.startsWith('--')) {
      docLines.push(trimmed.replace(/^--\s?/, ''));
      i++;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      const raw = [];
      while (i < lines.length) {
        raw.push(lines[i]);
        if (lines[i].includes('*/')) break;
        i++;
      }
      const cleaned = raw
        .map((line) => line.replace(/^\s*\/\*+/, '').replace(/\*\/\s*$/, '').replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
      if (cleaned) docLines.push(cleaned);
      i++;
      continue;
    }
    signature = trimmed;
    break;
  }
  return { docstring: docLines.join('\n').trim(), signature };
}

function classifySqlStatement(statement) {
  let trimmed = statement.trim();
  trimmed = trimmed.replace(/^(?:--.*(?:\r?\n|\r|$))+/g, '');
  trimmed = trimmed.replace(/^\/\*[\s\S]*?\*\//, '');
  trimmed = trimmed.trim().replace(/\s+/g, ' ');
  const match = trimmed.match(/^create\s+(?:or\s+replace\s+)?(table|view|materialized\s+view|function|procedure|trigger|index|schema|database)\s+([A-Za-z0-9_\"`\.]+)/i);
  if (match) {
    const kindMap = {
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
    return {
      kind: kindMap[match[1].toLowerCase()] || 'Statement',
      name: match[2].replace(/[\"`]/g, '')
    };
  }
  return { kind: 'Statement', name: 'statement' };
}

function getSqlParser(log) {
  if (sqlParserInstance || sqlParserLoadFailed) return sqlParserInstance;
  try {
    const mod = require('node-sql-parser');
    const Parser = mod.Parser || mod.default?.Parser || mod.default || mod;
    sqlParserInstance = new Parser();
  } catch (err) {
    sqlParserLoadFailed = true;
    if (log) log(`SQL parser unavailable; falling back to heuristic SQL handling. ${err?.message || err}`);
  }
  return sqlParserInstance;
}

function normalizeSqlIdentifier(raw) {
  if (!raw) return '';
  return String(raw).replace(/[\"`\[\]]/g, '').trim();
}

function collectSqlTablesFromAst(root, tables) {
  if (!root) return;

  // Iterative traversal to avoid deep recursion and to reduce per-node allocations.
  const stack = [root];
  const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen) {
      if (seen.has(node)) continue;
      seen.add(node);
    }

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        stack.push(node[i]);
      }
      continue;
    }

    if (typeof node.table === 'string') {
      const cleaned = normalizeSqlIdentifier(node.table);
      if (cleaned) tables.add(cleaned);
    } else if (node.table && typeof node.table === 'object') {
      if (typeof node.table.table === 'string') {
        const cleaned = normalizeSqlIdentifier(node.table.table);
        if (cleaned) tables.add(cleaned);
      }
      if (typeof node.table.name === 'string') {
        const cleaned = normalizeSqlIdentifier(node.table.name);
        if (cleaned) tables.add(cleaned);
      }
    }

    if (Array.isArray(node.tableList)) {
      for (const entry of node.tableList) {
        const cleaned = normalizeSqlIdentifier(entry);
        if (cleaned) tables.add(cleaned);
      }
    }

    // Avoid Object.values(...) (allocates an array per node).
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const value = node[key];
      if (value && typeof value === 'object') stack.push(value);
    }
  }
}

function collectSqlParserUsages(text, dialect, log) {
  const parser = getSqlParser(log);
  if (!parser) return [];
  const tables = new Set();
  const dialectKey = SQL_PARSER_DIALECTS[dialect] || null;
  try {
    const ast = parser.astify(text, dialectKey ? { database: dialectKey } : undefined);
    collectSqlTablesFromAst(ast, tables);
  } catch {
    return [];
  }
  return Array.from(tables);
}

/**
 * Collect imports from SQL source.
 * @returns {string[]}
 */
export function collectSqlImports(text = '') {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  let inBlockComment = false;
  for (const rawLine of lines) {
    let cleaned = '';
    let idx = 0;
    while (idx < rawLine.length) {
      if (inBlockComment) {
        const end = rawLine.indexOf('*/', idx);
        if (end === -1) {
          idx = rawLine.length;
          break;
        }
        idx = end + 2;
        inBlockComment = false;
        continue;
      }
      const blockStart = rawLine.indexOf('/*', idx);
      const lineCommentStart = rawLine.indexOf('--', idx);
      if (blockStart === -1 && lineCommentStart === -1) {
        cleaned += rawLine.slice(idx);
        break;
      }
      if (lineCommentStart !== -1 && (blockStart === -1 || lineCommentStart < blockStart)) {
        cleaned += rawLine.slice(idx, lineCommentStart);
        break;
      }
      cleaned += rawLine.slice(idx, blockStart);
      idx = blockStart + 2;
      inBlockComment = true;
    }
    const line = cleaned.trim();
    if (!line || line.startsWith('--') || line.startsWith('/*')) continue;
    const psqlMatch = line.match(/^\\i(?:r)?\s+([^\s;]+)/i);
    if (psqlMatch?.[1]) imports.add(psqlMatch[1]);
    const sourceMatch = line.match(/^source\s+([^\s;]+)/i);
    if (sourceMatch?.[1]) imports.add(sourceMatch[1]);
    const oracleMatch = line.match(/^@@\s*([^\s;]+)/);
    if (oracleMatch?.[1]) imports.add(oracleMatch[1]);
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for SQL statements.
 * Returns null when no statements are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildSqlChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'sql', options });
  if (treeChunks && treeChunks.length) {
    const dialect = options.dialect || 'generic';
    return treeChunks.map((chunk) => ({
      ...chunk,
      meta: {
        ...(chunk.meta || {}),
        dialect
      }
    }));
  }
  const lineIndex = buildLineIndex(text);
  const lines = text.includes('--') || text.includes('/*')
    ? text.split('\n')
    : null;
  const statements = splitSqlStatements(text);
  if (!statements.length) return null;

  const dialect = options.dialect || 'generic';
  const decls = [];
  for (const stmt of statements) {
    const stmtText = text.slice(stmt.start, stmt.end);
    const { kind, name } = classifySqlStatement(stmtText);
    const startLine = offsetToLine(lineIndex, stmt.start);
    const endLine = offsetToLine(lineIndex, stmt.end);
    const leading = extractSqlLeadingDoc(stmtText);
    const docstring = (lines ? extractDocComment(lines, startLine - 1, SQL_DOC_OPTIONS) : '') || leading.docstring;
    const signature = leading.signature || firstNonEmptyLine(stmtText);
    decls.push({
      start: stmt.start,
      end: stmt.end,
      name,
      kind,
      meta: {
        startLine,
        endLine,
        signature,
        docstring,
        dialect
      }
    });
  }
  return decls;
}

/**
 * Build import/export/call/usage relations for SQL chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} sqlChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildSqlRelations(text, sqlChunks, options = {}) {
  const exports = new Set();
  const usages = new Set();
  const imports = collectSqlImports(text);
  if (Array.isArray(sqlChunks)) {
    for (const chunk of sqlChunks) {
      if (!chunk || !chunk.name) continue;
      if (chunk.kind && chunk.kind.endsWith('Declaration')) exports.add(chunk.name);
    }
  }
  const parsedUsages = collectSqlParserUsages(text, options.dialect || 'generic', options.log);
  for (const entry of parsedUsages) {
    if (entry) usages.add(entry);
  }
  return {
    imports,
    exports: Array.from(exports),
    calls: [],
    usages: Array.from(usages),
    importLinks: imports.slice()
  };
}

/**
 * Heuristic control-flow/dataflow extraction for SQL chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeSqlFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  if (chunk.end <= chunk.start) return null;
  const slice = text.slice(chunk.start, chunk.end);
  const cleaned = stripSqlComments(slice);
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  const out = {
    dataflow: null,
    controlFlow: null,
    throws: [],
    awaits: [],
    yields: false,
    returnsValue: false
  };

  if (dataflowEnabled) {
    out.dataflow = buildHeuristicDataflow(cleaned, {
      skip: SQL_FLOW_SKIP,
      memberOperators: ['.', '::']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    const raiseSignalRe = /\b(?:raise|signal)\b\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
    let match;
    while ((match = raiseSignalRe.exec(cleaned)) !== null) {
      const name = match[1];
      if (name) throws.add(name);
    }
    out.throws = Array.from(throws);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, SQL_CONTROL_FLOW);
  }

  return out;
}

/**
 * Normalize SQL-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractSqlDocMeta(chunk) {
  const meta = chunk.meta || {};
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params: [],
    returns: null,
    signature: meta.signature || null,
    dialect: meta.dialect || null,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}
