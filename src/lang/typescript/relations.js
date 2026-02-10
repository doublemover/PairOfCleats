import { parseBabelAst } from '../babel-parser.js';
import { collectImportsFromAst } from '../javascript.js';
import { findCLikeBodyBounds } from '../clike.js';
import { resolveCalleeParts, resolveCallLocation, truncateCallText } from '../js-ts/relations-shared.js';
import { TS_CALL_KEYWORDS, TS_USAGE_SKIP } from './constants.js';
import { resolveTypeScriptParser, stripTypeScriptComments } from './parser.js';

const MAX_CALL_ARGS = 5;
const MAX_CALL_ARG_LEN = 80;
const MAX_CALL_ARG_DEPTH = 2;
const WALK_SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'tokens',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
  'parent'
]);
const OWN_HAS = Object.prototype.hasOwnProperty;

const getLastDottedSegment = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  let end = raw.length;
  while (end > 0 && raw[end - 1] === '.') end -= 1;
  if (!end) return '';
  const idx = raw.lastIndexOf('.', end - 1);
  return raw.slice(idx + 1, end);
};

const getMemberName = (node) => {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'PrivateName' && node.id?.name) return `#${node.id.name}`;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'Super') return 'super';
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const obj = getMemberName(node.object);
    const prop = node.computed
      ? (node.property?.type === 'StringLiteral' || node.property?.type === 'Literal'
        ? String(node.property.value)
        : null)
      : (node.property?.name || node.property?.id?.name || null);
    if (obj && prop) return `${obj}.${prop}`;
    return obj || prop;
  }
  if (node.type === 'TSQualifiedName') {
    const left = getMemberName(node.left);
    const right = getMemberName(node.right);
    if (left && right) return `${left}.${right}`;
    return left || right;
  }
  return null;
};

const getCalleeName = (callee) => {
  if (!callee) return null;
  if (callee.type === 'ChainExpression') return getCalleeName(callee.expression);
  if (callee.type === 'OptionalCallExpression') return getCalleeName(callee.callee);
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    return getMemberName(callee);
  }
  if (callee.type === 'Super') return 'super';
  return null;
};

const formatCallArg = (arg, depth = 0) => {
  if (!arg || depth > MAX_CALL_ARG_DEPTH) return '...';
  if (arg.type === 'Identifier') return arg.name;
  if (arg.type === 'Literal') return JSON.stringify(arg.value);
  if (arg.type === 'StringLiteral' || arg.type === 'NumericLiteral' || arg.type === 'BooleanLiteral') {
    return JSON.stringify(arg.value);
  }
  if (arg.type === 'MemberExpression' || arg.type === 'OptionalMemberExpression') {
    return getMemberName(arg) || 'member';
  }
  if (arg.type === 'CallExpression' || arg.type === 'OptionalCallExpression') {
    const callee = getCalleeName(arg.callee);
    return callee ? `${callee}(...)` : 'call(...)';
  }
  if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') return 'fn(...)';
  if (arg.type === 'ObjectExpression') return '{...}';
  if (arg.type === 'ArrayExpression') return '[...]';
  if (arg.type === 'TemplateLiteral') return '`...`';
  if (arg.type === 'SpreadElement') {
    const inner = formatCallArg(arg.argument, depth + 1);
    return inner ? `...${inner}` : '...';
  }
  return '...';
};

function collectTypeScriptImportsFromNormalized(normalized) {
  const imports = new Set();
  const capture = (regex) => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      if (match[1]) imports.add(match[1]);
      if (!match[0]) regex.lastIndex += 1;
    }
  };
  capture(/\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g);
  capture(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  capture(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  return Array.from(imports);
}

/**
 * Collect import paths from TypeScript source text.
 * @param {string} text
 * @returns {string[]}
 */
export function collectTypeScriptImports(text, options = {}) {
  if (!text || (!text.includes('import') && !text.includes('export') && !text.includes('require'))) {
    return [];
  }
  const importsOnly = options?.importsOnly === true || options?.typescript?.importsOnly === true;
  const parser = resolveTypeScriptParser(options);
  if (!importsOnly && (parser === 'babel' || parser === 'auto')) {
    const ast = parseBabelAst(text, { ext: options.ext || '', mode: 'typescript' });
    if (ast) return collectImportsFromAst(ast);
  }
  const normalized = typeof options?.normalizedText === 'string'
    ? options.normalizedText
    : stripTypeScriptComments(text);
  return collectTypeScriptImportsFromNormalized(normalized);
}

function collectTypeScriptExports(text) {
  if (!text || !text.includes('export ')) return [];
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
      for (const part of match[1].split(',')) {
        const name = part.trim();
        if (!name) continue;
        const clean = name.split(/\s+as\s+/i)[0].trim();
        if (clean) exports.add(clean);
      }
    }
  }
  return Array.from(exports);
}

function collectTypeScriptCallsAndUsages(text, normalizedText = null) {
  const calls = new Set();
  const usages = new Set();
  const normalized = typeof normalizedText === 'string'
    ? normalizedText
    : stripTypeScriptComments(text);
  const callRe = /\b([A-Za-z_$][A-Za-z0-9_$.]*)\s*\(/g;
  let match;
  while ((match = callRe.exec(normalized)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const base = getLastDottedSegment(raw);
    if (!base || TS_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
    if (!match[0]) callRe.lastIndex += 1;
  }
  const usageRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  while ((match = usageRe.exec(normalized)) !== null) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (TS_USAGE_SKIP.has(name)) continue;
    usages.add(name);
    if (!match[0]) usageRe.lastIndex += 1;
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
  const normalizedText = stripTypeScriptComments(text);
  const imports = collectTypeScriptImports(text, { ...options, normalizedText });
  const exports = new Set(collectTypeScriptExports(text));
  const calls = [];
  const callDetails = [];
  const usages = new Set();

  const ast = parseBabelAst(text, { ext: options.ext || '', mode: 'typescript' });
  const chunkRanges = Array.isArray(tsChunks)
    ? tsChunks
      .filter((chunk) => chunk && chunk.name && Number.isFinite(chunk.start) && Number.isFinite(chunk.end))
      .map((chunk) => ({
        name: chunk.name,
        start: chunk.start,
        end: chunk.end,
        span: Math.max(0, chunk.end - chunk.start)
      }))
      .sort((a, b) => (a.start - b.start) || (a.end - b.end))
    : [];

  const findLastChunkStartIndex = (value) => {
    let lo = 0;
    let hi = chunkRanges.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chunkRanges[mid].start <= value) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  };

  const resolveCallerName = (start, end) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || !chunkRanges.length) return '(module)';
    const startIdx = findLastChunkStartIndex(start);
    if (startIdx < 0) return '(module)';
    let best = null;
    for (let i = startIdx; i >= 0; i -= 1) {
      const chunk = chunkRanges[i];
      if (best && (start - chunk.start) >= best.span) break;
      if (end > chunk.end) continue;
      if (!best || chunk.span < best.span) {
        best = chunk;
      }
    }
    return best?.name || '(module)';
  };

  const recordCall = (node) => {
    const calleeName = getCalleeName(node.callee);
    if (!calleeName) return;
    const base = getLastDottedSegment(calleeName);
    if (!base || TS_CALL_KEYWORDS.has(base)) return;
    const location = resolveCallLocation(node);
    const callerName = location ? resolveCallerName(location.start, location.end) : '(module)';
    const args = [];
    if (Array.isArray(node.arguments)) {
      for (let i = 0; i < node.arguments.length && args.length < MAX_CALL_ARGS; i += 1) {
        const value = truncateCallText(formatCallArg(node.arguments[i]), MAX_CALL_ARG_LEN);
        if (value) args.push(value);
      }
    }
    const calleeParts = resolveCalleeParts(calleeName);
    const detail = {
      caller: callerName,
      callee: calleeName,
      calleeRaw: calleeParts.calleeRaw || calleeName,
      calleeNormalized: calleeParts.calleeNormalized || calleeName,
      receiver: calleeParts.receiver || null,
      args
    };
    if (location) {
      detail.start = location.start;
      detail.end = location.end;
      detail.startLine = location.startLine;
      detail.startCol = location.startCol;
      detail.endLine = location.endLine;
      detail.endCol = location.endCol;
    }
    callDetails.push(detail);
    calls.push([callerName, calleeName]);
  };

  const walk = (root) => {
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (seen.has(node)) continue;
      seen.add(node);
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i -= 1) {
          stack.push(node[i]);
        }
        continue;
      }
      if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
        recordCall(node);
      }
      if (node.type === 'Identifier' && !TS_USAGE_SKIP.has(node.name)) {
        usages.add(node.name);
      }
      for (const key in node) {
        if (!OWN_HAS.call(node, key)) continue;
        if (WALK_SKIP_KEYS.has(key)) continue;
        const value = node[key];
        if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }
  };

  if (ast) {
    walk(ast);
  }

  const { usages: regexUsages } = collectTypeScriptCallsAndUsages(text, normalizedText);
  for (const usage of regexUsages) usages.add(usage);

  if (!callDetails.length && Array.isArray(tsChunks)) {
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
    callDetails,
    usages: Array.from(usages)
  };
}
