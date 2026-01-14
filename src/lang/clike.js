import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { collectAttributes, extractDocComment, isCommentLine, sliceSignature } from './shared.js';
import {
  CLIKE_CALL_KEYWORDS,
  CLIKE_EXPORT_KINDS,
  CLIKE_MODIFIERS,
  CLIKE_SKIP_PREFIXES,
  CLIKE_TYPE_MAP,
  CLIKE_USAGE_SKIP,
  OBJC_TYPE_MAP,
  isCLike,
  isObjc
} from '../index/constants.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';

/**
 * C-like language chunking and relations.
 * Supports C/C++/ObjC declarations with heuristic parsing.
 */

function normalizeCLikeTypeName(raw) {
  if (!raw) return '';
  return raw.split(/[<\s:]/)[0];
}

function normalizeCLikeFuncName(raw) {
  if (!raw) return '';
  return raw.split(/[<\s]/)[0];
}

/**
 * Find the body bounds for a brace-delimited declaration.
 * @param {string} text
 * @param {number} start
 * @returns {{bodyStart:number,bodyEnd:number}}
 */
export function findCLikeBodyBounds(text, start) {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inChar = false;
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
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (inChar) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '\'') inChar = false;
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
      inString = true;
      continue;
    }
    if (ch === '\'') {
      inChar = true;
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

function findObjcEnd(text, start) {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
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
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
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
      inString = true;
      continue;
    }
    if (text.slice(i, i + 4) === '@end') {
      return i + 4;
    }
  }
  return -1;
}

function parseObjcSelector(signature) {
  const cleaned = signature.replace(/^[\s+-]+/, '');
  const match = cleaned.match(/\)\s*([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
  if (!match) return '';
  const rest = match[1] + (match[2] || '');
  const parts = [];
  for (const seg of rest.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
    parts.push(seg[1]);
  }
  if (parts.length) return `${parts.join(':')}:`;
  return match[1] || '';
}

function extractObjcParams(signature) {
  const params = [];
  for (const match of signature.matchAll(/:\s*\([^)]*\)\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    params.push(match[1]);
  }
  return params;
}

function extractObjcReturns(signature) {
  const match = signature.match(/^[\s+-]*\(\s*([^)]+)\s*\)/);
  return match ? match[1].trim() : null;
}

function extractObjcConforms(signature) {
  const match = signature.match(/<([^>]+)>/);
  if (!match) return [];
  return match[1].split(',').map((t) => t.trim()).filter(Boolean);
}

function extractCLikeModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/);
  for (const tok of tokens) {
    if (CLIKE_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractCLikeParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const parts = match[1].split(',');
  const params = [];
  for (const part of parts) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=[^,]+$/, '').trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let name = tokens[tokens.length - 1];
    name = name.replace(/[*&]+/g, '').replace(/\[.*\]$/, '');
    if (/^[A-Za-z_]/.test(name)) params.push(name);
  }
  return params;
}

function parseCLikeSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_][A-Za-z0-9_:]*)$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = before.slice(0, match.index).trim() || null;
  return { name, returns };
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
 * Collect #include imports from C-like source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectCLikeImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

function stripCLikeComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function collectCLikeCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const normalized = stripCLikeComments(text).replace(/->/g, '.');
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_.:]*)\s*\(/g)) {
    const raw = match[1];
    if (!raw) continue;
    const base = raw.split(/\.|::/).filter(Boolean).pop();
    if (!base || CLIKE_CALL_KEYWORDS.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
  }
  for (const match of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (CLIKE_USAGE_SKIP.has(name)) continue;
    if (/^[A-Z0-9_]{2,}$/.test(name)) continue;
    usages.add(name);
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Build chunk metadata for C-like declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @param {string} ext
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildCLikeChunks(text, ext, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, ext, options, languageId: null });
  if (treeChunks && treeChunks.length) return treeChunks;
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];
  const objc = isObjc(ext);

  const addDecl = (entry, isType = false) => {
    decls.push(entry);
    if (isType) typeDecls.push(entry);
  };

  const typeRe = /^\s*(typedef\s+)?(struct|class|enum|union)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const match of text.matchAll(typeRe)) {
    const start = match.index;
    const startLine = offsetToLine(lineIndex, start);
    const line = lines[startLine - 1] || '';
    if (isCLike(ext) && isCommentLine(line)) continue;
    const bounds = findCLikeBodyBounds(text, start);
    if (!Number.isFinite(bounds.bodyStart) || bounds.bodyStart === -1) continue;
    const signature = sliceSignature(text, start, bounds.bodyStart);
    const name = normalizeCLikeTypeName(match[3]);
    if (!name) continue;
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    const endLine = offsetToLine(lineIndex, end);
    const kind = CLIKE_TYPE_MAP[match[2]] || 'ClassDeclaration';
    addDecl({
      start,
      end,
      name,
      kind,
      meta: {
        startLine,
        endLine,
        signature,
        modifiers: extractCLikeModifiers(signature),
        docstring: extractDocComment(lines, startLine - 1),
        conforms: extractObjcConforms(signature)
      }
    }, true);
  }

  if (objc) {
    const objcTypeRe = /^\s*@(?:(interface|implementation|protocol))\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    for (const match of text.matchAll(objcTypeRe)) {
      const start = match.index;
      const startLine = offsetToLine(lineIndex, start);
      const end = findObjcEnd(text, start);
      const endLine = end > start ? offsetToLine(lineIndex, end) : startLine;
      const signature = sliceSignature(text, start, end);
      const name = normalizeCLikeTypeName(match[2]);
      if (!name) continue;
      const kind = OBJC_TYPE_MAP[match[1]] || 'InterfaceDeclaration';
      addDecl({
        start,
        end: end > start ? end : start,
        name,
        kind,
        meta: {
          startLine,
          endLine,
          signature,
          docstring: extractDocComment(lines, startLine - 1),
          conforms: extractObjcConforms(signature)
        }
      }, true);
    }
  }

  const findParent = (start, kinds) => {
    let parent = null;
    for (const type of typeDecls) {
      if (kinds && !kinds.has(type.kind)) continue;
      if (type.start < start && type.end > start) {
        if (!parent || type.start > parent.start) parent = type;
      }
    }
    return parent;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    if (objc && (trimmed.startsWith('-') || trimmed.startsWith('+'))) {
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const selector = parseObjcSelector(signature);
      if (!selector) {
        i = endLine;
        continue;
      }
      const start = lineIndex[i] + line.indexOf(trimmed);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const startLine = i + 1;
      const endLineNum = offsetToLine(lineIndex, end);
      const parent = findParent(start, new Set(['InterfaceDeclaration', 'ImplementationDeclaration', 'ProtocolDeclaration']));
      const name = parent && parent.name ? `${parent.name}.${selector}` : selector;
      const modifiers = trimmed.startsWith('+') ? ['class'] : [];
      addDecl({
        start,
        end,
        name,
        kind: 'MethodDeclaration',
        meta: {
          startLine,
          endLine: endLineNum,
          signature,
          params: extractObjcParams(signature),
          returns: extractObjcReturns(signature),
          docstring: extractDocComment(lines, i - 1),
          attributes: collectAttributes(lines, i - 1, signature),
          modifiers
        }
      });
      i = endLine;
      continue;
    }

    if (!trimmed.includes('(')) continue;
    const prefix = trimmed.split(/\s+/)[0];
    if (CLIKE_SKIP_PREFIXES.has(prefix)) continue;
    if (trimmed.startsWith('@') || trimmed.startsWith('-') || trimmed.startsWith('+')) continue;

    const { signature, endLine, hasBody } = readSignatureLines(lines, i);
    if (!hasBody) {
      i = endLine;
      continue;
    }
    const { name: rawName, returns } = parseCLikeSignature(signature);
    if (!rawName) {
      i = endLine;
      continue;
    }
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = findCLikeBodyBounds(text, start);
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const startLine = i + 1;
    const endLineNum = offsetToLine(lineIndex, end);
    let name = normalizeCLikeFuncName(rawName);
    const parent = findParent(start, new Set(['ClassDeclaration', 'StructDeclaration', 'UnionDeclaration']));
    if (parent && parent.name && !name.includes('::')) {
      name = `${parent.name}.${name}`;
    }
    addDecl({
      start,
      end,
      name,
      kind: 'FunctionDeclaration',
      meta: {
        startLine,
        endLine: endLineNum,
        signature,
        params: extractCLikeParams(signature),
        returns,
        modifiers: extractCLikeModifiers(signature),
        docstring: extractDocComment(lines, i - 1)
      }
    });
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
 * Build import/export/call/usage relations for C-like chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} clikeChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildCLikeRelations(text, allImports, clikeChunks) {
  const imports = collectCLikeImports(text);
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(clikeChunks)) {
    for (const chunk of clikeChunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (CLIKE_EXPORT_KINDS.has(chunk.kind)) exports.add(chunk.name);
      const bounds = findCLikeBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectCLikeCallsAndUsages(slice);
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
 * Normalize C-like doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],conforms:string[]}}
 */
export function extractCLikeDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const attributes = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  const conforms = Array.isArray(meta.conforms) ? meta.conforms : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    decorators: attributes,
    modifiers,
    conforms,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}

/**
 * Heuristic control-flow/dataflow extraction for C-like chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeCLikeFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripCLikeComments(slice);
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
      skip: CLIKE_USAGE_SKIP,
      memberOperators: ['.', '->', '::']
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    for (const match of cleaned.matchAll(/\bthrow\b\s+(?:new\s+)?([A-Za-z_][A-Za-z0-9_:]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) throws.add(name);
    }
    out.throws = Array.from(throws);
    const awaits = new Set();
    for (const match of cleaned.matchAll(/\b(?:co_await|await)\b\s+([A-Za-z_][A-Za-z0-9_.:]*)/g)) {
      const name = match[1].replace(/[({].*$/, '').trim();
      if (name) awaits.add(name);
    }
    out.awaits = Array.from(awaits);
    out.yields = /\bco_yield\b|\byield\b/.test(cleaned);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'else', 'switch', 'case', 'catch', 'try'],
      loopKeywords: ['for', 'while', 'do']
    });
  }

  return out;
}
