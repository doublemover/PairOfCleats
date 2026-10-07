import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import {
  buildDefaultDocMeta,
  buildBraceDelimitedMethodRelations,
  collectCLikeDataflowFacts,
  collectDottedCallsAndUsages,
  collectCLikeTypeBodyMemberDeclarations,
  extractReturnTypeBeforeName,
  extractDocComment,
  sliceSignature,
  stripCLikeComments
} from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * C# language chunking and relations.
 * Heuristic parser for namespaces, types, and methods.
 */
const CSHARP_MODIFIERS = new Set([
  'public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed',
  'virtual', 'override', 'async', 'extern', 'partial', 'readonly', 'unsafe', 'new'
]);

export const CSHARP_RESERVED_WORDS = new Set([
  'abstract',
  'add',
  'alias',
  'ascending',
  'async',
  'await',
  'base',
  'bool',
  'break',
  'byte',
  'by',
  'case',
  'catch',
  'char',
  'checked',
  'class',
  'const',
  'continue',
  'decimal',
  'default',
  'delegate',
  'descending',
  'do',
  'double',
  'dynamic',
  'else',
  'enum',
  'equals',
  'event',
  'explicit',
  'extern',
  'false',
  'finally',
  'fixed',
  'float',
  'for',
  'foreach',
  'from',
  'get',
  'global',
  'goto',
  'group',
  'if',
  'implicit',
  'in',
  'init',
  'int',
  'interface',
  'internal',
  'into',
  'is',
  'join',
  'let',
  'lock',
  'long',
  'namespace',
  'new',
  'nameof',
  'null',
  'object',
  'operator',
  'orderby',
  'out',
  'override',
  'params',
  'partial',
  'private',
  'protected',
  'public',
  'readonly',
  'record',
  'ref',
  'remove',
  'return',
  'sbyte',
  'sealed',
  'select',
  'set',
  'short',
  'sizeof',
  'stackalloc',
  'static',
  'string',
  'struct',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'uint',
  'ulong',
  'unchecked',
  'unsafe',
  'ushort',
  'using',
  'value',
  'var',
  'virtual',
  'void',
  'volatile',
  'when',
  'where',
  'while',
  'with',
  'yield'
]);

const CSHARP_CALL_KEYWORDS = new Set([
  ...CSHARP_RESERVED_WORDS
]);

const CSHARP_USAGE_SKIP = new Set([
  ...CSHARP_RESERVED_WORDS
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
  return extractReturnTypeBeforeName(signature, name, {
    modifiers: CSHARP_MODIFIERS,
    shouldSkipToken: (tok) => tok.startsWith('[')
  });
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

const stripCSharpComments = stripCLikeComments;

function collectCSharpCallsAndUsages(text) {
  return collectDottedCallsAndUsages(text, {
    callKeywords: CSHARP_CALL_KEYWORDS,
    usageSkip: CSHARP_USAGE_SKIP
  });
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
  if (!text || !text.includes('using ')) return [];
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
export function buildCSharpChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'csharp', options });
  if (treeChunks && treeChunks.length) return treeChunks;
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

  decls.push(...collectCLikeTypeBodyMemberDeclarations({
    text,
    lines,
    lineIndex,
    typeDecls,
    findBodyBounds: findCLikeBodyBounds,
    offsetToLine,
    readSignatureLines,
    shouldSkipLine: (trimmed) => (
      !trimmed
      || trimmed.startsWith('//')
      || trimmed.startsWith('/*')
      || trimmed.startsWith('*')
      || trimmed.startsWith('[')
    ),
    shouldReadLine: (trimmed) => trimmed.includes('('),
    buildEntry: ({ typeDecl, lineIndex: i, signature, start, end, endLine }) => {
      const parsed = parseCSharpSignature(signature);
      if (!parsed.name) return null;
      const modifiers = extractCSharpModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine,
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
      return { start, end, name, kind, meta };
    }
  }));

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
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} csharpChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildCSharpRelations(text, csharpChunks) {
  return buildBraceDelimitedMethodRelations(text, csharpChunks, {
    collectImports: collectCSharpImports,
    collectCallsAndUsages: collectCSharpCallsAndUsages,
    findBodyBounds: findCLikeBodyBounds
  });
}

/**
 * Normalize C#-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],visibility:(string|null),returnType:(string|null),extends:string[],implements:string[]}}
 */
export function extractCSharpDocMeta(chunk) {
  const meta = chunk.meta || {};
  const extendsList = Array.isArray(meta.extends) ? meta.extends : [];
  const implementsList = Array.isArray(meta.implements) ? meta.implements : [];
  return buildDefaultDocMeta(chunk, {
    decoratorsFrom: 'attributes',
    includeModifiers: true,
    includeReturnType: true,
    includeVisibility: true,
    extraFields: {
      extends: extendsList,
      implements: implementsList
    }
  });
}

/**
 * Heuristic control-flow/dataflow extraction for C# chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeCSharpFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripCSharpComments(slice);
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
    Object.assign(out, collectCLikeDataflowFacts(cleaned, {
      usageSkip: CSHARP_USAGE_SKIP,
      memberOperators: ['.'],
      awaitPattern: /\bawait\b\s+([A-Za-z_][A-Za-z0-9_.]*)/g,
      yieldPattern: /\byield\b/
    }));
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'switch', 'case', 'catch', 'try'],
      loopKeywords: ['for', 'while', 'do', 'foreach']
    });
  }

  return out;
}
