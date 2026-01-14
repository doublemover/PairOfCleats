import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment } from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sqlParserInstance = null;
let sqlParserLoadFailed = false;

const SQL_PARSER_DIALECTS = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite'
};

/**
 * SQL language chunking and relations.
 * Statement-based parser for schema objects.
 */
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
        const slice = text.slice(start, end);
        if (slice.trim()) statements.push({ start, end, text: slice });
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
  if (start < text.length) {
    const slice = text.slice(start);
    if (slice.trim()) statements.push({ start, end: text.length, text: slice });
  }
  return statements;
}

function stripSqlComments(text) {
  let out = '';
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
        out += ch;
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
          out += "''";
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
          out += '""';
          i++;
          continue;
        }
        if (text[i - 1] !== '\\') inDouble = false;
      } else {
        inDouble = true;
      }
    }
    out += ch;
  }
  return out;
}

const SQL_FLOW_SKIP = new Set();
const SQL_FLOW_SKIP_WORDS = [
  'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross',
  'on', 'group', 'order', 'by', 'having', 'limit', 'offset',
  'insert', 'into', 'update', 'delete', 'create', 'table', 'view', 'materialized',
  'procedure', 'function', 'trigger', 'index', 'schema', 'database',
  'values', 'set', 'as', 'and', 'or', 'distinct',
  'case', 'when', 'then', 'else', 'end', 'if', 'elseif', 'elsif',
  'return', 'returns', 'begin', 'loop', 'while', 'repeat', 'until', 'for',
  'declare', 'cursor', 'fetch', 'raise', 'signal',
  'primary', 'key', 'foreign', 'references', 'constraint', 'default', 'null', 'is', 'not',
  'true', 'false'
];
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

function extractSqlLeadingDoc(statementText) {
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
  trimmed = trimmed.replace(/^(--.*\n)+/g, '');
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

function collectSqlTablesFromAst(node, tables) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectSqlTablesFromAst(entry, tables);
    return;
  }
  if (typeof node !== 'object') return;
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
  for (const value of Object.values(node)) {
    collectSqlTablesFromAst(value, tables);
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
 * Collect imports from SQL source (none).
 * @returns {string[]}
 */
export function collectSqlImports() {
  return [];
}

/**
 * Build chunk metadata for SQL statements.
 * Returns null when no statements are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildSqlChunks(text, options = {}) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const statements = splitSqlStatements(text);
  if (!statements.length) return null;

  const dialect = options.dialect || 'generic';
  const decls = [];
  for (const stmt of statements) {
    const { kind, name } = classifySqlStatement(stmt.text);
    const startLine = offsetToLine(lineIndex, stmt.start);
    const endLine = offsetToLine(lineIndex, stmt.end);
    const leading = extractSqlLeadingDoc(stmt.text);
    const docstring = extractDocComment(lines, startLine - 1, SQL_DOC_OPTIONS) || leading.docstring;
    const signature = leading.signature || stmt.text.trim().split('\n')[0].trim();
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
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} sqlChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildSqlRelations(text, allImports, sqlChunks, options = {}) {
  const exports = new Set();
  const usages = new Set();
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
    imports: [],
    exports: Array.from(exports),
    calls: [],
    usages: Array.from(usages),
    importLinks: []
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
    for (const match of cleaned.matchAll(/\b(?:raise|signal)\b\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
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
