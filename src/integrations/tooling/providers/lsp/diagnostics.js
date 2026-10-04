import { pathToFileUri } from '../../lsp/client.js';
import { rangeToOffsets } from '../../lsp/positions.js';
import { buildVfsUri } from '../../lsp/uris.js';
import { resolveVfsDiskPath } from '../../../../index/tooling/vfs.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { findTargetForOffsets as lookupTargetForOffsets } from './target-index.js';

export const DEFAULT_MAX_DIAGNOSTIC_URIS = 1000;
export const DEFAULT_MAX_DIAGNOSTICS_PER_URI = 200;
export const DEFAULT_MAX_DIAGNOSTICS_PER_CHUNK = 100;

/**
 * Build a stable dedupe key for one diagnostic entry.
 * @param {object} diag
 * @returns {string}
 */
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

/**
 * Create diagnostic notification collector with bounded in-memory buffers.
 *
 * Caps are LRU-like at URI level and truncation at per-URI entry level, with
 * one-time warning checks recorded through `checks`/`checkFlags`.
 *
 * @param {object} input
 * @returns {{diagnosticsByUri:Map<string,Array<object>>,onNotification:(msg:object)=>void,setDiagnosticsForUri:(uri:string,diagnostics:Array<object>)=>void,waitForDiagnostics:Function}}
 */
export const createDiagnosticsCollector = ({
  captureDiagnostics,
  checks,
  checkFlags,
  maxDiagnosticUris,
  maxDiagnosticsPerUri,
  requireOwnedDocuments = false
}) => {
  const diagnosticsByUri = new Map();
  const drainListeners = new Set();
  const documentVersions = new Map();
  const ownershipLimit = Math.min(DEFAULT_MAX_DIAGNOSTIC_URIS, Number(maxDiagnosticUris) || DEFAULT_MAX_DIAGNOSTIC_URIS) * 2;
  const registerDocument = (uri, version) => {
    if (!captureDiagnostics || !uri || (!documentVersions.has(uri) && documentVersions.size >= ownershipLimit)) return;
    documentVersions.set(uri, version);
    diagnosticsByUri.delete(uri);
  };
  const unregisterDocument = (uri) => {
    documentVersions.delete(uri);
    diagnosticsByUri.delete(uri);
  };

  const setDiagnosticsForUri = (uri, diagnostics) => {
    const source = Array.isArray(diagnostics) ? diagnostics : [];
    if (!uri) return;

    const limited = source.length > maxDiagnosticsPerUri
      ? source.slice(0, maxDiagnosticsPerUri)
      : source;
    if (source.length > maxDiagnosticsPerUri && !checkFlags.diagnosticsPerUriTrimmed) {
      checkFlags.diagnosticsPerUriTrimmed = true;
      checks.push({
        name: 'tooling_diagnostics_per_uri_capped',
        status: 'warn',
        message: `LSP diagnostics per URI capped at ${maxDiagnosticsPerUri}.`,
        count: source.length
      });
    }

    if (diagnosticsByUri.has(uri)) diagnosticsByUri.delete(uri);
    diagnosticsByUri.set(uri, limited);
    while (diagnosticsByUri.size > maxDiagnosticUris) {
      const oldest = diagnosticsByUri.keys().next();
      if (oldest.done) break;
      diagnosticsByUri.delete(oldest.value);
      if (!checkFlags.diagnosticsUriBufferTrimmed) {
        checkFlags.diagnosticsUriBufferTrimmed = true;
        checks.push({
          name: 'tooling_diagnostics_uri_buffer_capped',
          status: 'warn',
          message: `LSP diagnostics URI buffer capped at ${maxDiagnosticUris}.`
        });
      }
    }
    for (const listener of drainListeners) listener();
  };

  const onNotification = (msg) => {
    if (!captureDiagnostics) return;
    if (msg?.method !== 'textDocument/publishDiagnostics') return;
    const uri = msg?.params?.uri;
    const diagnostics = msg?.params?.diagnostics;
    if (!uri || !Array.isArray(diagnostics)) return;
    if (requireOwnedDocuments && !documentVersions.has(uri)) return;
    if (documentVersions.has(uri) && msg.params.version != null
      && msg.params.version !== documentVersions.get(uri)) return;
    setDiagnosticsForUri(uri, diagnostics);
  };

  /** Wait once for the first diagnostic result per document/optional URI alias. */
  const waitForDiagnostics = (uriGroups, { timeoutMs = 500, signal = null } = {}) => {
    throwIfAborted(signal);
    const groups = [];
    const maxGroups = Math.max(0, Math.min(DEFAULT_MAX_DIAGNOSTIC_URIS, Math.floor(Number(maxDiagnosticUris) || DEFAULT_MAX_DIAGNOSTIC_URIS)));
    for (const group of uriGroups || []) {
      if (groups.length >= maxGroups) break;
      const uris = (Array.isArray(group) ? group.slice(0, 2) : [group])
        .filter((uri) => typeof uri === 'string' && uri);
      if (uris.length) groups.push(uris);
    }
    const budgetMs = Math.max(0, Math.min(2000, Number(timeoutMs) || 0));
    const summarize = (timedOut) => {
      const observedUris = groups.filter((group) => group.some((uri) => diagnosticsByUri.has(uri))).length;
      return { expectedUris: groups.length, observedUris, pendingUris: groups.length - observedUris, timedOut, timeoutMs: budgetMs };
    };
    if (!captureDiagnostics || !groups.length || summarize(false).pendingUris === 0 || !budgetMs) {
      return Promise.resolve(summarize(false));
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        clearTimeout(timer);
        drainListeners.delete(onChange);
        signal?.removeEventListener?.('abort', onAbort);
      };
      const onChange = () => {
        const summary = summarize(false);
        if (summary.pendingUris) return;
        cleanup();
        resolve(summary);
      };
      const onAbort = () => {
        cleanup();
        try {
          throwIfAborted(signal);
        } catch (error) {
          reject(error);
        }
      };
      drainListeners.add(onChange);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        cleanup();
        resolve(summarize(true));
      }, budgetMs);
      if (signal?.aborted) onAbort();
      else onChange();
    });
  };

  return { diagnosticsByUri, onNotification, setDiagnosticsForUri, waitForDiagnostics, registerDocument, unregisterDocument };
};

/**
 * Project URI-scoped diagnostics into chunk-scoped diagnostic buckets.
 *
 * Uses target overlap matching with dedupe per chunk and per-chunk cap to keep
 * payload size bounded during noisy language-server sessions.
 *
 * @param {object} input
 * @returns {{diagnosticsByChunkUid:object,diagnosticsCount:number}}
 */
export const shapeDiagnosticsByChunkUid = ({
  captureDiagnostics,
  diagnosticsByUri,
  docs,
  openDocs,
  targetIndexesByPath,
  diskPathMap,
  resolvedRoot,
  resolvedScheme,
  lineIndexFactory,
  maxDiagnosticsPerChunk,
  checks,
  checkFlags,
  findTargetForOffsets,
  positionEncoding = 'utf-16'
}) => {
  const diagnosticsByChunkUid = {};
  const diagnosticsSeenByChunkUid = new Map();
  let diagnosticsCount = 0;
  const reuseTargetLookups = findTargetForOffsets === lookupTargetForOffsets;

  if (!captureDiagnostics || !diagnosticsByUri?.size) {
    return { diagnosticsByChunkUid, diagnosticsCount };
  }

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
    const docText = openEntry?.text || doc.text || '';
    const docTargetIndex = targetIndexesByPath.get(doc.virtualPath) || null;
    let previousStart = NaN;
    let previousEnd = NaN;
    let previousTarget = null;

    for (const diag of diagnostics) {
      const offsets = rangeToOffsets(lineIndex, diag.range, {
        text: docText,
        positionEncoding
      });
      // The app-owned lookup is pure over this document's immutable target index.
      // Retain only the last range; custom callback invocation semantics stay intact.
      const repeatedRange = reuseTargetLookups && offsets.start === previousStart && offsets.end === previousEnd;
      const target = repeatedRange ? previousTarget : findTargetForOffsets(docTargetIndex, offsets);
      previousStart = offsets.start;
      previousEnd = offsets.end;
      previousTarget = target;
      if (!target?.chunkRef?.chunkUid) continue;

      const chunkUid = target.chunkRef.chunkUid;
      const existing = diagnosticsByChunkUid[chunkUid] || [];
      if (existing.length >= maxDiagnosticsPerChunk) {
        if (!checkFlags.diagnosticsPerChunkTrimmed) {
          checkFlags.diagnosticsPerChunkTrimmed = true;
          checks.push({
            name: 'tooling_diagnostics_per_chunk_capped',
            status: 'warn',
            message: `LSP diagnostics per chunk capped at ${maxDiagnosticsPerChunk}.`
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

  return { diagnosticsByChunkUid, diagnosticsCount };
};
