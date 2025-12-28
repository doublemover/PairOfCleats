import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { extractDocComment, sliceSignature } from './shared.js';

/**
 * C# language chunking and relations.
 * Heuristic parser for namespaces, types, and methods.
 */
const CSHARP_MODIFIERS = new Set([
  'public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed',
  'virtual', 'override', 'async', 'extern', 'partial', 'readonly', 'unsafe', 'new'
]);

const CSHARP_CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'case', 'return', 'new', 'throw', 'catch',
  'try', 'else', 'do', 'lock', 'using', 'await', 'yield'
]);

const CSHARP_USAGE_SKIP = new Set([
  ...CSHARP_CALL_KEYWORDS,
  'class', 'interface', 'struct', 'record', 'enum', 'delegate', 'void',
  'int', 'long', 'short', 'byte', 'float', 'double', 'decimal', 'bool', 'char',
  'string', 'object', 'null', 'true', 'false'
]);

function extractCSharpModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (CSHARP_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractCSharpParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/\[[^\]]+\]\s*/g, '');
    seg = seg.replace(/=[^,]+/g, '').trim();
    seg = seg.replace(/\b(ref|out|in|params|this)\b\s+/g, '').trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let name = tokens[tokens.length - 1];
    name = name.replace(/\[\]$/g, '');
    if (!/^[A-Za-z_]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

function extractCSharpReturns(signature, name) {
  if (!name) return null;
  const idx = signature.indexOf('(');
  if (idx === -1) return null;
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const nameIdx = before.lastIndexOf(name);
  if (nameIdx === -1) return null;
  const raw = before.slice(0, nameIdx).trim();
  if (!raw) return null;
  const filtered = raw
    .split(/\s+/)
    .filter((tok) => tok && !CSHARP_MODIFIERS.has(tok) && !tok.startsWith('['));
  return filtered.length ? filtered.join(' ') : null;
}

function parseCSharpSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = extractCSharpReturns(signature, name);
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

function stripCSharpComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function collectCSharpCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripCSharpComments(text);
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split('.').filter(Boolean).pop();
    if (!base || CSHARP_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (CSHARP_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

function collectCSharpAttributes(lines, startLineIdx) {
  const attrs = [];
  let i = startLineIdx - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (attrs.length) break;
      i--;
      continue;
    }
    if (trimmed.startsWith('[')) {
      const match = trimmed.match(/\[\s*([A-Za-z_][A-Za-z0-9_.]*)/);
      if (match) attrs.unshift(match[1]);
      i--;
      continue;
    }
    if (trimmed.startsWith('///') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      i--;
      continue;
    }
    break;
  }
  return attrs;
}

function parseCSharpInheritance(signature) {
  const extendsList = [];
  const implementsList = [];
  const match = signature.match(/:\s*([^\{]+)/);
  if (!match) return { extendsList, implementsList };
  const parts = match[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length) {
    extendsList.push(parts[0]);
    parts.slice(1).forEach((p) => implementsList.push(p));
  }
  return { extendsList, implementsList };
}

function extractVisibility(modifiers) {
  if (modifiers.includes('private')) return 'private';
  if (modifiers.includes('protected')) return 'protected';
  if (modifiers.includes('internal')) return 'internal';
  return 'public';
}

/**
 * Collect using imports from C# source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectCSharpImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('using ')) continue;
    const match = trimmed.match(/^using\s+(?:static\s+)?([^;]+);/);
    if (match) {
      const raw = match[1].trim();
      const value = raw.includes('=') ? raw.split('=').pop().trim() : raw;
      if (value) imports.add(value);
    }
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for C# declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildCSharpChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];

  const typeRe = /^\s*(?:\[[^\]]+\]\s+)*(?:(?:public|protected|private|internal|abstract|sealed|static|partial)\s+)*(class|interface|struct|record|enum|delegate)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const namespaceRe = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    let match = trimmed.match(namespaceRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const bounds = findCLikeBodyBounds(text, start);
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[i] + line.length;
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature: sliceSignature(text, start, bounds.bodyStart),
        docstring: extractDocComment(lines, i),
        attributes: []
      };
      decls.push({ start, end, name: match[1], kind: 'NamespaceDeclaration', meta });
      continue;
    }
    match = trimmed.match(typeRe);
    if (!match) continue;
    const start = lineIndex[i] + line.indexOf(match[0]);
    const bounds = findCLikeBodyBounds(text, start);
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[i] + line.length;
    const signature = sliceSignature(text, start, bounds.bodyStart);
    const modifiers = extractCSharpModifiers(signature);
    const { extendsList, implementsList } = parseCSharpInheritance(signature);
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      modifiers,
      visibility: extractVisibility(modifiers),
      docstring: extractDocComment(lines, i),
      attributes: collectCSharpAttributes(lines, i),
      extends: extendsList,
      implements: implementsList
    };
    const kindMap = {
      class: 'ClassDeclaration',
      interface: 'InterfaceDeclaration',
      struct: 'StructDeclaration',
      record: 'RecordDeclaration',
      enum: 'EnumDeclaration',
      delegate: 'DelegateDeclaration'
    };
    const entry = { start, end, name: match[2], kind: kindMap[match[1]] || 'ClassDeclaration', meta };
    decls.push(entry);
    if (['class', 'interface', 'struct', 'record'].includes(match[1])) {
      typeDecls.push(entry);
    }
  }

  for (const typeDecl of typeDecls) {
    if (!typeDecl || typeDecl.start == null || typeDecl.end == null) continue;
    const bounds = findCLikeBodyBounds(text, typeDecl.start);
    if (bounds.bodyStart === -1 || bounds.bodyEnd === -1) continue;
    const startLine = offsetToLine(lineIndex, bounds.bodyStart + 1);
    const endLine = offsetToLine(lineIndex, bounds.bodyEnd);
    for (let i = startLine - 1; i < Math.min(lines.length, endLine); i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('[')) continue;
      if (!trimmed.includes('(')) continue;
      const { signature, endLine: sigEndLine, hasBody } = readSignatureLines(lines, i);
      if (!signature.includes('(')) continue;
      const parsed = parseCSharpSignature(signature);
      if (!parsed.name) continue;
      const start = lineIndex[i] + line.indexOf(trimmed);
      const boundsInner = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = boundsInner.bodyEnd > start ? boundsInner.bodyEnd : lineIndex[sigEndLine] + lines[sigEndLine].length;
      const modifiers = extractCSharpModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractCSharpParams(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectCSharpAttributes(lines, i)
      };
      const kind = parsed.name === typeDecl.name ? 'ConstructorDeclaration' : 'MethodDeclaration';
      const name = `${typeDecl.name}.${parsed.name}`;
      decls.push({ start, end, name, kind, meta });
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
 * Build import/export/call/usage relations for C# chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} csharpChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildCSharpRelations(text, allImports, csharpChunks) {
  const imports = collectCSharpImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(csharpChunks)) {
    for (const chunk of csharpChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      const mods = Array.isArray(chunk.meta?.modifiers) ? chunk.meta.modifiers : [];
      if (mods.includes('public')) exports.add(chunk.name);
      if (!['MethodDeclaration', 'ConstructorDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectCSharpCallsAndUsages(slice);
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
 * Normalize C#-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],visibility:(string|null),returnType:(string|null),extends:string[],implements:string[]}}
 */
export function extractCSharpDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const decorators = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  const extendsList = Array.isArray(meta.extends) ? meta.extends : [];
  const implementsList = Array.isArray(meta.implements) ? meta.implements : [];
  const returns = meta.returns || null;
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns,
    returnType: returns,
    signature: meta.signature || null,
    decorators,
    modifiers,
    visibility: meta.visibility || null,
    extends: extendsList,
    implements: implementsList
  };
}
