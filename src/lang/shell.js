import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { sliceSignature } from './shared.js';

/**
 * Shell (lite) language chunking and relations.
 * Focuses on function declarations with minimal metadata.
 */

const SHELL_CALL_KEYWORDS = new Set([
  'if', 'then', 'fi', 'elif', 'else', 'for', 'in', 'do', 'done', 'while', 'until',
  'case', 'esac', 'select', 'function', 'return', 'break', 'continue', 'shift',
  'local', 'export', 'readonly', 'declare', 'typeset', 'set', 'unset', 'trap',
  'alias', 'unalias', 'source', 'eval', 'exec', 'exit', 'cd', 'pwd', 'true', 'false',
  'test', '[', '[[', 'time'
]);

const SHELL_USAGE_SKIP = new Set([
  ...SHELL_CALL_KEYWORDS,
  'nil', 'null', 'yes', 'no'
]);

function extractShellDocComment(lines, startLineIdx) {
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
  let endLine = startLine;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    parts.push(line.trim());
    if (line.includes('{')) {
      hasBrace = true;
      endLine = i;
      break;
    }
    endLine = i;
  }
  const signature = parts.join(' ');
  return { signature, endLine, hasBody: hasBrace };
}

function stripShellComments(text) {
  return text.replace(/#.*$/gm, ' ');
}

function collectShellCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripShellComments(text).replace(/\\\n/g, ' ');
  const callRe = /(?:^|[;&|]\s*|&&\s*|\|\|\s*)\s*([A-Za-z_][A-Za-z0-9_-]*)/gm;
  for (const match of normalized.matchAll(callRe)) {
    const name = match[1];
    if (!name || SHELL_CALL_KEYWORDS.has(name)) continue;
    calls.add(name);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_-]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (SHELL_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Collect source/. imports from shell scripts.
 * @param {string} text
 * @returns {string[]}
 */
export function collectShellImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:source|\.)\s+(.+)$/);
    if (!match) continue;
    let target = match[1].trim();
    if (!target) continue;
    target = target.replace(/^[\"']/, '').replace(/[\"']$/, '');
    target = target.split(/\s+/)[0];
    if (target) imports.add(target);
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for shell function declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildShellChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];

  const funcKwRe = /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?/;
  const funcParenRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let match = trimmed.match(funcKwRe);
    if (!match) match = trimmed.match(funcParenRe);
    if (!match) continue;
    const sigData = readSignatureLines(lines, i);
    const signature = sigData.signature;
    const endLine = sigData.endLine;
    const hasBody = sigData.hasBody;
    if (!hasBody) {
      i = endLine;
      continue;
    }
    if (!match) continue;
    const name = match[1];
    if (!name) {
      i = endLine;
      continue;
    }
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const signatureText = bounds.bodyStart > start ? sliceSignature(text, start, bounds.bodyStart) : signature;
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature: signatureText || trimmed,
      docstring: extractShellDocComment(lines, i)
    };
    decls.push({ start, end, name, kind: 'FunctionDeclaration', meta });
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
 * Build import/export/call/usage relations for shell chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} shellChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildShellRelations(text, allImports, shellChunks) {
  const imports = collectShellImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(shellChunks)) {
    for (const chunk of shellChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (chunk.kind === 'FunctionDeclaration') exports.add(chunk.name);
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectShellCallsAndUsages(slice);
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
 * Normalize shell-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractShellDocMeta(chunk) {
  const meta = chunk.meta || {};
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params: [],
    returns: null,
    signature: meta.signature || null
  };
}
