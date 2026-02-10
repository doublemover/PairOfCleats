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
  hoverDisableAfterTimeouts = null
}) {
  const resolvePositiveTimeout = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.max(1000, Math.floor(parsed));
  };
  const resolvedHoverTimeout = resolvePositiveTimeout(hoverTimeoutMs);
  const resolvedHoverMaxPerFile = toFiniteInt(hoverMaxPerFile, 0);
  const resolvedHoverDisableAfterTimeouts = toFiniteInt(hoverDisableAfterTimeouts, 1);
  const resolvedHoverKinds = normalizeHoverKinds(hoverSymbolKinds);
  const docs = Array.isArray(documents) ? documents : [];
  const targetList = Array.isArray(targets) ? targets : [];
  if (!docs.length || !targetList.length) {
    return {
      byChunkUid: {},
      diagnosticsByChunkUid: {},
      enriched: 0,
      diagnosticsCount: 0,
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
  const client = createLspClient({
    cmd,
    args,
    cwd: rootDir,
    log,
    onNotification: (msg) => {
      if (!captureDiagnostics) return;
      if (msg?.method !== 'textDocument/publishDiagnostics') return;
      const uri = msg?.params?.uri;
      const diagnostics = msg?.params?.diagnostics;
      if (!uri || !Array.isArray(diagnostics)) return;
      diagnosticsByUri.set(uri, diagnostics);
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
      timeoutMs: guardTimeout
    }), { label: 'initialize' });
  } catch (err) {
    log(`[index] ${cmd} initialize failed: ${err?.message || err}`);
    client.kill();
    return {
      byChunkUid: {},
      diagnosticsByChunkUid: {},
      enriched: 0,
      diagnosticsCount: 0,
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
  const openDocs = new Map();
  const diskPathMap = resolvedScheme === 'file'
    ? await ensureVirtualFilesBatch({
      rootDir: resolvedRoot,
      docs: docsToOpen,
      batching: resolvedBatching,
      coldStartCache
    })
    : null;
  for (const doc of docsToOpen) {
    const fileHoverStats = hoverFileStats.get(doc.virtualPath) || createHoverFileStats();
    hoverFileStats.set(doc.virtualPath, fileHoverStats);
    const docTargets = targetsByPath.get(doc.virtualPath) || [];
    const uri = await resolveDocumentUri({
      rootDir: resolvedRoot,
      doc,
      uriScheme: resolvedScheme,
      tokenMode: vfsTokenMode,
      diskPathMap,
      coldStartCache
    });
    const languageId = doc.languageId || languageIdForFileExt(path.extname(doc.virtualPath));
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
        legacyUri: resolvedScheme === 'poc-vfs' ? buildVfsUri(doc.virtualPath) : null,
        lineIndex: null,
        text: doc.text || ''
      });
    }

    let symbols = null;
    try {
      symbols = await guard.run(
        ({ timeoutMs: guardTimeout }) => client.request(
          'textDocument/documentSymbol',
          { textDocument: { uri } },
          { timeoutMs: guardTimeout }
        ),
        { label: 'documentSymbol' }
      );
    } catch (err) {
      log(`[index] ${cmd} documentSymbol failed (${doc.virtualPath}): ${err?.message || err}`);
      client.notify('textDocument/didClose', { textDocument: { uri } });
      if (guard.isOpen()) break;
      continue;
    }

    const flattened = flattenSymbols(symbols || []);
    if (!flattened.length) {
      client.notify('textDocument/didClose', { textDocument: { uri } });
      continue;
    }

    const openEntry = openDocs.get(doc.virtualPath) || null;
    const lineIndex = openEntry?.lineIndex || lineIndexFactory(openEntry?.text || doc.text || '');
    if (openEntry && !openEntry.lineIndex) openEntry.lineIndex = lineIndex;

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

    const parseSignatureCached = (detailText, symbolName) => {
      if (typeof parseSignature !== 'function') return null;
      const normalizedDetail = normalizeSignatureCacheText(detailText);
      if (!normalizedDetail) return null;
      const cacheKey = `${doc.languageId || ''}::${normalizedDetail}`;
      if (signatureParseCache.has(cacheKey)) {
        return signatureParseCache.get(cacheKey);
      }
      const parsed = parseSignature(normalizedDetail, doc.languageId, symbolName) || null;
      signatureParseCache.set(cacheKey, parsed);
      return parsed;
    };

    for (const symbol of flattened) {
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range);
      const target = findTargetForOffsets(docTargets, offsets, symbol.name);
      if (!target) continue;
      const detailText = symbol.detail || symbol.name;
      let info = parseSignatureCached(detailText, symbol.name);
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
      if (hoverEnabled && needsHover && symbolKindAllowed && !fileOverBudget && !adaptiveDisabled) {
        const hoverTimeoutOverride = Number.isFinite(resolvedHoverTimeout)
          ? resolvedHoverTimeout
          : null;
        fileHoverStats.requested += 1;
        hoverMetrics.requested += 1;
        const hoverStartMs = Date.now();
        try {
          const hover = await guard.run(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/hover', {
              textDocument: { uri },
              position: symbol.selectionRange?.start || symbol.range?.start
            }, { timeoutMs: guardTimeout }),
            { label: 'hover', ...(hoverTimeoutOverride ? { timeoutOverride: hoverTimeoutOverride } : {}) }
          );
          const hoverDurationMs = Date.now() - hoverStartMs;
          hoverLatencyMs.push(hoverDurationMs);
          fileHoverStats.latencyMs.push(hoverDurationMs);
          fileHoverStats.succeeded += 1;
          hoverMetrics.succeeded += 1;
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = parseSignatureCached(hoverText, symbol.name);
          if (hoverInfo) info = mergeSignatureInfo(info, hoverInfo);
        } catch (err) {
          const message = String(err?.message || err || '').toLowerCase();
          const isTimeout = message.includes('timeout');
          if (isTimeout) {
            fileHoverStats.timedOut += 1;
            hoverMetrics.timedOut += 1;
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
        }
      }
      if (!info) continue;

      const chunkUid = target.chunkRef?.chunkUid;
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
        chunk: target.chunkRef,
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

    client.notify('textDocument/didClose', { textDocument: { uri } });
  }

  const diagnosticsByChunkUid = {};
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
