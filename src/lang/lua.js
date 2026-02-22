import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment } from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { getNamedChild, getNamedChildCount } from './tree-sitter/ast.js';
import { getNativeTreeSitterParser } from './tree-sitter/native-runtime.js';
import { isTreeSitterEnabled } from './tree-sitter/options.js';

/**
 * Lua language chunking and relations.
 * Line-based parser for functions and method definitions.
 */
export const LUA_RESERVED_WORDS = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'goto',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while'
]);

const LUA_CALL_KEYWORDS = new Set([
  ...LUA_RESERVED_WORDS
]);

const LUA_USAGE_SKIP = new Set([
  ...LUA_RESERVED_WORDS,
  'self'
]);

const LUA_DOC_OPTIONS = {
  linePrefixes: ['---', '--'],
  blockStarts: [],
  blockEnd: null
};

const LUA_TREE_SITTER_NODE_TYPES = new Set([
  'function_declaration',
  'local_function'
]);

const LUA_TREE_SITTER_LOGGED = new Set();

function stripLuaComments(text) {
  return text.replace(/--\[\[[\s\S]*?\]\]/g, ' ').replace(/--.*$/gm, ' ');
}

function getLastLuaSegment(raw) {
  if (!raw) return '';
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === '.' || raw[end - 1] === ':')) end -= 1;
  if (!end) return '';
  let idx = end - 1;
  while (idx >= 0) {
    const ch = raw[idx];
    if (ch === '.' || ch === ':') break;
    idx -= 1;
  }
  return raw.slice(idx + 1, end);
}

function collectLuaCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripLuaComments(text);
  const callRe = /\b([A-Za-z_][A-Za-z0-9_.:]*)\s*\(/g;
  let match;
  while ((match = callRe.exec(normalized)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const base = getLastLuaSegment(raw);
    if (!base || LUA_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
    if (!match[0]) callRe.lastIndex += 1;
  }
  const usageRe = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((match = usageRe.exec(normalized)) !== null) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (LUA_USAGE_SKIP.has(name)) continue;
    usages.add(name);
    if (!match[0]) usageRe.lastIndex += 1;
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

const resolveLuaParseTimeoutMs = (options) => {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.lua || {};
  const raw = perLanguage.maxParseMs ?? config.maxParseMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const logLuaTreeSitterOnce = (options, key, message) => {
  if (!options?.log || !message || LUA_TREE_SITTER_LOGGED.has(key)) return;
  options.log(message);
  LUA_TREE_SITTER_LOGGED.add(key);
};

const extractLuaTreeSitterName = (node, text) => {
  if (!node || typeof text !== 'string') return null;
  const nameNode = typeof node.childForFieldName === 'function'
    ? node.childForFieldName('name')
    : null;
  if (nameNode) {
    const raw = text.slice(nameNode.startIndex, nameNode.endIndex).trim();
    if (raw) return normalizeLuaName(raw);
  }
  const limit = Math.min(text.length, node.startIndex + 240);
  const snippet = text.slice(node.startIndex, limit);
  const signature = (snippet.split('\n', 1)[0] || '').trim();
  if (!signature) return null;
  const parsed = parseLuaFunctionName(signature);
  if (parsed) return normalizeLuaName(parsed);
  return null;
};

const gatherLuaTreeSitterNodes = (root) => {
  if (!root) return null;
  const stack = [root];
  const nodes = [];
  let visited = 0;
  const maxNodes = 200_000;
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    visited += 1;
    if (visited > maxNodes) return null;
    if (LUA_TREE_SITTER_NODE_TYPES.has(node.type)) {
      nodes.push(node);
    }
    const childCount = getNamedChildCount(node);
    for (let i = childCount - 1; i >= 0; i -= 1) {
      stack.push(getNamedChild(node, i));
    }
  }
  return nodes;
};

const buildLuaTreeSitterChunks = (text, options = {}) => {
  if (options?.treeSitter && !isTreeSitterEnabled(options, 'lua')) {
    return null;
  }
  const parser = getNativeTreeSitterParser('lua', options);
  if (!parser) {
    logLuaTreeSitterOnce(
      options,
      'lua:parser-unavailable',
      'Tree-sitter unavailable for lua; falling back to heuristic chunking.'
    );
    return null;
  }

  let tree = null;
  try {
    try {
      const parseTimeoutMs = resolveLuaParseTimeoutMs(options);
      if (typeof parser.setTimeoutMicros === 'function') {
        parser.setTimeoutMicros(parseTimeoutMs ? parseTimeoutMs * 1000 : 0);
      }
      tree = parser.parse(text);
    } catch (err) {
      const message = err?.message || String(err);
      if (/timeout/i.test(message)) {
        logLuaTreeSitterOnce(
          options,
          'lua:parse-timeout',
          'Tree-sitter parse timed out for lua; falling back to heuristic chunking.'
        );
      }
      return null;
    }

    const rootNode = tree?.rootNode || null;
    const nodes = gatherLuaTreeSitterNodes(rootNode);
    if (!Array.isArray(nodes) || !nodes.length) return null;

    const lineIndex = buildLineIndex(text);
    const lines = text.split('\n');
    const chunks = [];
    for (const node of nodes) {
      const start = Number(node?.startIndex);
      const end = Number(node?.endIndex);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const name = extractLuaTreeSitterName(node, text);
      if (!name) continue;
      const kind = name.includes('.') ? 'MethodDeclaration' : 'FunctionDeclaration';
      const signature = (text.slice(start, Math.min(end, start + 240)).split('\n', 1)[0] || '').trim();
      const startLine = offsetToLine(lineIndex, start);
      const docstring = extractDocComment(lines, Math.max(0, startLine - 1), LUA_DOC_OPTIONS);
      chunks.push({
        start,
        end,
        name,
        kind,
        meta: {
          startLine,
          endLine: offsetToLine(lineIndex, Math.max(start, end - 1)),
          signature,
          params: parseLuaParams(signature),
          docstring
        }
      });
    }
    if (!chunks.length) return null;
    chunks.sort((a, b) => a.start - b.start);
    return chunks;
  } finally {
    try {
      if (tree && typeof tree.delete === 'function') tree.delete();
    } catch {}
    try {
      if (parser && typeof parser.reset === 'function') parser.reset();
    } catch {}
  }
};

/**
 * Collect require imports from Lua source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectLuaImports(text) {
  if (!text || !text.includes('require')) return [];
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
 * @param {object} [options]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildLuaChunks(text, options = {}) {
  const treeSitterChunks = buildLuaTreeSitterChunks(text, options);
  if (Array.isArray(treeSitterChunks) && treeSitterChunks.length) {
    return treeSitterChunks;
  }
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
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} luaChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildLuaRelations(text, luaChunks) {
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
  return {
    imports,
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages)
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
