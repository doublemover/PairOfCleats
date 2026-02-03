import { parseBabelAst } from '../babel-parser.js';
import { collectImportsFromAst } from '../javascript.js';
import { findCLikeBodyBounds } from '../clike.js';
import { TS_CALL_KEYWORDS, TS_USAGE_SKIP } from './constants.js';
import { resolveTypeScriptParser, stripTypeScriptComments } from './parser.js';

const MAX_CALL_ARGS = 5;
const MAX_CALL_ARG_LEN = 80;
const MAX_CALL_ARG_DEPTH = 2;

const normalizeCallText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
};

const truncateCallText = (value, maxLen = MAX_CALL_ARG_LEN) => {
  const normalized = normalizeCallText(value);
  if (!normalized) return '';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
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

const resolveCalleeParts = (calleeName) => {
  if (!calleeName) return { calleeRaw: null, calleeNormalized: null, receiver: null };
  const raw = String(calleeName);
  const parts = raw.split('.').filter(Boolean);
  if (!parts.length) return { calleeRaw: raw, calleeNormalized: raw, receiver: null };
  if (parts.length === 1) {
    return { calleeRaw: raw, calleeNormalized: parts[0], receiver: null };
  }
  return {
    calleeRaw: raw,
    calleeNormalized: parts[parts.length - 1],
    receiver: parts.slice(0, -1).join('.')
  };
};

const resolveCallLocation = (node) => {
  if (!node || typeof node !== 'object') return null;
  const start = Number.isFinite(node.start)
    ? node.start
    : (Array.isArray(node.range) ? node.range[0] : null);
  const end = Number.isFinite(node.end)
    ? node.end
    : (Array.isArray(node.range) ? node.range[1] : null);
  const loc = node.loc || null;
  const startLine = Number.isFinite(loc?.start?.line) ? loc.start.line : null;
  const startCol = Number.isFinite(loc?.start?.column) ? loc.start.column + 1 : null;
  const endLine = Number.isFinite(loc?.end?.line) ? loc.end.line : null;
  const endCol = Number.isFinite(loc?.end?.column) ? loc.end.column + 1 : null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    start,
    end,
    startLine,
    startCol,
    endLine,
    endCol
  };
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
    : [];

  const resolveCallerName = (start, end) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || !chunkRanges.length) return '(module)';
    let best = null;
    for (const chunk of chunkRanges) {
      if (start < chunk.start || end > chunk.end) continue;
      if (!best || chunk.span < best.span) {
        best = chunk;
      }
    }
    return best?.name || '(module)';
  };

  const recordCall = (node) => {
    const calleeName = getCalleeName(node.callee);
    if (!calleeName) return;
    const base = calleeName.split('.').filter(Boolean).pop();
    if (!base || TS_CALL_KEYWORDS.has(base)) return;
    const location = resolveCallLocation(node);
    const callerName = location ? resolveCallerName(location.start, location.end) : '(module)';
    const args = Array.isArray(node.arguments)
      ? node.arguments.map((arg) => truncateCallText(formatCallArg(arg))).filter(Boolean).slice(0, MAX_CALL_ARGS)
      : [];
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
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        const key = keys[i];
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

  const { usages: regexUsages } = collectTypeScriptCallsAndUsages(text);
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
