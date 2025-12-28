import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { sliceSignature } from './shared.js';

/**
 * Perl (lite) language chunking and relations.
 * Focuses on package and sub declarations with minimal metadata.
 */

const PERL_CALL_KEYWORDS = new Set([
  'if', 'for', 'foreach', 'while', 'until', 'return', 'sub', 'my', 'our',
  'use', 'package', 'require', 'else', 'elsif', 'do', 'given', 'when'
]);

const PERL_USAGE_SKIP = new Set([
  ...PERL_CALL_KEYWORDS,
  'undef', 'true', 'false'
]);

function extractPerlDocComment(lines, startLineIdx) {
  let i = startLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return '';
  const out = [];
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('#')) break;
    if (trimmed.startsWith('#!')) break;
    out.unshift(trimmed.replace(/^#\s?/, ''));
    i--;
  }
  return out.join('\n').trim();
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

function stripPerlComments(text) {
  return text.replace(/#.*$/gm, ' ');
}

function collectPerlCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripPerlComments(text).replace(/->/g, '::');
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_:]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split('::').filter(Boolean).pop();
    if (!base || PERL_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (PERL_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Collect use/require imports from Perl source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectPerlImports(text) {
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
export function buildPerlChunks(text) {
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
      docstring: extractPerlDocComment(lines, i)
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
      docstring: extractPerlDocComment(lines, i)
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
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} perlChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildPerlRelations(text, allImports, perlChunks) {
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
    signature: meta.signature || null
  };
}
