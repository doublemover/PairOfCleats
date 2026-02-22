import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { collectAttributes, extractDocComment, sliceSignature } from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * PHP language chunking and relations.
 * Heuristic parser for classes, interfaces, traits, and functions.
 */
const PHP_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'abstract', 'final'
]);

export const PHP_RESERVED_WORDS = new Set([
  '__halt_compiler',
  'abstract',
  'and',
  'array',
  'as',
  'break',
  'callable',
  'case',
  'catch',
  'class',
  'clone',
  'const',
  'continue',
  'declare',
  'default',
  'die',
  'do',
  'echo',
  'else',
  'elseif',
  'empty',
  'enddeclare',
  'endfor',
  'endforeach',
  'endif',
  'endswitch',
  'endwhile',
  'eval',
  'exit',
  'extends',
  'false',
  'final',
  'finally',
  'fn',
  'for',
  'foreach',
  'from',
  'function',
  'global',
  'goto',
  'if',
  'implements',
  'include',
  'include_once',
  'instanceof',
  'insteadof',
  'interface',
  'isset',
  'list',
  'match',
  'namespace',
  'new',
  'null',
  'or',
  'print',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'require_once',
  'return',
  'static',
  'switch',
  'throw',
  'trait',
  'true',
  'try',
  'unset',
  'use',
  'var',
  'while',
  'xor',
  'yield'
]);

const PHP_CALL_KEYWORDS = new Set([
  ...PHP_RESERVED_WORDS
]);

const PHP_USAGE_SKIP = new Set([
  ...PHP_RESERVED_WORDS
]);

function extractPhpModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (PHP_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractPhpParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=.+$/g, '').trim();
    seg = seg.replace(/\?\s*[A-Za-z0-9_\\|]+\s+/g, '').trim();
    const matchName = seg.match(/\$[A-Za-z_][A-Za-z0-9_]*/);
    if (!matchName) continue;
    params.push(matchName[0].replace('$', ''));
  }
  return params;
}

function extractPhpReturns(signature) {
  const idx = signature.indexOf(')');
  if (idx === -1) return null;
  const after = signature.slice(idx + 1);
  const match = after.match(/:\s*([^\{;]+)/);
  if (!match) return null;
  const ret = match[1].trim();
  return ret || null;
}

function parsePhpSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = extractPhpReturns(signature);
  return { name, returns };
}

function stripPhpComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/#.*$/gm, ' ');
}

function collectPhpCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripPhpComments(text);
  const callRe = /\b([A-Za-z_][A-Za-z0-9_\\]*)\s*\(/g;
  let match;
  while ((match = callRe.exec(normalized)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    let end = raw.length;
    while (end > 0 && raw[end - 1] === '\\') end -= 1;
    if (!end) continue;
    const sepIdx = raw.lastIndexOf('\\', end - 1);
    const base = sepIdx === -1 ? raw.slice(0, end) : raw.slice(sepIdx + 1, end);
    if (!base || PHP_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
    if (!match[0]) callRe.lastIndex += 1;
  }
  const usageRe = /\$([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((match = usageRe.exec(normalized)) !== null) {
    const name = match[1];
    if (!name || PHP_USAGE_SKIP.has(name)) continue;
    usages.add(name);
    if (!match[0]) usageRe.lastIndex += 1;
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

function extractVisibility(modifiers) {
  if (modifiers.includes('private')) return 'private';
  if (modifiers.includes('protected')) return 'protected';
  return 'public';
}

/**
 * Collect use/import statements from PHP source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectPhpImports(text) {
  if (!text) return [];
  const lowered = text.toLowerCase();
  const hasUse = lowered.includes('use ');
  const hasInclude = lowered.includes('include');
  const hasRequire = lowered.includes('require');
  if (!hasUse && !hasInclude && !hasRequire) return [];
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    if (/^use\s+/i.test(trimmed)) {
      const match = trimmed.match(/^use\s+([^;]+);/i);
      if (!match) continue;
      const raw = match[1].trim();
      raw.split(',').forEach((part) => {
        const seg = part.trim();
        if (!seg) return;
        const name = seg.split(/\s+as\s+/i)[0].trim();
        if (name) imports.add(name);
      });
      continue;
    }
    const includeMatch = trimmed.match(/^(?:include|include_once|require|require_once)\s*(?:\(\s*)?['"]([^'"]+)['"]/i);
    if (includeMatch?.[1]) {
      imports.add(includeMatch[1].trim());
    }
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for PHP declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildPhpChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'php', options });
  if (treeChunks && treeChunks.length) return treeChunks;
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];
  const isInsideType = (offset) => typeDecls.some((entry) =>
    Number.isFinite(entry?.start) && Number.isFinite(entry?.end) &&
    entry.start < offset && entry.end > offset
  );

  const typeRe = /^\s*(?:#[^\n]*\s*)?(?:(?:abstract|final|public|protected|private)\s+)*(class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const funcRe = /^\s*(?:#[^\n]*\s*)?(?:(?:public|protected|private|static)\s+)*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  const namespaceRe = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_\\]*)\s*(?:[;{])/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
    let match = trimmed.match(namespaceRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const end = lineIndex[i] + line.length;
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature: trimmed,
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, trimmed),
        visibility: 'public',
        modifiers: []
      };
      decls.push({ start, end, name: match[1], kind: 'NamespaceDeclaration', meta });
      continue;
    }
    match = trimmed.match(typeRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const bounds = findCLikeBodyBounds(text, start);
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[i] + line.length;
      const signature = sliceSignature(text, start, bounds.bodyStart);
      const modifiers = extractPhpModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      const kindMap = {
        class: 'ClassDeclaration',
        interface: 'InterfaceDeclaration',
        trait: 'TraitDeclaration'
      };
      const entry = { start, end, name: match[2], kind: kindMap[match[1]] || 'ClassDeclaration', meta };
      decls.push(entry);
      if (match[1] === 'class' || match[1] === 'interface' || match[1] === 'trait') {
        typeDecls.push(entry);
      }
      continue;
    }
    match = trimmed.match(funcRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      if (isInsideType(start)) continue;
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const modifiers = extractPhpModifiers(signature);
      const parsed = parsePhpSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractPhpParams(signature),
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
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
      if (!trimmed.includes('function')) continue;
      const { signature, endLine: sigEndLine, hasBody } = readSignatureLines(lines, i);
      if (!signature.includes('(')) continue;
      const parsed = parsePhpSignature(signature);
      if (!parsed.name) continue;
      const start = lineIndex[i] + line.indexOf(trimmed);
      const boundsInner = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = boundsInner.bodyEnd > start ? boundsInner.bodyEnd : lineIndex[sigEndLine] + lines[sigEndLine].length;
      const modifiers = extractPhpModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        params: extractPhpParams(signature),
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
 * Build import/export/call/usage relations for PHP chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} phpChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildPhpRelations(text, phpChunks) {
  const imports = collectPhpImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(phpChunks)) {
    for (const chunk of phpChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (chunk.kind === 'NamespaceDeclaration'
        || chunk.kind === 'ClassDeclaration'
        || chunk.kind === 'InterfaceDeclaration'
        || chunk.kind === 'TraitDeclaration'
        || chunk.kind === 'FunctionDeclaration') {
        exports.add(chunk.name);
      }
      const mods = Array.isArray(chunk.meta?.modifiers) ? chunk.meta.modifiers : [];
      if (chunk.kind === 'MethodDeclaration' && mods.includes('public')) exports.add(chunk.name);
      if (!['MethodDeclaration', 'FunctionDeclaration'].includes(chunk.kind)) continue;
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectPhpCallsAndUsages(slice);
      for (const callee of chunkCalls) calls.push([chunk.name, callee]);
      for (const usage of chunkUsages) usages.add(usage);
    }
  }
  return {
    imports,
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages)
  };
}

/**
 * Normalize PHP-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],visibility:(string|null),returnType:(string|null)}}
 */
export function extractPhpDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const decorators = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
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
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}

/**
 * Heuristic control-flow/dataflow extraction for PHP chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computePhpFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripPhpComments(slice);
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
    const flowSkip = new Set([...PHP_USAGE_SKIP, 'this']);
    out.dataflow = buildHeuristicDataflow(cleaned, {
      skip: flowSkip,
      memberOperators: ['->', '::', '.']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    const throwRe = /\bthrow\b\s+(?:new\s+)?([A-Za-z_][A-Za-z0-9_\\\\]*)/g;
    let match;
    while ((match = throwRe.exec(cleaned)) !== null) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) throws.add(name);
    }
    out.throws = Array.from(throws);
    out.yields = /\byield\b/.test(cleaned);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'elseif', 'switch', 'case'],
      loopKeywords: ['for', 'foreach', 'while', 'do']
    });
  }

  return out;
}
