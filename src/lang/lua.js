import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment } from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';

/**
 * Lua language chunking and relations.
 * Line-based parser for functions and method definitions.
 */
const LUA_CALL_KEYWORDS = new Set([
  'if', 'then', 'elseif', 'else', 'for', 'while', 'repeat', 'until', 'return',
  'function', 'local', 'end', 'do'
]);

const LUA_USAGE_SKIP = new Set([
  ...LUA_CALL_KEYWORDS,
  'nil', 'true', 'false', 'self'
]);

const LUA_DOC_OPTIONS = {
  linePrefixes: ['---', '--'],
  blockStarts: [],
  blockEnd: null
};

function stripLuaComments(text) {
  return text.replace(/--\[\[[\s\S]*?\]\]/g, ' ').replace(/--.*$/gm, ' ');
}

function collectLuaCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripLuaComments(text);
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_.:]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split(/[.:]/).filter(Boolean).pop();
    if (!base || LUA_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (LUA_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

function parseLuaParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const name = seg.replace(/^\.\.\./, '').trim();
    if (!name || !/^[A-Za-z_]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

function parseLuaFunctionName(trimmed) {
  let match = trimmed.match(/^local\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (match) return match[1];
  match = trimmed.match(/^function\s+([A-Za-z_][A-Za-z0-9_.:]*)\s*\(/);
  if (match) return match[1];
  match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.:]*)\s*=\s*function\s*\(/);
  if (match) return match[1];
  return null;
}

function normalizeLuaName(name) {
  if (!name) return null;
  return name.replace(/:/g, '.');
}

/**
 * Collect require imports from Lua source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectLuaImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    const match = trimmed.match(/\brequire\s*\(?\s*['"]([^'"]+)['"]/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for Lua declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildLuaChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const blockStack = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const codeLine = trimmed.replace(/--.*$/, '').trim();
    if (!codeLine) continue;

    if (codeLine === 'end') {
      const block = blockStack.pop();
      if (!block || !block.isDecl) continue;
      const end = lineIndex[i] + rawLine.length;
      decls.push({
        start: block.start,
        end,
        name: block.name,
        kind: block.kind,
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

    if (/^until\b/.test(codeLine)) {
      const block = blockStack.pop();
      if (block && block.isDecl) {
        const end = lineIndex[i] + rawLine.length;
        decls.push({
          start: block.start,
          end,
          name: block.name,
          kind: block.kind,
          meta: {
            startLine: block.startLine,
            endLine: offsetToLine(lineIndex, end),
            signature: block.signature,
            params: block.params,
            docstring: block.docstring
          }
        });
      }
      continue;
    }

    const fnName = parseLuaFunctionName(codeLine);
    if (fnName) {
      const start = lineIndex[i] + rawLine.indexOf(trimmed);
      const signature = codeLine;
      const params = parseLuaParams(signature);
      const docstring = extractDocComment(lines, i, LUA_DOC_OPTIONS);
      const normalized = normalizeLuaName(fnName);
      const kind = normalized && normalized.includes('.') ? 'MethodDeclaration' : 'FunctionDeclaration';
      blockStack.push({
        isDecl: true,
        name: normalized || fnName,
        kind,
        start,
        startLine: i + 1,
        signature,
        params,
        docstring
      });
      continue;
    }

    if (/^(if|for|while|repeat|do)\b/.test(codeLine)) {
      blockStack.push({ isDecl: false });
    }
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
 * Build import/export/call/usage relations for Lua chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} luaChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildLuaRelations(text, allImports, luaChunks) {
  const imports = collectLuaImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(luaChunks)) {
    for (const chunk of luaChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (!['MethodDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const slice = text.slice(chunk.start, chunk.end);
      const { calls: chunkCalls, usages: chunkUsages } = collectLuaCallsAndUsages(slice);
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
 * Normalize Lua-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractLuaDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}

/**
 * Heuristic control-flow/dataflow extraction for Lua chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeLuaFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const slice = text.slice(chunk.start, chunk.end);
  const cleaned = stripLuaComments(slice);
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
      skip: LUA_USAGE_SKIP,
      memberOperators: ['.', ':']
    });
    out.returnsValue = hasReturnValue(cleaned);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'elseif', 'else'],
      loopKeywords: ['for', 'while', 'repeat', 'until']
    });
  }

  return out;
}
