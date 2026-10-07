import { buildHeuristicDataflow, hasReturnValue } from './flow.js';

/**
 * Slice a declaration signature from raw text.
 * @param {string} text
 * @param {number} start
 * @param {number} bodyStart
 * @returns {string}
 */
export function sliceSignature(text, start, bodyStart) {
  let end = bodyStart > start ? bodyStart : text.indexOf('\n', start);
  if (end === -1) end = text.length;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Escape a value for use in a RegExp.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const resolveLinesAccessor = (lines) => {
  if (Array.isArray(lines)) {
    return {
      getLine: (idx) => lines[idx] ?? '',
      length: lines.length
    };
  }
  if (lines && typeof lines.getLine === 'function') {
    const length = Number.isFinite(lines.length)
      ? lines.length
      : (Number.isFinite(lines.lineCount) ? lines.lineCount : 0);
    return {
      getLine: (idx) => lines.getLine(idx) ?? '',
      length
    };
  }
  return {
    getLine: () => '',
    length: 0
  };
};

/**
 * Extract a doc comment immediately above a declaration.
 * Supports configurable line/block styles.
 * @param {string[]|{getLine:(idx:number)=>string,length?:number,lineCount?:number}} lines
 * @param {number} startLineIdx
 * @param {{linePrefixes?:string[]|string,blockStarts?:string[]|string,blockEnd?:string,skipLine?:(line:string)=>boolean}} [options]
 * @returns {string}
 */
export function extractDocComment(lines, startLineIdx, options = {}) {
  const accessor = resolveLinesAccessor(lines);
  const linePrefixesRaw = options.linePrefixes ?? ['///'];
  const blockStartsRaw = options.blockStarts ?? ['/**'];
  const linePrefixes = Array.isArray(linePrefixesRaw) ? linePrefixesRaw.filter(Boolean) : [linePrefixesRaw].filter(Boolean);
  const blockStarts = Array.isArray(blockStartsRaw) ? blockStartsRaw.filter(Boolean) : [blockStartsRaw].filter(Boolean);
  const blockEnd = options.blockEnd ?? '*/';
  const skipLine = typeof options.skipLine === 'function' ? options.skipLine : null;
  let i = startLineIdx - 1;
  while (i >= 0 && accessor.getLine(i).trim() === '') i--;
  if (i < 0) return '';
  const trimmed = accessor.getLine(i).trim();
  if (linePrefixes.length) {
    const initialPrefix = linePrefixes.find((prefix) => trimmed.startsWith(prefix));
    if (initialPrefix) {
      const out = [];
      while (i >= 0) {
        const line = accessor.getLine(i).trim();
        if (skipLine && skipLine(line)) {
          i--;
          continue;
        }
        const matchedPrefix = linePrefixes.find((prefix) => line.startsWith(prefix));
        if (!matchedPrefix) break;
        const prefixRegex = new RegExp(`^\\s*${escapeRegExp(matchedPrefix)}\\s?`);
        out.unshift(line.replace(prefixRegex, '').trim());
        i--;
      }
      return out.join('\n').trim();
    }
  }

  if (blockEnd && trimmed.includes(blockEnd) && blockStarts.length) {
    const raw = [];
    let foundStart = false;
    while (i >= 0) {
      const line = accessor.getLine(i);
      raw.unshift(line);
      if (blockStarts.some((start) => line.includes(start))) {
        foundStart = true;
        break;
      }
      i--;
    }
    if (!foundStart) return '';
    return raw
      .map((line) => {
        let cleaned = line;
        for (const start of blockStarts) {
          const startRegex = new RegExp(`^\\s*${escapeRegExp(start)}`);
          cleaned = cleaned.replace(startRegex, '');
        }
        if (blockEnd) {
          const endRegex = new RegExp(`${escapeRegExp(blockEnd)}\\s*$`);
          cleaned = cleaned.replace(endRegex, '');
        }
        cleaned = cleaned.replace(/^\s*\*\s?/, '');
        return cleaned.trim();
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

/**
 * Collect attributes/annotations near a declaration.
 * @param {string[]} lines
 * @param {number} startLineIdx
 * @param {string} signature
 * @returns {string[]}
 */
export function collectAttributes(lines, startLineIdx, signature) {
  const accessor = resolveLinesAccessor(lines);
  const attrs = new Set();
  const attrRe = /@([A-Za-z_][A-Za-z0-9_]*)/g;
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
    const trimmed = accessor.getLine(i).trim();
    if (!trimmed) {
      if (attrs.size) break;
      i--;
      continue;
    }
    if (trimmed.startsWith('@')) {
      addLine(trimmed);
      i--;
      continue;
    }
    if (trimmed.startsWith('///') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      i--;
      continue;
    }
    break;
  }
  return Array.from(attrs);
}

/**
 * Normalize a language parser's declaration accumulator for public chunk output.
 * Returns null when no declarations were collected.
 * @param {Array<{start:number,end:number,name:string,kind:string,meta?:Object}>} decls
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function normalizeDeclarationList(decls) {
  if (!Array.isArray(decls) || !decls.length) return null;
  decls.sort((a, b) => a.start - b.start);
  return decls.map((decl) => ({
    start: decl.start,
    end: decl.end,
    name: decl.name,
    kind: decl.kind,
    meta: decl.meta || {}
  }));
}

const defaultSkipCLikeMemberLine = (trimmed) => (
  !trimmed
  || trimmed.startsWith('//')
  || trimmed.startsWith('/*')
  || trimmed.startsWith('*')
);

/**
 * Collect member declarations inside brace-delimited C-like type bodies.
 * Language adapters still own parsing, naming, and metadata construction.
 * @param {{
 *   text:string,
 *   lines:string[],
 *   lineIndex:number[],
 *   typeDecls:Array<{start:number,end:number,name:string}>,
 *   findBodyBounds:(text:string,start:number)=>{bodyStart:number,bodyEnd:number},
 *   offsetToLine:(lineIndex:number[],offset:number)=>number,
 *   readSignatureLines:(lines:string[],lineIdx:number)=>{signature:string,endLine:number,hasBody:boolean},
 *   shouldSkipLine?:(trimmed:string,lineIdx:number,typeDecl:Object)=>boolean,
 *   shouldReadLine?:(trimmed:string,lineIdx:number,typeDecl:Object)=>boolean,
 *   buildEntry:(context:Object)=>({start:number,end:number,name:string,kind:string,meta:Object}|null|undefined)
 * }} options
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>}
 */
export function collectCLikeTypeBodyMemberDeclarations(options) {
  const text = String(options?.text || '');
  const lines = Array.isArray(options?.lines) ? options.lines : [];
  const lineIndex = Array.isArray(options?.lineIndex) ? options.lineIndex : [];
  const typeDecls = Array.isArray(options?.typeDecls) ? options.typeDecls : [];
  const findBodyBounds = options?.findBodyBounds;
  const readSignatureLines = options?.readSignatureLines;
  const offsetToLine = options?.offsetToLine;
  const buildEntry = options?.buildEntry;
  if (
    typeof findBodyBounds !== 'function'
    || typeof readSignatureLines !== 'function'
    || typeof offsetToLine !== 'function'
    || typeof buildEntry !== 'function'
  ) {
    return [];
  }
  const shouldSkipLine = typeof options?.shouldSkipLine === 'function'
    ? options.shouldSkipLine
    : defaultSkipCLikeMemberLine;
  const shouldReadLine = typeof options?.shouldReadLine === 'function'
    ? options.shouldReadLine
    : () => true;
  const out = [];
  for (const typeDecl of typeDecls) {
    if (!typeDecl || typeDecl.start == null || typeDecl.end == null) continue;
    const bounds = findBodyBounds(text, typeDecl.start);
    if (bounds.bodyStart === -1 || bounds.bodyEnd === -1) continue;
    const startLine = offsetToLine(lineIndex, bounds.bodyStart + 1);
    const endLine = offsetToLine(lineIndex, bounds.bodyEnd);
    for (let i = startLine - 1; i < Math.min(lines.length, endLine); i++) {
      const line = lines[i];
      const trimmed = String(line || '').trim();
      if (shouldSkipLine(trimmed, i, typeDecl)) continue;
      if (!shouldReadLine(trimmed, i, typeDecl)) continue;
      const signatureInfo = readSignatureLines(lines, i);
      const signature = String(signatureInfo?.signature || '');
      if (!signature.includes('(')) continue;
      const sigEndLine = Number.isFinite(signatureInfo?.endLine) ? signatureInfo.endLine : i;
      const start = lineIndex[i] + String(line || '').indexOf(trimmed);
      const boundsInner = signatureInfo?.hasBody
        ? findBodyBounds(text, start)
        : { bodyStart: -1, bodyEnd: -1 };
      const end = boundsInner.bodyEnd > start
        ? boundsInner.bodyEnd
        : lineIndex[sigEndLine] + String(lines[sigEndLine] || '').length;
      const entry = buildEntry({
        typeDecl,
        lineIndex: i,
        line,
        trimmed,
        signature,
        sigEndLine,
        hasBody: signatureInfo?.hasBody === true,
        start,
        end,
        endLine: offsetToLine(lineIndex, end)
      });
      if (entry) out.push(entry);
    }
  }
  return out;
}

const hasOwnOption = (options, key) => Object.prototype.hasOwnProperty.call(options, key);

const appendDocMetaFields = (out, fields) => {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value;
  }
};

/**
 * Build the shared docmeta/default metadata shape used by language adapters.
 * Language-specific options add fields without changing their existing order.
 * @param {{meta?:Object}} chunk
 * @param {Object} [options]
 * @returns {Object}
 */
export function buildDefaultDocMeta(chunk, options = {}) {
  options = options || {};
  const meta = chunk?.meta || {};
  const params = hasOwnOption(options, 'params')
    ? options.params
    : (Array.isArray(meta.params) ? meta.params : []);
  const returns = hasOwnOption(options, 'returns') ? options.returns : (meta.returns || null);
  const out = {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns
  };
  if (options.includeReturnType) out.returnType = returns;
  out.signature = meta.signature || null;
  if (options.decoratorsFrom) {
    out.decorators = Array.isArray(meta[options.decoratorsFrom]) ? meta[options.decoratorsFrom] : [];
  }
  if (options.includeModifiers) {
    out.modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  }
  if (options.includeVisibility) out.visibility = meta.visibility || null;
  if (options.includeImplFor) out.implFor = meta.implFor || null;
  appendDocMetaFields(out, options.extraFields);
  out.dataflow = meta.dataflow || null;
  out.throws = meta.throws || [];
  out.awaits = meta.awaits || [];
  out.yields = meta.yields || false;
  out.returnsValue = meta.returnsValue || false;
  out.controlFlow = meta.controlFlow || null;
  return out;
}

export function stripCLikeComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

const DEFAULT_CALL_PATTERN = /\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g;
const DEFAULT_USAGE_PATTERN = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;

function toSegmentSeparators(separators) {
  if (separators instanceof Set) return separators;
  if (Array.isArray(separators)) return new Set(separators);
  return new Set(String(separators || '.').split(''));
}

function makeGlobalPattern(pattern, fallback) {
  const source = pattern instanceof RegExp ? pattern : fallback;
  const flags = source.flags.includes('g') ? source.flags : `${source.flags}g`;
  return new RegExp(source.source, flags);
}

export function getLastDottedSegment(raw, separators = '.') {
  if (!raw) return '';
  const separatorSet = toSegmentSeparators(separators);
  let end = raw.length;
  while (end > 0 && separatorSet.has(raw[end - 1])) end -= 1;
  if (!end) return '';
  let idx = end - 1;
  while (idx >= 0) {
    if (separatorSet.has(raw[idx])) break;
    idx -= 1;
  }
  return raw.slice(idx + 1, end);
}

export function collectDottedCallsAndUsages(
  text,
  {
    callKeywords,
    usageSkip,
    stripComments = stripCLikeComments,
    normalizeText = (value) => value,
    shouldSkipUsage = () => false,
    callPattern = DEFAULT_CALL_PATTERN,
    usagePattern = DEFAULT_USAGE_PATTERN,
    segmentSeparators = '.'
  } = {}
) {
  const calls = new Set();
  const usages = new Set();
  const normalized = normalizeText(stripComments(text));
  const callRe = makeGlobalPattern(callPattern, DEFAULT_CALL_PATTERN);
  let match;
  while ((match = callRe.exec(normalized)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const base = getLastDottedSegment(raw, segmentSeparators);
    if (!base || callKeywords?.has(base)) continue;
    calls.add(raw);
    if (base !== raw) calls.add(base);
    if (!match[0]) callRe.lastIndex += 1;
  }
  const usageRe = makeGlobalPattern(usagePattern, DEFAULT_USAGE_PATTERN);
  while ((match = usageRe.exec(normalized)) !== null) {
    const name = match[1];
    if (!name || name.length < 2) continue;
    if (usageSkip?.has(name)) continue;
    if (shouldSkipUsage(name)) continue;
    usages.add(name);
    if (!match[0]) usageRe.lastIndex += 1;
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Extract the return type tokens that appear before a parsed method name.
 * @param {string} signature
 * @param {string} name
 * @param {{modifiers?:Set<string>,shouldSkipToken?:(tok:string)=>boolean}} [options]
 * @returns {string|null}
 */
export function extractReturnTypeBeforeName(signature, name, options = {}) {
  if (!name) return null;
  const idx = signature.indexOf('(');
  if (idx === -1) return null;
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const nameIdx = before.lastIndexOf(name);
  if (nameIdx === -1) return null;
  const raw = before.slice(0, nameIdx).trim();
  if (!raw) return null;
  const modifiers = options.modifiers || new Set();
  const shouldSkipToken = typeof options.shouldSkipToken === 'function'
    ? options.shouldSkipToken
    : () => false;
  const filtered = raw
    .split(/\s+/)
    .filter((tok) => tok && !modifiers.has(tok) && !shouldSkipToken(tok));
  return filtered.length ? filtered.join(' ') : null;
}

const DEFAULT_CALLABLE_CHUNK_KINDS = new Set([
  'MethodDeclaration',
  'ConstructorDeclaration',
  'FunctionDeclaration'
]);

/**
 * Build import/export/call/usage relations for brace-delimited method chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta?:Object}>|null} chunks
 * @param {{collectImports:(text:string)=>string[],collectCallsAndUsages:(text:string)=>{calls:string[],usages:string[]},findBodyBounds:(text:string,start:number)=>{bodyStart:number,bodyEnd:number},callableKinds?:Set<string>,isExported?:(chunk:Object)=>boolean,shouldScanCallable?:(chunk:Object)=>boolean}} options
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildBraceDelimitedMethodRelations(text, chunks, options) {
  const imports = typeof options?.collectImports === 'function' ? options.collectImports(text) : [];
  const collectCallsAndUsages = options?.collectCallsAndUsages;
  const findBodyBounds = options?.findBodyBounds;
  const callableKinds = options?.callableKinds || DEFAULT_CALLABLE_CHUNK_KINDS;
  const isExported = typeof options?.isExported === 'function'
    ? options.isExported
    : (chunk) => {
      const mods = Array.isArray(chunk.meta?.modifiers) ? chunk.meta.modifiers : [];
      return mods.includes('public');
    };
  const shouldScanCallable = typeof options?.shouldScanCallable === 'function'
    ? options.shouldScanCallable
    : () => true;
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  if (Array.isArray(chunks) && typeof collectCallsAndUsages === 'function' && typeof findBodyBounds === 'function') {
    for (const chunk of chunks) {
      if (!chunk || !chunk.name || chunk.start == null || chunk.end == null) continue;
      if (isExported(chunk)) exports.add(chunk.name);
      if (!callableKinds.has(chunk.kind)) continue;
      if (!shouldScanCallable(chunk)) continue;
      const bounds = findBodyBounds(text, chunk.start);
      const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
      const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
      const slice = text.slice(scanStart, scanEnd);
      const { calls: chunkCalls, usages: chunkUsages } = collectCallsAndUsages(slice);
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
 * Collect shared dataflow and flow-control facts from a C-family method body.
 * @param {string} cleaned
 * @param {{usageSkip?:Set<string>,memberOperators?:string[],throwPattern?:RegExp,awaitPattern?:RegExp,yieldPattern?:RegExp}} [options]
 * @returns {{dataflow:Object,throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}}
 */
export function collectCLikeDataflowFacts(cleaned, options = {}) {
  const dataflow = buildHeuristicDataflow(cleaned, {
    skip: options.usageSkip,
    memberOperators: Array.isArray(options.memberOperators) ? options.memberOperators : ['.']
  });
  const collectNames = (pattern) => {
    const names = new Set();
    if (!(pattern instanceof RegExp)) return names;
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match;
    while ((match = re.exec(cleaned)) !== null) {
      const name = String(match[1] || '').replace(/[({].*$/, '').trim();
      if (name) names.add(name);
    }
    return names;
  };
  const throwRe = options.throwPattern instanceof RegExp
    ? options.throwPattern
    : /\bthrow\b\s+(?:new\s+)?([A-Za-z_][A-Za-z0-9_.]*)/g;
  const throws = collectNames(throwRe);
  const awaits = collectNames(options.awaitPattern);
  const yieldPattern = options.yieldPattern instanceof RegExp
    ? new RegExp(options.yieldPattern.source, options.yieldPattern.flags.replace(/g/g, ''))
    : null;
  return {
    dataflow,
    throws: Array.from(throws),
    awaits: Array.from(awaits),
    yields: yieldPattern ? yieldPattern.test(cleaned) : false,
    returnsValue: hasReturnValue(cleaned)
  };
}

/**
 * Check if a line is a comment-only line.
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}
