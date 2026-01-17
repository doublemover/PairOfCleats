import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment, sliceSignature } from './shared.js';
import { findCLikeBodyBounds } from './clike.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Rust language chunking and relations.
 * Heuristic parser for structs/enums/traits/mods/impls/fns/macros.
 */

const RUST_USAGE_SKIP = new Set([
  'fn', 'let', 'mut', 'struct', 'enum', 'trait', 'impl', 'use', 'mod', 'pub',
  'crate', 'super', 'self', 'Self', 'match', 'if', 'else', 'for', 'while',
  'loop', 'in', 'return', 'break', 'continue', 'where', 'async', 'await', 'move',
  'ref', 'const', 'static', 'unsafe', 'extern', 'dyn', 'type', 'macro_rules',
  'macro', 'as', 'box', 'yield', 'true', 'false', 'None', 'Some',
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
  const addLine = (line) => {
    for (const match of line.matchAll(/#\s*\[\s*([A-Za-z_][A-Za-z0-9_:]*)/g)) {
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

/**
 * Collect use/extern crate imports from Rust source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectRustImports(text) {
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const match = trimmed.match(macroRulesRe) || trimmed.match(macroRe);
    if (!match) continue;
    const start = lineIndex[i] + line.indexOf(match[0]);
    const bounds = findCLikeBodyBounds(text, start);
    let end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    if (bounds.bodyStart === -1) {
      end = lineIndex[i] + line.length;
    }
    const signatureEnd = bounds.bodyStart > start ? bounds.bodyStart : end;
    const signature = sliceSignature(text, start, signatureEnd);
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      modifiers: extractRustModifiers(signature),
      docstring: extractDocComment(lines, i, RUST_DOC_OPTIONS),
      attributes: collectRustAttributes(lines, i, signature)
    };
    const entry = { start, end, name: match[1], kind: 'MacroDeclaration', meta };
    macroBlocks.push(entry);
    decls.push(entry);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const match = trimmed.match(typeRe);
    if (!match) continue;
    const start = lineIndex[i] + line.indexOf(match[0]);
    if (isInsideBlock(start, macroBlocks)) continue;
    const bounds = findCLikeBodyBounds(text, start);
    let end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    if (bounds.bodyStart === -1) {
      end = lineIndex[i] + line.length;
    }
    const kindMap = {
      struct: 'StructDeclaration',
      enum: 'EnumDeclaration',
      trait: 'TraitDeclaration',
      mod: 'ModuleDeclaration'
    };
    const kind = kindMap[match[1]] || 'StructDeclaration';
    const signatureEnd = bounds.bodyStart > start ? bounds.bodyStart : end;
    const signature = sliceSignature(text, start, signatureEnd);
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      modifiers: extractRustModifiers(signature),
      docstring: extractDocComment(lines, i, RUST_DOC_OPTIONS),
      attributes: collectRustAttributes(lines, i, signature)
    };
    const entry = { start, end, name: match[2], kind, meta };
    decls.push(entry);
    if (kind !== 'ModuleDeclaration') typeDecls.push(entry);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    if (!implRe.test(trimmed)) continue;
    const start = lineIndex[i] + line.indexOf(trimmed);
    if (isInsideBlock(start, macroBlocks)) continue;
    const bounds = findCLikeBodyBounds(text, start);
    if (bounds.bodyStart === -1) continue;
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    const signatureEnd = bounds.bodyStart > start ? bounds.bodyStart : end;
    const signature = sliceSignature(text, start, signatureEnd);
    const typeName = parseRustImplTarget(signature);
    if (!typeName) continue;
    const entry = {
      start,
      end,
      name: typeName,
      kind: 'ImplDeclaration',
      meta: {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        modifiers: extractRustModifiers(signature),
        docstring: extractDocComment(lines, i, RUST_DOC_OPTIONS),
        attributes: collectRustAttributes(lines, i, signature),
        implFor: typeName
      }
    };
    implBlocks.push(entry);
    decls.push(entry);
  }

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const fnMatch = trimmed.match(fnRe);
    if (!fnMatch) continue;
    const { signature, endLine, hasBody } = readSignatureLines(lines, i);
    const start = lineIndex[i] + line.indexOf(trimmed);
    if (isInsideBlock(start, macroBlocks)) {
      i = endLine;
      continue;
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
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      params: extractRustParams(signature),
      returns: extractRustReturns(signature),
      modifiers: extractRustModifiers(signature),
      docstring: extractDocComment(lines, i, RUST_DOC_OPTIONS),
      attributes: collectRustAttributes(lines, i, signature)
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

/**
 * Build import/export/call/usage relations for Rust chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildRustRelations(text, allImports) {
  const imports = collectRustImports(text);
  const exportRe = /^\s*pub(?:\([^)]+\))?\s+(struct|enum|trait|fn|mod|const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const exports = new Set();
  for (const match of text.matchAll(exportRe)) {
    exports.add(match[2]);
  }
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports: Array.from(exports),
    calls: [],
    usages: [],
    importLinks
  };
}

/**
 * Normalize Rust-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],implFor:(string|null)}}
 */
export function extractRustDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const attributes = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    decorators: attributes,
    modifiers,
    implFor: meta.implFor || null,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
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
    for (const match of cleaned.matchAll(/\bpanic!\s*\(|\bpanic\s*\(/g)) {
      if (match) throws.add('panic');
    }
    out.throws = Array.from(throws);
    const awaits = new Set();
    for (const match of cleaned.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\.await\b/g)) {
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
