import { pathToFileUri } from '../../lsp/client.js';
import { rangeToOffsets } from '../../lsp/positions.js';
import { buildVfsUri } from '../../lsp/uris.js';
import { resolveVfsDiskPath } from '../../../../index/tooling/vfs.js';

export const DEFAULT_MAX_DIAGNOSTIC_URIS = 1000;
export const DEFAULT_MAX_DIAGNOSTICS_PER_URI = 200;
export const DEFAULT_MAX_DIAGNOSTICS_PER_CHUNK = 100;

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

export const createDiagnosticsCollector = ({
  captureDiagnostics,
  checks,
  checkFlags,
  maxDiagnosticUris,
  maxDiagnosticsPerUri
}) => {
  const diagnosticsByUri = new Map();

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
  };

  const onNotification = (msg) => {
    if (!captureDiagnostics) return;
    if (msg?.method !== 'textDocument/publishDiagnostics') return;
    const uri = msg?.params?.uri;
    const diagnostics = msg?.params?.diagnostics;
    if (!uri || !Array.isArray(diagnostics)) return;
    setDiagnosticsForUri(uri, diagnostics);
  };

  return { diagnosticsByUri, onNotification, setDiagnosticsForUri };
};

export const shapeDiagnosticsByChunkUid = ({
  captureDiagnostics,
  diagnosticsByUri,
  docs,
  openDocs,
  targetsByPath,
  diskPathMap,
  resolvedRoot,
  resolvedScheme,
  lineIndexFactory,
  maxDiagnosticsPerChunk,
  checks,
  checkFlags,
  findTargetForOffsets
}) => {
  const diagnosticsByChunkUid = {};
  const diagnosticsSeenByChunkUid = new Map();
  let diagnosticsCount = 0;

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
    const docTargets = targetsByPath.get(doc.virtualPath) || [];

    for (const diag of diagnostics) {
      const offsets = rangeToOffsets(lineIndex, diag.range);
      const target = findTargetForOffsets(docTargets, offsets);
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
