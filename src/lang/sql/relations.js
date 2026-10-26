import { createRequire } from 'node:module';
import { createSqlRelationEvidence, noteSqlRelationCoverage, projectSqlRelationEvidence, sqlPhysicalUsageDisplays } from './relation-evidence.js';
import { SQL_PARSER_DIALECTS } from './constants.js';
import { collectSqlImports } from './imports.js';

const require = createRequire(import.meta.url);

let sqlParserInstance = null;
let sqlParserLoadFailed = false;
let sqlParserVersion = null;

/**
 * Lazily load `node-sql-parser` once per process.
 *
 * If loading fails, the failure is memoized and callers fall back to import-only
 * heuristics for the remainder of the run.
 *
 * @param {(line:string)=>void} [log]
 * @returns {object|null}
 */
function getSqlParser(log) {
  if (sqlParserInstance || sqlParserLoadFailed) return sqlParserInstance;
  try {
    const mod = require('node-sql-parser');
    const Parser = mod.Parser || mod.default?.Parser || mod.default || mod;
    sqlParserInstance = new Parser();
    sqlParserVersion = require('node-sql-parser/package.json').version;
  } catch (err) {
    sqlParserLoadFailed = true;
    sqlParserInstance = null; sqlParserVersion = null;
    if (log) log(`SQL parser unavailable; falling back to heuristic SQL handling. ${err?.message || err}`);
  }
  return sqlParserInstance;
}

/** Parse once and retain qualification even when no usages are admitted. */
function collectSqlParserEvidence(text, dialect, log) {
  const admitted = text.length <= 512 * 1024;
  const evidence = createSqlRelationEvidence(text, dialect, null, admitted);
  if (!admitted) { noteSqlRelationCoverage(evidence, 'source_budget'); return evidence; }
  const parser = getSqlParser(log);
  evidence.parserVersion = sqlParserVersion;
  if (!parser) { noteSqlRelationCoverage(evidence, 'parser_unavailable'); return evidence; }
  const dialectKey = SQL_PARSER_DIALECTS[dialect] || null;
  let ast;
  try { ast = parser.astify(text, { ...(dialectKey ? { database: dialectKey } : {}), parseOptions: { includeLocations: true } }); }
  catch { noteSqlRelationCoverage(evidence, 'parser_failed'); return evidence; }
  return projectSqlRelationEvidence(ast, evidence, text);
}

/**
 * Build import/export/call/usage relations for SQL chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} sqlChunks
 * @param {{dialect?:string,log?:(line:string)=>void}} [options]
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildSqlRelations(text, sqlChunks, options = {}) {
  const exports = new Set();
  const usages = new Set();
  const imports = collectSqlImports(text, options);

  if (Array.isArray(sqlChunks)) {
    for (const chunk of sqlChunks) {
      if (!chunk || !chunk.name) continue;
      if (chunk.kind && chunk.kind.endsWith('Declaration')) exports.add(chunk.name);
    }
  }

  const sqlRelationEvidence = collectSqlParserEvidence(text, options.dialect || 'generic', options.log);
  const parsedUsages = sqlPhysicalUsageDisplays(sqlRelationEvidence);
  for (const entry of parsedUsages) {
    if (entry) usages.add(entry);
  }

  return {
    imports,
    exports: Array.from(exports),
    calls: [],
    usages: Array.from(usages),
    importLinks: imports.slice(),
    sqlRelationEvidence
  };
}
