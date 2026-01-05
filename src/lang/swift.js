import { buildLineIndex, lineColToOffset, offsetToLine } from '../shared/lines.js';
import { collectAttributes, extractDocComment, isCommentLine, sliceSignature } from './shared.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * Swift language chunking and relations.
 * Heuristic parser for types, extensions, and functions.
 */

const SWIFT_DECL_KEYWORDS = new Set([
  'class', 'struct', 'enum', 'protocol', 'extension', 'actor',
  'func', 'init', 'deinit'
]);
const SWIFT_MODIFIERS = new Set([
  'public', 'private', 'fileprivate', 'internal', 'open', 'final', 'static',
  'class', 'mutating', 'nonmutating', 'override', 'convenience', 'required',
  'async', 'throws', 'rethrows', 'lazy', 'weak', 'unowned', 'inout'
]);
const SWIFT_KIND_MAP = {
  class: 'ClassDeclaration',
  struct: 'StructDeclaration',
  enum: 'EnumDeclaration',
  protocol: 'ProtocolDeclaration',
  extension: 'ExtensionDeclaration',
  actor: 'ActorDeclaration'
};

function normalizeSwiftName(raw) {
  if (!raw) return '';
  return raw.split(/[<\s:]/)[0];
}

function extractSwiftModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/);
  for (const tok of tokens) {
    if (SWIFT_DECL_KEYWORDS.has(tok)) break;
    if (SWIFT_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractSwiftParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  const parts = match[1].split(',');
  for (const part of parts) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/@[A-Za-z_][A-Za-z0-9_]*(\([^)]+\))?\s*/g, '');
    seg = seg.replace(/\b(inout|borrowing|consuming)\b\s*/g, '');
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) continue;
    const left = seg.slice(0, colonIdx).trim();
    if (!left) continue;
    const names = left.split(/\s+/).filter(Boolean);
    let name = names[names.length - 1];
    if (name === '_' && names.length > 1) name = names[names.length - 2];
    if (name && name !== '_') params.push(name);
  }
  return params;
}

function extractSwiftReturns(signature) {
  const arrow = signature.indexOf('->');
  if (arrow === -1) return null;
  let ret = signature.slice(arrow + 2).trim();
  ret = ret.replace(/\bwhere\b.*/, '').trim();
  ret = ret.replace(/\{$/, '').trim();
  return ret || null;
}

function extractSwiftConforms(signature) {
  const colon = signature.indexOf(':');
  if (colon === -1) return [];
  let tail = signature.slice(colon + 1).trim();
  tail = tail.replace(/\bwhere\b.*/, '').trim();
  tail = tail.replace(/\{$/, '').trim();
  return tail.split(',').map((t) => t.trim()).filter(Boolean);
}

function extractSwiftGenerics(signature) {
  const match = signature.match(/\b(?:class|struct|enum|protocol|extension|actor|func|init)\s+[A-Za-z_][A-Za-z0-9_\.]*\s*<([^>]+)>/);
  if (!match) return [];
  return match[1].split(',').map((item) => item.trim()).filter(Boolean);
}

function extractSwiftWhereClause(signature) {
  const match = signature.match(/\bwhere\b\s+(.+)$/);
  if (!match) return null;
  let clause = match[1].trim();
  clause = clause.replace(/\{$/, '').trim();
  return clause || null;
}

function extractSwiftExtensionTarget(signature) {
  const match = signature.match(/\bextension\s+([^\s:{]+(?:<[^>]+>)?)/);
  return match ? match[1].trim() : null;
}

function findSwiftBodyBounds(text, start) {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inTripleString = false;
  let braceDepth = 0;
  let bodyStart = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (inTripleString) {
        if (ch === '"' && text.slice(i, i + 3) === '"""') {
          inString = false;
          inTripleString = false;
          i += 2;
        }
        continue;
      }
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      if (text.slice(i, i + 3) === '"""') {
        inString = true;
        inTripleString = true;
        i += 2;
      } else {
        inString = true;
      }
      continue;
    }
    if (ch === '{') {
      if (bodyStart === -1) bodyStart = i;
      braceDepth++;
      continue;
    }
    if (ch === '}' && bodyStart !== -1) {
      braceDepth--;
      if (braceDepth === 0) {
        return { bodyStart, bodyEnd: i + 1 };
      }
    }
  }
  return { bodyStart, bodyEnd: -1 };
}

function stripSwiftComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

/**
 * Build chunk metadata for Swift declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildSwiftChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'swift', options });
  if (treeChunks && treeChunks.length) {
    const lines = text.split('\n');
    const lineIndex = buildLineIndex(text);
    const typeKinds = new Set([
      'ClassDeclaration',
      'StructDeclaration',
      'EnumDeclaration',
      'ProtocolDeclaration',
      'ExtensionDeclaration',
      'ActorDeclaration'
    ]);
    const funcSignatureRe = /\b(func|init|deinit)\b/;
    const typeSignatureRe = /\b(class|struct|enum|protocol|extension|actor)\b/;
    const resolveSignatureFallback = (startLine, keywordRe) => {
      const startIdx = Math.max(0, startLine - 1);
      const maxIdx = Math.min(lines.length, startIdx + 8);
      for (let i = startIdx; i < maxIdx; i += 1) {
        const raw = lines[i] || '';
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('///') || trimmed.startsWith('//')) continue;
        if (trimmed.startsWith('@')) continue;
        if (!keywordRe.test(trimmed)) continue;
        const offset = lineColToOffset(lineIndex, i + 1, raw.indexOf(trimmed));
        const bounds = findSwiftBodyBounds(text, offset);
        return { signature: sliceSignature(text, offset, bounds.bodyStart), line: i + 1 };
      }
      return null;
    };
    return treeChunks.map((chunk) => {
      const meta = chunk.meta || {};
      let signature = meta.signature || '';
      const startLine = Number.isFinite(meta.startLine) ? meta.startLine : 1;
      let signatureLine = startLine;
      const isType = typeKinds.has(chunk.kind);
      const keywordRe = isType ? typeSignatureRe : funcSignatureRe;
      if (signature && !keywordRe.test(signature)) {
        const fallback = resolveSignatureFallback(startLine, keywordRe);
        if (fallback?.signature) {
          signature = fallback.signature;
          signatureLine = fallback.line;
        }
      }
      const modifiers = extractSwiftModifiers(signature);
      const attributes = collectAttributes(lines, signatureLine - 1, signature);
      const params = isType ? [] : extractSwiftParams(signature);
      const returns = isType ? null : extractSwiftReturns(signature);
      const conforms = isType ? extractSwiftConforms(signature) : [];
      const generics = extractSwiftGenerics(signature);
      const whereClause = extractSwiftWhereClause(signature);
      const extendedType = chunk.kind === 'ExtensionDeclaration'
        ? extractSwiftExtensionTarget(signature)
        : null;
      return {
        ...chunk,
        meta: {
          ...meta,
          signature,
          params,
          returns,
          modifiers,
          attributes,
          conforms,
          generics,
          whereClause,
          extendedType
        }
      };
    });
  }
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(class|struct|enum|protocol|extension|actor)\s+([A-Za-z_][A-Za-z0-9_\.]*)/gm;
  const funcRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(func)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const initRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(init|deinit)\b/gm;

  const addDecl = (kindKey, rawName, start, isType) => {
    const startLine = offsetToLine(lineIndex, start);
    const line = lines[startLine - 1] || '';
    if (isCommentLine(line)) return;
    const bounds = findSwiftBodyBounds(text, start);
    const signature = sliceSignature(text, start, bounds.bodyStart);
    const name = normalizeSwiftName(rawName) || kindKey;
    const modifiers = extractSwiftModifiers(signature);
    const attributes = collectAttributes(lines, startLine - 1, signature);
    const docstring = extractDocComment(lines, startLine - 1);
    const params = isType ? [] : extractSwiftParams(signature);
    const returns = isType ? null : extractSwiftReturns(signature);
    const conforms = isType ? extractSwiftConforms(signature) : [];
    const generics = extractSwiftGenerics(signature);
    const whereClause = extractSwiftWhereClause(signature);
    const extendedType = kindKey === 'extension' ? extractSwiftExtensionTarget(signature) : null;
    const kind = isType
      ? (SWIFT_KIND_MAP[kindKey] || 'ClassDeclaration')
      : (kindKey === 'init' ? 'Initializer' : kindKey === 'deinit' ? 'Deinitializer' : 'FunctionDeclaration');
    decls.push({
      start,
      startLine,
      bodyStart: bounds.bodyStart,
      bodyEnd: bounds.bodyEnd,
      name,
      kind,
      isType,
      meta: {
        signature,
        params,
        returns,
        modifiers,
        attributes,
        docstring,
        conforms,
        generics,
        whereClause,
        extendedType
      }
    });
  };

  for (const match of text.matchAll(typeRe)) {
    addDecl(match[1], match[2], match.index, true);
  }
  for (const match of text.matchAll(funcRe)) {
    addDecl(match[1], match[2], match.index, false);
  }
  for (const match of text.matchAll(initRe)) {
    addDecl(match[1], match[1], match.index, false);
  }

  if (!decls.length) return null;
  decls.sort((a, b) => a.start - b.start);

  for (let i = 0; i < decls.length; i++) {
    const decl = decls[i];
    let end = decl.bodyEnd;
    if (!Number.isFinite(end) || end <= decl.start) {
      const nextStart = decls[i + 1] ? decls[i + 1].start : text.length;
      const lineEnd = lineIndex[decl.startLine] ?? text.length;
      end = Math.min(nextStart, lineEnd);
    }
    if (end <= decl.start) end = decls[i + 1] ? decls[i + 1].start : text.length;
    decl.end = end;
    decl.endLine = offsetToLine(lineIndex, end);
    decl.meta = { ...decl.meta, startLine: decl.startLine, endLine: decl.endLine };
  }

  const typeDecls = decls.filter((d) => d.isType);
  const findParent = (start) => {
    let parent = null;
    for (const type of typeDecls) {
      if (type.start < start && type.end > start) {
        if (!parent || type.start > parent.start) parent = type;
      }
    }
    return parent;
  };

  const chunks = [];
  for (const decl of decls) {
    if (!decl.name) continue;
    let name = decl.name;
    let kind = decl.kind;
    if (!decl.isType) {
      const parent = findParent(decl.start);
      if (parent && parent.name) {
        name = `${parent.name}.${name}`;
        if (kind === 'FunctionDeclaration') kind = 'MethodDeclaration';
      }
    }
    chunks.push({
      start: decl.start,
      end: decl.end,
      name,
      kind,
      meta: decl.meta
    });
  }
  return chunks;
}

/**
 * Collect import statements and basic usages from Swift source.
 * @param {string} text
 * @returns {{imports:string[],usages:string[]}}
 */
export function collectSwiftImports(text) {
  const imports = new Set();
  const usages = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    const match = trimmed.match(/^(?:@testable\s+)?import\s+([A-Za-z0-9_\.]+)/);
    if (!match) continue;
    imports.add(match[1]);
    const leaf = match[1].split('.').pop();
    if (leaf) usages.add(leaf);
  }
  return { imports: Array.from(imports), usages: Array.from(usages) };
}

/**
 * Build import/export/call/usage relations for Swift chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildSwiftRelations(text, allImports) {
  const { imports, usages } = collectSwiftImports(text);
  const exports = new Set();
  const declRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(class|struct|enum|protocol|extension|actor|func)\s+([A-Za-z_][A-Za-z0-9_\.]*)/gm;
  for (const match of text.matchAll(declRe)) {
    const indent = match[0].match(/^\s*/)?.[0] ?? '';
    if (indent.length) continue;
    const name = normalizeSwiftName(match[2]);
    if (name) exports.add(name);
  }
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports: Array.from(exports),
    calls: [],
    usages,
    importLinks
  };
}

/**
 * Normalize Swift-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],conforms:string[],generics:string[],whereClause:(string|null),extendedType:(string|null)}}
 */
export function extractSwiftDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const attributes = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  const conforms = Array.isArray(meta.conforms) ? meta.conforms : [];
  const generics = Array.isArray(meta.generics) ? meta.generics : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    decorators: attributes,
    modifiers,
    conforms,
    generics,
    whereClause: meta.whereClause || null,
    extendedType: meta.extendedType || null,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}

/**
 * Heuristic control-flow/dataflow extraction for Swift chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeSwiftFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findSwiftBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripSwiftComments(slice);
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
    const swiftSkip = new Set(['self', 'Self', 'nil', 'true', 'false']);
    out.dataflow = buildHeuristicDataflow(cleaned, {
      skip: swiftSkip,
      memberOperators: ['.']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    for (const match of cleaned.matchAll(/\bthrow\b\s+([A-Za-z_][A-Za-z0-9_.]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) throws.add(name);
    }
    out.throws = Array.from(throws);
    const awaits = new Set();
    for (const match of cleaned.matchAll(/\bawait\b\s+([A-Za-z_][A-Za-z0-9_.]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) awaits.add(name);
    }
    out.awaits = Array.from(awaits);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'switch', 'case', 'guard', 'catch'],
      loopKeywords: ['for', 'while', 'repeat']
    });
  }

  return out;
}
