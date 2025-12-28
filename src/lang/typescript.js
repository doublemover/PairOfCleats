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
export function collectTypeScriptImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let match = trimmed.match(/^(?:import|export)\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/);
    if (match) {
      imports.add(match[1]);
      continue;
    }
    match = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (match) imports.add(match[1]);
    match = trimmed.match(/\brequire\(['"]([^'"]+)['"]\)/);
    if (match) imports.add(match[1]);
  }
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

/**
 * Build chunk metadata for TypeScript declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildTypeScriptChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];

  const typeRe = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|enum|type|namespace|module)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
  const funcRe = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
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
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
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

/**
 * Build import/export/call/usage relations for TypeScript chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} tsChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildTypeScriptRelations(text, allImports, tsChunks) {
  const imports = collectTypeScriptImports(text);
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
