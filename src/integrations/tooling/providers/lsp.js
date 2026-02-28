import path from 'node:path';
import { buildLineIndex } from '../../../shared/lines.js';
import { languageIdForFileExt, pathToFileUri } from '../lsp/client.js';
import { buildVfsUri } from '../lsp/uris.js';
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
import { probeLspCapabilities } from './lsp/capabilities.js';
import { withLspSession } from './lsp/session-pool.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { coercePositiveInt } from '../../../shared/number-coerce.js';
import { sleep } from '../../../shared/sleep.js';

/**
 * Parse positive integer configuration with fallback floor of 1.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const clampPositiveInt = (value, fallback) => {
  const parsed = coercePositiveInt(value);
  if (parsed == null) return fallback;
  return Math.max(1, parsed);
};

const LSP_SESSION_DESYNC_ERROR_CODE = 'ERR_TOOLING_LSP_SESSION_DESYNC';

const coerceInitializeResultObject = (value) => (
  value && typeof value === 'object' ? value : null
);

/**
 * Create the canonical empty LSP collection payload.
 * @param {Array<object>} checks
 * @param {object|null} [runtime]
 * @returns {{byChunkUid:object,diagnosticsByChunkUid:object,enriched:number,diagnosticsCount:number,checks:Array<object>,hoverMetrics:object,runtime:object|null}}
 */
const buildEmptyCollectResult = (checks, runtime = null) => ({
  byChunkUid: {},
  diagnosticsByChunkUid: {},
  enriched: 0,
  diagnosticsCount: 0,
  checks,
  hoverMetrics: createEmptyHoverMetricsResult(),
  runtime: runtime && typeof runtime === 'object'
    ? {
      ...runtime,
      hoverMetrics: runtime.hoverMetrics && typeof runtime.hoverMetrics === 'object'
        ? runtime.hoverMetrics
        : createEmptyHoverMetricsResult()
    }
    : runtime
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
 * @param {number|null} [params.signatureHelpTimeoutMs=null]
 * @param {number|null} [params.definitionTimeoutMs=null]
 * @param {number|null} [params.typeDefinitionTimeoutMs=null]
 * @param {number|null} [params.referencesTimeoutMs=null]
 * @param {boolean} [params.hoverEnabled=true]
 * @param {boolean} [params.signatureHelpEnabled=true]
 * @param {boolean} [params.definitionEnabled=true]
 * @param {boolean} [params.typeDefinitionEnabled=true]
 * @param {boolean} [params.referencesEnabled=true]
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
 * @param {number} [params.signatureHelpConcurrency=8]
 * @param {number} [params.definitionConcurrency=8]
 * @param {number} [params.typeDefinitionConcurrency=8]
 * @param {number} [params.referencesConcurrency=8]
 * @param {number} [params.hoverCacheMaxEntries=50000]
 * @param {(line:string)=>boolean|null} [params.stderrFilter=null]
 * @param {object|null} [params.initializationOptions=null]
 * @param {string|null} [params.providerId=null]
 * @param {string|null} [params.workspaceKey=null]
 * @param {number|null} [params.lifecycleRestartWindowMs=null]
 * @param {number|null} [params.lifecycleMaxRestartsPerWindow=null]
 * @param {number|null} [params.lifecycleFdPressureBackoffMs=null]
 * @param {number|null} [params.sessionIdleTimeoutMs=null]
 * @param {number|null} [params.sessionMaxLifetimeMs=null]
 * @param {AbortSignal|null} [params.abortSignal=null]
 * @returns {Promise<{byChunkUid:object,diagnosticsByChunkUid:object,enriched:number,diagnosticsCount:number,checks:Array<object>,hoverMetrics:object,runtime:object|null}>}
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
  signatureHelpTimeoutMs = null,
  definitionTimeoutMs = null,
  typeDefinitionTimeoutMs = null,
  referencesTimeoutMs = null,
  hoverEnabled = true,
  signatureHelpEnabled = true,
  definitionEnabled = true,
  typeDefinitionEnabled = true,
  referencesEnabled = true,
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
  signatureHelpConcurrency = DEFAULT_HOVER_CONCURRENCY,
  definitionConcurrency = DEFAULT_HOVER_CONCURRENCY,
  typeDefinitionConcurrency = DEFAULT_HOVER_CONCURRENCY,
  referencesConcurrency = DEFAULT_HOVER_CONCURRENCY,
  hoverCacheMaxEntries = DEFAULT_HOVER_CACHE_MAX_ENTRIES,
  stderrFilter = null,
  initializationOptions = null,
  providerId = null,
  workspaceKey = null,
  lifecycleRestartWindowMs = null,
  lifecycleMaxRestartsPerWindow = null,
  lifecycleFdPressureBackoffMs = null,
  sessionIdleTimeoutMs = null,
  sessionMaxLifetimeMs = null,
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
  const resolvedSignatureHelpTimeout = resolvePositiveTimeout(signatureHelpTimeoutMs) ?? resolvedHoverTimeout;
  const resolvedDefinitionTimeout = resolvePositiveTimeout(definitionTimeoutMs) ?? resolvedHoverTimeout;
  const resolvedTypeDefinitionTimeout = resolvePositiveTimeout(typeDefinitionTimeoutMs) ?? resolvedDefinitionTimeout;
  const resolvedReferencesTimeout = resolvePositiveTimeout(referencesTimeoutMs) ?? resolvedTypeDefinitionTimeout;
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
  const resolvedSignatureHelpConcurrency = clampIntRange(
    signatureHelpConcurrency,
    DEFAULT_HOVER_CONCURRENCY,
    { min: 1, max: 64 }
  );
  const resolvedDefinitionConcurrency = clampIntRange(
    definitionConcurrency,
    DEFAULT_HOVER_CONCURRENCY,
    { min: 1, max: 64 }
  );
  const resolvedTypeDefinitionConcurrency = clampIntRange(
    typeDefinitionConcurrency,
    DEFAULT_HOVER_CONCURRENCY,
    { min: 1, max: 64 }
  );
  const resolvedReferencesConcurrency = clampIntRange(
    referencesConcurrency,
    DEFAULT_HOVER_CONCURRENCY,
    { min: 1, max: 64 }
  );
  const resolvedHoverCacheMaxEntries = clampIntRange(
    hoverCacheMaxEntries,
    DEFAULT_HOVER_CACHE_MAX_ENTRIES,
    { min: 1000, max: 200000 }
  );

  const checks = [];
  const runtime = {
    command: String(cmd || ''),
    capabilities: null,
    lifecycle: null,
    guard: null,
    requests: null
  };
  const docs = Array.isArray(documents) ? documents : [];
  const targetList = Array.isArray(targets) ? targets : [];
  if (!docs.length || !targetList.length) {
    return buildEmptyCollectResult(checks, runtime);
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
    return buildEmptyCollectResult(checks, runtime);
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
    documentSymbolFailed: false,
    circuitOpened: false,
    initializeFailed: false,
    fdPressureBackoff: false,
    crashLoopQuarantined: false
  };

  const { diagnosticsByUri, onNotification } = createDiagnosticsCollector({
    captureDiagnostics,
    checks,
    checkFlags,
    maxDiagnosticUris: resolvedMaxDiagnosticUris,
    maxDiagnosticsPerUri: resolvedMaxDiagnosticsPerUri
  });

  const runWithPooledSession = () => withLspSession({
    enabled: true,
    repoRoot: rootDir,
    providerId: String(providerId || cmd || 'lsp'),
    workspaceKey: workspaceKey || rootDir,
    cmd,
    args,
    cwd: rootDir,
    log,
    stderrFilter,
    onNotification,
    timeoutMs,
    retries,
    breakerThreshold,
    lifecycleName: String(providerId || cmd || 'lsp'),
    lifecycleRestartWindowMs,
    lifecycleMaxRestartsPerWindow,
    lifecycleFdPressureBackoffMs,
    sessionIdleTimeoutMs,
    sessionMaxLifetimeMs,
    initializationOptions
  }, async (lease) => {
    const client = lease.client;
    const guard = lease.guard;
    const lifecycleHealth = lease.lifecycleHealth;
    const killClientSafely = async () => {
      try {
        await Promise.resolve(client.kill());
      } catch {}
    };
    runtime.pooling = {
      enabled: lease.pooled,
      sessionKey: lease.sessionKey,
      reused: lease.reused,
      recycleCount: lease.recycleCount,
      ageMs: lease.ageMs,
      state: lease.state || null,
      transportGeneration: Number.isFinite(Number(lease.transportGeneration))
        ? Number(lease.transportGeneration)
        : null
    };

    let detachAbortHandler = null;
    let abortKillPromise = null;
    if (toolingAbortSignal && typeof toolingAbortSignal.addEventListener === 'function') {
      const onAbort = () => {
        abortKillPromise = killClientSafely();
      };
      toolingAbortSignal.addEventListener('abort', onAbort, { once: true });
      detachAbortHandler = () => toolingAbortSignal.removeEventListener('abort', onAbort);
      if (toolingAbortSignal.aborted) onAbort();
    }

    const refreshRuntimeState = () => {
      runtime.lifecycle = lifecycleHealth.getState();
      runtime.guard = guard.getState ? guard.getState() : null;
      runtime.requests = typeof client.getMetrics === 'function' ? client.getMetrics() : null;
    };

    const runWithHealthGuard = async (fn, options = {}) => {
      const state = lifecycleHealth.getState();
      runtime.lifecycle = state;
      if (state.crashLoopQuarantined) {
        const err = new Error(`${cmd} crash-loop quarantine active.`);
        err.code = 'TOOLING_CRASH_LOOP';
        err.detail = state;
        throw err;
      }
      if (state.fdPressureBackoffActive) {
        if (!checkFlags.fdPressureBackoff) {
          checkFlags.fdPressureBackoff = true;
          checks.push({
            name: 'tooling_fd_pressure_backoff',
            status: 'warn',
            message: `${cmd} observed fd pressure; delaying LSP requests by ${state.fdPressureBackoffRemainingMs}ms.`,
            count: state.fdPressureEvents
          });
        }
        await sleep(Math.min(1000, Math.max(25, state.fdPressureBackoffRemainingMs)));
      }
      try {
        const out = await guard.run(fn, options);
        refreshRuntimeState();
        return out;
      } catch (err) {
        const message = String(err?.message || err || '').toLowerCase();
        const transportFailure = err?.code === 'ERR_LSP_TRANSPORT_CLOSED'
          || message.includes('transport closed')
          || message.includes('writer unavailable')
          || message.includes('lsp exited');
        if (transportFailure && typeof lease.markPoisoned === 'function') {
          lease.markPoisoned('transport_failure');
        }
        refreshRuntimeState();
        throw err;
      }
    };

    const rootUri = pathToFileUri(rootDir);
    let shouldShutdownClient = false;
    let capabilityMask = null;
    let effectiveHoverEnabled = hoverEnabled !== false;
    let effectiveSignatureHelpEnabled = signatureHelpEnabled !== false;
    let effectiveDefinitionEnabled = definitionEnabled !== false;
    let effectiveTypeDefinitionEnabled = typeDefinitionEnabled !== false;
    let effectiveReferencesEnabled = referencesEnabled !== false;
    let skipSymbolCollection = false;
    try {
      throwIfAborted(toolingAbortSignal);
      let initializeResult = null;
      const mustInitialize = lease.shouldInitialize !== false;
      if (mustInitialize) {
        if (typeof lease.markInitializing === 'function') lease.markInitializing();
        const rawInitializeResult = await runWithHealthGuard(({ timeoutMs: guardTimeout }) => client.initialize({
          rootUri,
          capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
          initializationOptions,
          timeoutMs: guardTimeout
        }), { label: 'initialize' });
        initializeResult = coerceInitializeResultObject(rawInitializeResult);
        if (!initializeResult) {
          const initError = new Error(`${cmd} initialize returned invalid response.`);
          initError.code = 'ERR_TOOLING_LSP_INVALID_INITIALIZE_RESULT';
          throw initError;
        }
        if (typeof lease.markInitialized === 'function') lease.markInitialized(initializeResult);
      } else {
        initializeResult = coerceInitializeResultObject(lease.initializationResult);
        if (!initializeResult) {
          if (typeof lease.markPoisoned === 'function') {
            lease.markPoisoned('initialize_state_desync');
          }
          const desyncError = new Error(`${cmd} pooled session missing initialize state.`);
          desyncError.code = LSP_SESSION_DESYNC_ERROR_CODE;
          throw desyncError;
        }
      }
      capabilityMask = probeLspCapabilities(initializeResult);
      runtime.capabilities = capabilityMask;
      effectiveHoverEnabled = effectiveHoverEnabled && capabilityMask.hover;
      effectiveSignatureHelpEnabled = effectiveSignatureHelpEnabled && capabilityMask.signatureHelp;
      effectiveDefinitionEnabled = effectiveDefinitionEnabled && capabilityMask.definition;
      effectiveTypeDefinitionEnabled = effectiveTypeDefinitionEnabled && capabilityMask.typeDefinition;
      effectiveReferencesEnabled = effectiveReferencesEnabled && capabilityMask.references;
      if (!capabilityMask.documentSymbol) {
        checks.push({
          name: 'tooling_capability_missing_document_symbol',
          status: 'warn',
          message: `${cmd} does not advertise textDocument/documentSymbol; skipping LSP enrichment.`
        });
        skipSymbolCollection = true;
        shouldShutdownClient = lease.pooled !== true;
      }
      if (hoverEnabled !== false && !capabilityMask.hover) {
        checks.push({
          name: 'tooling_capability_missing_hover',
          status: 'warn',
          message: `${cmd} does not advertise textDocument/hover; hover enrichment disabled.`
        });
      }
      if (signatureHelpEnabled !== false && !capabilityMask.signatureHelp) {
        checks.push({
          name: 'tooling_capability_missing_signature_help',
          status: 'info',
          message: `${cmd} does not advertise textDocument/signatureHelp.`
        });
      }
      if (definitionEnabled !== false && !capabilityMask.definition) {
        checks.push({
          name: 'tooling_capability_missing_definition',
          status: 'info',
          message: `${cmd} does not advertise textDocument/definition.`
        });
      }
      if (typeDefinitionEnabled !== false && !capabilityMask.typeDefinition) {
        checks.push({
          name: 'tooling_capability_missing_type_definition',
          status: 'info',
          message: `${cmd} does not advertise textDocument/typeDefinition.`
        });
      }
      if (referencesEnabled !== false && !capabilityMask.references) {
        checks.push({
          name: 'tooling_capability_missing_references',
          status: 'info',
          message: `${cmd} does not advertise textDocument/references.`
        });
      }
      shouldShutdownClient = lease.pooled !== true;
    } catch (err) {
      throwIfAborted(toolingAbortSignal);
      if (err?.code === LSP_SESSION_DESYNC_ERROR_CODE) {
        throw err;
      }
      checkFlags.initializeFailed = true;
      if (typeof lease.markPoisoned === 'function') {
        lease.markPoisoned('initialize_failed');
      }
      if (err?.code === 'TOOLING_CRASH_LOOP' && !checkFlags.crashLoopQuarantined) {
        checkFlags.crashLoopQuarantined = true;
        checks.push({
          name: 'tooling_crash_loop_quarantined',
          status: 'warn',
          message: `${cmd} crash-loop quarantine active; skipping provider work.`
        });
      }
      checks.push({
        name: 'tooling_initialize_failed',
        status: 'warn',
        message: `${cmd} initialize failed: ${err?.message || err}`
      });
      log(`[index] ${cmd} initialize failed: ${err?.message || err}`);
      await killClientSafely();
      if (detachAbortHandler) {
        try {
          detachAbortHandler();
        } catch {}
        detachAbortHandler = null;
      }
      refreshRuntimeState();
      return buildEmptyCollectResult(checks, {
        ...runtime,
        lifecycle: lifecycleHealth.getState()
      });
    }

    try {
      if (skipSymbolCollection) {
        runtime.lifecycle = lifecycleHealth.getState();
        runtime.guard = guard.getState ? guard.getState() : null;
        runtime.requests = typeof client.getMetrics === 'function' ? client.getMetrics() : null;
        return buildEmptyCollectResult(checks, runtime);
      }
      const byChunkUid = {};
      let enriched = 0;
      const signatureParseCache = new Map();
      const hoverFileStats = new Map();
      const hoverLatencyMs = [];
      const hoverMetrics = createEmptyHoverMetricsResult();
      const hoverControl = { disabledGlobal: false };
      const hoverLimiter = createConcurrencyLimiter(resolvedHoverConcurrency);
      const signatureHelpLimiter = createConcurrencyLimiter(resolvedSignatureHelpConcurrency);
      const definitionLimiter = createConcurrencyLimiter(resolvedDefinitionConcurrency);
      const typeDefinitionLimiter = createConcurrencyLimiter(resolvedTypeDefinitionConcurrency);
      const referencesLimiter = createConcurrencyLimiter(resolvedReferencesConcurrency);
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
          guardRun: runWithHealthGuard,
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
          hoverEnabled: effectiveHoverEnabled,
          signatureHelpEnabled: effectiveSignatureHelpEnabled,
          definitionEnabled: effectiveDefinitionEnabled,
          typeDefinitionEnabled: effectiveTypeDefinitionEnabled,
          referencesEnabled: effectiveReferencesEnabled,
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
          abortSignal: toolingAbortSignal
        });
        enriched += enrichedDelta;
      };

      await runWithConcurrency(docsToOpen, resolvedDocumentSymbolConcurrency, processDoc, {
        signal: toolingAbortSignal
      });
      throwIfAborted(toolingAbortSignal);
      if (captureDiagnostics) {
        // PublishDiagnostics notifications can trail didOpen/documentSymbol by a few
        // milliseconds; give the session a brief drain window before shaping.
        await sleep(15);
        throwIfAborted(toolingAbortSignal);
      }

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

      const lifecycleState = lifecycleHealth.getState();
      runtime.lifecycle = lifecycleState;
      runtime.guard = guard.getState ? guard.getState() : null;
      runtime.requests = typeof client.getMetrics === 'function' ? client.getMetrics() : null;
      if (lifecycleState.crashLoopTrips > 0 && !checkFlags.crashLoopQuarantined) {
        checkFlags.crashLoopQuarantined = true;
        checks.push({
          name: 'tooling_crash_loop_detected',
          status: 'warn',
          message: `${cmd} observed crash-loop pressure (${lifecycleState.crashLoopTrips} trip${lifecycleState.crashLoopTrips === 1 ? '' : 's'}).`,
          count: lifecycleState.crashLoopTrips
        });
      }

      const summarizedHoverMetrics = summarizeHoverMetrics({
        hoverMetrics,
        hoverLatencyMs,
        hoverFileStats
      });
      runtime.hoverMetrics = summarizedHoverMetrics;
      const fallbackCount = Number(summarizedHoverMetrics.fallbackUsed || 0);
      const incompleteCount = Number(summarizedHoverMetrics.incompleteSymbols || 0);
      const fallbackRatio = incompleteCount > 0 ? (fallbackCount / incompleteCount) : 0;
      if (fallbackCount >= 10 || fallbackRatio >= 0.25) {
        log(
          `[tooling] ${cmd} fallback summary: used=${fallbackCount} incomplete=${incompleteCount} ratio=${fallbackRatio.toFixed(2)} reasons=${JSON.stringify(summarizedHoverMetrics.fallbackReasonCounts || {})}`
        );
      }

      return {
        byChunkUid,
        diagnosticsByChunkUid,
        enriched,
        diagnosticsCount,
        checks,
        runtime,
        hoverMetrics: summarizedHoverMetrics
      };
    } finally {
      if (detachAbortHandler) {
        try {
          detachAbortHandler();
        } catch {}
      }
      if (abortKillPromise && typeof abortKillPromise.then === 'function') {
        try {
          await abortKillPromise;
        } catch {}
      }
      if (shouldShutdownClient) {
        try {
          await client.shutdownAndExit();
        } catch {}
      }
      if (lease.pooled !== true) {
        await killClientSafely();
      }
    }
  });
  let attemptedDesyncRecovery = false;
  while (true) {
    try {
      return await runWithPooledSession();
    } catch (err) {
      const isSessionDesync = err?.code === LSP_SESSION_DESYNC_ERROR_CODE;
      if (!isSessionDesync) throw err;
      if (attemptedDesyncRecovery) {
        checkFlags.initializeFailed = true;
        checks.push({
          name: 'tooling_initialize_failed',
          status: 'warn',
          message: `${cmd} initialize failed: pooled session desync persisted after recycle.`
        });
        log(`[index] ${cmd} initialize failed: pooled session desync persisted after recycle.`);
        return buildEmptyCollectResult(checks, runtime);
      }
      attemptedDesyncRecovery = true;
      checks.push({
        name: 'tooling_session_recycled_after_desync',
        status: 'warn',
        message: `${cmd} pooled session initialize state desynced; recycled session and retrying once.`
      });
      log(`[tooling] ${cmd} pooled session initialize state desynced; recycling session and retrying once.`);
    }
  }
}
