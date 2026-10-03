import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { normalizeCapNullOnZero } from '../shared/limits.js';
import { findCLikeBodyBounds } from './clike.js';
import {
  buildDefaultDocMeta,
  buildBraceDelimitedMethodRelations,
  collectCLikeDataflowFacts,
  collectAttributes,
  collectCLikeTypeBodyMemberDeclarations,
  collectDottedCallsAndUsages,
  extractDocComment,
  sliceSignature,
  stripCLikeComments
} from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Kotlin language chunking and relations.
 * Heuristic parser for classes, objects, and functions.
 */
const KOTLIN_MODIFIERS = new Set([
  'public', 'private', 'protected', 'internal', 'open', 'abstract', 'sealed',
  'data', 'enum', 'annotation', 'value', 'inline', 'const', 'lateinit', 'override',
  'suspend', 'tailrec', 'operator', 'infix', 'companion'
]);

export const KOTLIN_RESERVED_WORDS = new Set([
  'abstract',
  'actual',
  'annotation',
  'as',
  'break',
  'by',
  'catch',
  'class',
  'companion',
  'const',
  'constructor',
  'continue',
  'crossinline',
  'data',
  'delegate',
  'do',
  'dynamic',
  'else',
  'enum',
  'expect',
  'external',
  'false',
  'field',
  'file',
  'final',
  'finally',
  'for',
  'fun',
  'get',
  'if',
  'import',
  'in',
  'init',
  'inner',
  'inline',
  'interface',
  'internal',
  'is',
  'lateinit',
  'noinline',
  'null',
  'object',
  'open',
  'operator',
  'out',
  'override',
  'package',
  'param',
  'private',
  'property',
  'protected',
  'public',
  'receiver',
  'reified',
  'return',
  'sealed',
  'set',
  'setparam',
  'super',
  'suspend',
  'tailrec',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'val',
  'var',
  'vararg',
  'value',
  'when',
  'where',
  'while'
]);

const KOTLIN_CALL_KEYWORDS = new Set([
  ...KOTLIN_RESERVED_WORDS
]);

const KOTLIN_USAGE_SKIP = new Set([
  ...KOTLIN_RESERVED_WORDS,
  'Any',
  'Boolean',
  'Double',
  'Float',
  'Int',
  'Long',
  'Nothing',
  'String',
  'Unit'
]);

const KOTLIN_RELATION_CALLABLE_KINDS = new Set(['MethodDeclaration', 'FunctionDeclaration']);

const DEFAULT_KOTLIN_LIMITS = {
  flowMaxBytes: 200 * 1024,
  flowMaxLines: 3000,
  relationsMaxBytes: 200 * 1024,
  relationsMaxLines: 2000
};

const normalizeLimit = (value, fallback) => (
  normalizeCapNullOnZero(value, fallback)
);

const resolveKotlinLimits = (options = {}) => {
  const config = options.kotlin || {};
  return {
    flowMaxBytes: normalizeLimit(config.flowMaxBytes, DEFAULT_KOTLIN_LIMITS.flowMaxBytes),
    flowMaxLines: normalizeLimit(config.flowMaxLines, DEFAULT_KOTLIN_LIMITS.flowMaxLines),
    relationsMaxBytes: normalizeLimit(config.relationsMaxBytes, DEFAULT_KOTLIN_LIMITS.relationsMaxBytes),
    relationsMaxLines: normalizeLimit(config.relationsMaxLines, DEFAULT_KOTLIN_LIMITS.relationsMaxLines)
  };
};

const exceedsLimit = (stats, maxBytes, maxLines) => {
  if (!stats) return false;
  if (Number.isFinite(maxBytes) && maxBytes > 0 && stats.bytes > maxBytes) return true;
  if (Number.isFinite(maxLines) && maxLines > 0 && stats.lines > maxLines) return true;
  return false;
};

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

const stripKotlinComments = stripCLikeComments;

function collectKotlinCallsAndUsages(text) {
  return collectDottedCallsAndUsages(text, {
    callKeywords: KOTLIN_CALL_KEYWORDS,
    usageSkip: KOTLIN_USAGE_SKIP
  });
}

function parseKotlinInheritance(signature) {
  const extendsList = [];
  const match = signature.match(/:\s*([^\{]+)/);
  if (!match) return extendsList;
  for (const part of match[1].split(',')) {
    const name = part.trim();
    if (name) extendsList.push(name);
  }
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
  if (!text || !text.includes('import ')) return [];
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

export function getKotlinFileStats(text) {
  const safeText = typeof text === 'string' ? text : '';
  return {
    bytes: Buffer.byteLength(safeText, 'utf8'),
    lines: safeText ? safeText.split('\n').length : 0
  };
}

/**
 * Build chunk metadata for Kotlin declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildKotlinChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'kotlin', options });
  if (treeChunks && treeChunks.length) return treeChunks;
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

  decls.push(...collectCLikeTypeBodyMemberDeclarations({
    text,
    lines,
    lineIndex,
    typeDecls,
    findBodyBounds: findCLikeBodyBounds,
    offsetToLine,
    readSignatureLines,
    shouldReadLine: (trimmed) => trimmed.includes('fun '),
    buildEntry: ({ typeDecl, lineIndex: i, signature, start, end, endLine }) => {
      const parsed = parseKotlinSignature(signature);
      if (!parsed.name) return null;
      const modifiers = extractKotlinModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine,
        signature,
        params: extractKotlinParams(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      return {
        start,
        end,
        name: `${typeDecl.name}.${parsed.name}`,
        kind: 'MethodDeclaration',
        meta
      };
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
 * Build import/export/call/usage relations for Kotlin chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} kotlinChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildKotlinRelations(text, kotlinChunks, options = {}) {
  const stats = options.stats || getKotlinFileStats(text);
  const limits = resolveKotlinLimits(options);
  const skipRelations = exceedsLimit(stats, limits.relationsMaxBytes, limits.relationsMaxLines);
  return buildBraceDelimitedMethodRelations(text, kotlinChunks, {
    collectImports: collectKotlinImports,
    collectCallsAndUsages: collectKotlinCallsAndUsages,
    findBodyBounds: findCLikeBodyBounds,
    callableKinds: KOTLIN_RELATION_CALLABLE_KINDS,
    shouldScanCallable: () => !skipRelations
  });
}

/**
 * Normalize Kotlin-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],visibility:(string|null),returnType:(string|null),extends:string[]}}
 */
export function extractKotlinDocMeta(chunk) {
  const meta = chunk.meta || {};
  const extendsList = Array.isArray(meta.extends) ? meta.extends : [];
  return buildDefaultDocMeta(chunk, {
    decoratorsFrom: 'attributes',
    includeModifiers: true,
    includeReturnType: true,
    includeVisibility: true,
    extraFields: { extends: extendsList }
  });
}

/**
 * Heuristic control-flow/dataflow extraction for Kotlin chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean,kotlin?:object,stats?:{bytes:number,lines:number}}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeKotlinFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const stats = options.stats || getKotlinFileStats(text);
  const limits = resolveKotlinLimits(options);
  const skipFlow = exceedsLimit(stats, limits.flowMaxBytes, limits.flowMaxLines);
  if (skipFlow) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripKotlinComments(slice);
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
      usageSkip: KOTLIN_USAGE_SKIP,
      memberOperators: ['.'],
      throwPattern: /\bthrow\b\s+([A-Za-z_][A-Za-z0-9_.]*)/g
    }));
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'when'],
      loopKeywords: ['for', 'while']
    });
  }

  return out;
}
