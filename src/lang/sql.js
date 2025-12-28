import { buildLineIndex, offsetToLine } from '../shared/lines.js';

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

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

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
    if (!inDouble && ch === '\'' && text[i - 1] !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"' && text[i - 1] !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && ch === ';') {
      const end = i + 1;
      const slice = text.slice(start, end);
      if (slice.trim()) statements.push({ start, end, text: slice });
      start = end;
    }
  }
  if (start < text.length) {
    const slice = text.slice(start);
    if (slice.trim()) statements.push({ start, end: text.length, text: slice });
  }
  return statements;
}

function extractSqlDocComment(lines, startLineIdx) {
  let i = startLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return '';
  const out = [];
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('--')) {
      out.unshift(trimmed.replace(/^--\s?/, ''));
      i--;
      continue;
    }
    if (trimmed.endsWith('*/')) {
      const raw = [];
      while (i >= 0) {
        raw.unshift(lines[i]);
        if (lines[i].includes('/*')) break;
        i--;
      }
      const cleaned = raw
        .map((line) => line.replace(/^\s*\/\*+/, '').replace(/\*\/\s*$/, '').replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
      if (cleaned) out.unshift(cleaned);
      break;
    }
    break;
  }
  return out.join('\n').trim();
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
export function buildSqlChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const statements = splitSqlStatements(text);
  if (!statements.length) return null;

  const decls = [];
  for (const stmt of statements) {
    const { kind, name } = classifySqlStatement(stmt.text);
    const startLine = offsetToLine(lineIndex, stmt.start);
    const endLine = offsetToLine(lineIndex, stmt.end);
    const docstring = extractSqlDocComment(lines, startLine - 1);
    decls.push({
      start: stmt.start,
      end: stmt.end,
      name,
      kind,
      meta: {
        startLine,
        endLine,
        signature: stmt.text.trim().split('\n')[0].trim(),
        docstring
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
export function buildSqlRelations(text, allImports, sqlChunks) {
  const exports = new Set();
  if (Array.isArray(sqlChunks)) {
    for (const chunk of sqlChunks) {
      if (!chunk || !chunk.name) continue;
      if (chunk.kind && chunk.kind.endsWith('Declaration')) exports.add(chunk.name);
    }
  }
  return {
    imports: [],
    exports: Array.from(exports),
    calls: [],
    usages: [],
    importLinks: []
  };
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
    signature: meta.signature || null
  };
}
