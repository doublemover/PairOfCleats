import fs from 'node:fs/promises';
import path from 'node:path';
import { rangeToOffsets } from '../../lsp/positions.js';
import { flattenSymbols } from '../../lsp/symbols.js';
import { writeJsonObjectFile } from '../../../../shared/json-stream.js';
import { throwIfAborted } from '../../../../shared/abort.js';

export const DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY = 4;
export const DEFAULT_HOVER_CONCURRENCY = 8;
export const DEFAULT_HOVER_CACHE_MAX_ENTRIES = 50000;

/**
 * Clamp numeric values to an integer range with fallback.
 * @param {unknown} value
 * @param {number} fallback
 * @param {{min?:number,max?:number}} [bounds]
 * @returns {number}
 */
export const clampIntRange = (value, fallback, { min = 1, max = 64 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return Math.max(min, Math.min(max, normalized));
};

/**
 * Run async work over a list with a fixed worker pool.
 * @param {Array<any>} items
 * @param {number} concurrency
 * @param {(item:any,index:number)=>Promise<void>} worker
 * @param {{signal?:AbortSignal|null}} [options]
 * @returns {Promise<void>}
 */
export const runWithConcurrency = async (items, concurrency, worker, options = {}) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const signal = options?.signal && typeof options.signal.aborted === 'boolean'
    ? options.signal
    : null;
  const maxWorkers = Math.max(1, Math.min(list.length, clampIntRange(concurrency, 1, { min: 1, max: 128 })));
  let index = 0;
  const runners = Array.from({ length: maxWorkers }, async () => {
    while (true) {
      throwIfAborted(signal);
      const current = index;
      index += 1;
      if (current >= list.length) break;
      throwIfAborted(signal);
      await worker(list[current], current);
      throwIfAborted(signal);
    }
  });
  await Promise.all(runners);
};

/**
 * Create a generic concurrency limiter for promise-returning tasks.
 * @param {number} concurrency
 * @returns {(fn:()=>Promise<any>)=>Promise<any>}
 */
export const createConcurrencyLimiter = (concurrency) => {
  const maxWorkers = Math.max(1, clampIntRange(concurrency, 1, { min: 1, max: 256 }));
  let active = 0;
  let queue = [];
  let queueHead = 0;

  const dequeue = () => {
    if (queueHead >= queue.length) return null;
    const task = queue[queueHead];
    queueHead += 1;
    // Keep dequeue O(1) and compact periodically.
    if (queueHead >= 1024 && queueHead * 2 >= queue.length) {
      queue = queue.slice(queueHead);
      queueHead = 0;
    }
    return task;
  };

  const pump = () => {
    while (active < maxWorkers) {
      const task = dequeue();
      if (!task) break;
      active += 1;
      Promise.resolve()
        .then(task.fn)
        .then(task.resolve, task.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
};

const resolveHoverCachePath = (cacheRoot) => {
  if (!cacheRoot) return null;
  return path.join(cacheRoot, 'lsp', 'hover-cache-v1.json');
};

/**
 * Load persisted hover parse cache from disk.
 * Invalid/missing cache files degrade to an empty cache.
 *
 * @param {string|null} cacheRoot
 * @returns {Promise<{path:string|null,entries:Map<string,object>}>}
 */
export const loadHoverCache = async (cacheRoot) => {
  const cachePath = resolveHoverCachePath(cacheRoot);
  if (!cachePath) return { path: null, entries: new Map() };
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const entries = new Map();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (typeof row.key !== 'string' || !row.key) continue;
      if (!row.value || typeof row.value !== 'object') continue;
      entries.set(row.key, row.value);
    }
    return { path: cachePath, entries };
  } catch {
    return { path: cachePath, entries: new Map() };
  }
};

/**
 * Persist hover cache entries with recency ordering and bounded size.
 * @param {{cachePath:string|null,entries:Map<string,object>,maxEntries:number}} input
 * @returns {Promise<void>}
 */
export const persistHoverCache = async ({ cachePath, entries, maxEntries }) => {
  if (!cachePath || !(entries instanceof Map)) return;
  const rows = Array.from(entries.entries()).map(([key, value]) => ({
    key,
    value
  }));
  rows.sort((a, b) => Number(b?.value?.at || 0) - Number(a?.value?.at || 0));
  const cap = clampIntRange(maxEntries, DEFAULT_HOVER_CACHE_MAX_ENTRIES, { min: 1000, max: 200000 });
  const limited = rows.length > cap ? rows.slice(0, cap) : rows;
  await writeJsonObjectFile(cachePath, {
    trailingNewline: false,
    fields: {
      version: 1,
      generatedAt: new Date().toISOString()
    },
    arrays: {
      entries: limited
    }
  });
};

/**
 * Build deterministic cache key for one hover request tuple.
 * @param {{cmd:string,docHash:string,languageId:string,symbolName:string,position:{line:number,character:number}}} input
 * @returns {string|null}
 */
const buildHoverCacheKey = ({ cmd, docHash, languageId, symbolName, position }) => {
  if (!docHash || !position || !Number.isFinite(position.line) || !Number.isFinite(position.character)) return null;
  return [
    String(cmd || ''),
    String(languageId || ''),
    String(docHash),
    String(symbolName || ''),
    `${Math.floor(position.line)}:${Math.floor(position.character)}`
  ].join('|');
};

/**
 * Normalize LSP hover content payloads to plain text.
 * @param {string|Array<any>|object|null} contents
 * @returns {string}
 */
const normalizeHoverContents = (contents) => {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((entry) => normalizeHoverContents(entry)).filter(Boolean).join('\n');
  }
  if (typeof contents === 'object') {
    if (typeof contents.value === 'string') return contents.value;
    if (typeof contents.language === 'string' && typeof contents.value === 'string') return contents.value;
  }
  return '';
};

const extractSignatureHelpText = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const signatures = Array.isArray(payload.signatures) ? payload.signatures : [];
  if (!signatures.length) return '';
  const activeIndexRaw = Number(payload.activeSignature);
  const activeIndex = Number.isFinite(activeIndexRaw)
    ? Math.max(0, Math.min(signatures.length - 1, Math.floor(activeIndexRaw)))
    : 0;
  const activeSignature = signatures[activeIndex] || signatures[0] || null;
  if (!activeSignature || typeof activeSignature !== 'object') return '';
  return String(activeSignature.label || '').trim();
};

const extractDefinitionLocations = (payload) => {
  const source = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const uri = typeof entry.uri === 'string'
      ? entry.uri
      : (typeof entry.targetUri === 'string' ? entry.targetUri : null);
    const range = entry.range && typeof entry.range === 'object'
      ? entry.range
      : (entry.targetRange && typeof entry.targetRange === 'object' ? entry.targetRange : null);
    if (!uri || !range) continue;
    out.push({ uri, range });
  }
  return out;
};

/**
 * Normalize signature/type strings to compact one-line text.
 * @param {unknown} value
 * @returns {string|null}
 */
export const normalizeTypeText = (value) => {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
};

const normalizeSignatureCacheText = (value) => (
  String(value || '').replace(/\s+/g, ' ').trim()
);

/**
 * Parse finite integer values with optional lower bound.
 * @param {unknown} value
 * @param {number|null} [min=null]
 * @returns {number|null}
 */
export const toFiniteInt = (value, min = null) => {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  if (!Number.isFinite(min)) return normalized;
  return Math.max(min, normalized);
};

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const target = Number(ratio);
  if (!Number.isFinite(target) || target <= 0) return Math.min(...values);
  if (target >= 1) return Math.max(...values);
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(target * sorted.length) - 1));
  return sorted[index];
};

const summarizeLatencies = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null };
  }
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95)
  };
};

const createHoverFileStats = () => ({
  requested: 0,
  succeeded: 0,
  hoverTimedOut: 0,
  signatureHelpRequested: 0,
  signatureHelpSucceeded: 0,
  signatureHelpTimedOut: 0,
  definitionRequested: 0,
  definitionSucceeded: 0,
  definitionTimedOut: 0,
  typeDefinitionRequested: 0,
  typeDefinitionSucceeded: 0,
  typeDefinitionTimedOut: 0,
  referencesRequested: 0,
  referencesSucceeded: 0,
  referencesTimedOut: 0,
  timedOut: 0,
  skippedByBudget: 0,
  skippedByKind: 0,
  skippedByReturnSufficient: 0,
  skippedByAdaptiveDisable: 0,
  skippedByGlobalDisable: 0,
  latencyMs: [],
  disabledAdaptive: false
});

/**
 * Normalize configurable symbol kinds to a set of integer IDs.
 * @param {number[]|number|string[]|string|null} kinds
 * @returns {Set<number>|null}
 */
export const normalizeHoverKinds = (kinds) => {
  if (kinds == null) return null;
  const source = Array.isArray(kinds) ? kinds : [kinds];
  const normalized = source
    .map((entry) => toFiniteInt(entry, 0))
    .filter((entry) => Number.isFinite(entry));
  if (!normalized.length) return null;
  return new Set(normalized);
};

/**
 * Normalize parsed parameter type payloads to enriched provenance entries.
 * @param {object|null} paramTypes
 * @returns {object|null}
 */
export const normalizeParamTypes = (paramTypes) => {
  if (!paramTypes || typeof paramTypes !== 'object') return null;
  const output = {};
  for (const [name, entries] of Object.entries(paramTypes)) {
    if (!name) continue;
    if (Array.isArray(entries)) {
      const normalized = entries
        .map((entry) => (typeof entry === 'string' ? { type: entry } : entry))
        .filter((entry) => entry?.type)
        .map((entry) => ({
          type: normalizeTypeText(entry.type),
          confidence: Number.isFinite(entry.confidence) ? entry.confidence : 0.7,
          source: entry.source || 'tooling'
        }))
        .filter((entry) => entry.type);
      if (normalized.length) output[name] = normalized;
      continue;
    }
    if (typeof entries === 'string') {
      const type = normalizeTypeText(entries);
      if (type) output[name] = [{ type, confidence: 0.7, source: 'tooling' }];
    }
  }
  return Object.keys(output).length ? output : null;
};

const hasParamTypes = (paramTypes) => {
  if (!paramTypes || typeof paramTypes !== 'object') return false;
  for (const entries of Object.values(paramTypes)) {
    if (Array.isArray(entries)) {
      if (entries.some((entry) => normalizeTypeText(typeof entry === 'string' ? entry : entry?.type))) {
        return true;
      }
      continue;
    }
    if (normalizeTypeText(entries)) return true;
  }
  return false;
};

const FUNCTION_LIKE_SYMBOL_KINDS = new Set([6, 9, 12]);

const normalizeParamNames = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    const name = String(entry || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
};

const signatureDeclaresParameters = (signature) => {
  const text = normalizeTypeText(signature);
  if (!text) return false;
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < 0 || close <= open) return false;
  const inside = text.slice(open + 1, close).trim();
  if (!inside) return false;
  return !/^(void|\(\s*\))$/i.test(inside);
};

const hasTypedParamEntry = (value) => {
  if (Array.isArray(value)) {
    return value.some((entry) => normalizeTypeText(typeof entry === 'string' ? entry : entry?.type));
  }
  return normalizeTypeText(value) != null;
};

const hasTypedParamName = (paramTypes, name) => {
  if (!paramTypes || typeof paramTypes !== 'object') return false;
  if (!name) return false;
  return hasTypedParamEntry(paramTypes[name]);
};

const isAmbiguousReturnType = (info) => {
  const signatureText = normalizeTypeText(info?.signature);
  const hasSignatureArrow = typeof signatureText === 'string' && signatureText.includes('->');
  const normalizedReturnType = normalizeTypeText(info?.returnType);
  const treatVoidAsMissing = normalizedReturnType === 'Void' && hasSignatureArrow;
  return !normalizedReturnType
    || /^unknown$/i.test(normalizedReturnType)
    || /^any\b/i.test(normalizedReturnType)
    || treatVoidAsMissing;
};

/**
 * Determine whether a parsed signature payload is incomplete for enrichment.
 *
 * @param {object|null} info
 * @param {{symbolKind?:number|null}} [options]
 * @returns {{incomplete:boolean,missingReturn:boolean,missingParamTypes:boolean,paramCoverage:number}}
 */
export const isIncompleteTypePayload = (info, options = {}) => {
  if (!info || typeof info !== 'object') {
    return {
      incomplete: true,
      missingReturn: true,
      missingParamTypes: true,
      paramCoverage: 0
    };
  }
  const symbolKind = Number.isInteger(options?.symbolKind) ? options.symbolKind : null;
  const functionLike = symbolKind == null || FUNCTION_LIKE_SYMBOL_KINDS.has(symbolKind);
  const missingReturn = functionLike ? isAmbiguousReturnType(info) : false;
  const paramNames = normalizeParamNames(info?.paramNames);
  const declaredParams = paramNames.length > 0 || signatureDeclaresParameters(info?.signature);
  let paramCoverage = 1;
  let missingParamTypes = false;
  if (functionLike && declaredParams) {
    if (paramNames.length) {
      const typedCount = paramNames.filter((name) => hasTypedParamName(info?.paramTypes, name)).length;
      paramCoverage = typedCount / paramNames.length;
      missingParamTypes = typedCount < paramNames.length;
    } else {
      const hasAnyTypedParam = hasParamTypes(info?.paramTypes);
      paramCoverage = hasAnyTypedParam ? 1 : 0;
      missingParamTypes = !hasAnyTypedParam;
    }
  }
  return {
    incomplete: missingReturn || missingParamTypes,
    missingReturn,
    missingParamTypes,
    paramCoverage
  };
};

/**
 * Extract a source-level signature candidate from target byte range.
 * @param {string} text
 * @param {{start:number,end:number}} virtualRange
 * @returns {string|null}
 */
const buildSourceSignatureCandidate = (text, virtualRange) => {
  if (typeof text !== 'string' || !text) return null;
  const start = Number(virtualRange?.start);
  const end = Number(virtualRange?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const clampedStart = Math.max(0, Math.min(text.length, Math.floor(start)));
  const clampedEnd = Math.max(clampedStart, Math.min(text.length, Math.ceil(end + 1)));
  if (clampedEnd <= clampedStart) return null;
  let candidate = text.slice(clampedStart, clampedEnd);
  if (!candidate.includes('(') || !candidate.includes(')')) return null;
  const terminators = [candidate.indexOf('{'), candidate.indexOf(';')].filter((idx) => idx >= 0);
  if (terminators.length) {
    candidate = candidate.slice(0, Math.min(...terminators));
  }
  const lastParen = candidate.lastIndexOf(')');
  if (lastParen === -1) return null;
  const trailing = candidate.slice(lastParen + 1);
  const lineBreakIdx = trailing.search(/[\r\n]/);
  const cut = lineBreakIdx >= 0
    ? lastParen + 1 + lineBreakIdx
    : candidate.length;
  return normalizeSignatureCacheText(candidate.slice(0, cut));
};

const buildLineSignatureCandidate = (text, lineNumber) => {
  if (typeof text !== 'string' || !text) return null;
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 0) return null;
  const lines = text.split(/\r?\n/u);
  if (line >= lines.length) return null;
  let candidate = String(lines[line] || '');
  if (!candidate.includes('(') || !candidate.includes(')')) return null;
  const terminators = [candidate.indexOf('{'), candidate.indexOf(';')].filter((idx) => idx >= 0);
  if (terminators.length) {
    candidate = candidate.slice(0, Math.min(...terminators));
  }
  return normalizeSignatureCacheText(candidate);
};

/**
 * Resolve best chunk target for a symbol/diagnostic offset range.
 *
 * Ranking prefers containing ranges, then optional symbol-name matches, then
 * smallest span to keep mapping stable for nested declarations.
 *
 * @param {Array<object>} targets
 * @param {{start:number,end:number}|null} offsets
 * @param {string|null} [nameHint=null]
 * @returns {object|null}
 */
export const findTargetForOffsets = (targets, offsets, nameHint = null) => {
  if (!offsets) return null;
  let best = null;
  let bestRank = -1;
  let bestSpan = Infinity;
  for (const target of targets || []) {
    const range = target?.virtualRange || null;
    if (!range) continue;
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) continue;
    const overlaps = offsets.end >= range.start && offsets.start <= range.end;
    if (!overlaps) continue;
    const contains = offsets.start >= range.start && offsets.end <= range.end;
    const nameMatch = nameHint && target?.symbolHint?.name === nameHint;
    const span = range.end - range.start;
    const rank = (contains ? 2 : 1) + (nameMatch ? 2 : 0);
    if (rank > bestRank || (rank === bestRank && span < bestSpan)) {
      best = target;
      bestRank = rank;
      bestSpan = span;
    }
  }
  return best;
};

/**
 * Compute deterministic quality score for one signature candidate.
 *
 * @param {object|null} info
 * @param {{symbolKind?:number|null}} [options]
 * @returns {{total:number,returnScore:number,paramScore:number,signatureScore:number,evidenceScore:number,incomplete:boolean}}
 */
export const scoreSignatureInfo = (info, options = {}) => {
  if (!info || typeof info !== 'object') {
    return {
      total: 0,
      returnScore: 0,
      paramScore: 0,
      signatureScore: 0,
      evidenceScore: 0,
      incomplete: true
    };
  }
  const completeness = isIncompleteTypePayload(info, options);
  const returnScore = completeness.missingReturn ? 0 : 4;
  const paramScore = Math.round(Math.max(0, Math.min(1, completeness.paramCoverage || 0)) * 4);
  const signatureScore = normalizeTypeText(info.signature) ? 1 : 0;
  const evidenceScore = hasParamTypes(info.paramTypes) ? 1 : 0;
  return {
    total: returnScore + paramScore + signatureScore + evidenceScore,
    returnScore,
    paramScore,
    signatureScore,
    evidenceScore,
    incomplete: completeness.incomplete
  };
};

const choosePreferredSignatureInfo = (base, next, options = {}) => {
  const baseScore = scoreSignatureInfo(base, options);
  const nextScore = scoreSignatureInfo(next, options);
  if (nextScore.total > baseScore.total) return { preferred: next, alternate: base };
  if (nextScore.total < baseScore.total) return { preferred: base, alternate: next };
  const baseSignature = normalizeTypeText(base?.signature) || '';
  const nextSignature = normalizeTypeText(next?.signature) || '';
  if (nextSignature.length > baseSignature.length) {
    return { preferred: next, alternate: base };
  }
  return { preferred: base, alternate: next };
};

const mergeParamTypesByQuality = (preferred, alternate, paramNames) => {
  const preferredParamTypes = preferred?.paramTypes && typeof preferred.paramTypes === 'object'
    ? preferred.paramTypes
    : null;
  const alternateParamTypes = alternate?.paramTypes && typeof alternate.paramTypes === 'object'
    ? alternate.paramTypes
    : null;
  if (!preferredParamTypes && !alternateParamTypes) return null;
  const names = Array.from(new Set([
    ...paramNames,
    ...Object.keys(preferredParamTypes || {}),
    ...Object.keys(alternateParamTypes || {})
  ])).filter(Boolean);
  const out = {};
  for (const name of names) {
    const preferredBucket = preferredParamTypes?.[name];
    const alternateBucket = alternateParamTypes?.[name];
    if (hasTypedParamEntry(preferredBucket)) {
      out[name] = preferredBucket;
      continue;
    }
    if (hasTypedParamEntry(alternateBucket)) {
      out[name] = alternateBucket;
      continue;
    }
    if (preferredBucket != null) out[name] = preferredBucket;
    else if (alternateBucket != null) out[name] = alternateBucket;
  }
  return Object.keys(out).length ? out : null;
};

/**
 * Merge signature candidates, preferring higher-quality metadata while
 * preserving deterministic tie-break behavior.
 *
 * @param {object|null} base
 * @param {object|null} next
 * @param {{symbolKind?:number|null}} [options]
 * @returns {object|null}
 */
const mergeSignatureInfo = (base, next, options = {}) => {
  if (!next) return base;
  if (!base) return next;
  const { preferred, alternate } = choosePreferredSignatureInfo(base, next, options);
  const merged = { ...preferred };
  const preferredReturnAmbiguous = isAmbiguousReturnType(preferred);
  const alternateReturnAmbiguous = isAmbiguousReturnType(alternate);
  if (preferredReturnAmbiguous && !alternateReturnAmbiguous) {
    merged.returnType = alternate.returnType;
  }
  const preferredSignature = normalizeTypeText(preferred?.signature);
  const alternateSignature = normalizeTypeText(alternate?.signature);
  if (!preferredSignature && alternateSignature) {
    merged.signature = alternate.signature;
  }
  const paramNames = Array.from(new Set([
    ...normalizeParamNames(preferred?.paramNames),
    ...normalizeParamNames(alternate?.paramNames)
  ]));
  if (paramNames.length) merged.paramNames = paramNames;
  const mergedParamTypes = mergeParamTypesByQuality(preferred, alternate, paramNames);
  if (mergedParamTypes) merged.paramTypes = mergedParamTypes;
  return merged;
};

const isFunctionLikeTargetHint = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'function'
      || normalized === 'method'
      || normalized === 'constructor';
  }
  return FUNCTION_LIKE_SYMBOL_KINDS.has(Number(value));
};

const scoreChunkPayloadCandidate = ({ info, symbol, target }) => {
  const detailScore = scoreSignatureInfo(info, { symbolKind: symbol?.kind });
  let total = detailScore.total;
  const hintName = typeof target?.symbolHint?.name === 'string'
    ? target.symbolHint.name.trim()
    : '';
  const symbolName = typeof symbol?.name === 'string' ? symbol.name.trim() : '';
  if (hintName) {
    if (hintName === symbolName) total += 100;
    else if (symbolName) total -= 40;
  }
  const hintIsFunctionLike = isFunctionLikeTargetHint(target?.symbolHint?.kind);
  const symbolIsFunctionLike = FUNCTION_LIKE_SYMBOL_KINDS.has(Number(symbol?.kind));
  if (hintIsFunctionLike && symbolIsFunctionLike) total += 20;
  else if (hintIsFunctionLike && !symbolIsFunctionLike) total -= 20;
  if (!detailScore.incomplete) total += 30;
  return total;
};

/**
 * Create default hover metrics envelope.
 * @returns {object}
 */
export const createEmptyHoverMetricsResult = () => ({
  requested: 0,
  succeeded: 0,
  hoverTimedOut: 0,
  signatureHelpRequested: 0,
  signatureHelpSucceeded: 0,
  signatureHelpTimedOut: 0,
  definitionRequested: 0,
  definitionSucceeded: 0,
  definitionTimedOut: 0,
  typeDefinitionRequested: 0,
  typeDefinitionSucceeded: 0,
  typeDefinitionTimedOut: 0,
  referencesRequested: 0,
  referencesSucceeded: 0,
  referencesTimedOut: 0,
  timedOut: 0,
  incompleteSymbols: 0,
  hoverTriggeredByIncomplete: 0,
  fallbackUsed: 0,
  fallbackReasonCounts: Object.create(null),
  skippedByBudget: 0,
  skippedByKind: 0,
  skippedByReturnSufficient: 0,
  skippedByAdaptiveDisable: 0,
  skippedByGlobalDisable: 0,
  p50Ms: null,
  p95Ms: null,
  files: []
});

/**
 * Aggregate per-request and per-file hover metrics for reporting.
 * @param {{hoverMetrics:object,hoverLatencyMs:number[],hoverFileStats:Map<string,object>}} input
 * @returns {object}
 */
export const summarizeHoverMetrics = ({ hoverMetrics, hoverLatencyMs, hoverFileStats }) => {
  const hoverSummary = summarizeLatencies(hoverLatencyMs);
  const hoverFiles = Array.from(hoverFileStats.entries())
    .map(([virtualPath, stats]) => ({
      virtualPath,
      requested: stats.requested,
      succeeded: stats.succeeded,
      hoverTimedOut: stats.hoverTimedOut,
      signatureHelpRequested: stats.signatureHelpRequested,
      signatureHelpSucceeded: stats.signatureHelpSucceeded,
      signatureHelpTimedOut: stats.signatureHelpTimedOut,
      definitionRequested: stats.definitionRequested,
      definitionSucceeded: stats.definitionSucceeded,
      definitionTimedOut: stats.definitionTimedOut,
      typeDefinitionRequested: stats.typeDefinitionRequested,
      typeDefinitionSucceeded: stats.typeDefinitionSucceeded,
      typeDefinitionTimedOut: stats.typeDefinitionTimedOut,
      referencesRequested: stats.referencesRequested,
      referencesSucceeded: stats.referencesSucceeded,
      referencesTimedOut: stats.referencesTimedOut,
      timedOut: stats.timedOut,
      skippedByBudget: stats.skippedByBudget,
      skippedByKind: stats.skippedByKind,
      skippedByReturnSufficient: stats.skippedByReturnSufficient,
      skippedByAdaptiveDisable: stats.skippedByAdaptiveDisable,
      skippedByGlobalDisable: stats.skippedByGlobalDisable,
      disabledAdaptive: stats.disabledAdaptive === true,
      ...summarizeLatencies(stats.latencyMs)
    }))
    .sort((a, b) => {
      const timeoutCmp = (b.timedOut || 0) - (a.timedOut || 0);
      if (timeoutCmp) return timeoutCmp;
      const p95A = Number.isFinite(a.p95Ms) ? a.p95Ms : -1;
      const p95B = Number.isFinite(b.p95Ms) ? b.p95Ms : -1;
      if (p95B !== p95A) return p95B - p95A;
      return String(a.virtualPath || '').localeCompare(String(b.virtualPath || ''));
    });

  return {
    requested: hoverMetrics.requested,
    succeeded: hoverMetrics.succeeded,
    hoverTimedOut: hoverMetrics.hoverTimedOut,
    signatureHelpRequested: hoverMetrics.signatureHelpRequested,
    signatureHelpSucceeded: hoverMetrics.signatureHelpSucceeded,
    signatureHelpTimedOut: hoverMetrics.signatureHelpTimedOut,
    definitionRequested: hoverMetrics.definitionRequested,
    definitionSucceeded: hoverMetrics.definitionSucceeded,
    definitionTimedOut: hoverMetrics.definitionTimedOut,
    typeDefinitionRequested: hoverMetrics.typeDefinitionRequested,
    typeDefinitionSucceeded: hoverMetrics.typeDefinitionSucceeded,
    typeDefinitionTimedOut: hoverMetrics.typeDefinitionTimedOut,
    referencesRequested: hoverMetrics.referencesRequested,
    referencesSucceeded: hoverMetrics.referencesSucceeded,
    referencesTimedOut: hoverMetrics.referencesTimedOut,
    timedOut: hoverMetrics.timedOut,
    incompleteSymbols: hoverMetrics.incompleteSymbols,
    hoverTriggeredByIncomplete: hoverMetrics.hoverTriggeredByIncomplete,
    fallbackUsed: hoverMetrics.fallbackUsed,
    fallbackReasonCounts: { ...(hoverMetrics.fallbackReasonCounts || {}) },
    skippedByBudget: hoverMetrics.skippedByBudget,
    skippedByKind: hoverMetrics.skippedByKind,
    skippedByReturnSufficient: hoverMetrics.skippedByReturnSufficient,
    skippedByAdaptiveDisable: hoverMetrics.skippedByAdaptiveDisable,
    skippedByGlobalDisable: hoverMetrics.skippedByGlobalDisable,
    p50Ms: hoverSummary.p50Ms,
    p95Ms: hoverSummary.p95Ms,
    files: hoverFiles
  };
};

/**
 * Emit a one-time check entry when tooling circuit breaker opens.
 * @param {{cmd:string,guard:object,checks:Array<object>,checkFlags:object}} input
 * @returns {void}
 */
const recordCircuitOpenCheck = ({ cmd, guard, checks, checkFlags }) => {
  if (checkFlags.circuitOpened) return;
  checkFlags.circuitOpened = true;
  const state = guard.getState?.() || null;
  checks.push({
    name: 'tooling_circuit_open',
    status: 'warn',
    message: `${cmd} circuit breaker opened after ${state?.consecutiveFailures ?? 'unknown'} failures.`,
    count: state?.tripCount ?? 1
  });
};

const recordCrashLoopCheck = ({ cmd, checks, checkFlags, detail }) => {
  if (checkFlags.crashLoopQuarantined) return;
  checkFlags.crashLoopQuarantined = true;
  const remainingMs = Number.isFinite(Number(detail?.crashLoopBackoffRemainingMs))
    ? Math.max(0, Math.floor(Number(detail.crashLoopBackoffRemainingMs)))
    : null;
  checks.push({
    name: 'tooling_crash_loop_quarantined',
    status: 'warn',
    message: `${cmd} crash-loop quarantine active${remainingMs != null ? ` (${remainingMs}ms remaining)` : ''}.`
  });
};

const recordDocumentSymbolFailureCheck = ({ cmd, checks, checkFlags, err }) => {
  if (checkFlags.documentSymbolFailed) return;
  checkFlags.documentSymbolFailed = true;
  const message = String(err?.message || err || '');
  const lower = message.toLowerCase();
  const category = lower.includes('timeout')
    ? 'timeout'
    : (
      err?.code === 'ERR_LSP_TRANSPORT_CLOSED'
          || lower.includes('transport closed')
          || lower.includes('writer unavailable')
    )
      ? 'transport'
      : 'request';
  checks.push({
    name: 'tooling_document_symbol_failed',
    status: 'warn',
    message: `${cmd} documentSymbol requests failed; running in degraded mode (${category}).`
  });
};

const isTimeoutError = (err) => (
  String(err?.message || err || '').toLowerCase().includes('timeout')
);

const TIMEOUT_METRIC_KEY_BY_STAGE = Object.freeze({
  hover: 'hoverTimedOut',
  signature_help: 'signatureHelpTimedOut',
  definition: 'definitionTimedOut',
  type_definition: 'typeDefinitionTimedOut',
  references: 'referencesTimedOut'
});

const recordAdaptiveTimeout = ({
  cmd,
  stageKey,
  checks,
  checkFlags,
  fileHoverStats,
  hoverMetrics,
  hoverControl,
  resolvedHoverDisableAfterTimeouts
}) => {
  fileHoverStats.timedOut += 1;
  hoverMetrics.timedOut += 1;
  const timeoutMetricKey = TIMEOUT_METRIC_KEY_BY_STAGE[stageKey] || null;
  if (timeoutMetricKey) {
    fileHoverStats[timeoutMetricKey] = Number(fileHoverStats[timeoutMetricKey] || 0) + 1;
    hoverMetrics[timeoutMetricKey] = Number(hoverMetrics[timeoutMetricKey] || 0) + 1;
  }
  const timeoutFlag = `${stageKey}TimedOut`;
  if (!checkFlags[timeoutFlag]) {
    checkFlags[timeoutFlag] = true;
    checks.push({
      name: `tooling_${stageKey}_timeout`,
      status: 'warn',
      message: `${cmd} ${stageKey} requests timed out; adaptive suppression may be enabled.`
    });
  }
  if (Number.isFinite(resolvedHoverDisableAfterTimeouts)
    && fileHoverStats.timedOut >= resolvedHoverDisableAfterTimeouts
    && !fileHoverStats.disabledAdaptive) {
    fileHoverStats.disabledAdaptive = true;
  }
  if (Number.isFinite(resolvedHoverDisableAfterTimeouts)
    && hoverMetrics.timedOut >= resolvedHoverDisableAfterTimeouts) {
    hoverControl.disabledGlobal = true;
  }
};

const handleStageRequestError = ({
  err,
  cmd,
  stageKey,
  guard,
  checks,
  checkFlags,
  fileHoverStats,
  hoverMetrics,
  hoverControl,
  resolvedHoverDisableAfterTimeouts
}) => {
  if (err?.code === 'ABORT_ERR') throw err;
  if (err?.code === 'TOOLING_CIRCUIT_OPEN') {
    recordCircuitOpenCheck({ cmd, guard, checks, checkFlags });
  } else if (err?.code === 'TOOLING_CRASH_LOOP') {
    recordCrashLoopCheck({ cmd, checks, checkFlags, detail: err?.detail || null });
  }
  if (isTimeoutError(err)) {
    recordAdaptiveTimeout({
      cmd,
      stageKey,
      checks,
      checkFlags,
      fileHoverStats,
      hoverMetrics,
      hoverControl,
      resolvedHoverDisableAfterTimeouts
    });
  }
  return null;
};

const recordFallbackReasons = (hoverMetrics, reasons) => {
  if (!hoverMetrics || !Array.isArray(reasons) || !reasons.length) return;
  hoverMetrics.fallbackUsed += 1;
  if (!hoverMetrics.fallbackReasonCounts || typeof hoverMetrics.fallbackReasonCounts !== 'object') {
    hoverMetrics.fallbackReasonCounts = Object.create(null);
  }
  for (const rawReason of reasons) {
    const reason = String(rawReason || '').trim();
    if (!reason) continue;
    hoverMetrics.fallbackReasonCounts[reason] = Number(hoverMetrics.fallbackReasonCounts[reason] || 0) + 1;
  }
};

const buildFallbackReasonCodes = ({
  incompleteState,
  hoverRequested,
  hoverSucceeded,
  signatureHelpRequested,
  signatureHelpSucceeded,
  definitionRequested,
  definitionSucceeded,
  typeDefinitionRequested,
  typeDefinitionSucceeded,
  referencesRequested,
  referencesSucceeded
}) => {
  const reasons = [];
  if (incompleteState?.missingReturn) reasons.push('missing_return_type');
  if (incompleteState?.missingParamTypes) reasons.push('missing_param_types');
  if (!hoverRequested) reasons.push('hover_not_requested');
  else if (!hoverSucceeded) reasons.push('hover_unavailable_or_failed');
  else reasons.push('post_hover_still_incomplete');
  if (!signatureHelpRequested) reasons.push('signature_help_not_requested');
  else if (!signatureHelpSucceeded) reasons.push('signature_help_unavailable_or_failed');
  else reasons.push('post_signature_help_still_incomplete');
  if (!definitionRequested) reasons.push('definition_not_requested');
  else if (!definitionSucceeded) reasons.push('definition_unavailable_or_failed');
  else reasons.push('post_definition_still_incomplete');
  if (!typeDefinitionRequested) reasons.push('type_definition_not_requested');
  else if (!typeDefinitionSucceeded) reasons.push('type_definition_unavailable_or_failed');
  else reasons.push('post_type_definition_still_incomplete');
  if (!referencesRequested) reasons.push('references_not_requested');
  else if (!referencesSucceeded) reasons.push('references_unavailable_or_failed');
  else reasons.push('post_references_still_incomplete');
  return reasons;
};

/**
 * Enrich chunk payloads for one document using symbol + hover information.
 *
 * Fallback semantics:
 * 1. documentSymbol errors are soft-failed per document.
 * 2. hover/signatureHelp/definition/typeDefinition/references requests are deduped by
 *    position and can be suppressed by:
 *    return-type sufficiency, kind filters, per-file budget, adaptive timeout,
 *    or global timeout circuit.
 * 3. source-signature fallback runs only after hover/signatureHelp/definition/
 *    typeDefinition/references attempts still leave the payload incomplete.
 * 4. strict mode throws only when resolved symbol data cannot be mapped to a
 *    chunk uid.
 *
 * @param {object} input
 * @returns {Promise<{enrichedDelta:number}>}
 */
export const processDocumentTypes = async ({
  doc,
  cmd,
  client,
  guard,
  guardRun,
  log,
  strict,
  parseSignature,
  lineIndexFactory,
  uri,
  legacyUri,
  languageId,
  openDocs,
  targetsByPath,
  byChunkUid,
  signatureParseCache,
  hoverEnabled,
  signatureHelpEnabled,
  definitionEnabled,
  typeDefinitionEnabled,
  referencesEnabled,
  hoverRequireMissingReturn,
  resolvedHoverKinds,
  resolvedHoverMaxPerFile,
  resolvedHoverDisableAfterTimeouts,
  resolvedHoverTimeout,
  resolvedSignatureHelpTimeout,
  resolvedDefinitionTimeout,
  resolvedTypeDefinitionTimeout,
  resolvedReferencesTimeout,
  resolvedDocumentSymbolTimeout,
  hoverLimiter,
  signatureHelpLimiter,
  definitionLimiter,
  typeDefinitionLimiter,
  referencesLimiter,
  hoverCacheEntries,
  markHoverCacheDirty,
  hoverControl,
  hoverFileStats,
  hoverLatencyMs,
  hoverMetrics,
  checks,
  checkFlags,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  if (guard.isOpen()) return { enrichedDelta: 0 };
  let openedHere = false;
  const runGuarded = typeof guardRun === 'function'
    ? guardRun
    : ((fn, options) => guard.run(fn, options));

  const docTargets = targetsByPath.get(doc.virtualPath) || [];
  const fileHoverStats = hoverFileStats.get(doc.virtualPath) || createHoverFileStats();
  hoverFileStats.set(doc.virtualPath, fileHoverStats);
  const parseCache = signatureParseCache instanceof Map ? signatureParseCache : null;

  const parseSignatureCached = (detailText, symbolName) => {
    if (typeof parseSignature !== 'function') return null;
    const normalizedDetail = normalizeSignatureCacheText(detailText);
    if (!normalizedDetail) return null;
    const cacheKey = `${languageId || ''}::${normalizedDetail}`;
    if (parseCache?.has(cacheKey)) {
      return parseCache.get(cacheKey);
    }
    const parsed = parseSignature(normalizedDetail, languageId, symbolName) || null;
    if (parseCache) parseCache.set(cacheKey, parsed);
    return parsed;
  };

  if (!openDocs.has(doc.virtualPath)) {
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: doc.text || ''
      }
    });
    openDocs.set(doc.virtualPath, {
      uri,
      legacyUri,
      lineIndex: null,
      text: doc.text || ''
    });
    openedHere = true;
  }

  try {
    throwIfAborted(abortSignal);
    let symbols = null;
    try {
      symbols = await runGuarded(
        ({ timeoutMs: guardTimeout }) => client.request(
          'textDocument/documentSymbol',
          { textDocument: { uri } },
          { timeoutMs: guardTimeout }
        ),
        {
          label: 'documentSymbol',
          ...(resolvedDocumentSymbolTimeout ? { timeoutOverride: resolvedDocumentSymbolTimeout } : {})
        }
      );
    } catch (err) {
      log(`[index] ${cmd} documentSymbol failed (${doc.virtualPath}): ${err?.message || err}`);
      if (err?.code === 'TOOLING_CIRCUIT_OPEN') {
        recordCircuitOpenCheck({ cmd, guard, checks, checkFlags });
      } else if (err?.code === 'TOOLING_CRASH_LOOP') {
        recordCrashLoopCheck({ cmd, checks, checkFlags, detail: err?.detail || null });
      } else {
        recordDocumentSymbolFailureCheck({ cmd, checks, checkFlags, err });
      }
      return { enrichedDelta: 0 };
    }

    const flattened = flattenSymbols(symbols || []);
    if (!flattened.length) {
      return { enrichedDelta: 0 };
    }

    const openEntry = openDocs.get(doc.virtualPath) || null;
    const lineIndex = openEntry?.lineIndex || lineIndexFactory(openEntry?.text || doc.text || '');
    if (openEntry && !openEntry.lineIndex) openEntry.lineIndex = lineIndex;
    const hoverRequestByPosition = new Map();
    const signatureHelpRequestByPosition = new Map();
    const definitionRequestByPosition = new Map();
    const typeDefinitionRequestByPosition = new Map();
    const referencesRequestByPosition = new Map();
    const bestCandidateScoreByChunkUid = new Map();
    const symbolRecords = [];

    const requestHover = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = `${Math.floor(position.line)}:${Math.floor(position.character)}`;
      if (hoverRequestByPosition.has(key)) return hoverRequestByPosition.get(key);
      const hoverCacheKey = buildHoverCacheKey({
        cmd,
        docHash: doc.docHash || null,
        languageId,
        symbolName: symbol?.name,
        position
      });
      const cachedHoverInfo = hoverCacheKey ? hoverCacheEntries.get(hoverCacheKey) : null;
      const promise = (async () => {
        if (cachedHoverInfo?.info) {
          return cachedHoverInfo.info;
        }

        const hoverTimeoutOverride = Number.isFinite(resolvedHoverTimeout)
          ? resolvedHoverTimeout
          : null;
        fileHoverStats.requested += 1;
        hoverMetrics.requested += 1;
        const hoverStartMs = Date.now();

        try {
          throwIfAborted(abortSignal);
          const hover = await hoverLimiter(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/hover', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'hover', ...(hoverTimeoutOverride ? { timeoutOverride: hoverTimeoutOverride } : {}) }
          ));
          const hoverDurationMs = Date.now() - hoverStartMs;
          hoverLatencyMs.push(hoverDurationMs);
          fileHoverStats.latencyMs.push(hoverDurationMs);
          fileHoverStats.succeeded += 1;
          hoverMetrics.succeeded += 1;
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = parseSignatureCached(hoverText, symbol?.name);
          if (hoverCacheKey && hoverInfo) {
            hoverCacheEntries.set(hoverCacheKey, { info: hoverInfo, at: Date.now() });
            markHoverCacheDirty();
          }
          return hoverInfo;
        } catch (err) {
          return handleStageRequestError({
            err,
            cmd,
            stageKey: 'hover',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
        }
      })();
      hoverRequestByPosition.set(key, promise);
      return promise;
    };

    const requestSignatureHelp = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = `${Math.floor(position.line)}:${Math.floor(position.character)}`;
      if (signatureHelpRequestByPosition.has(key)) return signatureHelpRequestByPosition.get(key);
      const runSignatureHelp = typeof signatureHelpLimiter === 'function'
        ? signatureHelpLimiter
        : hoverLimiter;
      const promise = (async () => {
        const timeoutOverride = Number.isFinite(resolvedSignatureHelpTimeout)
          ? resolvedSignatureHelpTimeout
          : null;
        fileHoverStats.signatureHelpRequested += 1;
        hoverMetrics.signatureHelpRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const signatureHelp = await runSignatureHelp(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/signatureHelp', {
              textDocument: { uri },
              position,
              context: {
                triggerKind: 1,
                isRetrigger: false,
                activeSignatureHelp: null
              }
            }, { timeoutMs: guardTimeout }),
            { label: 'signatureHelp', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          fileHoverStats.signatureHelpSucceeded += 1;
          hoverMetrics.signatureHelpSucceeded += 1;
          const signatureText = extractSignatureHelpText(signatureHelp);
          return parseSignatureCached(signatureText, symbol?.name);
        } catch (err) {
          return handleStageRequestError({
            err,
            cmd,
            stageKey: 'signature_help',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
        }
      })();
      signatureHelpRequestByPosition.set(key, promise);
      return promise;
    };

    const requestDefinition = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = `${Math.floor(position.line)}:${Math.floor(position.character)}`;
      if (definitionRequestByPosition.has(key)) return definitionRequestByPosition.get(key);
      const runDefinition = typeof definitionLimiter === 'function'
        ? definitionLimiter
        : hoverLimiter;
      const promise = (async () => {
        const timeoutOverride = Number.isFinite(resolvedDefinitionTimeout)
          ? resolvedDefinitionTimeout
          : null;
        fileHoverStats.definitionRequested += 1;
        hoverMetrics.definitionRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runDefinition(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/definition', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'definition', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const definitionUris = new Set([String(uri || '')]);
          if (legacyUri) definitionUris.add(String(legacyUri));
          for (const location of locations) {
            if (!definitionUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null);
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              fileHoverStats.definitionSucceeded += 1;
              hoverMetrics.definitionSucceeded += 1;
              return info;
            }
          }
          return null;
        } catch (err) {
          return handleStageRequestError({
            err,
            cmd,
            stageKey: 'definition',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
        }
      })();
      definitionRequestByPosition.set(key, promise);
      return promise;
    };

    const requestTypeDefinition = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = `${Math.floor(position.line)}:${Math.floor(position.character)}`;
      if (typeDefinitionRequestByPosition.has(key)) return typeDefinitionRequestByPosition.get(key);
      const runTypeDefinition = typeof typeDefinitionLimiter === 'function'
        ? typeDefinitionLimiter
        : hoverLimiter;
      const promise = (async () => {
        const timeoutOverride = Number.isFinite(resolvedTypeDefinitionTimeout)
          ? resolvedTypeDefinitionTimeout
          : null;
        fileHoverStats.typeDefinitionRequested += 1;
        hoverMetrics.typeDefinitionRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runTypeDefinition(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/typeDefinition', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'typeDefinition', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const definitionUris = new Set([String(uri || '')]);
          if (legacyUri) definitionUris.add(String(legacyUri));
          for (const location of locations) {
            if (!definitionUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null);
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              fileHoverStats.typeDefinitionSucceeded += 1;
              hoverMetrics.typeDefinitionSucceeded += 1;
              return info;
            }
          }
          return null;
        } catch (err) {
          return handleStageRequestError({
            err,
            cmd,
            stageKey: 'type_definition',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
        }
      })();
      typeDefinitionRequestByPosition.set(key, promise);
      return promise;
    };

    const requestReferences = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = `${Math.floor(position.line)}:${Math.floor(position.character)}`;
      if (referencesRequestByPosition.has(key)) return referencesRequestByPosition.get(key);
      const runReferences = typeof referencesLimiter === 'function'
        ? referencesLimiter
        : hoverLimiter;
      const promise = (async () => {
        const timeoutOverride = Number.isFinite(resolvedReferencesTimeout)
          ? resolvedReferencesTimeout
          : null;
        fileHoverStats.referencesRequested += 1;
        hoverMetrics.referencesRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runReferences(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/references', {
              textDocument: { uri },
              position,
              context: { includeDeclaration: true }
            }, { timeoutMs: guardTimeout }),
            { label: 'references', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const referenceUris = new Set([String(uri || '')]);
          if (legacyUri) referenceUris.add(String(legacyUri));
          for (const location of locations) {
            if (!referenceUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null);
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              fileHoverStats.referencesSucceeded += 1;
              hoverMetrics.referencesSucceeded += 1;
              return info;
            }
          }
          return null;
        } catch (err) {
          return handleStageRequestError({
            err,
            cmd,
            stageKey: 'references',
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
        }
      })();
      referencesRequestByPosition.set(key, promise);
      return promise;
    };

    for (const symbol of flattened) {
      throwIfAborted(abortSignal);
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range);
      const target = findTargetForOffsets(docTargets, offsets, symbol.name);
      if (!target) continue;

      const detailText = symbol.detail || symbol.name;
      let info = parseSignatureCached(detailText, symbol.name);
      const incompleteState = isIncompleteTypePayload(info, { symbolKind: symbol?.kind });
      if (incompleteState.incomplete) {
        hoverMetrics.incompleteSymbols += 1;
      }
      const needsHover = hoverRequireMissingReturn === false
        ? incompleteState.incomplete === true
        : (incompleteState.missingReturn || incompleteState.missingParamTypes);
      if (needsHover) {
        hoverMetrics.hoverTriggeredByIncomplete += 1;
      }
      if (!needsHover) {
        fileHoverStats.skippedByReturnSufficient += 1;
        hoverMetrics.skippedByReturnSufficient += 1;
      }

      const symbolKindAllowed = !resolvedHoverKinds
        || (Number.isInteger(symbol?.kind) && resolvedHoverKinds.has(symbol.kind));
      if (!symbolKindAllowed) {
        fileHoverStats.skippedByKind += 1;
        hoverMetrics.skippedByKind += 1;
      }

      const requestBudgetCount = Number(fileHoverStats.requested || 0)
        + Number(fileHoverStats.signatureHelpRequested || 0)
        + Number(fileHoverStats.definitionRequested || 0)
        + Number(fileHoverStats.typeDefinitionRequested || 0)
        + Number(fileHoverStats.referencesRequested || 0);
      const fileOverBudget = Number.isFinite(resolvedHoverMaxPerFile)
        && resolvedHoverMaxPerFile >= 0
        && requestBudgetCount >= resolvedHoverMaxPerFile;
      if (fileOverBudget) {
        fileHoverStats.skippedByBudget += 1;
        hoverMetrics.skippedByBudget += 1;
      }

      const adaptiveDisabled = hoverControl.disabledGlobal || fileHoverStats.disabledAdaptive;
      if (adaptiveDisabled) {
        if (hoverControl.disabledGlobal) {
          fileHoverStats.skippedByGlobalDisable += 1;
          hoverMetrics.skippedByGlobalDisable += 1;
        } else {
          fileHoverStats.skippedByAdaptiveDisable += 1;
          hoverMetrics.skippedByAdaptiveDisable += 1;
        }
      }

      const position = symbol.selectionRange?.start || symbol.range?.start || null;
      const sourceSignature = buildSourceSignatureCandidate(
        openEntry?.text || doc.text || '',
        target?.virtualRange
      );
      const hoverPromise = (
        hoverEnabled
        && needsHover
        && symbolKindAllowed
        && !fileOverBudget
        && !adaptiveDisabled
        && position
      )
        ? requestHover(symbol, position)
        : null;
      symbolRecords.push({
        symbol,
        position,
        target,
        info,
        hoverPromise,
        sourceSignature,
        hoverRequested: hoverPromise != null,
        signatureHelpEligible: (
          signatureHelpEnabled
          && needsHover
          && symbolKindAllowed
          && !fileOverBudget
          && !adaptiveDisabled
          && position != null
        ),
        definitionEligible: (
          definitionEnabled
          && needsHover
          && symbolKindAllowed
          && !fileOverBudget
          && !adaptiveDisabled
          && position != null
          && !sourceSignature
        ),
        typeDefinitionEligible: (
          typeDefinitionEnabled
          && needsHover
          && symbolKindAllowed
          && !fileOverBudget
          && !adaptiveDisabled
          && position != null
          && !sourceSignature
        ),
        referencesEligible: (
          referencesEnabled
          && FUNCTION_LIKE_SYMBOL_KINDS.has(Number(symbol?.kind))
          && needsHover
          && symbolKindAllowed
          && !fileOverBudget
          && !adaptiveDisabled
          && position != null
          && !sourceSignature
        )
      });
    }

    let enrichedDelta = 0;
    const isAdaptiveSuppressed = () => hoverControl.disabledGlobal || fileHoverStats.disabledAdaptive;
    const recordAdaptiveSkip = () => {
      if (hoverControl.disabledGlobal) {
        fileHoverStats.skippedByGlobalDisable += 1;
        hoverMetrics.skippedByGlobalDisable += 1;
      } else if (fileHoverStats.disabledAdaptive) {
        fileHoverStats.skippedByAdaptiveDisable += 1;
        hoverMetrics.skippedByAdaptiveDisable += 1;
      }
    };
    for (const record of symbolRecords) {
      throwIfAborted(abortSignal);
      let info = record.info;
      let hoverSucceeded = false;
      let signatureHelpSucceeded = false;
      let signatureHelpRequested = false;
      let definitionSucceeded = false;
      let definitionRequested = false;
      let typeDefinitionSucceeded = false;
      let typeDefinitionRequested = false;
      let referencesSucceeded = false;
      let referencesRequested = false;
      if (record.hoverPromise) {
        const hoverInfo = await record.hoverPromise;
        if (hoverInfo) {
          hoverSucceeded = true;
          info = mergeSignatureInfo(info, hoverInfo, { symbolKind: record?.symbol?.kind });
        }
      }

      const incompleteAfterHover = isIncompleteTypePayload(info, {
        symbolKind: record?.symbol?.kind
      });
      if (incompleteAfterHover.incomplete && record.signatureHelpEligible) {
        if (isAdaptiveSuppressed()) {
          recordAdaptiveSkip();
        } else {
          signatureHelpRequested = true;
          const signatureHelpInfo = await requestSignatureHelp(record.symbol, record.position);
          if (signatureHelpInfo) {
            signatureHelpSucceeded = true;
            info = mergeSignatureInfo(info, signatureHelpInfo, { symbolKind: record?.symbol?.kind });
          }
        }
      }

      const incompleteAfterSignatureHelp = isIncompleteTypePayload(info, {
        symbolKind: record?.symbol?.kind
      });
      if (incompleteAfterSignatureHelp.incomplete && record.definitionEligible) {
        if (isAdaptiveSuppressed()) {
          recordAdaptiveSkip();
        } else {
          definitionRequested = true;
          const definitionInfo = await requestDefinition(record.symbol, record.position);
          if (definitionInfo) {
            definitionSucceeded = true;
            info = mergeSignatureInfo(info, definitionInfo, { symbolKind: record?.symbol?.kind });
          }
        }
      }
      const incompleteAfterDefinition = isIncompleteTypePayload(info, {
        symbolKind: record?.symbol?.kind
      });
      if (incompleteAfterDefinition.incomplete && record.typeDefinitionEligible) {
        if (isAdaptiveSuppressed()) {
          recordAdaptiveSkip();
        } else {
          typeDefinitionRequested = true;
          const typeDefinitionInfo = await requestTypeDefinition(record.symbol, record.position);
          if (typeDefinitionInfo) {
            typeDefinitionSucceeded = true;
            info = mergeSignatureInfo(info, typeDefinitionInfo, { symbolKind: record?.symbol?.kind });
          }
        }
      }
      const incompleteAfterTypeDefinition = isIncompleteTypePayload(info, {
        symbolKind: record?.symbol?.kind
      });
      if (incompleteAfterTypeDefinition.incomplete && record.referencesEligible) {
        if (isAdaptiveSuppressed()) {
          recordAdaptiveSkip();
        } else {
          referencesRequested = true;
          const referencesInfo = await requestReferences(record.symbol, record.position);
          if (referencesInfo) {
            referencesSucceeded = true;
            info = mergeSignatureInfo(info, referencesInfo, { symbolKind: record?.symbol?.kind });
          }
        }
      }
      const incompleteAfterReferences = isIncompleteTypePayload(info, {
        symbolKind: record?.symbol?.kind
      });
      if (incompleteAfterReferences.incomplete && record.sourceSignature) {
        const sourceInfo = parseSignatureCached(record.sourceSignature, record?.symbol?.name);
        if (sourceInfo) {
          const fallbackReasons = buildFallbackReasonCodes({
            incompleteState: incompleteAfterReferences,
            hoverRequested: record.hoverRequested === true,
            hoverSucceeded,
            signatureHelpRequested,
            signatureHelpSucceeded,
            definitionRequested,
            definitionSucceeded,
            typeDefinitionRequested,
            typeDefinitionSucceeded,
            referencesRequested,
            referencesSucceeded
          });
          recordFallbackReasons(hoverMetrics, fallbackReasons);
          info = mergeSignatureInfo(info, sourceInfo, { symbolKind: record?.symbol?.kind });
        }
      }
      if (!info) continue;

      const chunkUid = record.target?.chunkRef?.chunkUid;
      if (!chunkUid) {
        if (strict) throw new Error('LSP output missing chunkUid.');
        continue;
      }

      const normalizedSignature = normalizeTypeText(info.signature);
      let normalizedReturn = normalizeTypeText(info.returnType);
      if (normalizedReturn === 'Void' && normalizedSignature?.includes('->')) {
        const arrowMatch = normalizedSignature.split('->').pop();
        const trimmed = arrowMatch ? arrowMatch.trim() : '';
        if (trimmed) {
          normalizedReturn = trimmed === '()' ? 'Void' : trimmed;
        }
      }

      const payload = {
        returnType: normalizedReturn,
        paramTypes: normalizeParamTypes(info.paramTypes),
        signature: normalizedSignature
      };
      const candidateScore = scoreChunkPayloadCandidate({
        info,
        symbol: record.symbol,
        target: record.target
      });
      const existingScore = bestCandidateScoreByChunkUid.get(chunkUid);
      if (Number.isFinite(existingScore) && existingScore > candidateScore) {
        continue;
      }
      if (Number.isFinite(existingScore) && existingScore === candidateScore) {
        const existingSignatureLength = String(byChunkUid[chunkUid]?.payload?.signature || '').length;
        const candidateSignatureLength = String(payload.signature || '').length;
        if (existingSignatureLength >= candidateSignatureLength) {
          continue;
        }
      }

      bestCandidateScoreByChunkUid.set(chunkUid, candidateScore);
      byChunkUid[chunkUid] = {
        chunk: record.target.chunkRef,
        payload,
        provenance: {
          provider: cmd,
          version: '1.0.0',
          collectedAt: new Date().toISOString()
        }
      };
      enrichedDelta += 1;
    }

    return { enrichedDelta };
  } finally {
    if (openedHere) {
      // Retain the URI/line-index mapping until diagnostics shaping completes.
      // For tokenized poc-vfs URIs, fallback URI reconstruction can differ from
      // the didOpen URI, so deleting this too early drops diagnostics.
      client.notify('textDocument/didClose', { textDocument: { uri } }, { startIfNeeded: false });
    }
  }
};
