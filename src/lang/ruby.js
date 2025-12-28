import { buildLineIndex, offsetToLine } from '../shared/lines.js';

/**
 * Ruby language chunking and relations.
 * Line-based parser for modules, classes, and methods.
 */
const RUBY_CALL_KEYWORDS = new Set([
  'if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'case', 'when',
  'return', 'yield', 'super', 'break', 'next', 'redo', 'retry', 'then', 'do',
  'begin', 'rescue', 'ensure', 'end'
]);

const RUBY_USAGE_SKIP = new Set([
  ...RUBY_CALL_KEYWORDS,
  'class', 'module', 'def', 'nil', 'true', 'false', 'self'
]);

function extractRubyDocComment(lines, startLineIdx) {
  let i = startLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return '';
  const out = [];
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('#')) break;
    if (trimmed.startsWith('#!')) break;
    out.unshift(trimmed.replace(/^#\s?/, ''));
    i--;
  }
  return out.join('\n').trim();
}

function stripRubyComments(text) {
  return text.replace(/#.*$/gm, ' ');
}

function collectRubyCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripRubyComments(text);
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_:.!?=]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split(/[:.]/).filter(Boolean).pop();
    if (!base || RUBY_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_?!]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (RUBY_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

function parseRubyParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=[^,]+/g, '').trim();
    seg = seg.replace(/^[*&]/, '').trim();
    const name = seg.split(/\s+/)[0];
    if (!name || !/^[A-Za-z_]/.test(name)) continue;
    params.push(name.replace(/[^A-Za-z0-9_]/g, ''));
  }
  return params;
}

/**
 * Collect require statements from Ruby source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectRubyImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let match = trimmed.match(/^require\s+['"]([^'"]+)['"]/);
    if (match) {
      imports.add(match[1]);
      continue;
    }
    match = trimmed.match(/^require_relative\s+['"]([^'"]+)['"]/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

function isBlockStart(trimmed) {
  if (/^class\s+/.test(trimmed)) return 'class';
  if (/^module\s+/.test(trimmed)) return 'module';
  if (/^def\s+/.test(trimmed)) return 'def';
  if (/^(if|unless|while|until|for|case|begin)\b/.test(trimmed)) return 'block';
  if (/\bdo\b\s*(\|[^|]*\|)?\s*$/.test(trimmed)) return 'block';
  return null;
}

function parseRubyDefName(trimmed) {
  const match = trimmed.match(/^def\s+([A-Za-z0-9_:.!?=]+)/);
  if (!match) return null;
  return match[1];
}

/**
 * Build chunk metadata for Ruby declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildRubyChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const blockStack = [];
  const scopeStack = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/#.*$/g, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'end') {
      const block = blockStack.pop();
      if (!block) continue;
      if (block.kind === 'class' || block.kind === 'module') {
        scopeStack.pop();
      }
      if (!block.isDecl) continue;
      const start = block.start;
      const end = lineIndex[i] + rawLine.length;
      decls.push({
        start,
        end,
        name: block.name,
        kind: block.kind === 'class' ? 'ClassDeclaration' : (block.kind === 'module' ? 'ModuleDeclaration' : 'MethodDeclaration'),
        meta: {
          startLine: block.startLine,
          endLine: offsetToLine(lineIndex, end),
          signature: block.signature,
          params: block.params,
          docstring: block.docstring
        }
      });
      continue;
    }

    const blockKind = isBlockStart(trimmed);
    if (!blockKind) continue;

    if (blockKind === 'class') {
      const match = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_:]*)/);
      if (!match) continue;
      const name = match[1];
      const start = lineIndex[i] + rawLine.indexOf(match[0]);
      const signature = rawLine.trim();
      const docstring = extractRubyDocComment(lines, i);
      scopeStack.push(name);
      blockStack.push({
        kind: 'class',
        isDecl: true,
        name,
        start,
        startLine: i + 1,
        signature,
        params: [],
        docstring
      });
      continue;
    }

    if (blockKind === 'module') {
      const match = trimmed.match(/^module\s+([A-Za-z_][A-Za-z0-9_:]*)/);
      if (!match) continue;
      const name = match[1];
      const start = lineIndex[i] + rawLine.indexOf(match[0]);
      const signature = rawLine.trim();
      const docstring = extractRubyDocComment(lines, i);
      scopeStack.push(name);
      blockStack.push({
        kind: 'module',
        isDecl: true,
        name,
        start,
        startLine: i + 1,
        signature,
        params: [],
        docstring
      });
      continue;
    }

    if (blockKind === 'def') {
      const defName = parseRubyDefName(trimmed);
      if (!defName) continue;
      const start = lineIndex[i] + rawLine.indexOf('def');
      const signature = rawLine.trim();
      const params = parseRubyParams(signature);
      const docstring = extractRubyDocComment(lines, i);
      let methodName = defName;
      const currentScope = scopeStack[scopeStack.length - 1] || null;
      if (currentScope && !defName.includes('.') && !defName.includes('::')) {
        methodName = `${currentScope}.${defName}`;
      } else if (defName.startsWith('self.')) {
        const base = defName.replace(/^self\./, '');
        methodName = currentScope ? `${currentScope}.${base}` : base;
      }
      blockStack.push({
        kind: 'def',
        isDecl: true,
        name: methodName,
        start,
        startLine: i + 1,
        signature,
        params,
        docstring
      });
      continue;
    }

    blockStack.push({ kind: 'block', isDecl: false });
  }

  if (!decls.length) return null;
  decls.sort((a, b) => a.start - b.start);
  return decls.map((decl) => ({
    start: decl.start,
    end: decl.end,
    name: decl.name,
    kind: decl.kind,
    meta: decl.meta || {}
  }));
}

/**
 * Build import/export/call/usage relations for Ruby chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} rubyChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildRubyRelations(text, allImports, rubyChunks) {
  const imports = collectRubyImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(rubyChunks)) {
    for (const chunk of rubyChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (chunk.kind === 'ClassDeclaration' || chunk.kind === 'ModuleDeclaration') {
        exports.add(chunk.name);
      }
      if (!['MethodDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const slice = text.slice(chunk.start, chunk.end);
      const { calls: chunkCalls, usages: chunkUsages } = collectRubyCallsAndUsages(slice);
      for (const callee of chunkCalls) calls.push([chunk.name, callee]);
      for (const usage of chunkUsages) usages.add(usage);
    }
  }
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages),
    importLinks
  };
}

/**
 * Normalize Ruby-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractRubyDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null
  };
}
