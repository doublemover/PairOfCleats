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
  const queue = [];

  const pump = () => {
    while (active < maxWorkers && queue.length) {
      const task = queue.shift();
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
  return normalizeSignatureCacheText(candidate.slice(0, lastParen + 1));
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
 * Merge signature candidates, preferring stronger return/signature evidence and
 * preserving existing high-confidence param metadata.
 *
 * @param {object|null} base
 * @param {object|null} next
 * @returns {object|null}
 */
const mergeSignatureInfo = (base, next) => {
  if (!next) return base;
  if (!base) return next;
  const merged = { ...base };
  if ((!merged.returnType || merged.returnType === 'Void')
    && next.returnType
    && next.returnType !== 'Void') {
    merged.returnType = next.returnType;
  }
  if (!merged.signature
    || (!merged.signature.includes('->') && next.signature?.includes('->'))) {
    if (next.signature) merged.signature = next.signature;
  }
  const baseParamTypes = merged.paramTypes && typeof merged.paramTypes === 'object'
    ? merged.paramTypes
    : null;
  const nextParamTypes = next.paramTypes && typeof next.paramTypes === 'object'
    ? next.paramTypes
    : null;
  if (nextParamTypes) {
    merged.paramTypes = {
      ...nextParamTypes,
      ...(baseParamTypes || {})
    };
  }
  if ((!merged.paramNames || !merged.paramNames.length) && next.paramNames?.length) {
    merged.paramNames = next.paramNames;
  }
  return merged;
};

/**
 * Create default hover metrics envelope.
 * @returns {object}
 */
export const createEmptyHoverMetricsResult = () => ({
  requested: 0,
  succeeded: 0,
  timedOut: 0,
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
    timedOut: hoverMetrics.timedOut,
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

/**
 * Enrich chunk payloads for one document using symbol + hover information.
 *
 * Fallback semantics:
 * 1. documentSymbol errors are soft-failed per document.
 * 2. hover requests are deduped by position and can be suppressed by:
 *    return-type sufficiency, kind filters, per-file budget, adaptive timeout,
 *    or global timeout circuit.
 * 3. strict mode throws only when resolved symbol data cannot be mapped to a
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
  hoverRequireMissingReturn,
  resolvedHoverKinds,
  resolvedHoverMaxPerFile,
  resolvedHoverDisableAfterTimeouts,
  resolvedHoverTimeout,
  resolvedDocumentSymbolTimeout,
  hoverLimiter,
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
          if (err?.code === 'ABORT_ERR') throw err;
          const message = String(err?.message || err || '').toLowerCase();
          const isTimeout = message.includes('timeout');
          if (err?.code === 'TOOLING_CIRCUIT_OPEN') {
            recordCircuitOpenCheck({ cmd, guard, checks, checkFlags });
          } else if (err?.code === 'TOOLING_CRASH_LOOP') {
            recordCrashLoopCheck({ cmd, checks, checkFlags, detail: err?.detail || null });
          }
          if (isTimeout) {
            fileHoverStats.timedOut += 1;
            hoverMetrics.timedOut += 1;
            if (!checkFlags.hoverTimedOut) {
              checkFlags.hoverTimedOut = true;
              checks.push({
                name: 'tooling_hover_timeout',
                status: 'warn',
                message: `${cmd} hover requests timed out; adaptive suppression may be enabled.`
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
          }
          return null;
        }
      })();
      hoverRequestByPosition.set(key, promise);
      return promise;
    };

    for (const symbol of flattened) {
      throwIfAborted(abortSignal);
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range);
      const target = findTargetForOffsets(docTargets, offsets, symbol.name);
      if (!target) continue;

      const detailText = symbol.detail || symbol.name;
      let info = parseSignatureCached(detailText, symbol.name);
      if (!hasParamTypes(info?.paramTypes)) {
        const sourceSignature = buildSourceSignatureCandidate(
          openEntry?.text || doc.text || '',
          target?.virtualRange
        );
        if (sourceSignature) {
          const sourceInfo = parseSignatureCached(sourceSignature, symbol.name);
          if (hasParamTypes(sourceInfo?.paramTypes)) {
            info = mergeSignatureInfo(info, sourceInfo);
          }
        }
      }

      const hasExplicitArrow = typeof detailText === 'string' && detailText.includes('->');
      const hasSignatureArrow = typeof info?.signature === 'string' && info.signature.includes('->');
      const normalizedReturnType = normalizeTypeText(info?.returnType);
      const treatVoidAsMissing = normalizedReturnType === 'Void' && (hasExplicitArrow || hasSignatureArrow);
      const ambiguousReturn = !normalizedReturnType
        || /^unknown$/i.test(normalizedReturnType)
        || /^any\b/i.test(normalizedReturnType)
        || treatVoidAsMissing;
      const needsHover = hoverRequireMissingReturn === true
        ? ambiguousReturn
        : (!info || !info.returnType || ambiguousReturn);
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

      const fileOverBudget = Number.isFinite(resolvedHoverMaxPerFile)
        && resolvedHoverMaxPerFile >= 0
        && fileHoverStats.requested >= resolvedHoverMaxPerFile;
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
      symbolRecords.push({ symbol, target, info, hoverPromise });
    }

    let enrichedDelta = 0;
    for (const record of symbolRecords) {
      throwIfAborted(abortSignal);
      let info = record.info;
      if (record.hoverPromise) {
        const hoverInfo = await record.hoverPromise;
        if (hoverInfo) info = mergeSignatureInfo(info, hoverInfo);
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

      byChunkUid[chunkUid] = {
        chunk: record.target.chunkRef,
        payload: {
          returnType: normalizedReturn,
          paramTypes: normalizeParamTypes(info.paramTypes),
          signature: normalizedSignature
        },
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
    client.notify('textDocument/didClose', { textDocument: { uri } });
  }
};
