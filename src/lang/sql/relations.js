import { createRequire } from 'node:module';
import { SQL_PARSER_DIALECTS } from './constants.js';
import { collectSqlImports } from './imports.js';

const require = createRequire(import.meta.url);

let sqlParserInstance = null;
let sqlParserLoadFailed = false;

function normalizeSqlIdentifier(raw) {
  if (!raw) return '';
  let out = '';
  const value = String(raw);
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '"' && ch !== '`' && ch !== '[' && ch !== ']') out += ch;
  }
  return out.trim();
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

function collectSqlTablesFromAst(root, tables) {
  if (!root) return;

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
