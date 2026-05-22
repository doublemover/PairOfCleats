import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import {
  buildBraceDelimitedMethodRelations,
  buildDefaultDocMeta,
  collectDottedCallsAndUsages,
  extractDocComment,
  normalizeDeclarationList,
  sliceSignature
} from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Go language chunking and relations.
 * Heuristic parser focused on top-level types, functions, and methods.
 */

export const GO_RESERVED_WORDS = new Set([
  'any',
  'append',
  'bool',
  'break',
  'byte',
  'cap',
  'case',
  'chan',
  'close',
  'complex',
  'complex128',
  'complex64',
  'const',
  'continue',
  'copy',
  'default',
  'defer',
  'delete',
  'else',
  'error',
  'fallthrough',
  'false',
  'float32',
  'float64',
  'for',
  'func',
  'go',
  'goto',
  'if',
  'imag',
  'import',
  'int',
  'int16',
  'int32',
  'int64',
  'int8',
  'interface',
  'iota',
  'len',
  'make',
  'map',
  'new',
  'nil',
  'package',
  'panic',
  'print',
  'println',
  'range',
  'real',
  'recover',
  'return',
  'rune',
  'select',
  'string',
  'struct',
  'switch',
  'true',
  'type',
  'uint',
  'uint16',
  'uint32',
  'uint64',
  'uint8',
  'uintptr',
  'var'
]);

const GO_CALL_KEYWORDS = new Set([
  ...GO_RESERVED_WORDS
]);

const GO_USAGE_SKIP = new Set([
  ...GO_RESERVED_WORDS
]);

const GO_DOC_OPTIONS = {
  linePrefixes: ['//'],
  blockStarts: ['/*'],
  blockEnd: '*/',
  skipLine: (line) => line.startsWith('//go:') || line.startsWith('// +build')
};

const GO_CALLABLE_KINDS = new Set(['FunctionDeclaration', 'MethodDeclaration']);

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
  return collectDottedCallsAndUsages(text, {
    callKeywords: GO_CALL_KEYWORDS,
    usageSkip: GO_USAGE_SKIP,
    stripComments: stripGoComments
  });
}

/**
 * Collect import paths from Go source text.
 * Handles single-line imports and import blocks.
 * @param {string} text
 * @returns {string[]}
 */
export function collectGoImports(text) {
  if (!text || !text.includes('import')) return [];
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
  if (treeChunks && treeChunks.length) {
    return treeChunks.map((chunk) => {
      const meta = chunk.meta || {};
      const signature = meta.signature || '';
      return {
        ...chunk,
        meta: {
          ...meta,
          signature,
          params: extractGoParams(signature),
          returns: extractGoReturns(signature)
        }
      };
    });
  }
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
      const signatureEnd = bounds.bodyStart > start ? bounds.bodyStart : end;
      const signature = sliceSignature(text, start, signatureEnd);
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
    const { signature, endLine, hasBody } = readSignatureLines(lines, i, { stopOnSemicolon: false });
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

  return normalizeDeclarationList(decls);
}

/**
 * Build import/export/call/usage relations for Go chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} goChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildGoRelations(text, goChunks) {
  return buildBraceDelimitedMethodRelations(text, goChunks, {
    collectImports: collectGoImports,
    collectCallsAndUsages: collectGoCallsAndUsages,
    findBodyBounds: findCLikeBodyBounds,
    callableKinds: GO_CALLABLE_KINDS,
    isExported: (chunk) => {
      const base = chunk.name.split('.').pop();
      return Boolean(base && /^[A-Z]/.test(base));
    }
  });
}

/**
 * Normalize Go-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractGoDocMeta(chunk) {
  return buildDefaultDocMeta(chunk);
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
    const panicRe = /\bpanic\s*\(/g;
    if (panicRe.test(cleaned)) throws.add('panic');
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
