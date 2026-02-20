import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLineIndex } from '../../../shared/lines.js';
import { createLspClient, languageIdForFileExt, pathToFileUri } from '../lsp/client.js';
import { rangeToOffsets } from '../lsp/positions.js';
import { flattenSymbols } from '../lsp/symbols.js';
import { buildVfsUri, resolveVfsTokenUri } from '../lsp/uris.js';
import { createToolingGuard } from './shared.js';
import { buildIndexSignature } from '../../../retrieval/index-cache.js';
import {
  computeVfsManifestHash,
  createVfsColdStartCache,
  ensureVfsDiskDocument,
  resolveVfsDiskPath
} from '../../../index/tooling/vfs.js';

const DEFAULT_MAX_DIAGNOSTIC_URIS = 1000;
const DEFAULT_MAX_DIAGNOSTICS_PER_URI = 200;
const DEFAULT_MAX_DIAGNOSTICS_PER_CHUNK = 100;
const DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY = 4;
const DEFAULT_HOVER_CONCURRENCY = 8;
const DEFAULT_HOVER_CACHE_MAX_ENTRIES = 50000;

const clampPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const clampIntRange = (value, fallback, { min = 1, max = 64 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return Math.max(min, Math.min(max, normalized));
};

const runWithConcurrency = async (items, concurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const maxWorkers = Math.max(1, Math.min(list.length, clampIntRange(concurrency, 1, { min: 1, max: 128 })));
  let index = 0;
  const runners = Array.from({ length: maxWorkers }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= list.length) break;
      await worker(list[current], current);
    }
  });
  await Promise.all(runners);
};

const createConcurrencyLimiter = (concurrency) => {
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

const loadHoverCache = async (cacheRoot) => {
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

const persistHoverCache = async ({ cachePath, entries, maxEntries }) => {
  if (!cachePath || !(entries instanceof Map)) return;
  const rows = Array.from(entries.entries()).map(([key, value]) => ({
    key,
    value
  }));
  rows.sort((a, b) => Number(b?.value?.at || 0) - Number(a?.value?.at || 0));
  const cap = clampIntRange(maxEntries, DEFAULT_HOVER_CACHE_MAX_ENTRIES, { min: 1000, max: 200000 });
  const limited = rows.slice(0, cap);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    entries: limited
  }));
};

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

const diagnosticKey = (diag) => {
  if (!diag || typeof diag !== 'object') return '';
  const range = diag.range || {};
  const start = range.start || {};
  const end = range.end || {};
  return [
    String(diag.code || ''),
    String(diag.severity || ''),
    String(diag.source || ''),
    String(diag.message || ''),
    `${start.line ?? ''}:${start.character ?? ''}`,
    `${end.line ?? ''}:${end.character ?? ''}`
  ].join('|');
};

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

const normalizeTypeText = (value) => {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
};

const normalizeSignatureCacheText = (value) => (
  String(value || '').replace(/\s+/g, ' ').trim()
);

const toFiniteInt = (value, min = null) => {
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

const normalizeHoverKinds = (kinds) => {
  if (kinds == null) return null;
  const source = Array.isArray(kinds) ? kinds : [kinds];
  const normalized = source
    .map((entry) => toFiniteInt(entry, 0))
    .filter((entry) => Number.isFinite(entry));
  if (!normalized.length) return null;
  return new Set(normalized);
};

const normalizeParamTypes = (paramTypes) => {
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

const findTargetForOffsets = (targets, offsets, nameHint = null) => {
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
 * Ensure a VFS document exists on disk for file-based LSP servers.
 * Uses docHash to avoid unnecessary rewrites.
 */
const ensureVirtualFile = async (rootDir, doc, coldStartCache = null) => {
  const virtualPath = doc?.virtualPath;
  const normalized = typeof virtualPath === 'string' ? virtualPath.replace(/\\/g, '/') : '';
  if (!normalized) {
    throw new Error('LSP document is missing a virtualPath.');
  }
  if (path.isAbsolute(normalized) || normalized.startsWith('/')) {
    throw new Error(`LSP virtualPath must be relative: ${normalized}`);
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error(`LSP virtualPath must not escape the VFS root: ${normalized}`);
  }
  const result = await ensureVfsDiskDocument({
    baseDir: rootDir,
    virtualPath: doc.virtualPath,
    text: doc.text || '',
    docHash: doc.docHash || null,
    coldStartCache
  });
  return result.path;
};

export const resolveVfsIoBatching = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (value.enabled !== true) return null;
  const maxInflightRaw = Number(value.maxInflight);
  const maxInflight = Number.isFinite(maxInflightRaw) ? Math.max(1, Math.floor(maxInflightRaw)) : 4;
  const maxQueueRaw = Number(value.maxQueueEntries);
  const maxQueueEntries = Number.isFinite(maxQueueRaw) ? Math.max(1, Math.floor(maxQueueRaw)) : 5000;
  return { maxInflight, maxQueueEntries };
};

export const ensureVirtualFilesBatch = async ({ rootDir, docs, batching, coldStartCache }) => {
  const results = new Map();
  if (!Array.isArray(docs) || docs.length === 0) return results;
  const maxInflight = batching?.maxInflight ? Math.max(1, batching.maxInflight) : 1;
  const maxQueueEntries = batching?.maxQueueEntries
    ? Math.max(1, batching.maxQueueEntries)
    : docs.length;
  for (let start = 0; start < docs.length; start += maxQueueEntries) {
    const slice = docs.slice(start, start + maxQueueEntries);
    let index = 0;
    const workers = Array.from({ length: maxInflight }, async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= slice.length) break;
        const doc = slice[current];
        const result = await ensureVfsDiskDocument({
          baseDir: rootDir,
          virtualPath: doc.virtualPath,
          text: doc.text || '',
          docHash: doc.docHash || null,
          coldStartCache
        });
        results.set(doc.virtualPath, result.path);
      }
    });
    await Promise.all(workers);
  }
  return results;
};

const normalizeUriScheme = (value) => (value === 'poc-vfs' ? 'poc-vfs' : 'file');

const resolveDocumentUri = async ({
  rootDir,
  doc,
  uriScheme,
  tokenMode,
  diskPathMap,
  coldStartCache
}) => {
  if (uriScheme === 'poc-vfs') {
    const resolved = await resolveVfsTokenUri({
      virtualPath: doc.virtualPath,
      docHash: doc.docHash || null,
      mode: tokenMode
    });
    return resolved.uri;
  }
  const cachedPath = diskPathMap?.get(doc.virtualPath) || null;
  const absPath = cachedPath || await ensureVirtualFile(rootDir, doc, coldStartCache);
  return pathToFileUri(absPath);
};

export async function collectLspTypes({
  rootDir,
  documents,
  targets,
  log = () => {},
  cmd,
  args,
  timeoutMs = 15000,
  retries = 2,
  breakerThreshold = 3,
  parseSignature,
  strict = true,
  vfsRoot = null,
  uriScheme = 'file',
  captureDiagnostics = false,
  vfsTokenMode = 'docHash+virtualPath',
  vfsIoBatching = null,
  lineIndexFactory = buildLineIndex,
  indexDir = null,
  vfsColdStartCache = null,
  cacheRoot = null,
  hoverTimeoutMs = null,
  hoverEnabled = true,
  hoverRequireMissingReturn = true,
  hoverSymbolKinds = null,
  hoverMaxPerFile = null,
  hoverDisableAfterTimeouts = null,
  maxDiagnosticUris = DEFAULT_MAX_DIAGNOSTIC_URIS,
  maxDiagnosticsPerUri = DEFAULT_MAX_DIAGNOSTICS_PER_URI,
  maxDiagnosticsPerChunk = DEFAULT_MAX_DIAGNOSTICS_PER_CHUNK,
  documentSymbolTimeoutMs = null,
  documentSymbolConcurrency = DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
  hoverConcurrency = DEFAULT_HOVER_CONCURRENCY,
  hoverCacheMaxEntries = DEFAULT_HOVER_CACHE_MAX_ENTRIES,
  stderrFilter = null,
  initializationOptions = null
}) {
  const resolvePositiveTimeout = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.max(1000, Math.floor(parsed));
  };
  const resolvedHoverTimeout = resolvePositiveTimeout(hoverTimeoutMs);
  const resolvedDocumentSymbolTimeout = resolvePositiveTimeout(documentSymbolTimeoutMs);
  const resolvedHoverMaxPerFile = toFiniteInt(hoverMaxPerFile, 0);
  const resolvedHoverDisableAfterTimeouts = toFiniteInt(hoverDisableAfterTimeouts, 1);
  const resolvedHoverKinds = normalizeHoverKinds(hoverSymbolKinds);
  const resolvedMaxDiagnosticUris = clampPositiveInt(maxDiagnosticUris, DEFAULT_MAX_DIAGNOSTIC_URIS);
  const resolvedMaxDiagnosticsPerUri = clampPositiveInt(maxDiagnosticsPerUri, DEFAULT_MAX_DIAGNOSTICS_PER_URI);
  const resolvedMaxDiagnosticsPerChunk = clampPositiveInt(maxDiagnosticsPerChunk, DEFAULT_MAX_DIAGNOSTICS_PER_CHUNK);
  const resolvedDocumentSymbolConcurrency = clampIntRange(
    documentSymbolConcurrency,
    DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
    { min: 1, max: 32 }
  );
  const resolvedHoverConcurrency = clampIntRange(
    hoverConcurrency,
    DEFAULT_HOVER_CONCURRENCY,
    { min: 1, max: 64 }
  );
  const resolvedHoverCacheMaxEntries = clampIntRange(
    hoverCacheMaxEntries,
    DEFAULT_HOVER_CACHE_MAX_ENTRIES,
    { min: 1000, max: 200000 }
  );
  const checks = [];
  const docs = Array.isArray(documents) ? documents : [];
  const targetList = Array.isArray(targets) ? targets : [];
  if (!docs.length || !targetList.length) {
    return {
      byChunkUid: {},
      diagnosticsByChunkUid: {},
      enriched: 0,
      diagnosticsCount: 0,
      checks,
      hoverMetrics: {
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
      }
    };
  }

  const resolvedRoot = vfsRoot || rootDir;
  const resolvedScheme = normalizeUriScheme(uriScheme);
  const resolvedBatching = resolveVfsIoBatching(vfsIoBatching);
  const targetsByPath = new Map();
  for (const target of targetList) {
    const chunkRef = target?.chunkRef || target?.chunk || null;
    if (!target?.virtualPath || !chunkRef?.chunkUid) continue;
    const list = targetsByPath.get(target.virtualPath) || [];
    list.push({ ...target, chunkRef });
    targetsByPath.set(target.virtualPath, list);
  }
  const docsToOpen = docs.filter((doc) => (targetsByPath.get(doc.virtualPath) || []).length);
  if (!docsToOpen.length) {
    return {
      byChunkUid: {},
      diagnosticsByChunkUid: {},
      enriched: 0,
      diagnosticsCount: 0,
      checks,
      hoverMetrics: {
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
      }
    };
  }

  let coldStartCache = null;
  if (vfsColdStartCache !== false) {
    const resolvedIndexDir = indexDir || resolvedRoot || rootDir;
    const indexSignature = resolvedIndexDir ? await buildIndexSignature(resolvedIndexDir) : null;
    const manifestHash = resolvedIndexDir ? await computeVfsManifestHash({ indexDir: resolvedIndexDir }) : null;
    coldStartCache = await createVfsColdStartCache({
      cacheRoot,
      indexSignature,
      manifestHash,
      config: vfsColdStartCache
    });
  }

  const diagnosticsByUri = new Map();
  const checkFlags = {
    diagnosticsPerUriTrimmed: false,
    diagnosticsUriBufferTrimmed: false,
    diagnosticsPerChunkTrimmed: false,
    hoverTimedOut: false,
    circuitOpened: false,
    initializeFailed: false
  };
  const setDiagnosticsForUri = (uri, diagnostics) => {
    const source = Array.isArray(diagnostics) ? diagnostics : [];
    if (!uri) return;
    const limited = source.length > resolvedMaxDiagnosticsPerUri
      ? source.slice(0, resolvedMaxDiagnosticsPerUri)
      : source;
    if (source.length > resolvedMaxDiagnosticsPerUri && !checkFlags.diagnosticsPerUriTrimmed) {
      checkFlags.diagnosticsPerUriTrimmed = true;
      checks.push({
        name: 'tooling_diagnostics_per_uri_capped',
        status: 'warn',
        message: `LSP diagnostics per URI capped at ${resolvedMaxDiagnosticsPerUri}.`,
        count: source.length
      });
    }
    if (diagnosticsByUri.has(uri)) diagnosticsByUri.delete(uri);
    diagnosticsByUri.set(uri, limited);
    while (diagnosticsByUri.size > resolvedMaxDiagnosticUris) {
      const oldest = diagnosticsByUri.keys().next();
      if (oldest.done) break;
      diagnosticsByUri.delete(oldest.value);
      if (!checkFlags.diagnosticsUriBufferTrimmed) {
        checkFlags.diagnosticsUriBufferTrimmed = true;
        checks.push({
          name: 'tooling_diagnostics_uri_buffer_capped',
          status: 'warn',
          message: `LSP diagnostics URI buffer capped at ${resolvedMaxDiagnosticUris}.`
        });
      }
    }
  };
  const client = createLspClient({
    cmd,
    args,
    cwd: rootDir,
    log,
    stderrFilter,
    onNotification: (msg) => {
      if (!captureDiagnostics) return;
      if (msg?.method !== 'textDocument/publishDiagnostics') return;
      const uri = msg?.params?.uri;
      const diagnostics = msg?.params?.diagnostics;
      if (!uri || !Array.isArray(diagnostics)) return;
      setDiagnosticsForUri(uri, diagnostics);
    }
  });
  const guard = createToolingGuard({
    name: cmd,
    timeoutMs,
    retries,
    breakerThreshold,
    log
  });

  const rootUri = pathToFileUri(rootDir);
  try {
    await guard.run(({ timeoutMs: guardTimeout }) => client.initialize({
      rootUri,
      capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
      initializationOptions,
      timeoutMs: guardTimeout
    }), { label: 'initialize' });
  } catch (err) {
    checkFlags.initializeFailed = true;
    checks.push({
      name: 'tooling_initialize_failed',
      status: 'warn',
      message: `${cmd} initialize failed: ${err?.message || err}`
    });
    log(`[index] ${cmd} initialize failed: ${err?.message || err}`);
    client.kill();
    return {
      byChunkUid: {},
      diagnosticsByChunkUid: {},
      enriched: 0,
      diagnosticsCount: 0,
      checks,
      hoverMetrics: {
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
      }
    };
  }

  const byChunkUid = {};
  let enriched = 0;
  const signatureParseCache = new Map();
  const hoverFileStats = new Map();
  const hoverLatencyMs = [];
  const hoverMetrics = {
    requested: 0,
    succeeded: 0,
    timedOut: 0,
    skippedByBudget: 0,
    skippedByKind: 0,
    skippedByReturnSufficient: 0,
    skippedByAdaptiveDisable: 0,
    skippedByGlobalDisable: 0
  };
  let hoverDisabledGlobal = false;
  const hoverLimiter = createConcurrencyLimiter(resolvedHoverConcurrency);
  const hoverCacheState = await loadHoverCache(cacheRoot);
  const hoverCacheEntries = hoverCacheState.entries;
  let hoverCacheDirty = false;

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

  const parseSignatureCached = (detailText, symbolName, languageId) => {
    if (typeof parseSignature !== 'function') return null;
    const normalizedDetail = normalizeSignatureCacheText(detailText);
    if (!normalizedDetail) return null;
    const cacheKey = `${languageId || ''}::${normalizedDetail}`;
    if (signatureParseCache.has(cacheKey)) {
      return signatureParseCache.get(cacheKey);
    }
    const parsed = parseSignature(normalizedDetail, languageId, symbolName) || null;
    signatureParseCache.set(cacheKey, parsed);
    return parsed;
  };

  const openDocs = new Map();
  const diskPathMap = resolvedScheme === 'file'
    ? await ensureVirtualFilesBatch({
      rootDir: resolvedRoot,
      docs: docsToOpen,
      batching: resolvedBatching,
      coldStartCache
    })
    : null;
  const processDoc = async (doc) => {
    if (guard.isOpen()) return;
    const fileHoverStats = hoverFileStats.get(doc.virtualPath) || createHoverFileStats();
    hoverFileStats.set(doc.virtualPath, fileHoverStats);
    const docTargets = targetsByPath.get(doc.virtualPath) || [];
    const languageId = doc.languageId || languageIdForFileExt(path.extname(doc.virtualPath));
    const uri = await resolveDocumentUri({
      rootDir: resolvedRoot,
      doc,
      uriScheme: resolvedScheme,
      tokenMode: vfsTokenMode,
      diskPathMap,
      coldStartCache
    });
    const legacyUri = resolvedScheme === 'poc-vfs' ? buildVfsUri(doc.virtualPath) : null;
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
      let symbols = null;
      try {
        symbols = await guard.run(
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
        if (err?.code === 'TOOLING_CIRCUIT_OPEN' && !checkFlags.circuitOpened) {
          checkFlags.circuitOpened = true;
          const state = guard.getState?.() || null;
          checks.push({
            name: 'tooling_circuit_open',
            status: 'warn',
            message: `${cmd} circuit breaker opened after ${state?.consecutiveFailures ?? 'unknown'} failures.`,
            count: state?.tripCount ?? 1
          });
        }
        return;
      }

      const flattened = flattenSymbols(symbols || []);
      if (!flattened.length) {
        return;
      }

      const openEntry = openDocs.get(doc.virtualPath) || null;
      const lineIndex = openEntry?.lineIndex || lineIndexFactory(openEntry?.text || doc.text || '');
      if (openEntry && !openEntry.lineIndex) openEntry.lineIndex = lineIndex;
      const hoverRequestByPosition = new Map();
      const symbolRecords = [];

      const requestHover = (symbol, position) => {
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
            const hover = await hoverLimiter(() => guard.run(
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
            const hoverInfo = parseSignatureCached(hoverText, symbol?.name, languageId);
            if (hoverCacheKey && hoverInfo) {
              hoverCacheEntries.set(hoverCacheKey, { info: hoverInfo, at: Date.now() });
              hoverCacheDirty = true;
            }
            return hoverInfo;
          } catch (err) {
            const message = String(err?.message || err || '').toLowerCase();
            const isTimeout = message.includes('timeout');
            if (err?.code === 'TOOLING_CIRCUIT_OPEN' && !checkFlags.circuitOpened) {
              checkFlags.circuitOpened = true;
              const state = guard.getState?.() || null;
              checks.push({
                name: 'tooling_circuit_open',
                status: 'warn',
                message: `${cmd} circuit breaker opened after ${state?.consecutiveFailures ?? 'unknown'} failures.`,
                count: state?.tripCount ?? 1
              });
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
                hoverDisabledGlobal = true;
              }
            }
            return null;
          }
        })();
        hoverRequestByPosition.set(key, promise);
        return promise;
      };

      for (const symbol of flattened) {
        const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range);
        const target = findTargetForOffsets(docTargets, offsets, symbol.name);
        if (!target) continue;
        const detailText = symbol.detail || symbol.name;
        let info = parseSignatureCached(detailText, symbol.name, languageId);
        if (!hasParamTypes(info?.paramTypes)) {
          const sourceSignature = buildSourceSignatureCandidate(
            openEntry?.text || doc.text || '',
            target?.virtualRange
          );
          if (sourceSignature) {
            const sourceInfo = parseSignatureCached(sourceSignature, symbol.name, languageId);
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
        const adaptiveDisabled = hoverDisabledGlobal || fileHoverStats.disabledAdaptive;
        if (adaptiveDisabled) {
          if (hoverDisabledGlobal) {
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

      for (const record of symbolRecords) {
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
        enriched += 1;
      }
    } finally {
      client.notify('textDocument/didClose', { textDocument: { uri } });
    }
  };

  await runWithConcurrency(docsToOpen, resolvedDocumentSymbolConcurrency, processDoc);
  if (hoverCacheDirty) {
    try {
      await persistHoverCache({
        cachePath: hoverCacheState.path,
        entries: hoverCacheEntries,
        maxEntries: resolvedHoverCacheMaxEntries
      });
    } catch {}
  }

  const diagnosticsByChunkUid = {};
  const diagnosticsSeenByChunkUid = new Map();
  let diagnosticsCount = 0;
  if (captureDiagnostics && diagnosticsByUri.size) {
    for (const doc of docs) {
      const resolvedDiskPath = diskPathMap?.get(doc.virtualPath)
        || resolveVfsDiskPath({ baseDir: resolvedRoot, virtualPath: doc.virtualPath });
      const fallbackUri = resolvedScheme === 'poc-vfs'
        ? buildVfsUri(doc.virtualPath)
        : pathToFileUri(resolvedDiskPath);
      const openEntry = openDocs.get(doc.virtualPath) || null;
      const uri = openEntry?.uri || fallbackUri;
      const diagnostics = diagnosticsByUri.get(uri)
        || (openEntry?.legacyUri ? diagnosticsByUri.get(openEntry.legacyUri) : null)
        || [];
      if (!diagnostics.length) continue;
      const lineIndex = openEntry?.lineIndex
        || lineIndexFactory(openEntry?.text || doc.text || '');
      if (openEntry && !openEntry.lineIndex) openEntry.lineIndex = lineIndex;
      const docTargets = targetsByPath.get(doc.virtualPath) || [];
      for (const diag of diagnostics) {
        const offsets = rangeToOffsets(lineIndex, diag.range);
        const target = findTargetForOffsets(docTargets, offsets);
        if (!target?.chunkRef?.chunkUid) continue;
        const chunkUid = target.chunkRef.chunkUid;
        const existing = diagnosticsByChunkUid[chunkUid] || [];
        if (existing.length >= resolvedMaxDiagnosticsPerChunk) {
          if (!checkFlags.diagnosticsPerChunkTrimmed) {
            checkFlags.diagnosticsPerChunkTrimmed = true;
            checks.push({
              name: 'tooling_diagnostics_per_chunk_capped',
              status: 'warn',
              message: `LSP diagnostics per chunk capped at ${resolvedMaxDiagnosticsPerChunk}.`
            });
          }
          continue;
        }
        const seen = diagnosticsSeenByChunkUid.get(chunkUid) || new Set();
        const key = diagnosticKey(diag);
        if (key && seen.has(key)) continue;
        if (key) {
          seen.add(key);
          diagnosticsSeenByChunkUid.set(chunkUid, seen);
        }
        existing.push(diag);
        diagnosticsByChunkUid[chunkUid] = existing;
        diagnosticsCount += 1;
      }
    }
  }

  if (coldStartCache?.flush) {
    try {
      await coldStartCache.flush();
    } catch (err) {
      log(`[tooling] vfs cold-start cache flush failed: ${err?.message || err}`);
    }
  }

  await client.shutdownAndExit();
  client.kill();
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
    byChunkUid,
    diagnosticsByChunkUid,
    enriched,
    diagnosticsCount,
    checks,
    hoverMetrics: {
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
    }
  };
}
