import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import {
  buildDefaultDocMeta,
  extractDocComment,
  normalizeDeclarationList,
  sliceSignature
} from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { findCLikeBodyBounds } from './clike.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Rust language chunking and relations.
 * Heuristic parser for structs/enums/traits/mods/impls/fns/macros.
 */

export const RUST_RESERVED_WORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'become',
  'box',
  'break',
  'const',
  'continue',
  'crate',
  'default',
  'do',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'final',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'macro',
  'macro_rules',
  'match',
  'mod',
  'move',
  'mut',
  'override',
  'priv',
  'pub',
  'ref',
  'return',
  'self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'try',
  'type',
  'typeof',
  'union',
  'unsafe',
  'unsized',
  'use',
  'virtual',
  'where',
  'while',
  'yield'
]);

const RUST_USAGE_SKIP = new Set([
  ...RUST_RESERVED_WORDS,
  'Self',
  'None',
  'Some',
  'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
  'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
  'f32', 'f64', 'bool', 'str', 'String'
]);

const RUST_DOC_OPTIONS = {
  linePrefixes: ['///', '//!'],
  blockStarts: ['/**', '/*!'],
  blockEnd: '*/'
};

function collectRustAttributes(lines, startLineIdx, signature) {
  const attrs = new Set();
  const attrRe = /#\s*\[\s*([A-Za-z_][A-Za-z0-9_:]*)/g;
  const addLine = (line) => {
    attrRe.lastIndex = 0;
    let match;
    while ((match = attrRe.exec(line)) !== null) {
      attrs.add(match[1]);
    }
  };
  if (signature) addLine(signature);
  let i = startLineIdx - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (attrs.size) break;
      i--;
      continue;
    }
    if (trimmed.startsWith('#[')) {
      addLine(trimmed);
      i--;
      continue;
    }
    if (trimmed.startsWith('///') || trimmed.startsWith('//!') || trimmed.startsWith('/*')
      || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      i--;
      continue;
    }
    break;
  }
  return Array.from(attrs);
}

function extractRustModifiers(signature) {
  const mods = [];
  const pubMatch = signature.match(/\bpub(?:\([^)]+\))?/);
  if (pubMatch) mods.push(pubMatch[0]);
  if (/\basync\b/.test(signature)) mods.push('async');
  if (/\bunsafe\b/.test(signature)) mods.push('unsafe');
  if (/\bconst\b/.test(signature)) mods.push('const');
  return mods;
}

function stripRustComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function extractRustParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    if (/\bself\b/.test(seg)) {
      params.push('self');
      continue;
    }
    seg = seg.replace(/^&\s*/, '').replace(/\bmut\s+/, '');
    const namePart = seg.split(':')[0].trim();
    if (!namePart) continue;
    const tokens = namePart.split(/\s+/).filter(Boolean);
    let name = tokens[tokens.length - 1];
    if (!name || name === '_') continue;
    name = name.replace(/[()]/g, '');
    params.push(name);
  }
  return params;
}

function extractRustReturns(signature) {
  const arrow = signature.indexOf('->');
  if (arrow === -1) return null;
  let ret = signature.slice(arrow + 2);
  ret = ret.replace(/\{.*$/, '').replace(/\bwhere\b.*/, '').replace(/;.*$/, '').trim();
  return ret || null;
}

function normalizeRustTypeName(raw) {
  if (!raw) return '';
  let name = raw.trim();
  name = name.replace(/^[<\s]+/, '');
  name = name.replace(/<.*$/, '');
  name = name.replace(/\bwhere\b.*/, '');
  name = name.replace(/[^A-Za-z0-9_:]/g, '');
  return name;
}

function parseRustImplTarget(signature) {
  let rest = signature.replace(/^\s*pub(?:\([^)]+\))?\s+/, '').trim();
  rest = rest.replace(/^\s*impl\s+/, '');
  rest = rest.replace(/\{.*$/, '').trim();
  const forMatch = rest.match(/\bfor\s+([A-Za-z_][A-Za-z0-9_:<>]*)/);
  if (forMatch) return normalizeRustTypeName(forMatch[1]);
  const match = rest.match(/([A-Za-z_][A-Za-z0-9_:<>]*)\s*(?:where\b|$)/);
  return match ? normalizeRustTypeName(match[1]) : '';
}

function resolveRustDeclarationSignature({ text, line, lineIndex, lineNumber, start, bounds }) {
  let end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
  if (bounds.bodyStart === -1) {
    end = lineIndex[lineNumber] + line.length;
  }
  const signatureEnd = bounds.bodyStart > start ? bounds.bodyStart : end;
  return {
    end,
    signature: sliceSignature(text, start, signatureEnd)
  };
}

function buildRustDeclarationMeta({ text, line, lines, lineIndex, lineNumber, start, bounds }) {
  const { end, signature } = resolveRustDeclarationSignature({
    text,
    line,
    lineIndex,
    lineNumber,
    start,
    bounds
  });
  return {
    end,
    signature,
    meta: {
      startLine: lineNumber + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      modifiers: extractRustModifiers(signature),
      docstring: extractDocComment(lines, lineNumber, RUST_DOC_OPTIONS),
      attributes: collectRustAttributes(lines, lineNumber, signature)
    }
  };
}

function buildRustDeclarationEntry({
  text,
  line,
  lines,
  lineIndex,
  lineNumber,
  start,
  bounds,
  name,
  kind,
  extraMeta = null
}) {
  const { end, meta } = buildRustDeclarationMeta({
    text,
    line,
    lines,
    lineIndex,
    lineNumber,
    start,
    bounds
  });
  return {
    start,
    end,
    name,
    kind,
    meta: extraMeta ? { ...meta, ...extraMeta } : meta
  };
}

function normalizeRustCandidateLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    return '';
  }
  return trimmed;
}

function forEachRustCandidateLine(lines, visit) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = normalizeRustCandidateLine(line);
    if (!trimmed) continue;
    const nextLine = visit({
      line,
      trimmed,
      lineNumber: i
    });
    if (Number.isInteger(nextLine) && nextLine > i) {
      i = nextLine;
    }
  }
}

/**
 * Collect use/extern crate imports from Rust source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectRustImports(text) {
  if (!text || (!text.includes('use ') && !text.includes('extern crate'))) return [];
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    let match = trimmed.match(/^(?:pub\s+)?use\s+([^;]+);/);
    if (match) {
      let path = match[1].split(/\s+as\s+/)[0].trim();
      path = path.replace(/\{.*\}/, '').replace(/::\*$/, '').replace(/::\s*$/, '').trim();
      if (path) imports.add(path);
      continue;
    }
    match = trimmed.match(/^extern\s+crate\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for Rust declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildRustChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'rust', options });
  if (treeChunks && treeChunks.length) {
    const lines = text.split('\n');
    return treeChunks.map((chunk) => {
      const meta = chunk.meta || {};
      const signature = meta.signature || '';
      const startLine = Number.isFinite(meta.startLine) ? meta.startLine : 1;
      return {
        ...chunk,
        meta: {
          ...meta,
          signature,
          params: extractRustParams(signature),
          returns: extractRustReturns(signature),
          modifiers: extractRustModifiers(signature),
          attributes: collectRustAttributes(lines, startLine - 1, signature)
        }
      };
    });
  }
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];
  const implBlocks = [];
  const macroBlocks = [];
  const typeRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?(struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const implRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?impl\b/;
  const fnRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const macroRulesRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?macro_rules!\s*([A-Za-z_][A-Za-z0-9_]*)/;
  const macroRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?macro\s+([A-Za-z_][A-Za-z0-9_]*)/;

  const isInsideBlock = (pos, blocks) =>
    blocks.some((block) => Number.isFinite(block.start) && Number.isFinite(block.end)
      && pos >= block.start && pos <= block.end);

  forEachRustCandidateLine(lines, ({ line, trimmed, lineNumber }) => {
    const match = trimmed.match(macroRulesRe) || trimmed.match(macroRe);
    if (!match) return;
    const start = lineIndex[lineNumber] + line.indexOf(match[0]);
    const bounds = findCLikeBodyBounds(text, start);
    const entry = buildRustDeclarationEntry({
      text,
      line,
      lines,
      lineIndex,
      lineNumber,
      start,
      bounds,
      name: match[1],
      kind: 'MacroDeclaration'
    });
    macroBlocks.push(entry);
    decls.push(entry);
  });

  forEachRustCandidateLine(lines, ({ line, trimmed, lineNumber }) => {
    const match = trimmed.match(typeRe);
    if (!match) return;
    const start = lineIndex[lineNumber] + line.indexOf(match[0]);
    if (isInsideBlock(start, macroBlocks)) return;
    const bounds = findCLikeBodyBounds(text, start);
    const kindMap = {
      struct: 'StructDeclaration',
      enum: 'EnumDeclaration',
      trait: 'TraitDeclaration',
      mod: 'ModuleDeclaration'
    };
    const kind = kindMap[match[1]] || 'StructDeclaration';
    const entry = buildRustDeclarationEntry({
      text,
      line,
      lines,
      lineIndex,
      lineNumber,
      start,
      bounds,
      name: match[2],
      kind
    });
    decls.push(entry);
    if (kind !== 'ModuleDeclaration') typeDecls.push(entry);
  });

  forEachRustCandidateLine(lines, ({ line, trimmed, lineNumber }) => {
    if (!implRe.test(trimmed)) return;
    const start = lineIndex[lineNumber] + line.indexOf(trimmed);
    if (isInsideBlock(start, macroBlocks)) return;
    const bounds = findCLikeBodyBounds(text, start);
    if (bounds.bodyStart === -1) return;
    const { end, meta } = buildRustDeclarationMeta({
      text,
      line,
      lines,
      lineIndex,
      lineNumber,
      start,
      bounds
    });
    const typeName = parseRustImplTarget(meta.signature);
    if (!typeName) return;
    const entry = { start, end, name: typeName, kind: 'ImplDeclaration', meta: { ...meta, implFor: typeName } };
    implBlocks.push(entry);
    decls.push(entry);
  });

  const allParents = [...typeDecls, ...implBlocks];
  const findParent = (start) => {
    let parent = null;
    for (const type of allParents) {
      if (type.start < start && type.end > start) {
        if (!parent || type.start > parent.start) parent = type;
      }
    }
    return parent;
  };

  forEachRustCandidateLine(lines, ({ line, trimmed, lineNumber }) => {
    const fnMatch = trimmed.match(fnRe);
    if (!fnMatch) return;
    const { signature, endLine, hasBody } = readSignatureLines(lines, lineNumber);
    const start = lineIndex[lineNumber] + line.indexOf(trimmed);
    if (isInsideBlock(start, macroBlocks)) {
      return endLine;
    }
    const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const parent = findParent(start);
    let name = fnMatch[1];
    let kind = 'FunctionDeclaration';
    if (parent && parent.name) {
      if (parent.kind === 'ImplDeclaration' || parent.kind === 'TraitDeclaration' || parent.kind === 'StructDeclaration') {
        name = `${parent.name}.${name}`;
        kind = 'MethodDeclaration';
      }
    }
    const meta = {
      startLine: lineNumber + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      params: extractRustParams(signature),
      returns: extractRustReturns(signature),
      modifiers: extractRustModifiers(signature),
      docstring: extractDocComment(lines, lineNumber, RUST_DOC_OPTIONS),
      attributes: collectRustAttributes(lines, lineNumber, signature)
    };
    decls.push({ start, end, name, kind, meta });
    return endLine;
  });

  return normalizeDeclarationList(decls);
}


/**
 * Build import/export/call/usage relations for Rust chunks.
 * @param {string} text
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildRustRelations(text) {
  const imports = collectRustImports(text);
  const exportRe = /^\s*pub(?:\([^)]+\))?\s+(struct|enum|trait|fn|mod|const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const exports = new Set();
  let match;
  while ((match = exportRe.exec(text)) !== null) {
    exports.add(match[2]);
  }
  return {
    imports,
    exports: Array.from(exports),
    calls: [],
    usages: []
  };
}

/**
 * Normalize Rust-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],implFor:(string|null)}}
 */
export function extractRustDocMeta(chunk) {
  return buildDefaultDocMeta(chunk, {
    decoratorsFrom: 'attributes',
    includeModifiers: true,
    includeImplFor: true
  });
}

/**
 * Heuristic control-flow/dataflow extraction for Rust chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeRustFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripRustComments(slice);
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
      skip: RUST_USAGE_SKIP,
      memberOperators: ['.', '::']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    const panicRe = /\bpanic!\s*\(|\bpanic\s*\(/g;
    if (panicRe.test(cleaned)) throws.add('panic');
    out.throws = Array.from(throws);
    const awaits = new Set();
    const awaitRe = /([A-Za-z_][A-Za-z0-9_.]*)\s*\.await\b/g;
    let match;
    while ((match = awaitRe.exec(cleaned)) !== null) {
      const name = match[1].trim();
      if (name) awaits.add(name);
    }
    out.awaits = Array.from(awaits);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'match'],
      loopKeywords: ['for', 'while', 'loop'],
      returnKeywords: ['return']
    });
  }

  return out;
}
