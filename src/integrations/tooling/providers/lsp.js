import path from 'node:path';
import { buildLineIndex } from '../../../shared/lines.js';
import { createLspClient, languageIdForFileExt, pathToFileUri } from '../lsp/client.js';
import { buildVfsUri } from '../lsp/uris.js';
import { createToolingGuard } from './shared.js';
import { buildIndexSignature } from '../../../retrieval/index-cache.js';
import {
  computeVfsManifestHash,
  createVfsColdStartCache
} from '../../../index/tooling/vfs.js';
import {
  DEFAULT_MAX_DIAGNOSTIC_URIS,
  DEFAULT_MAX_DIAGNOSTICS_PER_URI,
  DEFAULT_MAX_DIAGNOSTICS_PER_CHUNK,
  createDiagnosticsCollector,
  shapeDiagnosticsByChunkUid
} from './lsp/diagnostics.js';
import {
  DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
  DEFAULT_HOVER_CONCURRENCY,
  DEFAULT_HOVER_CACHE_MAX_ENTRIES,
  clampIntRange,
  createConcurrencyLimiter,
  createEmptyHoverMetricsResult,
  findTargetForOffsets,
  loadHoverCache,
  normalizeHoverKinds,
  persistHoverCache,
  processDocumentTypes,
  runWithConcurrency,
  summarizeHoverMetrics,
  toFiniteInt
} from './lsp/hover-types.js';
import {
  ensureVirtualFilesBatch,
  normalizeUriScheme,
  resolveDocumentUri,
  resolveVfsIoBatching
} from './lsp/vfs-batching.js';
import { throwIfAborted } from '../../../shared/abort.js';

/**
 * Parse positive integer configuration with fallback floor of 1.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const clampPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Create the canonical empty LSP collection payload.
 * @param {Array<object>} checks
 * @returns {{byChunkUid:object,diagnosticsByChunkUid:object,enriched:number,diagnosticsCount:number,checks:Array<object>,hoverMetrics:object}}
 */
const buildEmptyCollectResult = (checks) => ({
  byChunkUid: {},
  diagnosticsByChunkUid: {},
  enriched: 0,
  diagnosticsCount: 0,
  checks,
  hoverMetrics: createEmptyHoverMetricsResult()
});

export { resolveVfsIoBatching, ensureVirtualFilesBatch };

/**
 * Collect LSP-derived signature/hover metadata for indexed chunks.
 *
 * Pipeline summary:
 * 1. Resolve targeted documents/chunks and optional VFS cold-start cache.
 * 2. Initialize LSP client under tooling guard (retries + circuit breaker).
 * 3. Process docs with bounded documentSymbol + hover concurrency.
 * 4. Optionally shape diagnostics into chunk-scoped buckets.
 *
 * Fallback behavior:
 * 1. Initialization failure returns empty result with warning checks.
 * 2. Worker/document failures are soft unless `strict` requires chunk binding.
 * 3. Hover can be adaptively disabled on repeated timeout pressure.
 *
 * @param {object} params
 * @param {string} params.rootDir
 * @param {Array<object>} params.documents
 * @param {Array<object>} params.targets
 * @param {(line:string)=>void} [params.log]
 * @param {string} params.cmd
 * @param {string[]} params.args
 * @param {number} [params.timeoutMs=15000]
 * @param {number} [params.retries=2]
 * @param {number} [params.breakerThreshold=3]
 * @param {(detail:string,languageId:string,symbolName?:string)=>object|null} [params.parseSignature]
 * @param {boolean} [params.strict=true]
 * @param {string|null} [params.vfsRoot=null]
 * @param {'file'|'poc-vfs'|string} [params.uriScheme='file']
 * @param {boolean} [params.captureDiagnostics=false]
 * @param {string} [params.vfsTokenMode='docHash+virtualPath']
 * @param {object|null} [params.vfsIoBatching=null]
 * @param {(text:string)=>number[]} [params.lineIndexFactory]
 * @param {string|null} [params.indexDir=null]
 * @param {object|boolean|null} [params.vfsColdStartCache=null]
 * @param {string|null} [params.cacheRoot=null]
 * @param {number|null} [params.hoverTimeoutMs=null]
 * @param {boolean} [params.hoverEnabled=true]
 * @param {boolean} [params.hoverRequireMissingReturn=true]
 * @param {number[]|number|null} [params.hoverSymbolKinds=null]
 * @param {number|null} [params.hoverMaxPerFile=null]
 * @param {number|null} [params.hoverDisableAfterTimeouts=null]
 * @param {number} [params.maxDiagnosticUris=1000]
 * @param {number} [params.maxDiagnosticsPerUri=200]
 * @param {number} [params.maxDiagnosticsPerChunk=100]
 * @param {number|null} [params.documentSymbolTimeoutMs=null]
 * @param {number} [params.documentSymbolConcurrency=4]
 * @param {number} [params.hoverConcurrency=8]
 * @param {number} [params.hoverCacheMaxEntries=50000]
 * @param {(line:string)=>boolean|null} [params.stderrFilter=null]
 * @param {object|null} [params.initializationOptions=null]
 * @param {AbortSignal|null} [params.abortSignal=null]
 * @returns {Promise<{byChunkUid:object,diagnosticsByChunkUid:object,enriched:number,diagnosticsCount:number,checks:Array<object>,hoverMetrics:object}>}
 */
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
  initializationOptions = null,
  abortSignal = null
}) {
  const toolingAbortSignal = abortSignal && typeof abortSignal.aborted === 'boolean'
    ? abortSignal
    : null;
  throwIfAborted(toolingAbortSignal);
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
    return buildEmptyCollectResult(checks);
  }
  throwIfAborted(toolingAbortSignal);

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
    return buildEmptyCollectResult(checks);
  }

  let coldStartCache = null;
  if (vfsColdStartCache !== false) {
    throwIfAborted(toolingAbortSignal);
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

  const checkFlags = {
    diagnosticsPerUriTrimmed: false,
    diagnosticsUriBufferTrimmed: false,
    diagnosticsPerChunkTrimmed: false,
    hoverTimedOut: false,
    circuitOpened: false,
    initializeFailed: false
  };

  const { diagnosticsByUri, onNotification } = createDiagnosticsCollector({
    captureDiagnostics,
    checks,
    checkFlags,
    maxDiagnosticUris: resolvedMaxDiagnosticUris,
    maxDiagnosticsPerUri: resolvedMaxDiagnosticsPerUri
  });

  const client = createLspClient({
    cmd,
    args,
    cwd: rootDir,
    log,
    stderrFilter,
    onNotification
  });
  let detachAbortHandler = null;
  if (toolingAbortSignal && typeof toolingAbortSignal.addEventListener === 'function') {
    const onAbort = () => {
      client.kill();
    };
    toolingAbortSignal.addEventListener('abort', onAbort, { once: true });
    detachAbortHandler = () => toolingAbortSignal.removeEventListener('abort', onAbort);
    if (toolingAbortSignal.aborted) onAbort();
  }

  const guard = createToolingGuard({
    name: cmd,
    timeoutMs,
    retries,
    breakerThreshold,
    log
  });

  const rootUri = pathToFileUri(rootDir);
  let shouldShutdownClient = false;
  try {
    throwIfAborted(toolingAbortSignal);
    await guard.run(({ timeoutMs: guardTimeout }) => client.initialize({
      rootUri,
      capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
      initializationOptions,
      timeoutMs: guardTimeout
    }), { label: 'initialize' });
    shouldShutdownClient = true;
  } catch (err) {
    throwIfAborted(toolingAbortSignal);
    checkFlags.initializeFailed = true;
    checks.push({
      name: 'tooling_initialize_failed',
      status: 'warn',
      message: `${cmd} initialize failed: ${err?.message || err}`
    });
    log(`[index] ${cmd} initialize failed: ${err?.message || err}`);
    client.kill();
    return buildEmptyCollectResult(checks);
  }

  try {
    const byChunkUid = {};
    let enriched = 0;
    const signatureParseCache = new Map();
    const hoverFileStats = new Map();
    const hoverLatencyMs = [];
    const hoverMetrics = createEmptyHoverMetricsResult();
    const hoverControl = { disabledGlobal: false };
    const hoverLimiter = createConcurrencyLimiter(resolvedHoverConcurrency);
    const hoverCacheState = await loadHoverCache(cacheRoot);
    const hoverCacheEntries = hoverCacheState.entries;
    let hoverCacheDirty = false;
    const markHoverCacheDirty = () => {
      hoverCacheDirty = true;
    };

    throwIfAborted(toolingAbortSignal);
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
      throwIfAborted(toolingAbortSignal);
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

      const { enrichedDelta } = await processDocumentTypes({
        doc,
        cmd,
        client,
        guard,
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
        abortSignal: toolingAbortSignal
      });
      enriched += enrichedDelta;
    };

    await runWithConcurrency(docsToOpen, resolvedDocumentSymbolConcurrency, processDoc, {
      signal: toolingAbortSignal
    });
    throwIfAborted(toolingAbortSignal);

    if (hoverCacheDirty) {
      try {
        await persistHoverCache({
          cachePath: hoverCacheState.path,
          entries: hoverCacheEntries,
          maxEntries: resolvedHoverCacheMaxEntries
        });
      } catch {}
    }
    throwIfAborted(toolingAbortSignal);

    const { diagnosticsByChunkUid, diagnosticsCount } = shapeDiagnosticsByChunkUid({
      captureDiagnostics,
      diagnosticsByUri,
      docs,
      openDocs,
      targetsByPath,
      diskPathMap,
      resolvedRoot,
      resolvedScheme,
      lineIndexFactory,
      maxDiagnosticsPerChunk: resolvedMaxDiagnosticsPerChunk,
      checks,
      checkFlags,
      findTargetForOffsets
    });

    if (coldStartCache?.flush) {
      try {
        await coldStartCache.flush();
      } catch (err) {
        log(`[tooling] vfs cold-start cache flush failed: ${err?.message || err}`);
      }
    }

    return {
      byChunkUid,
      diagnosticsByChunkUid,
      enriched,
      diagnosticsCount,
      checks,
      hoverMetrics: summarizeHoverMetrics({
        hoverMetrics,
        hoverLatencyMs,
        hoverFileStats
      })
    };
  } finally {
    if (detachAbortHandler) {
      try {
        detachAbortHandler();
      } catch {}
    }
    if (shouldShutdownClient) {
      try {
        await client.shutdownAndExit();
      } catch {}
    }
    client.kill();
  }
}
