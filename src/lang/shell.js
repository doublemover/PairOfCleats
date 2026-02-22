import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { extractDocComment, sliceSignature } from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Shell (lite) language chunking and relations.
 * Focuses on function declarations with minimal metadata.
 */

export const SHELL_RESERVED_WORDS = new Set([
  'break',
  'case',
  'continue',
  'coproc',
  'declare',
  'do',
  'done',
  'elif',
  'else',
  'esac',
  'eval',
  'exec',
  'exit',
  'export',
  'false',
  'fi',
  'for',
  'function',
  'if',
  'in',
  'local',
  'readonly',
  'return',
  'select',
  'set',
  'shift',
  'source',
  'then',
  'time',
  'trap',
  'true',
  'typeset',
  'unset',
  'until',
  'wait',
  'while'
]);

const SHELL_CALL_KEYWORDS = new Set([
  ...SHELL_RESERVED_WORDS,
  'alias',
  'cd',
  'pwd',
  'test',
  'unalias'
]);

const SHELL_USAGE_SKIP = new Set([
  ...SHELL_CALL_KEYWORDS,
  'nil',
  'no',
  'null',
  'yes'
]);

const SHELL_DOC_OPTIONS = {
  linePrefixes: ['#'],
  blockStarts: [],
  blockEnd: null,
  skipLine: (line) => line.startsWith('#!')
};

function stripShellComments(text) {
  return text.replace(/#.*$/gm, ' ');
}

function collectShellCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripShellComments(text).replace(/\\\n/g, ' ');
  const callRe = /(?:^|[;&|]\s*|&&\s*|\|\|\s*)\s*([A-Za-z_][A-Za-z0-9_-]*)/gm;
  let match;
  while ((match = callRe.exec(normalized)) !== null) {
    const name = match[1];
    if (!name || SHELL_CALL_KEYWORDS.has(name)) continue;
    calls.add(name);
    if (!match[0]) callRe.lastIndex += 1;
  }
  const usageRe = /\b([A-Za-z_][A-Za-z0-9_-]*)\b/g;
  while ((match = usageRe.exec(normalized)) !== null) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (SHELL_USAGE_SKIP.has(name)) continue;
    usages.add(name);
    if (!match[0]) usageRe.lastIndex += 1;
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Collect source/. imports from shell scripts.
 * @param {string} text
 * @returns {string[]}
 */
export function collectShellImports(text) {
  if (!text || (!text.includes('source') && !text.includes('. ') && !text.includes('.\t'))) return [];
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
export function buildShellChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'shell', options });
  if (treeChunks && treeChunks.length) return treeChunks;
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
    const sigData = readSignatureLines(lines, i, { stopOnSemicolon: false });
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
      docstring: extractDocComment(lines, i, SHELL_DOC_OPTIONS)
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
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} shellChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildShellRelations(text, shellChunks) {
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
  return {
    imports,
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages)
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
 * Heuristic control-flow/dataflow extraction for shell chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeShellFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripShellComments(slice).replace(/\\\n/g, ' ');
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
      skip: SHELL_USAGE_SKIP,
      identifierRegex: /\b([A-Za-z_][A-Za-z0-9_-]*)\b/g,
      memberOperators: []
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    const exitRe = /\bexit\b/g;
    if (exitRe.test(cleaned)) throws.add('exit');
    out.throws = Array.from(throws);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'then', 'elif', 'else', 'case'],
      loopKeywords: ['for', 'while', 'until', 'select'],
      returnKeywords: ['return']
    });
  }

  return out;
}
