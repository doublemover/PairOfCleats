import { parseBabelAst } from '../babel-parser.js';
import { collectImportsFromAst } from '../javascript.js';
import { findCLikeBodyBounds } from '../clike.js';
import { TS_CALL_KEYWORDS, TS_USAGE_SKIP } from './constants.js';
import { resolveTypeScriptParser, stripTypeScriptComments } from './parser.js';

/**
 * Collect import paths from TypeScript source text.
 * @param {string} text
 * @returns {string[]}
 */
export function collectTypeScriptImports(text, options = {}) {
  const importsOnly = options?.importsOnly === true || options?.typescript?.importsOnly === true;
  const parser = resolveTypeScriptParser(options);
  if (!importsOnly && (parser === 'babel' || parser === 'auto')) {
    const ast = parseBabelAst(text, { ext: options.ext || '', mode: 'typescript' });
    if (ast) return collectImportsFromAst(ast);
  }
  const imports = new Set();
  const normalized = stripTypeScriptComments(text);
  const capture = (regex) => {
    for (const match of normalized.matchAll(regex)) {
      if (match[1]) imports.add(match[1]);
    }
  };
  capture(/\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g);
  capture(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  capture(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  return Array.from(imports);
}

function collectTypeScriptExports(text) {
  const exports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('export ')) continue;
    let match = trimmed.match(/^export\s+(?:default\s+)?(?:class|interface|enum|type|function|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (match) {
      exports.add(match[1]);
      continue;
    }
    match = trimmed.match(/^export\s*\{([^}]+)\}/);
    if (match) {
      match[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => {
        const clean = name.split(/\s+as\s+/i)[0].trim();
        if (clean) exports.add(clean);
      });
    }
  }
  return Array.from(exports);
}

function collectTypeScriptCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripTypeScriptComments(text);
  for (const match of normalized.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$.]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split('.').filter(Boolean).pop();
    if (!base || TS_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (TS_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Build import/export/call/usage relations for TypeScript chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} tsChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildTypeScriptRelations(text, tsChunks, options = {}) {
  const imports = collectTypeScriptImports(text, options);
  const exports = new Set(collectTypeScriptExports(text));
  const calls = [];
  const usages = new Set();
  if (Array.isArray(tsChunks)) {
    for (const chunk of tsChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (!['MethodDeclaration', 'ConstructorDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end
        ? bounds.bodyStart + 1
        : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end
        ? bounds.bodyEnd
        : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectTypeScriptCallsAndUsages(slice);
      for (const callee of chunkCalls) calls.push([chunk.name, callee]);
      for (const usage of chunkUsages) usages.add(usage);
    }
  }
  return {
    imports,
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages)
  };
}
