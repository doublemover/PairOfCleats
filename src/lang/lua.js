import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import {
  buildDefaultDocMeta,
  collectDottedCallsAndUsages,
  extractDocComment,
  normalizeDeclarationList
} from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { getNamedChild, getNamedChildCount } from './tree-sitter/ast.js';
import { getNativeTreeSitterParser } from './tree-sitter/native-runtime.js';
import { isTreeSitterEnabled } from './tree-sitter/options.js';
import { attachSyntaxCallFacts, syntaxRelationsForChunks } from './tree-sitter/call-facts.js';

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
  'local_function',
  'assignment_statement',
  'function_definition'
]);

const LUA_TREE_SITTER_LOGGED = new Set();

function stripLuaComments(text) {
  return text.replace(/--\[\[[\s\S]*?\]\]/g, ' ').replace(/--.*$/gm, ' ');
}

const LUA_CALL_PATTERN = /\b([A-Za-z_][A-Za-z0-9_.:]*)\s*\(/g;

const maskLuaNonCode = text => {
  const pieces = []; let index = 0;
  const longOpening = /\[(=*)\[/y;
  const blank = value => value.replace(/[^\r\n]/g, ' ');
  while (index < text.length) {
    const start = index, comment = text.startsWith('--', index);
    const bracketStart = index + (comment ? 2 : 0);
    longOpening.lastIndex = bracketStart;
    const long = text[bracketStart] === '[' ? longOpening.exec(text) : null;
    if (long) {
      const close = ']' + long[1] + ']';
      const stop = text.indexOf(close, bracketStart + long[0].length);
      index = stop < 0 ? text.length : stop + close.length;
    } else if (comment) {
      while (index < text.length && !/[\r\n]/u.test(text[index])) index++;
    } else if (text[index] === '"' || text[index] === "'") {
      const quote = text[index++];
      while (index < text.length) {
        if (text[index] === '\\') { index = Math.min(text.length, index + 2); continue; }
        if (text[index++] === quote) break;
      }
    } else { pieces.push(text[index++]); continue; }
    pieces.push(blank(text.slice(start, index)));
  }
  return pieces.join('');
};

const buildLuaLexicalChunks = text => {
  const code = maskLuaNonCode(text), lineIndex = buildLineIndex(text), lines = text.split('\n');
  const tokens = [...code.matchAll(/[A-Za-z_][A-Za-z0-9_]*|[^\s]/gu)]
    .map(match => ({ value: match[0], start: match.index, end: match.index + match[0].length }));
  const stack = [], chunks = [], callableRanges = []; let unowned = 0;
  const finish = token => {
    const block = stack.pop();
    if (block?.type !== 'function') return;
    callableRanges.push({ start: block.start, end: token.end });
    if (!block.name) { unowned++; return; }
    chunks.push({ start: block.start, end: token.end, name: block.name,
      kind: block.name.includes('.') ? 'MethodDeclaration' : 'FunctionDeclaration',
      meta: { startLine: offsetToLine(lineIndex, block.start), endLine: offsetToLine(lineIndex, token.end-1),
        signature: text.slice(block.start, block.bodyStart).replace(/\s+/gu, ' ').trim(),
        params: parseLuaParams(text.slice(block.start, block.bodyStart)),
        docstring: extractDocComment(lines, offsetToLine(lineIndex, block.start)-1, LUA_DOC_OPTIONS),
        definitionStart: block.definitionStart, definitionEnd: token.end,
        bodyStart: block.bodyStart, bodyEnd: token.start, headerRangeSource: 'lua-lexical-parameter-boundary' } });
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], word = token.value;
    if (word === 'function') {
      let open = index+1;
      while (open < tokens.length && tokens[open].value !== '(' && /^[A-Za-z_][A-Za-z0-9_]*$|^[.:]$/u.test(tokens[open].value)) open++;
      const named = code.slice(token.end, tokens[open]?.start).trim();
      const lineStart = Math.max(code.lastIndexOf('\n',token.start),code.lastIndexOf(';',token.start))+1;
      const assignment = !named ? code.slice(lineStart, token.start).match(/(?:\blocal\s+)?([A-Za-z_][A-Za-z0-9_.:]*)\s*=\s*$/u) : null;
      let name = named && /^[A-Za-z_][A-Za-z0-9_.:]*$/u.test(named) ? named : assignment?.[1];
      let start = token.start;
      if (named && tokens[index-1]?.value === 'local') start = tokens[index-1].start;
      else if (!named && assignment) {
        start = token.start-assignment[0].length;
        // Multiple-assignment identity is ambiguous, even when its last name is simple.
        if (code.slice(0,start).trimEnd().endsWith(',')) name = null;
      }
      let close = open+1;
      while (close < tokens.length && tokens[close].value !== ')') close++;
      if (tokens[open]?.value !== '(' || !tokens[close]) { unowned++; break; }
      stack.push({ type: 'function', start, definitionStart: token.start,
        name: normalizeLuaName(name), bodyStart: tokens[close].end });
      index = close;
    } else if (word === 'if' || word === 'repeat') stack.push({ type: word });
    else if (word === 'for' || word === 'while') stack.push({ type: word, awaitingDo: true });
    else if (word === 'do') {
      if (stack.at(-1)?.awaitingDo) stack.at(-1).awaitingDo = false;
      else stack.push({ type: 'do' });
    } else if (word === 'end' || word === 'until') finish(token);
  }
  for (const chunk of chunks) {
    chunk.meta.lexicalExcludedCallableRanges = callableRanges.filter(range => range.start >= chunk.meta.bodyStart && range.end <= chunk.meta.bodyEnd);
    chunk.meta.luaDeclarationCoverage = { state: 'partial', reason: 'lexical-supported-declaration-roles', unownedFunctions: unowned,
      incompleteBlocks: stack.length };
  }
  return normalizeDeclarationList(chunks);
};

function collectLuaCallsAndUsages(text) {
  return collectDottedCallsAndUsages(text, {
    callKeywords: LUA_CALL_KEYWORDS,
    usageSkip: LUA_USAGE_SKIP,
    stripComments: stripLuaComments,
    callPattern: LUA_CALL_PATTERN,
    segmentSeparators: '.:'
  });
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
  if (node.type === 'function_definition') return null;
  if (node.type === 'assignment_statement') {
    const children = Array.from({length:getNamedChildCount(node)},(_,i)=>getNamedChild(node,i));
    const variables = children.find(child=>child.type === 'variable_list');
    const values = children.find(child=>child.type === 'expression_list');
    if (!variables || !values || getNamedChildCount(variables) !== 1 || getNamedChildCount(values) !== 1
      || getNamedChild(values,0)?.type !== 'function_definition') return null;
    const name = text.slice(variables.startIndex,variables.endIndex).trim();
    return /^[A-Za-z_][A-Za-z0-9_.:]*$/.test(name) ? normalizeLuaName(name) : null;
  }
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
    const declarations = new Map();
    for (const node of nodes) {
      const rangeOwner = node.type === 'assignment_statement' && node.parent?.type === 'variable_declaration' ? node.parent : node;
      const start = Number(rangeOwner?.startIndex);
      const end = Number(node?.endIndex);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const name = extractLuaTreeSitterName(node, text);
      if (!name) continue;
      const kind = name.includes('.') ? 'MethodDeclaration' : 'FunctionDeclaration';
      let callable = node;
      if (node.type === 'assignment_statement') {
        const values = Array.from({length:getNamedChildCount(node)},(_,i)=>getNamedChild(node,i)).find(child=>child.type === 'expression_list');
        callable = getNamedChild(values,0);
      }
      const parameters = callable.childForFieldName?.('parameters');
      const signatureEnd = parameters?.endIndex ?? Math.min(end,start+240);
      const signature = text.slice(start,Math.min(signatureEnd,start+2000)).replace(/\s+/gu,' ').trim();
      const body = callable.childForFieldName?.('body');
      const startLine = offsetToLine(lineIndex, start);
      const docstring = extractDocComment(lines, Math.max(0, startLine - 1), LUA_DOC_OPTIONS);
      const chunk = {
        start,
        end,
        name,
        kind,
        meta: {
          startLine,
          endLine: offsetToLine(lineIndex, Math.max(start, end - 1)),
          signature,
          params: parseLuaParams(signature),
          docstring,
          definitionStart:callable.startIndex,definitionEnd:callable.endIndex,
          ...(body ? {bodyStart:body.startIndex,bodyEnd:body.endIndex} : {})
        }
      };
      chunks.push(chunk);
      declarations.set(`${callable.startIndex}:${callable.endIndex}`,chunk);
    }
    if (!chunks.length) return null;
    const unownedFunctions = nodes.filter(node => node.type === 'function_definition'
      && !declarations.has(`${node.startIndex}:${node.endIndex}`)).length;
    for (const chunk of chunks) chunk.meta.luaDeclarationCoverage = {
      state:unownedFunctions ? 'partial' : 'complete-supported-declaration-roles',
      reason:unownedFunctions ? 'anonymous-or-ambiguous-function-owner' : null,unownedFunctions
    };
    attachSyntaxCallFacts(rootNode,text,chunks,{maxNodes:200000,declarations});
    return normalizeDeclarationList(chunks);
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
  if (Array.isArray(treeSitterChunks) && treeSitterChunks.length) return treeSitterChunks;
  return buildLuaLexicalChunks(text);
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
  if (Array.isArray(luaChunks) && luaChunks.every(chunk=>Array.isArray(chunk.meta?.syntaxCalls))) {
    return {imports,exports:[],...syntaxRelationsForChunks(luaChunks)};
  }
  if (Array.isArray(luaChunks)) {
    for (const chunk of luaChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (!['MethodDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const bodyStart = chunk.meta?.bodyStart;
      if (!Number.isSafeInteger(bodyStart) || bodyStart < chunk.start || bodyStart > chunk.end) continue;
      let slice = maskLuaNonCode(text.slice(bodyStart, chunk.meta.bodyEnd ?? chunk.end));
      // Nested callable ranges retain their original owner, even when anonymous.
      for (const range of [...(chunk.meta.lexicalExcludedCallableRanges || [])].sort((a,b) => b.start-a.start)) {
        const offset = range.start-bodyStart, length = range.end-range.start;
        slice = slice.slice(0,offset) + ' '.repeat(length) + slice.slice(offset+length);
      }
      const { calls: chunkCalls, usages: chunkUsages } = collectLuaCallsAndUsages(slice);
      for (const callee of chunkCalls) calls.push([chunk.name, callee]);
      for (const usage of chunkUsages) usages.add(usage);
    }
  }
  return {
    imports,
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages),
    callCoverage: 'partial',
    callCoverageReasons: ['lua-lexical-supported-declaration-roles']
  };
}

/**
 * Normalize Lua-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractLuaDocMeta(chunk) {
  return buildDefaultDocMeta(chunk);
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
