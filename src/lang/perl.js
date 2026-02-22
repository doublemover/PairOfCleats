import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { findCLikeBodyBounds } from './clike.js';
import { extractDocComment, sliceSignature } from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Perl (lite) language chunking and relations.
 * Focuses on package and sub declarations with minimal metadata.
 */

export const PERL_RESERVED_WORDS = new Set([
  'BEGIN',
  'CHECK',
  'END',
  'INIT',
  'UNITCHECK',
  'continue',
  'default',
  'die',
  'do',
  'else',
  'elsif',
  'for',
  'foreach',
  'given',
  'goto',
  'if',
  'last',
  'my',
  'next',
  'our',
  'package',
  'print',
  'redo',
  'return',
  'say',
  'sub',
  'unless',
  'until',
  'use',
  'warn',
  'when',
  'while'
]);

const PERL_CALL_KEYWORDS = new Set([
  ...PERL_RESERVED_WORDS
]);

const PERL_USAGE_SKIP = new Set([
  ...PERL_RESERVED_WORDS,
  'false',
  'true',
  'undef'
]);

const PERL_DOC_OPTIONS = {
  linePrefixes: ['#'],
  blockStarts: [],
  blockEnd: null,
  skipLine: (line) => line.startsWith('#!')
};

function stripPerlComments(text) {
  return text.replace(/#.*$/gm, ' ');
}

function getLastDoubleColonSegment(raw) {
  if (!raw) return '';
  let end = raw.length;
  while (end > 0 && raw[end - 1] === ':') end -= 1;
  if (!end) return '';
  const idx = raw.lastIndexOf('::', end - 1);
  return idx === -1 ? raw.slice(0, end) : raw.slice(idx + 2, end);
}

function collectPerlCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripPerlComments(text).replace(/->/g, '::');
  const callRe = /\b([A-Za-z_][A-Za-z0-9_:]*)\s*\(/g;
  let match;
  while ((match = callRe.exec(normalized)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const base = getLastDoubleColonSegment(raw);
    if (!base || PERL_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
    if (!match[0]) callRe.lastIndex += 1;
  }
  const usageRe = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((match = usageRe.exec(normalized)) !== null) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (PERL_USAGE_SKIP.has(name)) continue;
    usages.add(name);
    if (!match[0]) usageRe.lastIndex += 1;
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Collect use/require imports from Perl source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectPerlImports(text) {
  if (!text || (!text.includes('use ') && !text.includes('require'))) return [];
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let match = trimmed.match(/^use\s+([A-Za-z_][A-Za-z0-9_:]*)/);
    if (match) {
      imports.add(match[1]);
      continue;
    }
    match = trimmed.match(/^require\s+([A-Za-z_][A-Za-z0-9_:]*)/);
    if (match) {
      imports.add(match[1]);
    }
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for Perl package and sub declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildPerlChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'perl', options });
  if (treeChunks && treeChunks.length) return treeChunks;
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];

  const packageRe = /^\s*package\s+([A-Za-z_][A-Za-z0-9_:]*)/;
  const subRe = /^\s*sub\s+([A-Za-z_][A-Za-z0-9_:]*)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(packageRe);
    if (!match) continue;
    const start = lineIndex[i] + line.indexOf(match[0]);
    const end = lineIndex[i] + line.length;
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature: trimmed,
      docstring: extractDocComment(lines, i, PERL_DOC_OPTIONS)
    };
    decls.push({ start, end, name: match[1], kind: 'PackageDeclaration', meta });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(subRe);
    if (!match) continue;
    const { signature, endLine, hasBody } = readSignatureLines(lines, i);
    const start = lineIndex[i] + line.indexOf(match[0]);
    const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const signatureText = bounds.bodyStart > start ? sliceSignature(text, start, bounds.bodyStart) : signature;
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature: signatureText,
      docstring: extractDocComment(lines, i, PERL_DOC_OPTIONS)
    };
    decls.push({ start, end, name: match[1], kind: 'FunctionDeclaration', meta });
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
 * Build import/export/call/usage relations for Perl chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} perlChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildPerlRelations(text, perlChunks) {
  const imports = collectPerlImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(perlChunks)) {
    for (const chunk of perlChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (chunk.kind === 'FunctionDeclaration') exports.add(chunk.name);
      if (chunk.kind !== 'FunctionDeclaration') continue;
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectPerlCallsAndUsages(slice);
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
 * Normalize Perl-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractPerlDocMeta(chunk) {
  const meta = chunk.meta || {};
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params: [],
    returns: null,
    signature: meta.signature || null,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}

/**
 * Heuristic control-flow/dataflow extraction for Perl chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computePerlFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const slice = text.slice(chunk.start, chunk.end);
  const cleaned = stripPerlComments(slice);
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
      skip: PERL_USAGE_SKIP,
      identifierRegex: /\b([A-Za-z_][A-Za-z0-9_:]*)\b/g,
      memberOperators: ['::', '->', '.']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    const dieRe = /\bdie\b\s*['\"]?([A-Za-z_][A-Za-z0-9_:]*)?/g;
    let match;
    while ((match = dieRe.exec(cleaned)) !== null) {
      const name = (match[1] || 'die').replace(/[({].*$/, '').trim();
      if (name) throws.add(name);
    }
    out.throws = Array.from(throws);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'elsif', 'else', 'unless', 'given', 'when'],
      loopKeywords: ['for', 'foreach', 'while', 'until']
    });
  }

  return out;
}
