import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import {
  buildDefaultDocMeta,
  buildBraceDelimitedMethodRelations,
  collectCLikeDataflowFacts,
  collectAttributes,
  collectDottedCallsAndUsages,
  extractReturnTypeBeforeName,
  extractDocComment,
  sliceSignature,
  stripCLikeComments
} from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Java language chunking and relations.
 * Heuristic parser for classes, methods, and constructors.
 */

const JAVA_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'abstract',
  'synchronized', 'native', 'transient', 'volatile', 'strictfp',
  'default', 'sealed', 'non-sealed'
]);

export const JAVA_RESERVED_WORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'exports',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'module',
  'native',
  'new',
  'non-sealed',
  'null',
  'open',
  'opens',
  'package',
  'permits',
  'private',
  'protected',
  'provides',
  'public',
  'record',
  'requires',
  'return',
  'sealed',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'to',
  'transient',
  'transitive',
  'true',
  'try',
  'uses',
  'var',
  'void',
  'volatile',
  'while',
  'with',
  'yield'
]);

const JAVA_CALL_KEYWORDS = new Set([
  ...JAVA_RESERVED_WORDS
]);

const JAVA_USAGE_SKIP = new Set([
  ...JAVA_RESERVED_WORDS
]);

function extractJavaModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (JAVA_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractJavaParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/@[A-Za-z_][A-Za-z0-9_.]*(\([^)]*\))?\s*/g, '');
    seg = seg.replace(/\bfinal\b\s+/g, '');
    seg = seg.replace(/\s*\.{3}\s*/, ' ');
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let name = tokens[tokens.length - 1];
    name = name.replace(/\[\]$/g, '');
    if (!/^[A-Za-z_]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

function extractJavaReturns(signature, name) {
  return extractReturnTypeBeforeName(signature, name, {
    modifiers: JAVA_MODIFIERS,
    shouldSkipToken: (tok) => tok.startsWith('@')
  });
}

function parseJavaSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = extractJavaReturns(signature, name);
  return { name, returns };
}

const stripJavaComments = stripCLikeComments;

function collectJavaCallsAndUsages(text) {
  return collectDottedCallsAndUsages(text, {
    callKeywords: JAVA_CALL_KEYWORDS,
    usageSkip: JAVA_USAGE_SKIP,
    normalizeText: (value) => value.replace(/->/g, '.'),
    shouldSkipUsage: (name) => /^[A-Z0-9_]{2,}$/.test(name)
  });
}

/**
 * Collect import statements from Java source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectJavaImports(text) {
  if (!text || !text.includes('import ')) return [];
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('import ')) continue;
    const match = trimmed.match(/^import\s+(?:static\s+)?([^;]+);/);
    if (match) imports.add(match[1].trim());
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for Java declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildJavaChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'java', options });
  if (treeChunks && treeChunks.length) return treeChunks;
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];

  const typeRe = /^\s*(?:@[A-Za-z_][A-Za-z0-9_.]*\s+)*(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\s+)*(@?interface|class|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const match = trimmed.match(typeRe);
    if (!match) continue;
    const start = lineIndex[i] + line.indexOf(match[0]);
    const bounds = findCLikeBodyBounds(text, start);
    if (bounds.bodyStart === -1) continue;
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    const signature = sliceSignature(text, start, bounds.bodyStart);
    const kindMap = {
      class: 'ClassDeclaration',
      interface: 'InterfaceDeclaration',
      enum: 'EnumDeclaration',
      record: 'RecordDeclaration',
      '@interface': 'AnnotationDeclaration'
    };
    const kind = kindMap[match[1]] || 'ClassDeclaration';
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      modifiers: extractJavaModifiers(signature),
      docstring: extractDocComment(lines, i),
      attributes: collectAttributes(lines, i, signature)
    };
    const entry = { start, end, name: match[2], kind, meta };
    typeDecls.push(entry);
    decls.push(entry);
  }

  const findParent = (start) => {
    let parent = null;
    for (const type of typeDecls) {
      if (type.start < start && type.end > start) {
        if (!parent || type.start > parent.start) parent = type;
      }
    }
    return parent;
  };

  const skipPrefixes = new Set([
    'if', 'for', 'while', 'switch', 'return', 'case', 'do', 'else',
    'try', 'catch', 'finally', 'throw', 'new', 'synchronized'
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    if (!trimmed.includes('(')) continue;
    const prefix = trimmed.split(/\s+/)[0];
    if (skipPrefixes.has(prefix)) continue;
    if (trimmed.startsWith('@')) continue;
    if (/\b(class|interface|enum|record)\b/.test(trimmed)) continue;

    const { signature, endLine, hasBody } = readSignatureLines(lines, i);
    if (!hasBody) {
      i = endLine;
      continue;
    }
    const { name: rawName, returns } = parseJavaSignature(signature);
    if (!rawName) {
      i = endLine;
      continue;
    }
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = findCLikeBodyBounds(text, start);
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const parent = findParent(start);
    let name = rawName;
    let kind = 'MethodDeclaration';
    if (parent && parent.name) {
      name = `${parent.name}.${name}`;
      if (rawName === parent.name) kind = 'ConstructorDeclaration';
    } else {
      kind = 'FunctionDeclaration';
    }
    const signatureText = bounds.bodyStart > start ? sliceSignature(text, start, bounds.bodyStart) : signature;
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature: signatureText,
      params: extractJavaParams(signature),
      returns: kind === 'ConstructorDeclaration' ? null : returns,
      modifiers: extractJavaModifiers(signature),
      docstring: extractDocComment(lines, i),
      attributes: collectAttributes(lines, i, signature)
    };
    decls.push({ start, end, name, kind, meta });
    i = endLine;
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
 * Build import/export/call/usage relations for Java chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} javaChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildJavaRelations(text, javaChunks) {
  return buildBraceDelimitedMethodRelations(text, javaChunks, {
    collectImports: collectJavaImports,
    collectCallsAndUsages: collectJavaCallsAndUsages,
    findBodyBounds: findCLikeBodyBounds
  });
}

/**
 * Normalize Java-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[]}}
 */
export function extractJavaDocMeta(chunk) {
  return buildDefaultDocMeta(chunk, {
    decoratorsFrom: 'attributes',
    includeModifiers: true
  });
}

/**
 * Heuristic control-flow/dataflow extraction for Java chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeJavaFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripJavaComments(slice);
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
      usageSkip: JAVA_USAGE_SKIP,
      memberOperators: ['.']
    }));
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'switch', 'case', 'catch', 'try'],
      loopKeywords: ['for', 'while', 'do']
    });
  }

  return out;
}
