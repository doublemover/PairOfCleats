import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { collectAttributes, extractDocComment, sliceSignature } from './shared.js';

/**
 * Kotlin language chunking and relations.
 * Heuristic parser for classes, objects, and functions.
 */
const KOTLIN_MODIFIERS = new Set([
  'public', 'private', 'protected', 'internal', 'open', 'abstract', 'sealed',
  'data', 'enum', 'annotation', 'value', 'inline', 'const', 'lateinit', 'override',
  'suspend', 'tailrec', 'operator', 'infix', 'companion'
]);

const KOTLIN_CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'when', 'return', 'throw', 'catch', 'try', 'else',
  'do', 'new', 'this', 'super', 'in', 'is'
]);

const KOTLIN_USAGE_SKIP = new Set([
  ...KOTLIN_CALL_KEYWORDS,
  'class', 'interface', 'object', 'enum', 'fun', 'val', 'var', 'null', 'true',
  'false', 'Unit', 'Nothing', 'Any', 'Int', 'Long', 'Double', 'Float', 'Boolean',
  'String'
]);

function extractKotlinModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (KOTLIN_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractKotlinParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=[^,]+/g, '').trim();
    seg = seg.replace(/:[^,]+/g, '').trim();
    seg = seg.replace(/\b(var|val|crossinline|noinline)\b\s+/g, '').trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].replace(/[^A-Za-z0-9_]/g, '');
    if (!name || !/^[A-Za-z_]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

function extractKotlinReturns(signature) {
  const idx = signature.indexOf(')');
  if (idx === -1) return null;
  const after = signature.slice(idx + 1);
  const match = after.match(/:\s*([^=\{]+)/);
  if (!match) return null;
  const ret = match[1].trim();
  return ret || null;
}

function parseKotlinSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = extractKotlinReturns(signature);
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

function stripKotlinComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function collectKotlinCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripKotlinComments(text);
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split('.').filter(Boolean).pop();
    if (!base || KOTLIN_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (KOTLIN_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

function parseKotlinInheritance(signature) {
  const extendsList = [];
  const match = signature.match(/:\s*([^\{]+)/);
  if (!match) return extendsList;
  match[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => extendsList.push(name));
  return extendsList;
}

function extractVisibility(modifiers) {
  if (modifiers.includes('private')) return 'private';
  if (modifiers.includes('protected')) return 'protected';
  if (modifiers.includes('internal')) return 'internal';
  return 'public';
}

/**
 * Collect import statements from Kotlin source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectKotlinImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('import ')) continue;
    const match = trimmed.match(/^import\s+([^;\s]+)/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for Kotlin declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildKotlinChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];

  const typeRe = /^\s*(?:@[A-Za-z_][A-Za-z0-9_.]*\s+)*(?:(?:public|protected|private|internal|open|abstract|sealed|data|enum|annotation|value|inline|const|lateinit|override)\s+)*(class|interface|object|enum\s+class|data\s+class|sealed\s+class|annotation\s+class|value\s+class)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const funcRe = /^\s*(?:@[A-Za-z_][A-Za-z0-9_.]*\s+)*(?:(?:public|protected|private|internal|open|abstract|final|override|suspend|inline|tailrec|operator|infix)\s+)*fun\s+([A-Za-z_][A-Za-z0-9_]*)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    let match = trimmed.match(typeRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const bounds = findCLikeBodyBounds(text, start);
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[i] + line.length;
      const signature = sliceSignature(text, start, bounds.bodyStart);
      const modifiers = extractKotlinModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature),
        extends: parseKotlinInheritance(signature)
      };
      let kind = 'ClassDeclaration';
      if (match[1].includes('interface')) kind = 'InterfaceDeclaration';
      if (match[1].includes('object')) kind = 'ObjectDeclaration';
      if (match[1].includes('enum')) kind = 'EnumDeclaration';
      const entry = { start, end, name: match[2], kind, meta };
      decls.push(entry);
      if (kind === 'ClassDeclaration' || kind === 'InterfaceDeclaration' || kind === 'ObjectDeclaration' || kind === 'EnumDeclaration') {
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
      const modifiers = extractKotlinModifiers(signature);
      const parsed = parseKotlinSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractKotlinParams(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
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
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      if (!trimmed.includes('fun ')) continue;
      const { signature, endLine: sigEndLine, hasBody } = readSignatureLines(lines, i);
      if (!signature.includes('(')) continue;
      const parsed = parseKotlinSignature(signature);
      if (!parsed.name) continue;
      const start = lineIndex[i] + line.indexOf(trimmed);
      const boundsInner = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = boundsInner.bodyEnd > start ? boundsInner.bodyEnd : lineIndex[sigEndLine] + lines[sigEndLine].length;
      const modifiers = extractKotlinModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractKotlinParams(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({
        start,
        end,
        name: `${typeDecl.name}.${parsed.name}`,
        kind: 'MethodDeclaration',
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

/**
 * Build import/export/call/usage relations for Kotlin chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} kotlinChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildKotlinRelations(text, allImports, kotlinChunks) {
  const imports = collectKotlinImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(kotlinChunks)) {
    for (const chunk of kotlinChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      const mods = Array.isArray(chunk.meta?.modifiers) ? chunk.meta.modifiers : [];
      if (mods.includes('public')) exports.add(chunk.name);
      if (!['MethodDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectKotlinCallsAndUsages(slice);
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
 * Normalize Kotlin-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],visibility:(string|null),returnType:(string|null),extends:string[]}}
 */
export function extractKotlinDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const decorators = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  const extendsList = Array.isArray(meta.extends) ? meta.extends : [];
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
    extends: extendsList
  };
}
