import { createRequire } from 'node:module';
import path from 'node:path';
import { parseBabelAst } from './babel-parser.js';
import { collectImportsFromAst } from './javascript.js';
import { buildTreeSitterChunks } from './tree-sitter.js';
import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { collectAttributes, extractDocComment, sliceSignature } from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';

/**
 * TypeScript language chunking and relations.
 * Heuristic parser for classes, interfaces, enums, types, and functions.
 */
const TS_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'declare',
  'async', 'export', 'default', 'override'
]);

const TS_CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'case', 'return', 'new', 'throw', 'catch',
  'try', 'else', 'do', 'typeof', 'instanceof', 'await', 'yield'
]);

const TS_USAGE_SKIP = new Set([
  ...TS_CALL_KEYWORDS,
  'class', 'interface', 'enum', 'type', 'namespace', 'module', 'void',
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'null', 'undefined',
  'true', 'false', 'object', 'symbol', 'bigint'
]);

const TSX_CLOSE_TAG = /<\/[A-Za-z]/;
const TSX_SELF_CLOSING = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*\/>/;
const TSX_FRAGMENT_OPEN = /<>/;
const TSX_FRAGMENT_CLOSE = /<\/>/;
const nodeRequire = createRequire(import.meta.url);
const typeScriptCache = new Map();
const TS_PARSERS = new Set(['auto', 'typescript', 'babel', 'heuristic']);

function resolveTypeScriptParser(options = {}) {
  const raw = options.parser || options.typescript?.parser || options.typescriptParser;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return TS_PARSERS.has(normalized) ? normalized : 'auto';
}

function loadTypeScriptModule(rootDir) {
  const key = rootDir || '__default__';
  if (typeScriptCache.has(key)) return typeScriptCache.get(key);
  let resolved = null;
  if (rootDir) {
    try {
      const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));
      const mod = requireFromRoot('typescript');
      resolved = mod?.default || mod;
    } catch {
      resolved = null;
    }
  }
  if (!resolved) {
    try {
      const mod = nodeRequire('typescript');
      resolved = mod?.default || mod;
    } catch {
      resolved = null;
    }
  }
  typeScriptCache.set(key, resolved);
  return resolved;
}

function isLikelyTsx(text, ext) {
  const normalized = ext ? ext.toLowerCase() : '';
  if (normalized === '.tsx') return true;
  if (normalized && normalized !== '.tsx') return false;
  if (TSX_CLOSE_TAG.test(text)) return true;
  if (TSX_SELF_CLOSING.test(text)) return true;
  return TSX_FRAGMENT_OPEN.test(text) || TSX_FRAGMENT_CLOSE.test(text);
}

function resolveTypeScriptFilename(ext, isTsx) {
  if (ext) return `module${ext}`;
  return isTsx ? 'module.tsx' : 'module.ts';
}

function getTypeScriptName(ts, node, sourceFile) {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPrivateIdentifier(node)) return `#${node.text}`;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (typeof node.getText === 'function') {
    const raw = node.getText(sourceFile);
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw)) return raw;
  }
  return null;
}

function extractTypeScriptHeritage(ts, node, sourceFile) {
  const extendsList = [];
  const implementsList = [];
  for (const clause of node?.heritageClauses || []) {
    const list = clause?.types?.map((entry) => entry.getText(sourceFile).trim()).filter(Boolean) || [];
    if (!list.length) continue;
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      extendsList.push(...list);
    } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
      implementsList.push(...list);
    }
  }
  return { extendsList, implementsList };
}

function mergeParamTypes(base, extra) {
  const out = { ...(base || {}) };
  for (const [name, value] of Object.entries(extra || {})) {
    if (!name || !value) continue;
    if (!out[name]) {
      out[name] = value;
      continue;
    }
    if (out[name] === value) continue;
    out[name] = Array.from(new Set([out[name], value])).join(' | ');
  }
  return out;
}

function collectParamDetails(ts, node, sourceFile, signature) {
  const params = [];
  const paramTypes = {};
  for (const param of node?.parameters || []) {
    if (!param?.name || !ts.isIdentifier(param.name)) continue;
    const name = param.name.text;
    if (!name) continue;
    params.push(name);
    const typeText = param.type ? param.type.getText(sourceFile).trim() : '';
    if (typeText) paramTypes[name] = typeText;
  }
  const fallbackParams = extractTypeScriptParams(signature);
  const fallbackTypes = extractTypeScriptParamTypes(signature);
  for (const name of fallbackParams) {
    if (!params.includes(name)) params.push(name);
  }
  return {
    params: params.length ? params : fallbackParams,
    paramTypes: mergeParamTypes(paramTypes, fallbackTypes)
  };
}

function extractTypeScriptModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (TS_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractTypeScriptParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=.+$/g, '').trim();
    seg = seg.replace(/:[^,]+/g, '').trim();
    seg = seg.replace(/\b(public|private|protected|readonly|override)\b/g, '').trim();
    seg = seg.replace(/\?/g, '').trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let name = tokens[tokens.length - 1];
    name = name.replace(/[^A-Za-z0-9_$]/g, '');
    if (!name || !/^[A-Za-z_$]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

function extractTypeScriptParamTypes(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return {};
  const paramTypes = {};
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=.+$/g, '').trim();
    seg = seg.replace(/\b(public|private|protected|readonly|override)\b/g, '').trim();
    seg = seg.replace(/^\.\.\./, '').trim();
    const [rawName, ...rest] = seg.split(':');
    if (!rawName || !rest.length) continue;
    const name = rawName.replace(/\?/g, '').replace(/[^A-Za-z0-9_$]/g, '').trim();
    const type = rest.join(':').trim();
    if (!name || !type) continue;
    paramTypes[name] = type;
  }
  return paramTypes;
}

function extractTypeScriptReturns(signature) {
  const idx = signature.indexOf(')');
  if (idx === -1) return null;
  const after = signature.slice(idx + 1);
  const match = after.match(/:\s*([^=;{]+)/);
  if (!match) return null;
  const ret = match[1].trim();
  return ret || null;
}

function parseTypeScriptSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = extractTypeScriptReturns(signature);
  return { name, returns };
}

function readSignatureLines(lines, startLine) {
  const parts = [];
  let hasBrace = false;
  let hasSemi = false;
  let endLine = startLine;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    parts.push(line.trim());
    if (line.includes('{')) {
      hasBrace = true;
      endLine = i;
      break;
    }
    if (line.includes(';')) {
      hasSemi = true;
      endLine = i;
      break;
    }
    endLine = i;
  }
  const signature = parts.join(' ');
  const braceIdx = signature.indexOf('{');
  const semiIdx = signature.indexOf(';');
  const hasBody = hasBrace && (semiIdx === -1 || (braceIdx !== -1 && braceIdx < semiIdx));
  return { signature, endLine, hasBody };
}

function stripTypeScriptComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
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

function extractTypeScriptInheritance(signature) {
  const extendsList = [];
  const implementsList = [];
  const extendsMatch = signature.match(/\bextends\s+([^\{]+)/);
  if (extendsMatch) {
    const raw = extendsMatch[1].split(/\bimplements\b/)[0];
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => extendsList.push(s));
  }
  const implMatch = signature.match(/\bimplements\s+([^\{]+)/);
  if (implMatch) {
    implMatch[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => implementsList.push(s));
  }
  return { extendsList, implementsList };
}

function extractVisibility(modifiers) {
  if (modifiers.includes('private')) return 'private';
  if (modifiers.includes('protected')) return 'protected';
  return 'public';
}

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

function getBabelName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value);
  if (node.type === 'PrivateName' && node.id?.name) return `#${node.id.name}`;
  if (node.type === 'TSQualifiedName') {
    const left = getBabelName(node.left);
    const right = getBabelName(node.right);
    if (left && right) return `${left}.${right}`;
  }
  return null;
}

function buildTypeScriptChunksFromBabel(text, options = {}) {
  const ast = parseBabelAst(text, { ext: options.ext || '', mode: 'typescript' });
  if (!ast || !Array.isArray(ast.body)) return null;
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];

  const qualify = (prefix, name) => (prefix ? `${prefix}.${name}` : name);
  const buildSignature = (start, bodyStart) => sliceSignature(text, start, bodyStart);
  const buildMetaBase = (start, end, signature) => {
    const startLine = offsetToLine(lineIndex, start);
    const endLine = offsetToLine(lineIndex, end);
    const modifiers = extractTypeScriptModifiers(signature);
    return {
      startLine,
      endLine,
      signature,
      modifiers,
      visibility: extractVisibility(modifiers),
      docstring: extractDocComment(lines, startLine - 1),
      attributes: collectAttributes(lines, startLine - 1, signature)
    };
  };
  const buildFunctionMeta = (start, end, signature) => ({
    ...buildMetaBase(start, end, signature),
    params: extractTypeScriptParams(signature),
    paramTypes: extractTypeScriptParamTypes(signature),
    returns: extractTypeScriptReturns(signature)
  });
  const buildTypeMeta = (start, end, signature) => {
    const base = buildMetaBase(start, end, signature);
    const { extendsList, implementsList } = extractTypeScriptInheritance(signature);
    return { ...base, extends: extendsList, implements: implementsList };
  };
  const addChunk = (node, name, kind, meta) => {
    if (!node || !name) return;
    const start = Number.isFinite(node.start) ? node.start : 0;
    const end = Number.isFinite(node.end) ? node.end : start;
    decls.push({ start, end, name, kind, meta });
  };

  const handleClassMembers = (prefix, className, members) => {
    const qualified = qualify(prefix, className);
    for (const member of members || []) {
      if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
        const methodName = getBabelName(member.key) || 'anonymous';
        const signature = buildSignature(member.start, member.body?.start ?? -1);
        addChunk(member, `${qualified}.${methodName}`, 'MethodDeclaration',
          buildFunctionMeta(member.start, member.end, signature));
      }
      if ((member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty')
        && member.value && (member.value.type === 'ArrowFunctionExpression'
          || member.value.type === 'FunctionExpression')) {
        const propName = getBabelName(member.key) || 'anonymous';
        const bodyStart = member.value.body?.start ?? -1;
        const signature = buildSignature(member.start, bodyStart);
        addChunk(member, `${qualified}.${propName}`, 'MethodDeclaration',
          buildFunctionMeta(member.start, member.end, signature));
      }
    }
  };

  const handleStatement = (stmt, prefix = '') => {
    if (!stmt) return;
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      if (stmt.declaration) {
        handleStatement(stmt.declaration, prefix);
      }
      return;
    }
    if (stmt.type === 'ClassDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'ClassDeclaration',
        buildTypeMeta(start, stmt.end ?? start, signature));
      handleClassMembers(prefix, stmt.id.name, stmt.body?.body || []);
      return;
    }
    if (stmt.type === 'TSInterfaceDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'InterfaceDeclaration',
        buildTypeMeta(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'TSEnumDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.members?.[0]?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'EnumDeclaration',
        buildMetaBase(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'TSTypeAliasDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'TypeAliasDeclaration',
        buildMetaBase(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'TSModuleDeclaration' && stmt.id) {
      const name = getBabelName(stmt.id);
      if (!name) return;
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, name), 'NamespaceDeclaration',
        buildMetaBase(start, stmt.end ?? start, signature));
      const moduleBody = stmt.body?.body;
      if (Array.isArray(moduleBody)) {
        moduleBody.forEach((child) => handleStatement(child, qualify(prefix, name)));
      } else if (stmt.body) {
        handleStatement(stmt.body, qualify(prefix, name));
      }
      return;
    }
    if (stmt.type === 'TSDeclareFunction' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'FunctionDeclaration',
        buildFunctionMeta(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'FunctionDeclaration',
        buildFunctionMeta(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations || []) {
        if (decl.id?.name && decl.init
          && (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')) {
          const start = decl.start ?? stmt.start ?? 0;
          const signature = buildSignature(start, decl.init.body?.start ?? -1);
          addChunk(decl, qualify(prefix, decl.id.name), 'FunctionDeclaration',
            buildFunctionMeta(start, decl.end ?? start, signature));
        }
      }
    }
  };

  ast.body.forEach((stmt) => handleStatement(stmt, ''));
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

function buildTypeScriptChunksFromAst(text, options = {}) {
  const ts = loadTypeScriptModule(options.rootDir);
  if (!ts) return null;
  const ext = options.ext || '';
  const tsx = isLikelyTsx(text, ext);
  const fileName = resolveTypeScriptFilename(ext, tsx);
  let sourceFile;
  try {
    sourceFile = ts.createSourceFile(
      fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
  } catch {
    return null;
  }
  if (!sourceFile) return null;

  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const qualify = (prefix, name) => (prefix ? `${prefix}.${name}` : name);

  const buildSignature = (start, bodyStart) => sliceSignature(text, start, bodyStart);

  const buildMetaBase = (start, end, signature) => {
    const startLine = offsetToLine(lineIndex, start);
    const endLine = offsetToLine(lineIndex, end);
    const modifiers = extractTypeScriptModifiers(signature);
    return {
      startLine,
      endLine,
      signature,
      modifiers,
      visibility: extractVisibility(modifiers),
      docstring: extractDocComment(lines, startLine - 1),
      attributes: collectAttributes(lines, startLine - 1, signature)
    };
  };

  const buildFunctionMeta = (node, signature, start, end) => {
    const base = buildMetaBase(start, end, signature);
    const { params, paramTypes } = collectParamDetails(ts, node, sourceFile, signature);
    const returns = ts.isConstructorDeclaration(node)
      ? null
      : (node?.type ? node.type.getText(sourceFile).trim() : extractTypeScriptReturns(signature));
    return { ...base, params, paramTypes, returns };
  };

  const buildTypeMeta = (node, signature, start, end) => {
    const base = buildMetaBase(start, end, signature);
    const { extendsList, implementsList } = extractTypeScriptHeritage(ts, node, sourceFile);
    return { ...base, extends: extendsList, implements: implementsList };
  };

  const addChunk = (start, end, name, kind, meta) => {
    if (!name) return;
    decls.push({ start, end, name, kind, meta });
  };

  const isFunctionInitializer = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);

  const handleClassMembers = (prefix, className, members) => {
    const qualified = qualify(prefix, className);
    for (const member of members || []) {
      if (ts.isConstructorDeclaration(member)) {
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.body ? member.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.constructor`, 'ConstructorDeclaration',
          buildFunctionMeta(member, signature, start, end));
        continue;
      }
      if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
        const methodName = getTypeScriptName(ts, member.name, sourceFile);
        if (!methodName) continue;
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.body ? member.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.${methodName}`, 'MethodDeclaration',
          buildFunctionMeta(member, signature, start, end));
        continue;
      }
      if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        const accessorName = getTypeScriptName(ts, member.name, sourceFile);
        if (!accessorName) continue;
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.body ? member.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.${accessorName}`, 'MethodDeclaration',
          buildFunctionMeta(member, signature, start, end));
        continue;
      }
      if (ts.isPropertyDeclaration(member) && member.name && member.initializer && isFunctionInitializer(member.initializer)) {
        const propName = getTypeScriptName(ts, member.name, sourceFile);
        if (!propName) continue;
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.initializer.body ? member.initializer.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.${propName}`, 'MethodDeclaration',
          buildFunctionMeta(member.initializer, signature, start, end));
      }
    }
  };

  const handleStatements = (statements, prefix = '') => {
    for (const stmt of statements || []) {
      if (ts.isClassDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'ClassDeclaration',
          buildTypeMeta(stmt, signature, start, end));
        handleClassMembers(prefix, name, stmt.members);
        continue;
      }
      if (ts.isInterfaceDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'InterfaceDeclaration',
          buildTypeMeta(stmt, signature, start, end));
        handleClassMembers(prefix, name, stmt.members);
        continue;
      }
      if (ts.isEnumDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'EnumDeclaration',
          buildMetaBase(start, end, signature));
        continue;
      }
      if (ts.isTypeAliasDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const signature = buildSignature(start, -1);
        addChunk(start, end, qualify(prefix, name), 'TypeAliasDeclaration',
          buildMetaBase(start, end, signature));
        continue;
      }
      if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bodyStart = stmt.body ? stmt.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, qualify(prefix, name), 'FunctionDeclaration',
          buildFunctionMeta(stmt, signature, start, end));
        continue;
      }
      if (ts.isVariableStatement(stmt)) {
        const declarations = stmt.declarationList?.declarations || [];
        const useStatementStart = declarations.length === 1;
        for (const decl of declarations) {
          if (!decl?.name || !decl.initializer || !ts.isIdentifier(decl.name)) continue;
          if (!isFunctionInitializer(decl.initializer)) continue;
          const name = decl.name.text;
          const start = useStatementStart ? stmt.getStart(sourceFile) : decl.getStart(sourceFile);
          const end = decl.initializer.end;
          const bodyStart = decl.initializer.body ? decl.initializer.body.getStart(sourceFile) : -1;
          const signature = buildSignature(start, bodyStart);
          addChunk(start, end, qualify(prefix, name), 'FunctionDeclaration',
            buildFunctionMeta(decl.initializer, signature, start, end));
        }
        continue;
      }
      if (ts.isModuleDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'NamespaceDeclaration',
          buildMetaBase(start, end, signature));
        if (stmt.body) {
          if (ts.isModuleBlock(stmt.body)) {
            handleStatements(stmt.body.statements, qualify(prefix, name));
          } else if (ts.isModuleDeclaration(stmt.body)) {
            handleStatements([stmt.body], qualify(prefix, name));
          }
        }
      }
    }
  };

  handleStatements(sourceFile.statements, '');

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
 * Build chunk metadata for TypeScript declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
function buildTypeScriptChunksHeuristic(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];

  const typeRe = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|enum|type|namespace|module)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
  const funcRe = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
  const assignFuncRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function\b/;
  const arrowRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:<[^>]+>\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=>/;
  const kindMap = {
    class: 'ClassDeclaration',
    interface: 'InterfaceDeclaration',
    enum: 'EnumDeclaration',
    type: 'TypeAliasDeclaration',
    namespace: 'NamespaceDeclaration',
    module: 'NamespaceDeclaration'
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    let match = trimmed.match(typeRe);
    if (match) {
      const kindKey = match[1];
      const start = lineIndex[i] + line.indexOf(match[0]);
      let end = lineIndex[i] + line.length;
      let signature = trimmed;
      if (kindKey !== 'type') {
        const bounds = findCLikeBodyBounds(text, start);
        if (bounds.bodyStart !== -1) {
          end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
          signature = sliceSignature(text, start, bounds.bodyStart);
        }
      }
      const modifiers = extractTypeScriptModifiers(signature);
      const { extendsList, implementsList } = extractTypeScriptInheritance(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature),
        extends: extendsList,
        implements: implementsList
      };
      const entry = { start, end, name: match[2], kind: kindMap[kindKey] || 'ClassDeclaration', meta };
      decls.push(entry);
      if (kindKey === 'class' || kindKey === 'interface' || kindKey === 'enum') {
        typeDecls.push(entry);
      }
      continue;
    }
    match = trimmed.match(funcRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const modifiers = extractTypeScriptModifiers(signature);
      const parsed = parseTypeScriptSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
    }

    match = trimmed.match(assignFuncRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const modifiers = extractTypeScriptModifiers(signature);
      const parsed = parseTypeScriptSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
      continue;
    }

    match = trimmed.match(arrowRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const modifiers = extractTypeScriptModifiers(signature);
      const parsed = parseTypeScriptSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
      continue;
    }
  }

  const methodRe = /^\s*(?:public|private|protected|static|abstract|async|readonly|override|declare\s+)*(?:get|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*|constructor)\s*(?:<[^>]+>)?\s*\(/;
  for (const typeDecl of typeDecls) {
    if (!typeDecl || typeDecl.start == null || typeDecl.end == null) continue;
    const bounds = findCLikeBodyBounds(text, typeDecl.start);
    if (bounds.bodyStart === -1 || bounds.bodyEnd === -1) continue;
    const startLine = offsetToLine(lineIndex, bounds.bodyStart + 1);
    const endLine = offsetToLine(lineIndex, bounds.bodyEnd);
    for (let i = startLine - 1; i < Math.min(lines.length, endLine); i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      const match = trimmed.match(methodRe);
      if (!match) continue;
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine: sigEndLine, hasBody } = readSignatureLines(lines, i);
      const boundsInner = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = boundsInner.bodyEnd > start ? boundsInner.bodyEnd : lineIndex[sigEndLine] + lines[sigEndLine].length;
      const parsed = parseTypeScriptSignature(signature);
      const methodName = parsed.name || match[1] || 'anonymous';
      const modifiers = extractTypeScriptModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({
        start,
        end,
        name: `${typeDecl.name}.${methodName}`,
        kind: methodName === 'constructor' ? 'ConstructorDeclaration' : 'MethodDeclaration',
        meta
      });
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

export function buildTypeScriptChunks(text, options = {}) {
  if (options.treeSitter) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: (options.ext || '').toLowerCase() === '.tsx' ? 'tsx' : 'typescript',
      ext: options.ext,
      options: { treeSitter: options.treeSitter, log: options.log }
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
  const parser = resolveTypeScriptParser(options);
  if (parser === 'heuristic') return buildTypeScriptChunksHeuristic(text);
  if (parser === 'babel') {
    const babelChunks = buildTypeScriptChunksFromBabel(text, options);
    if (babelChunks && babelChunks.length) return babelChunks;
    return buildTypeScriptChunksHeuristic(text);
  }
  if (parser === 'typescript') {
    const astChunks = buildTypeScriptChunksFromAst(text, options);
    if (astChunks && astChunks.length) return astChunks;
    return buildTypeScriptChunksHeuristic(text);
  }
  const astChunks = buildTypeScriptChunksFromAst(text, options);
  if (astChunks && astChunks.length) return astChunks;
  const babelChunks = buildTypeScriptChunksFromBabel(text, options);
  if (babelChunks && babelChunks.length) return babelChunks;
  return buildTypeScriptChunksHeuristic(text);
}

/**
 * Build import/export/call/usage relations for TypeScript chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} tsChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildTypeScriptRelations(text, allImports, tsChunks, options = {}) {
  const imports = collectTypeScriptImports(text, options);
  const exports = new Set(collectTypeScriptExports(text));
  const calls = [];
  const usages = new Set();
  if (Array.isArray(tsChunks)) {
    for (const chunk of tsChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (!['MethodDeclaration', 'ConstructorDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectTypeScriptCallsAndUsages(slice);
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
 * Normalize TypeScript-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],visibility:(string|null),returnType:(string|null),extends:string[],implements:string[]}}
 */
export function extractTypeScriptDocMeta(chunk) {
  const meta = chunk.meta || {};
  const signature = meta.signature || '';
  const params = Array.isArray(meta.params) && meta.params.length
    ? meta.params
    : (signature ? extractTypeScriptParams(signature) : []);
  const paramTypes = meta.paramTypes && typeof meta.paramTypes === 'object'
    && Object.keys(meta.paramTypes).length
    ? meta.paramTypes
    : (signature ? extractTypeScriptParamTypes(signature) : {});
  const decorators = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  let extendsList = Array.isArray(meta.extends) ? meta.extends : [];
  let implementsList = Array.isArray(meta.implements) ? meta.implements : [];
  if ((!extendsList.length || !implementsList.length) && signature) {
    const inheritance = extractTypeScriptInheritance(signature);
    if (!extendsList.length && inheritance.extendsList.length) {
      extendsList = inheritance.extendsList;
    }
    if (!implementsList.length && inheritance.implementsList.length) {
      implementsList = inheritance.implementsList;
    }
  }
  const returns = meta.returns || (signature ? extractTypeScriptReturns(signature) : null);
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    paramTypes,
    returns,
    returnType: returns,
    signature: signature || null,
    decorators,
    modifiers,
    visibility: meta.visibility || null,
    extends: extendsList,
    implements: implementsList,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}

/**
 * Heuristic control-flow/dataflow extraction for TypeScript chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeTypeScriptFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripTypeScriptComments(slice);
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
      skip: TS_USAGE_SKIP,
      memberOperators: ['.']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    for (const match of cleaned.matchAll(/\bthrow\b\s+(?:new\s+)?([A-Za-z_$][A-Za-z0-9_$.]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) throws.add(name);
    }
    out.throws = Array.from(throws);
    const awaits = new Set();
    for (const match of cleaned.matchAll(/\bawait\b\s+([A-Za-z_$][A-Za-z0-9_$.]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) awaits.add(name);
    }
    out.awaits = Array.from(awaits);
    out.yields = /\byield\b/.test(cleaned);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'switch', 'case', 'catch', 'try'],
      loopKeywords: ['for', 'while', 'do']
    });
  }

  return out;
}
