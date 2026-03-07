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
import { applyToolchainDaemonPolicyEnv } from '../../../shared/toolchain-env.js';

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

const ADAPTIVE_LSP_SCOPE_PROFILES = Object.freeze({
  pyright: Object.freeze({
    docThreshold: 256,
    maxDocs: 384,
    degradedMaxDocs: 192,
    degradedDocumentSymbolTimeouts: 2,
    degradedDocumentSymbolP95Ms: 2500,
    defaultHoverMaxPerFile: 12,
    degradedHoverMaxPerFile: 8
  }),
  gopls: Object.freeze({
    docThreshold: 192,
    maxDocs: 320,
    degradedMaxDocs: 160,
    degradedDocumentSymbolTimeouts: 2,
    degradedDocumentSymbolP95Ms: 2500,
    defaultHoverMaxPerFile: 10,
    degradedHoverMaxPerFile: 6
  }),
  sourcekit: Object.freeze({
    docThreshold: 96,
    maxDocs: 160,
    degradedMaxDocs: 96,
    degradedHoverTimeouts: 2,
    degradedHoverP95Ms: 2000,
    defaultHoverMaxPerFile: 8,
    degradedHoverMaxPerFile: 4
  }),
  'lua-language-server': Object.freeze({
    docThreshold: 192,
    maxDocs: 256,
    degradedMaxDocs: 160,
    degradedDocumentSymbolTimeouts: 2,
    degradedDocumentSymbolP95Ms: 2500,
    defaultHoverMaxPerFile: 8,
    degradedHoverMaxPerFile: 5
  }),
  'rust-analyzer': Object.freeze({
    docThreshold: 256,
    maxDocs: 320,
    degradedMaxDocs: 192,
    degradedDocumentSymbolTimeouts: 2,
    degradedDocumentSymbolP95Ms: 3000,
    defaultHoverMaxPerFile: 8,
    degradedHoverMaxPerFile: 4
  }),
  zls: Object.freeze({
    docThreshold: 160,
    maxDocs: 256,
    degradedMaxDocs: 128,
    degradedDocumentSymbolTimeouts: 2,
    degradedDocumentSymbolP95Ms: 2500,
    defaultHoverMaxPerFile: 6,
    degradedHoverMaxPerFile: 4
  })
});

const normalizeAdaptiveLspScopeProfile = (value) => {
  if (!value || typeof value !== 'object') return null;
  const normalizeInt = (entry, min = 1) => {
    const parsed = Number(entry);
    return Number.isFinite(parsed) ? Math.max(min, Math.floor(parsed)) : null;
  };
  return {
    docThreshold: normalizeInt(value.docThreshold),
    maxDocs: normalizeInt(value.maxDocs),
    degradedMaxDocs: normalizeInt(value.degradedMaxDocs),
    degradedDocumentSymbolTimeouts: normalizeInt(value.degradedDocumentSymbolTimeouts, 0),
    degradedDocumentSymbolP95Ms: normalizeInt(value.degradedDocumentSymbolP95Ms, 0),
    degradedHoverTimeouts: normalizeInt(value.degradedHoverTimeouts, 0),
    degradedHoverP95Ms: normalizeInt(value.degradedHoverP95Ms, 0),
    defaultHoverMaxPerFile: normalizeInt(value.defaultHoverMaxPerFile, 0),
    degradedHoverMaxPerFile: normalizeInt(value.degradedHoverMaxPerFile, 0)
  };
};

const mergeAdaptiveLspScopeProfiles = (base, override) => {
  const normalizedBase = normalizeAdaptiveLspScopeProfile(base);
  const normalizedOverride = normalizeAdaptiveLspScopeProfile(override);
  if (!normalizedBase && !normalizedOverride) return null;
  return {
    ...(normalizedBase || {}),
    ...(normalizedOverride || {})
  };
};

const rankAdaptiveLspDocuments = (docs, targetsByPath) => (
  Array.isArray(docs)
    ? docs.slice().sort((left, right) => {
      const leftTargets = (targetsByPath.get(left?.virtualPath) || []).length;
      const rightTargets = (targetsByPath.get(right?.virtualPath) || []).length;
      if (leftTargets !== rightTargets) return rightTargets - leftTargets;
      const leftBytes = Buffer.byteLength(String(left?.text || ''), 'utf8');
      const rightBytes = Buffer.byteLength(String(right?.text || ''), 'utf8');
      if (leftBytes !== rightBytes) return leftBytes - rightBytes;
      return String(left?.virtualPath || '').localeCompare(String(right?.virtualPath || ''));
    })
    : []
);

const resolveAdaptiveLspScopeProfile = ({ providerId, override = null }) => {
  const normalizedProviderId = String(providerId || '').trim().toLowerCase();
  const baseProfile = ADAPTIVE_LSP_SCOPE_PROFILES[normalizedProviderId] || null;
  return mergeAdaptiveLspScopeProfiles(baseProfile, override);
};

export const __resolveAdaptiveLspScopePlanForTests = ({
  providerId,
  docs,
  targetsByPath,
  clientMetrics = null,
  documentSymbolConcurrency = DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
  hoverMaxPerFile = null,
  adaptiveDocScope = null
}) => {
  const profile = resolveAdaptiveLspScopeProfile({ providerId, override: adaptiveDocScope });
  const sourceDocs = Array.isArray(docs) ? docs : [];
  const effectiveTargetsByPath = targetsByPath instanceof Map ? targetsByPath : new Map();
  const totalTargets = sourceDocs.reduce(
    (sum, doc) => sum + (effectiveTargetsByPath.get(doc?.virtualPath) || []).length,
    0
  );
  const methodMetrics = clientMetrics?.byMethod || {};
  const documentSymbolMetrics = methodMetrics['textDocument/documentSymbol']?.latencyMs || {};
  const documentSymbolTimedOut = Number(methodMetrics['textDocument/documentSymbol']?.timedOut || 0);
  const hoverMetrics = methodMetrics['textDocument/hover']?.latencyMs || {};
  const hoverTimedOut = Number(methodMetrics['textDocument/hover']?.timedOut || 0);
  const configuredHoverMaxPerFile = toFiniteInt(hoverMaxPerFile, 0);
  let effectiveHoverMaxPerFile = configuredHoverMaxPerFile;
  let selectedDocs = sourceDocs;
  let docLimitApplied = false;
  let degraded = false;
  let reason = null;
  if (profile) {
    const docThreshold = Number(profile.docThreshold || 0);
    const maxDocsBase = Number(profile.maxDocs || 0);
    const degradedMaxDocsBase = Number(profile.degradedMaxDocs || maxDocsBase || 0);
    const documentSymbolP95Ms = Number(documentSymbolMetrics?.p95 || 0);
    const hoverP95Ms = Number(hoverMetrics?.p95 || 0);
    degraded = (
      (Number(profile.degradedDocumentSymbolTimeouts || 0) > 0
        && documentSymbolTimedOut >= Number(profile.degradedDocumentSymbolTimeouts || 0))
      || (Number(profile.degradedDocumentSymbolP95Ms || 0) > 0
        && documentSymbolP95Ms >= Number(profile.degradedDocumentSymbolP95Ms || 0))
      || (Number(profile.degradedHoverTimeouts || 0) > 0
        && hoverTimedOut >= Number(profile.degradedHoverTimeouts || 0))
      || (Number(profile.degradedHoverP95Ms || 0) > 0
        && hoverP95Ms >= Number(profile.degradedHoverP95Ms || 0))
    );
    if (docThreshold > 0 && maxDocsBase > 0 && sourceDocs.length > docThreshold) {
      const targetCap = Math.max(
        Math.max(1, clampIntRange(documentSymbolConcurrency, DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY, { min: 1, max: 32 })) * 4,
        degraded ? degradedMaxDocsBase : maxDocsBase
      );
      if (sourceDocs.length > targetCap) {
        selectedDocs = rankAdaptiveLspDocuments(sourceDocs, effectiveTargetsByPath).slice(0, targetCap);
        docLimitApplied = true;
      }
      reason = degraded
        ? `degraded-doc-cap:${targetCap}`
        : `doc-cap:${targetCap}`;
    }
    if (!Number.isFinite(effectiveHoverMaxPerFile) || effectiveHoverMaxPerFile <= 0) {
      if (Number(profile.defaultHoverMaxPerFile || 0) > 0) {
        effectiveHoverMaxPerFile = Number(profile.defaultHoverMaxPerFile);
      }
    }
    if ((degraded || docLimitApplied) && Number(profile.degradedHoverMaxPerFile || 0) > 0) {
      effectiveHoverMaxPerFile = Number.isFinite(effectiveHoverMaxPerFile) && effectiveHoverMaxPerFile > 0
        ? Math.min(effectiveHoverMaxPerFile, Number(profile.degradedHoverMaxPerFile))
        : Number(profile.degradedHoverMaxPerFile);
    }
  }
  const selectedTargetPaths = new Set(selectedDocs.map((doc) => String(doc?.virtualPath || '')).filter(Boolean));
  const selectedTargets = selectedDocs.reduce(
    (sum, doc) => sum + (effectiveTargetsByPath.get(doc?.virtualPath) || []).length,
    0
  );
  return {
    profile,
    documents: selectedDocs,
    selectedTargetPaths,
    totalDocs: sourceDocs.length,
    selectedDocs: selectedDocs.length,
    totalTargets,
    selectedTargets,
    docLimitApplied,
    degraded,
    reason,
    hoverMaxPerFile: Number.isFinite(effectiveHoverMaxPerFile) && effectiveHoverMaxPerFile > 0
      ? effectiveHoverMaxPerFile
      : null
  };
};

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
 * @param {number} [params.timeoutMs=60000]
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
 * @param {object|null} [params.adaptiveDocScope=null]
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
 * @param {number|null} [params.softDeadlineMs=null]
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
 * @param {boolean} [params.sessionPoolingEnabled=true]
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
  timeoutMs = 60000,
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
  adaptiveDocScope = null,
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
  softDeadlineMs = null,
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
  sessionPoolingEnabled = true,
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
  const resolvedProviderId = String(providerId || cmd || 'lsp');
  const resolvedHoverMaxPerFile = toFiniteInt(hoverMaxPerFile, 0);
  const resolvedHoverDisableAfterTimeouts = toFiniteInt(hoverDisableAfterTimeouts, 1);
  const resolvedHoverKinds = normalizeHoverKinds(hoverSymbolKinds);
  const resolvedSoftDeadlineMs = resolvePositiveTimeout(softDeadlineMs)
    ?? Math.max(
      2000,
      Math.floor((resolvePositiveTimeout(timeoutMs) ?? 60000) * 0.9)
    );
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
  // Symbol-level enrichment used to run mostly serial within each document.
  // Raise concurrency here while downstream request-limiters keep per-method
  // pressure bounded so we improve throughput without dropping enrichment work.
  const resolvedSymbolProcessingConcurrency = clampIntRange(
    Math.max(
      resolvedDocumentSymbolConcurrency * 8,
      resolvedHoverConcurrency * 2,
      8
    ),
    16,
    { min: 1, max: 256 }
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
    softDeadlineReached: false,
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
    enabled: sessionPoolingEnabled !== false,
    repoRoot: rootDir,
    providerId: resolvedProviderId,
    workspaceKey: workspaceKey || rootDir,
    cmd,
    args,
    cwd: rootDir,
    env: applyToolchainDaemonPolicyEnv(process.env),
    log,
    stderrFilter,
    onNotification,
    timeoutMs,
    retries,
    breakerThreshold,
    lifecycleName: resolvedProviderId,
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
        const requestTimeout = err?.code === 'ERR_LSP_REQUEST_TIMEOUT'
          || message.includes('request timeout');
        if (transportFailure && typeof lease.markPoisoned === 'function') {
          lease.markPoisoned('transport_failure');
        }
        if (requestTimeout && typeof lease.markPoisoned === 'function') {
          lease.markPoisoned('request_timeout');
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
      const softDeadlineAt = Number.isFinite(Number(resolvedSoftDeadlineMs))
        ? Date.now() + Number(resolvedSoftDeadlineMs)
        : null;
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
      const adaptiveScopePlan = __resolveAdaptiveLspScopePlanForTests({
        providerId: resolvedProviderId,
        docs: docsToOpen,
        targetsByPath,
        clientMetrics: typeof client.getMetrics === 'function' ? client.getMetrics() : null,
        documentSymbolConcurrency: resolvedDocumentSymbolConcurrency,
        hoverMaxPerFile: resolvedHoverMaxPerFile,
        adaptiveDocScope
      });
      const selectedDocsToOpen = adaptiveScopePlan.documents;
      if (!selectedDocsToOpen.length) {
        runtime.selection = {
          providerId: resolvedProviderId,
          totalDocs: adaptiveScopePlan.totalDocs,
          selectedDocs: 0,
          totalTargets: adaptiveScopePlan.totalTargets,
          selectedTargets: 0,
          docLimitApplied: adaptiveScopePlan.docLimitApplied,
          degraded: adaptiveScopePlan.degraded,
          reason: adaptiveScopePlan.reason,
          hoverMaxPerFile: adaptiveScopePlan.hoverMaxPerFile
        };
        return buildEmptyCollectResult(checks, runtime);
      }
      const selectedTargetsByPath = new Map();
      for (const doc of selectedDocsToOpen) {
        const pathKey = String(doc?.virtualPath || '');
        if (!pathKey) continue;
        const docTargets = targetsByPath.get(pathKey) || [];
        if (docTargets.length) {
          selectedTargetsByPath.set(pathKey, docTargets);
        }
      }
      const effectiveHoverMaxPerFile = adaptiveScopePlan.hoverMaxPerFile;
      runtime.selection = {
        providerId: resolvedProviderId,
        totalDocs: adaptiveScopePlan.totalDocs,
        selectedDocs: adaptiveScopePlan.selectedDocs,
        totalTargets: adaptiveScopePlan.totalTargets,
        selectedTargets: adaptiveScopePlan.selectedTargets,
        docLimitApplied: adaptiveScopePlan.docLimitApplied,
        degraded: adaptiveScopePlan.degraded,
        reason: adaptiveScopePlan.reason,
        hoverMaxPerFile: effectiveHoverMaxPerFile,
        profile: adaptiveScopePlan.profile
      };
      if (
        adaptiveScopePlan.docLimitApplied
        || adaptiveScopePlan.degraded
        || effectiveHoverMaxPerFile !== (resolvedHoverMaxPerFile > 0 ? resolvedHoverMaxPerFile : null)
      ) {
        log(
          `[tooling] ${cmd} adaptive scope: docs=${adaptiveScopePlan.selectedDocs}/${adaptiveScopePlan.totalDocs}, `
          + `targets=${adaptiveScopePlan.selectedTargets}/${adaptiveScopePlan.totalTargets}, `
          + `hoverMaxPerFile=${effectiveHoverMaxPerFile ?? 'default'}, `
          + `degraded=${adaptiveScopePlan.degraded ? 'yes' : 'no'}`
          + `${adaptiveScopePlan.reason ? `, reason=${adaptiveScopePlan.reason}` : ''}`
        );
      }

      throwIfAborted(toolingAbortSignal);
      const openDocs = new Map();
      const diskPathMap = resolvedScheme === 'file'
        ? await ensureVirtualFilesBatch({
          rootDir: resolvedRoot,
          docs: selectedDocsToOpen,
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
          targetsByPath: selectedTargetsByPath,
          byChunkUid,
          signatureParseCache,
          hoverEnabled: effectiveHoverEnabled,
          signatureHelpEnabled: effectiveSignatureHelpEnabled,
          definitionEnabled: effectiveDefinitionEnabled,
          typeDefinitionEnabled: effectiveTypeDefinitionEnabled,
          referencesEnabled: effectiveReferencesEnabled,
          hoverRequireMissingReturn,
          resolvedHoverKinds,
          resolvedHoverMaxPerFile: effectiveHoverMaxPerFile,
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
          symbolProcessingConcurrency: resolvedSymbolProcessingConcurrency,
          softDeadlineAt,
          checks,
          checkFlags,
          abortSignal: toolingAbortSignal
        });
        enriched += enrichedDelta;
      };

      let processedDocs = 0;
      let lastProgressLogAt = Date.now();
      const progressLogEnabled = selectedDocsToOpen.length >= 20;
      const runDocWithProgress = async (doc) => {
        try {
          await processDoc(doc);
        } finally {
          processedDocs += 1;
          if (!progressLogEnabled) return;
          const now = Date.now();
          const shouldLog = processedDocs === selectedDocsToOpen.length
            || processedDocs % 20 === 0
            || (now - lastProgressLogAt) >= 5000;
          if (!shouldLog) return;
          lastProgressLogAt = now;
          log(
            `[tooling] ${cmd} progress: docs=${processedDocs}/${selectedDocsToOpen.length}, enriched=${enriched}, checks=${checks.length}`
          );
        }
      };
      await runWithConcurrency(selectedDocsToOpen, resolvedDocumentSymbolConcurrency, runDocWithProgress, {
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
        docs: selectedDocsToOpen,
        openDocs,
        targetsByPath: selectedTargetsByPath,
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
