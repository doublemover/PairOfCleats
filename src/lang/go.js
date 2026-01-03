import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { extractDocComment, sliceSignature } from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Go language chunking and relations.
 * Heuristic parser focused on top-level types, functions, and methods.
 */

const GO_CALL_KEYWORDS = new Set([
  'if', 'for', 'switch', 'case', 'return', 'func', 'go', 'defer', 'range', 'select',
  'type', 'struct', 'interface', 'map', 'chan', 'var', 'const', 'package',
  'break', 'continue', 'fallthrough', 'default', 'make', 'new', 'len', 'cap',
  'append', 'delete', 'copy', 'close', 'panic', 'recover', 'print', 'println'
]);

const GO_USAGE_SKIP = new Set([
  ...GO_CALL_KEYWORDS,
  'bool', 'byte', 'rune', 'string', 'int', 'int8', 'int16', 'int32', 'int64',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'float32', 'float64', 'complex64', 'complex128', 'error', 'any',
  'nil', 'true', 'false'
]);

const GO_DOC_OPTIONS = {
  linePrefixes: ['//'],
  blockStarts: ['/*'],
  blockEnd: '*/',
  skipLine: (line) => line.startsWith('//go:') || line.startsWith('// +build')
};

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

function normalizeGoReceiverType(raw) {
  if (!raw) return '';
  let text = raw.trim();
  text = text.replace(/^([A-Za-z_][A-Za-z0-9_]*\s+)?/, '');
  text = text.replace(/^(\*|\[\])+/g, '');
  text = text.replace(/\[.*\]/g, '');
  text = text.replace(/[^A-Za-z0-9_.]/g, '');
  if (!text) return '';
  if (text.includes('.')) return text.split('.').pop();
  return text;
}

function extractGoParams(signature) {
  const methodMatch = signature.match(/\bfunc\s*\([^)]*\)\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\[[^\]]+\])?\s*\(([^)]*)\)/);
  const funcMatch = signature.match(/\bfunc\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:\[[^\]]+\])?\s*\(([^)]*)\)/);
  const paramsString = methodMatch ? methodMatch[1] : (funcMatch ? funcMatch[1] : '');
  if (!paramsString) return [];
  const params = [];
  for (const part of paramsString.split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/^\.{3}/, '').trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].replace(/[^A-Za-z0-9_]/g, '');
    if (!name || name === '_' || !/^[A-Za-z_]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

function extractGoReturns(signature) {
  const braceIdx = signature.indexOf('{');
  const pre = braceIdx === -1 ? signature.trim() : signature.slice(0, braceIdx).trim();
  const lastParen = pre.lastIndexOf(')');
  if (lastParen === -1) return null;
  let ret = pre.slice(lastParen + 1).trim();
  if (!ret) return null;
  if (ret.startsWith('(') && ret.endsWith(')')) {
    ret = ret.slice(1, -1).trim();
  }
  return ret || null;
}

function stripGoComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function collectGoCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripGoComments(text);
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split('.').filter(Boolean).pop();
    if (!base || GO_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (GO_USAGE_SKIP.has(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Collect import paths from Go source text.
 * Handles single-line imports and import blocks.
 * @param {string} text
 * @returns {string[]}
 */
export function collectGoImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!inBlock) {
      if (trimmed.startsWith('import (')) {
        inBlock = true;
        continue;
      }
      const match = trimmed.match(/^import\s+(?:[A-Za-z_][A-Za-z0-9_]*|_|\.)?\s*"([^"]+)"/);
      if (match) imports.add(match[1]);
      continue;
    }
    if (trimmed.startsWith(')')) {
      inBlock = false;
      continue;
    }
    const match = trimmed.match(/^(?:[A-Za-z_][A-Za-z0-9_]*|_|\.)?\s*"([^"]+)"/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for Go declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildGoChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'go', options });
  if (treeChunks && treeChunks.length) return treeChunks;
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];

  const typeRe = /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b/;
  const aliasRe = /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\b/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const match = trimmed.match(typeRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const bounds = findCLikeBodyBounds(text, start);
      let end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
      if (bounds.bodyStart === -1) {
        end = lineIndex[i] + line.length;
      }
      const signature = sliceSignature(text, start, bounds.bodyStart);
      const kind = match[2] === 'struct' ? 'StructDeclaration' : 'InterfaceDeclaration';
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        docstring: extractDocComment(lines, i, GO_DOC_OPTIONS)
      };
      decls.push({ start, end, name: match[1], kind, meta });
      continue;
    }
    const aliasMatch = trimmed.match(aliasRe);
    if (aliasMatch) {
      const start = lineIndex[i] + line.indexOf(aliasMatch[0]);
      const end = lineIndex[i] + line.length;
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature: trimmed,
        docstring: extractDocComment(lines, i, GO_DOC_OPTIONS)
      };
      decls.push({ start, end, name: aliasMatch[1], kind: 'TypeAliasDeclaration', meta });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    if (!trimmed.startsWith('func')) continue;
    const { signature, endLine, hasBody } = readSignatureLines(lines, i);
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const signatureText = bounds.bodyStart > start ? sliceSignature(text, start, bounds.bodyStart) : signature;
    const methodMatch = signature.match(/\bfunc\s*\(([^)]*)\)\s*([A-Za-z_][A-Za-z0-9_]*)/);
    let name = '';
    let kind = 'FunctionDeclaration';
    if (methodMatch) {
      const receiver = normalizeGoReceiverType(methodMatch[1]);
      name = methodMatch[2];
      if (receiver) {
        name = `${receiver}.${name}`;
        kind = 'MethodDeclaration';
      }
    } else {
      const fnMatch = signature.match(/\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (fnMatch) name = fnMatch[1];
    }
    if (!name) {
      i = endLine;
      continue;
    }
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature: signatureText,
      params: extractGoParams(signature),
      returns: extractGoReturns(signature),
      docstring: extractDocComment(lines, i, GO_DOC_OPTIONS)
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
 * Build import/export/call/usage relations for Go chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} goChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildGoRelations(text, allImports, goChunks) {
  const imports = collectGoImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(goChunks)) {
    for (const chunk of goChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      const base = chunk.name.split('.').pop();
      if (base && /^[A-Z]/.test(base)) exports.add(chunk.name);
      if (!['FunctionDeclaration', 'MethodDeclaration'].includes(chunk.kind)) continue;
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectGoCallsAndUsages(slice);
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
 * Normalize Go-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractGoDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
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
 * Heuristic control-flow/dataflow extraction for Go chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeGoFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripGoComments(slice);
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
      skip: GO_USAGE_SKIP,
      memberOperators: ['.']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    for (const match of cleaned.matchAll(/\bpanic\s*\(/g)) {
      if (match) throws.add('panic');
    }
    out.throws = Array.from(throws);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'switch', 'case', 'select'],
      loopKeywords: ['for', 'range'],
      returnKeywords: ['return']
    });
  }

  return out;
}
