import path from 'node:path';
import { buildLineIndex } from '../../../shared/lines.js';
import { languageIdForFileExt, pathToFileUri } from '../lsp/client.js';
import { resolveInitializeResultPositionEncoding } from '../lsp/positions.js';
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
  DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES,
  LSP_REQUEST_CACHE_POLICY_VERSION,
  clampIntRange,
  createConcurrencyLimiter,
  createEmptyHoverMetricsResult,
  loadLspRequestCache,
  normalizeHoverKinds,
  persistLspRequestCache,
  processDocumentTypes,
  runWithConcurrency,
  summarizeHoverMetrics,
  toFiniteInt
} from './lsp/hover-types.js';
import { buildTargetLookupIndex, findTargetForOffsets } from './lsp/target-index.js';
import {
  ensureVirtualFilesBatch,
  normalizeUriScheme,
  resolveDocumentUri,
  resolveVfsIoBatching
} from './lsp/vfs-batching.js';
import { classifyLspDocumentPathPolicy } from './lsp/path-policy.js';
import { buildLspCapabilityGate, probeLspCapabilities } from './lsp/capabilities.js';
import { withLspSession } from './lsp/session-pool.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { coercePositiveInt } from '../../../shared/number-coerce.js';
import { sleep } from '../../../shared/sleep.js';
import { applyToolchainDaemonPolicyEnv } from '../../../shared/toolchain-env.js';
import { sha1 } from '../../../shared/hash.js';
import { getLspProviderDelta, listLspProviderDeltas } from '../../../index/tooling/lsp-provider-deltas.js';

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

const ADAPTIVE_LSP_SCOPE_PROFILES = Object.freeze(
  Object.fromEntries(
    listLspProviderDeltas()
      .filter((delta) => delta?.adaptiveDocScope && typeof delta.adaptiveDocScope === 'object')
      .map((delta) => [delta.id, Object.freeze({ ...delta.adaptiveDocScope })])
  )
);

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
    targetThreshold: normalizeInt(value.targetThreshold),
    maxTargets: normalizeInt(value.maxTargets),
    degradedMaxTargets: normalizeInt(value.degradedMaxTargets),
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

const buildAdaptiveLspDocEntries = (docs, targetsByPath) => (
  Array.isArray(docs)
    ? docs.map((doc) => ({
      doc,
      virtualPath: String(doc?.virtualPath || ''),
      targetCount: (targetsByPath.get(doc?.virtualPath) || []).length,
      byteLength: Buffer.byteLength(String(doc?.text || ''), 'utf8'),
      pathPolicy: classifyLspDocumentPathPolicy({
        providerId: doc?.providerId || null,
        virtualPath: doc?.virtualPath || ''
      })
    }))
    : []
);

const resolveAdaptiveSelectionTierRank = (entry) => {
  const tier = String(entry?.pathPolicy?.selectionTier || 'preferred').trim().toLowerCase();
  if (tier === 'preferred') return 0;
  if (tier === 'secondary') return 1;
  if (tier === 'low-value') return 2;
  return 3;
};

const rankAdaptiveLspDocumentEntries = (entries) => (
  Array.isArray(entries)
    ? entries.slice().sort((left, right) => (
      (resolveAdaptiveSelectionTierRank(left) - resolveAdaptiveSelectionTierRank(right))
      || (Number(Boolean(left?.pathPolicy?.skipDocumentSymbol)) - Number(Boolean(right?.pathPolicy?.skipDocumentSymbol)))
      || (right.targetCount - left.targetCount)
      || (Number(Boolean(left?.pathPolicy?.deprioritized)) - Number(Boolean(right?.pathPolicy?.deprioritized)))
      || (left.byteLength - right.byteLength)
      || left.virtualPath.localeCompare(right.virtualPath)
    ))
    : []
);

const applyAdaptiveDocCapByTier = (entries, limit) => {
  const rankedEntries = rankAdaptiveLspDocumentEntries(entries);
  if (!Number.isFinite(Number(limit)) || limit <= 0 || rankedEntries.length <= limit) {
    return rankedEntries;
  }
  const tierBuckets = new Map();
  for (const entry of rankedEntries) {
    const rank = resolveAdaptiveSelectionTierRank(entry);
    const bucket = tierBuckets.get(rank) || [];
    bucket.push(entry);
    tierBuckets.set(rank, bucket);
  }
  const limited = [];
  for (const rank of [0, 1, 2, 3]) {
    const bucket = tierBuckets.get(rank) || [];
    if (!bucket.length) continue;
    const remaining = Math.max(0, limit - limited.length);
    if (remaining <= 0) break;
    limited.push(...bucket.slice(0, remaining));
  }
  return limited.length ? limited : rankedEntries.slice(0, limit);
};

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
  adaptiveDocScope = null,
  adaptiveDegradedHint = false,
  adaptiveReasonHint = null
}) => {
  const profile = resolveAdaptiveLspScopeProfile({ providerId, override: adaptiveDocScope });
  const sourceDocs = Array.isArray(docs) ? docs : [];
  const effectiveTargetsByPath = targetsByPath instanceof Map ? targetsByPath : new Map();
  const candidateEntries = buildAdaptiveLspDocEntries(
    sourceDocs.map((doc) => ({ ...doc, providerId })),
    effectiveTargetsByPath
  ).filter((entry) => entry?.pathPolicy?.skipDocument !== true);
  const sourceEntries = candidateEntries.filter((entry) => (
    entry?.pathPolicy?.skipDocumentSymbol !== true
    && entry.targetCount > 0
  ));
  const totalTargets = sourceEntries.reduce((sum, entry) => sum + entry.targetCount, 0);
  const methodMetrics = clientMetrics?.byMethod || {};
  const documentSymbolMetrics = methodMetrics['textDocument/documentSymbol']?.latencyMs || {};
  const documentSymbolTimedOut = Number(methodMetrics['textDocument/documentSymbol']?.timedOut || 0);
  const hoverMetrics = methodMetrics['textDocument/hover']?.latencyMs || {};
  const hoverTimedOut = Number(methodMetrics['textDocument/hover']?.timedOut || 0);
  const configuredHoverMaxPerFile = toFiniteInt(hoverMaxPerFile, 0);
  let effectiveHoverMaxPerFile = configuredHoverMaxPerFile;
  let selectedEntries = sourceEntries;
  let docLimitApplied = false;
  let targetLimitApplied = false;
  let degraded = false;
  const reasons = [];
  const rankEntries = (entriesToRank) => rankAdaptiveLspDocumentEntries(entriesToRank);
  const applyTargetCap = (entriesToLimit, targetCap) => {
    const rankedEntries = rankEntries(entriesToLimit);
    const limited = [];
    let accumulatedTargets = 0;
    for (const entry of rankedEntries) {
      if (limited.length > 0 && accumulatedTargets >= targetCap) break;
      if (limited.length > 0 && (accumulatedTargets + entry.targetCount) > targetCap) break;
      limited.push(entry);
      accumulatedTargets += entry.targetCount;
    }
    return limited.length ? limited : rankedEntries.slice(0, 1);
  };
  if (profile) {
    const docThreshold = Number(profile.docThreshold || 0);
    const maxDocsBase = Number(profile.maxDocs || 0);
    const degradedMaxDocsBase = Number(profile.degradedMaxDocs || maxDocsBase || 0);
    const documentSymbolP95Ms = Number(documentSymbolMetrics?.p95 || 0);
    const hoverP95Ms = Number(hoverMetrics?.p95 || 0);
    degraded = (
      adaptiveDegradedHint === true
      || (
        (Number(profile.degradedDocumentSymbolTimeouts || 0) > 0
        && documentSymbolTimedOut >= Number(profile.degradedDocumentSymbolTimeouts || 0))
      || (Number(profile.degradedDocumentSymbolP95Ms || 0) > 0
        && documentSymbolP95Ms >= Number(profile.degradedDocumentSymbolP95Ms || 0))
      || (Number(profile.degradedHoverTimeouts || 0) > 0
        && hoverTimedOut >= Number(profile.degradedHoverTimeouts || 0))
      || (Number(profile.degradedHoverP95Ms || 0) > 0
        && hoverP95Ms >= Number(profile.degradedHoverP95Ms || 0))
      )
    );
    if (adaptiveDegradedHint === true && adaptiveReasonHint) {
      reasons.push(`preflight:${String(adaptiveReasonHint)}`);
    }
    if (docThreshold > 0 && maxDocsBase > 0 && sourceEntries.length > docThreshold) {
      const targetCap = Math.max(
        Math.max(1, clampIntRange(documentSymbolConcurrency, DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY, { min: 1, max: 32 })) * 4,
        degraded ? degradedMaxDocsBase : maxDocsBase
      );
      if (sourceEntries.length > targetCap) {
        selectedEntries = applyAdaptiveDocCapByTier(sourceEntries, targetCap);
        docLimitApplied = true;
      }
      reasons.push(degraded ? `degraded-doc-cap:${targetCap}` : `doc-cap:${targetCap}`);
    }
    const targetThreshold = Number(profile.targetThreshold || 0);
    const maxTargetsBase = Number(profile.maxTargets || 0);
    const degradedMaxTargetsBase = Number(profile.degradedMaxTargets || maxTargetsBase || 0);
    const currentTargetCount = selectedEntries.reduce((sum, entry) => sum + entry.targetCount, 0);
    if (targetThreshold > 0 && maxTargetsBase > 0 && currentTargetCount > targetThreshold) {
      const targetCap = degraded ? degradedMaxTargetsBase : maxTargetsBase;
      if (targetCap > 0 && currentTargetCount > targetCap) {
        selectedEntries = applyTargetCap(selectedEntries, targetCap);
        targetLimitApplied = true;
      }
      reasons.push(degraded ? `degraded-target-cap:${targetCap}` : `target-cap:${targetCap}`);
    }
    if (!Number.isFinite(effectiveHoverMaxPerFile) || effectiveHoverMaxPerFile <= 0) {
      if (Number(profile.defaultHoverMaxPerFile || 0) > 0) {
        effectiveHoverMaxPerFile = Number(profile.defaultHoverMaxPerFile);
      }
    }
    if ((degraded || docLimitApplied || targetLimitApplied) && Number(profile.degradedHoverMaxPerFile || 0) > 0) {
      effectiveHoverMaxPerFile = Number.isFinite(effectiveHoverMaxPerFile) && effectiveHoverMaxPerFile > 0
        ? Math.min(effectiveHoverMaxPerFile, Number(profile.degradedHoverMaxPerFile))
        : Number(profile.degradedHoverMaxPerFile);
    }
  }
  const selectedDocs = selectedEntries.map((entry) => entry.doc);
  const selectedTargetPaths = new Set(selectedDocs.map((doc) => String(doc?.virtualPath || '')).filter(Boolean));
  const selectedTargets = selectedEntries.reduce((sum, entry) => sum + entry.targetCount, 0);
  const skippedByPathPolicy = Math.max(0, sourceDocs.length - candidateEntries.length);
  const skippedByDocumentSymbolPolicy = Math.max(
    0,
    candidateEntries.filter((entry) => entry?.pathPolicy?.skipDocumentSymbol === true).length
  );
  const skippedByMissingTargets = Math.max(
    0,
    candidateEntries.filter((entry) => (
      entry?.pathPolicy?.skipDocumentSymbol !== true
      && entry.targetCount <= 0
    )).length
  );
  const interactiveSuppressedDocs = selectedEntries.filter((entry) => entry?.pathPolicy?.suppressInteractive).length;
  if (!selectedEntries.length && skippedByDocumentSymbolPolicy > 0) {
    reasons.push('document-symbol-path-policy');
  }
  if (!selectedEntries.length && skippedByMissingTargets > 0) {
    reasons.push('no-targets');
  }
  return {
    profile,
    entries: selectedEntries,
    documents: selectedDocs,
    selectedTargetPaths,
    sourceDocCount: sourceDocs.length,
    totalDocs: sourceEntries.length,
    selectedDocs: selectedDocs.length,
    totalTargets,
    selectedTargets,
    skippedByPathPolicy,
    skippedByDocumentSymbolPolicy,
    skippedByMissingTargets,
    interactiveSuppressedDocs,
    docLimitApplied,
    targetLimitApplied,
    degraded,
    reason: reasons.length ? reasons.join(',') : null,
    hoverMaxPerFile: Number.isFinite(effectiveHoverMaxPerFile) && effectiveHoverMaxPerFile > 0
      ? effectiveHoverMaxPerFile
      : null
  };
};

const REQUEST_BUDGET_METHODS = Object.freeze({
  documentSymbol: 'textDocument/documentSymbol',
  hover: 'textDocument/hover',
  semanticTokens: 'textDocument/semanticTokens/full',
  signatureHelp: 'textDocument/signatureHelp',
  inlayHints: 'textDocument/inlayHint',
  definition: 'textDocument/definition',
  typeDefinition: 'textDocument/typeDefinition',
  references: 'textDocument/references'
});

const REQUEST_BUDGET_WEIGHTS = Object.freeze({
  documentSymbol: 1,
  hover: 1,
  semanticTokens: 0.8,
  signatureHelp: 1.1,
  inlayHints: 0.9,
  definition: 1.4,
  typeDefinition: 1.5,
  references: 1.8
});

const REQUEST_BUDGET_P95_THRESHOLDS = Object.freeze({
  documentSymbol: 3000,
  hover: 1800,
  semanticTokens: 2200,
  signatureHelp: 1800,
  inlayHints: 1800,
  definition: 2200,
  typeDefinition: 2200,
  references: 2500
});

const REQUEST_BUDGET_PROVIDER_WEIGHTS = Object.freeze(
  Object.fromEntries(
    listLspProviderDeltas()
      .map((delta) => [delta.id, Number(delta?.requestBudgetWeight)])
      .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
  )
);

const resolveProviderConfidenceBias = (providerId) => {
  const delta = getLspProviderDelta(providerId);
  const bias = Number(delta?.confidenceBias);
  return Number.isFinite(bias) ? bias : 0;
};

const toNonNegativeInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const createBudgetController = (maxRequests) => {
  const cap = toFiniteInt(maxRequests, 0);
  if (!Number.isFinite(cap) || cap < 0) {
    return {
      enabled: false,
      maxRequests: null,
      used: 0,
      tryReserve() {
        return true;
      }
    };
  }
  let used = 0;
  return {
    enabled: true,
    maxRequests: cap,
    get used() {
      return used;
    },
    tryReserve() {
      if (used >= cap) return false;
      used += 1;
      return true;
    }
  };
};

const createEmptyRequestCacheMetrics = (providerId = null) => ({
  providerId: String(providerId || '').trim() || null,
  hits: 0,
  misses: 0,
  memoryHits: 0,
  persistedHits: 0,
  negativeHits: 0,
  writes: 0,
  byKind: Object.create(null)
});

const summarizeRequestCacheMetrics = (metrics) => {
  if (!metrics || typeof metrics !== 'object') {
    return createEmptyRequestCacheMetrics(null);
  }
  const byKind = Object.create(null);
  for (const [kind, value] of Object.entries(metrics.byKind || {})) {
    byKind[kind] = {
      hits: toNonNegativeInt(value?.hits),
      misses: toNonNegativeInt(value?.misses),
      memoryHits: toNonNegativeInt(value?.memoryHits),
      persistedHits: toNonNegativeInt(value?.persistedHits),
      negativeHits: toNonNegativeInt(value?.negativeHits),
      writes: toNonNegativeInt(value?.writes)
    };
  }
  return {
    providerId: metrics.providerId || null,
    hits: toNonNegativeInt(metrics.hits),
    misses: toNonNegativeInt(metrics.misses),
    memoryHits: toNonNegativeInt(metrics.memoryHits),
    persistedHits: toNonNegativeInt(metrics.persistedHits),
    negativeHits: toNonNegativeInt(metrics.negativeHits),
    writes: toNonNegativeInt(metrics.writes),
    byKind
  };
};

export const __resolveAdaptiveLspRequestBudgetPlanForTests = ({
  providerId,
  selection,
  clientMetrics = null,
  lifecycleState = null,
  guardState = null,
  workspaceKey = null
}) => {
  const selectedDocs = toNonNegativeInt(selection?.selectedDocs);
  const selectedTargets = toNonNegativeInt(selection?.selectedTargets);
  const hoverMaxPerFile = Math.max(1, toNonNegativeInt(selection?.hoverMaxPerFile || 1));
  const providerWeight = Number(REQUEST_BUDGET_PROVIDER_WEIGHTS[String(providerId || '').trim()]) || 1;
  const methodMetrics = clientMetrics?.byMethod || {};
  const lifecycle = lifecycleState && typeof lifecycleState === 'object' ? lifecycleState : {};
  const guard = guardState && typeof guardState === 'object' ? guardState : {};
  const workspaceCostCeiling = Math.max(
    selectedDocs,
    Math.floor((selectedTargets * 3 + selectedDocs * 2) * providerWeight)
  );
  const baseByKind = {
    documentSymbol: selectedDocs,
    hover: Math.max(0, Math.min(selectedTargets || (selectedDocs * hoverMaxPerFile), selectedDocs * hoverMaxPerFile)),
    semanticTokens: selectedDocs,
    signatureHelp: Math.ceil(selectedDocs * hoverMaxPerFile * 0.75),
    inlayHints: Math.ceil(selectedDocs * hoverMaxPerFile * 0.75),
    definition: Math.ceil(selectedDocs * hoverMaxPerFile * 0.5),
    typeDefinition: Math.ceil(selectedDocs * hoverMaxPerFile * 0.35),
    references: Math.ceil(selectedDocs * hoverMaxPerFile * 0.25)
  };
  const weightedCost = Object.entries(baseByKind).reduce(
    (sum, [kind, value]) => sum + (Number(value || 0) * Number(REQUEST_BUDGET_WEIGHTS[kind] || 1)),
    0
  );
  const scale = weightedCost > workspaceCostCeiling && weightedCost > 0
    ? (workspaceCostCeiling / weightedCost)
    : 1;
  const byKind = Object.create(null);
  let degraded = false;
  const reasons = [];
  for (const [kind, baseValueRaw] of Object.entries(baseByKind)) {
    const baseValue = toNonNegativeInt(baseValueRaw);
    const methodName = REQUEST_BUDGET_METHODS[kind];
    const method = methodMetrics?.[methodName] || {};
    const requests = Math.max(0, Number(method?.requests || 0));
    const failures = Math.max(0, Number(method?.failed || 0));
    const timedOut = Math.max(0, Number(method?.timedOut || 0));
    const failureRate = requests > 0 ? (failures / requests) : 0;
    const timeoutRate = requests > 0 ? (timedOut / requests) : 0;
    const p95Ms = Math.max(0, Number(method?.latencyMs?.p95 || 0));
    let multiplier = scale;
    const reasonCodes = [];
    if (timeoutRate >= 0.15 || timedOut >= 2) {
      multiplier *= 0.5;
      degraded = true;
      reasonCodes.push('timeout_pressure');
    }
    if (failureRate >= 0.25 || failures >= 3) {
      multiplier *= 0.65;
      degraded = true;
      reasonCodes.push('failure_pressure');
    }
    if (p95Ms >= Number(REQUEST_BUDGET_P95_THRESHOLDS[kind] || 0)) {
      multiplier *= 0.8;
      degraded = true;
      reasonCodes.push('latency_pressure');
    }
    if (lifecycle?.fdPressureBackoffActive === true) {
      multiplier *= 0.75;
      degraded = true;
      reasonCodes.push('fd_pressure_backoff');
    }
    if ((lifecycle?.crashLoopQuarantined === true) || Number(guard?.tripCount || 0) > 0) {
      multiplier *= 0.5;
      degraded = true;
      reasonCodes.push('breaker_or_quarantine');
    }
    const forcedZero = lifecycle?.crashLoopQuarantined === true && kind !== 'documentSymbol';
    const maxRequests = forcedZero
      ? 0
      : (
        baseValue > 0
          ? Math.max(1, Math.floor(baseValue * multiplier))
          : 0
      );
    byKind[kind] = {
      method: methodName,
      maxRequests,
      baseRequests: baseValue,
      requests,
      failures,
      timedOut,
      failureRate: Number(failureRate.toFixed(4)),
      timeoutRate: Number(timeoutRate.toFixed(4)),
      p95Ms,
      reasonCodes
    };
    if (reasonCodes.length) reasons.push(`${kind}:${reasonCodes.join('+')}`);
  }
  return {
    providerId: String(providerId || '').trim() || null,
    workspaceKey: String(workspaceKey || '').trim() || null,
    policyVersion: LSP_REQUEST_CACHE_POLICY_VERSION,
    workspaceCostCeiling,
    weightedCost: Number(weightedCost.toFixed(2)),
    degraded,
    reason: reasons.length ? reasons.join(',') : null,
    byKind
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
 * @param {number} [params.requestCacheMaxEntries=50000]
 * @param {(line:string)=>boolean|null} [params.stderrFilter=null]
 * @param {object|null} [params.initializationOptions=null]
 * @param {string|null} [params.providerId=null]
 * @param {string|null} [params.providerVersion=null]
 * @param {boolean} [params.semanticTokensEnabled=true]
 * @param {boolean} [params.inlayHintsEnabled=true]
 * @param {string|null} [params.workspaceRootDir=null]
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
  adaptiveDegradedHint = false,
  adaptiveReasonHint = null,
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
  requestCacheMaxEntries = DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES,
  stderrFilter = null,
  initializationOptions = null,
  providerId = null,
  providerVersion = null,
  semanticTokensEnabled = true,
  inlayHintsEnabled = true,
  workspaceRootDir = null,
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
  const resolvedProviderVersion = String(providerVersion || '1.0.0').trim() || '1.0.0';
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
  const resolvedRequestCacheMaxEntries = clampIntRange(
    requestCacheMaxEntries,
    DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES,
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
  const docs = Array.isArray(documents)
    ? documents.map((doc) => ({
      ...doc,
      docHash: String(doc?.docHash || '').trim()
        || sha1(`${String(doc?.virtualPath || '')}\0${String(doc?.text || '')}`)
    }))
    : [];
  const targetList = Array.isArray(targets) ? targets : [];
  if (!docs.length || !targetList.length) {
    runtime.selection = {
      providerId: resolvedProviderId,
      totalDocs: docs.length,
      selectedDocs: 0,
      totalTargets: targetList.length,
      selectedTargets: 0,
      docLimitApplied: false,
      targetLimitApplied: false,
      degraded: false,
      reason: !docs.length ? 'no-documents' : 'no-targets',
      hoverMaxPerFile: resolvedHoverMaxPerFile,
      skippedByPathPolicy: 0,
      skippedByDocumentSymbolPolicy: 0,
      skippedByMissingTargets: docs.length,
      interactiveSuppressedDocs: 0
    };
    return buildEmptyCollectResult(checks, runtime);
  }
  throwIfAborted(toolingAbortSignal);

  const resolvedRoot = vfsRoot || rootDir;
  const resolvedWorkspaceRootDir = String(workspaceRootDir || rootDir || '').trim() || rootDir;
  const resolvedWorkspaceKey = String(workspaceKey || workspaceRootDir || rootDir || '').trim() || null;
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
    runtime.selection = {
      providerId: resolvedProviderId,
      totalDocs: docs.length,
      selectedDocs: 0,
      totalTargets: targetList.length,
      selectedTargets: 0,
      docLimitApplied: false,
      targetLimitApplied: false,
      degraded: false,
      reason: 'no-targets',
      hoverMaxPerFile: resolvedHoverMaxPerFile,
      skippedByPathPolicy: 0,
      skippedByDocumentSymbolPolicy: 0,
      skippedByMissingTargets: docs.length,
      interactiveSuppressedDocs: 0
    };
    return buildEmptyCollectResult(checks, runtime);
  }
  const preInitializeAdaptiveScopePlan = __resolveAdaptiveLspScopePlanForTests({
    providerId: resolvedProviderId,
    docs: docsToOpen,
    targetsByPath,
    clientMetrics: null,
    documentSymbolConcurrency: resolvedDocumentSymbolConcurrency,
    hoverMaxPerFile: resolvedHoverMaxPerFile,
    adaptiveDocScope,
    adaptiveDegradedHint,
    adaptiveReasonHint
  });
  if (!preInitializeAdaptiveScopePlan.documents.length) {
    runtime.selection = {
      providerId: resolvedProviderId,
      totalDocs: preInitializeAdaptiveScopePlan.totalDocs,
      selectedDocs: 0,
      totalTargets: preInitializeAdaptiveScopePlan.totalTargets,
      selectedTargets: 0,
      docLimitApplied: preInitializeAdaptiveScopePlan.docLimitApplied,
      targetLimitApplied: preInitializeAdaptiveScopePlan.targetLimitApplied,
      degraded: preInitializeAdaptiveScopePlan.degraded,
      reason: preInitializeAdaptiveScopePlan.reason,
      hoverMaxPerFile: preInitializeAdaptiveScopePlan.hoverMaxPerFile,
      skippedByPathPolicy: preInitializeAdaptiveScopePlan.skippedByPathPolicy,
      skippedByDocumentSymbolPolicy: preInitializeAdaptiveScopePlan.skippedByDocumentSymbolPolicy,
      skippedByMissingTargets: preInitializeAdaptiveScopePlan.skippedByMissingTargets,
      interactiveSuppressedDocs: 0
    };
    return buildEmptyCollectResult(checks, runtime);
  }

  let coldStartCache = null;

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
    workspaceKey: resolvedWorkspaceKey || rootDir,
    cmd,
    args,
    cwd: resolvedWorkspaceRootDir,
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
    runtime.capabilityGate = {
      requested: Object.create(null),
      effective: Object.create(null),
      missing: []
    };
    runtime.workspaceModel = {
      workspaceRootDir: resolvedWorkspaceRootDir,
      workspaceKey: resolvedWorkspaceKey
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

    const refreshRuntimeState = ({ includeRequests = false } = {}) => {
      runtime.lifecycle = typeof lease.getReliabilityState === 'function'
        ? lease.getReliabilityState()
        : lifecycleHealth.getState();
      runtime.guard = guard.getState ? guard.getState() : null;
      if (includeRequests || runtime.requests == null) {
        runtime.requests = typeof client.getMetrics === 'function' ? client.getMetrics() : null;
      }
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

    const rootUri = pathToFileUri(resolvedWorkspaceRootDir);
    let shouldShutdownClient = false;
    let capabilityMask = null;
    let effectiveHoverEnabled = hoverEnabled !== false;
    let effectiveSemanticTokensEnabled = semanticTokensEnabled !== false;
    let effectiveSignatureHelpEnabled = signatureHelpEnabled !== false;
    let effectiveInlayHintsEnabled = inlayHintsEnabled !== false;
    let effectiveDefinitionEnabled = definitionEnabled !== false;
    let effectiveTypeDefinitionEnabled = typeDefinitionEnabled !== false;
    let effectiveReferencesEnabled = referencesEnabled !== false;
    let skipSymbolCollection = false;
    let positionEncoding = 'utf-16';
    let initializeResult = null;
    try {
      throwIfAborted(toolingAbortSignal);
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
        positionEncoding = resolveInitializeResultPositionEncoding(initializeResult);
        runtime.positionEncoding = positionEncoding;
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
        positionEncoding = resolveInitializeResultPositionEncoding(initializeResult);
        runtime.positionEncoding = positionEncoding;
      }
      capabilityMask = probeLspCapabilities(initializeResult);
      const capabilityGate = buildLspCapabilityGate({
        capabilityMask,
        cmd,
        hoverEnabled,
        semanticTokensEnabled,
        signatureHelpEnabled,
        inlayHintsEnabled,
        definitionEnabled,
        typeDefinitionEnabled,
        referencesEnabled
      });
      runtime.capabilities = capabilityGate.capabilities;
      runtime.capabilityGate = {
        requested: capabilityGate.requested,
        effective: capabilityGate.effective,
        missing: capabilityGate.missing
      };
      effectiveHoverEnabled = capabilityGate.effective.hover;
      effectiveSemanticTokensEnabled = capabilityGate.effective.semanticTokens;
      effectiveSignatureHelpEnabled = capabilityGate.effective.signatureHelp;
      effectiveInlayHintsEnabled = capabilityGate.effective.inlayHints;
      effectiveDefinitionEnabled = capabilityGate.effective.definition;
      effectiveTypeDefinitionEnabled = capabilityGate.effective.typeDefinition;
      effectiveReferencesEnabled = capabilityGate.effective.references;
      skipSymbolCollection = capabilityGate.skipSymbolCollection;
      checks.push(...capabilityGate.checks);
      if (skipSymbolCollection) {
        shouldShutdownClient = lease.pooled !== true;
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
      refreshRuntimeState({ includeRequests: true });
      return buildEmptyCollectResult(checks, runtime);
    }

    try {
      if (skipSymbolCollection) {
        refreshRuntimeState({ includeRequests: true });
        return buildEmptyCollectResult(checks, runtime);
      }
      const byChunkUid = {};
      let enriched = 0;
      const signatureParseCache = new Map();
      const hoverFileStats = new Map();
      const hoverLatencyMs = [];
      const hoverMetrics = createEmptyHoverMetricsResult();
      const hoverControl = { disabledGlobal: false };
      const documentSymbolControl = { disabled: false };
      const softDeadlineAt = Number.isFinite(Number(resolvedSoftDeadlineMs))
        ? Date.now() + Number(resolvedSoftDeadlineMs)
        : null;
      const hoverLimiter = createConcurrencyLimiter(resolvedHoverConcurrency);
      const signatureHelpLimiter = createConcurrencyLimiter(resolvedSignatureHelpConcurrency);
      const definitionLimiter = createConcurrencyLimiter(resolvedDefinitionConcurrency);
      const typeDefinitionLimiter = createConcurrencyLimiter(resolvedTypeDefinitionConcurrency);
      const referencesLimiter = createConcurrencyLimiter(resolvedReferencesConcurrency);
      const requestCacheState = await loadLspRequestCache(cacheRoot);
      const requestCacheEntries = requestCacheState.entries;
      const requestCachePersistedKeys = requestCacheState.persistedKeys;
      const requestCacheMetrics = createEmptyRequestCacheMetrics(resolvedProviderId);
      let requestCacheDirty = false;
      const markRequestCacheDirty = () => {
        requestCacheDirty = true;
      };
      const adaptiveScopePlan = __resolveAdaptiveLspScopePlanForTests({
        providerId: resolvedProviderId,
        docs: docsToOpen,
        targetsByPath,
        clientMetrics: typeof client.getMetrics === 'function' ? client.getMetrics() : null,
        documentSymbolConcurrency: resolvedDocumentSymbolConcurrency,
        hoverMaxPerFile: resolvedHoverMaxPerFile,
        adaptiveDocScope,
        adaptiveDegradedHint,
        adaptiveReasonHint
      });
      const selectedDocsToOpen = captureDiagnostics
        ? adaptiveScopePlan.documents
        : adaptiveScopePlan.entries
          .filter((entry) => entry?.pathPolicy?.skipDocumentSymbol !== true)
          .map((entry) => entry.doc);
      if (!selectedDocsToOpen.length) {
        runtime.selection = {
          providerId: resolvedProviderId,
          totalDocs: adaptiveScopePlan.totalDocs,
          selectedDocs: 0,
          totalTargets: adaptiveScopePlan.totalTargets,
          selectedTargets: 0,
          docLimitApplied: adaptiveScopePlan.docLimitApplied,
          targetLimitApplied: adaptiveScopePlan.targetLimitApplied,
          degraded: adaptiveScopePlan.degraded,
          reason: adaptiveScopePlan.reason,
          hoverMaxPerFile: adaptiveScopePlan.hoverMaxPerFile,
          skippedByPathPolicy: adaptiveScopePlan.skippedByPathPolicy,
          skippedByDocumentSymbolPolicy: adaptiveScopePlan.skippedByDocumentSymbolPolicy,
          skippedByMissingTargets: adaptiveScopePlan.skippedByMissingTargets,
          interactiveSuppressedDocs: 0
        };
        return buildEmptyCollectResult(checks, runtime);
      }
      const selectedTargetsByPath = new Map();
      const docPathPolicyByPath = new Map();
      const selectedEntries = Array.isArray(adaptiveScopePlan.entries) ? adaptiveScopePlan.entries : [];
      const selectedEntryByPath = new Map(
        selectedEntries.map((entry) => [String(entry?.virtualPath || ''), entry])
      );
      for (const doc of selectedDocsToOpen) {
        const pathKey = String(doc?.virtualPath || '');
        if (!pathKey) continue;
        const docTargets = targetsByPath.get(pathKey) || [];
        if (docTargets.length) {
          selectedTargetsByPath.set(pathKey, docTargets);
        }
        const matchingEntry = selectedEntryByPath.get(pathKey);
        docPathPolicyByPath.set(pathKey, matchingEntry?.pathPolicy || null);
      }
      const targetIndexesByPath = new Map(
        Array.from(selectedTargetsByPath.entries(), ([pathKey, docTargets]) => [
          pathKey,
          buildTargetLookupIndex(docTargets)
        ])
      );
      const effectiveHoverMaxPerFile = adaptiveScopePlan.hoverMaxPerFile;
      const requestBudgetPlan = __resolveAdaptiveLspRequestBudgetPlanForTests({
        providerId: resolvedProviderId,
        selection: adaptiveScopePlan,
        clientMetrics: typeof client.getMetrics === 'function' ? client.getMetrics() : null,
        lifecycleState: lifecycleHealth.getState(),
        guardState: guard.getState ? guard.getState() : null,
        workspaceKey: resolvedWorkspaceKey
      });
      const requestBudgetControllers = {
        documentSymbol: createBudgetController(requestBudgetPlan.byKind?.documentSymbol?.maxRequests),
        hover: createBudgetController(requestBudgetPlan.byKind?.hover?.maxRequests),
        semanticTokens: createBudgetController(requestBudgetPlan.byKind?.semanticTokens?.maxRequests),
        signatureHelp: createBudgetController(requestBudgetPlan.byKind?.signatureHelp?.maxRequests),
        inlayHints: createBudgetController(requestBudgetPlan.byKind?.inlayHints?.maxRequests),
        definition: createBudgetController(requestBudgetPlan.byKind?.definition?.maxRequests),
        typeDefinition: createBudgetController(requestBudgetPlan.byKind?.typeDefinition?.maxRequests),
        references: createBudgetController(requestBudgetPlan.byKind?.references?.maxRequests)
      };
      runtime.selection = {
        providerId: resolvedProviderId,
        totalDocs: adaptiveScopePlan.totalDocs,
        selectedDocs: adaptiveScopePlan.selectedDocs,
        openedDocs: selectedDocsToOpen.length,
        totalTargets: adaptiveScopePlan.totalTargets,
        selectedTargets: adaptiveScopePlan.selectedTargets,
        docLimitApplied: adaptiveScopePlan.docLimitApplied,
        targetLimitApplied: adaptiveScopePlan.targetLimitApplied,
        degraded: adaptiveScopePlan.degraded,
        reason: adaptiveScopePlan.reason,
        hoverMaxPerFile: effectiveHoverMaxPerFile,
        profile: adaptiveScopePlan.profile,
        skippedByPathPolicy: adaptiveScopePlan.skippedByPathPolicy,
        skippedByDocumentSymbolPolicy: adaptiveScopePlan.skippedByDocumentSymbolPolicy,
        skippedByMissingTargets: adaptiveScopePlan.skippedByMissingTargets,
        interactiveSuppressedDocs: adaptiveScopePlan.interactiveSuppressedDocs
      };
      runtime.requestBudgets = requestBudgetPlan;
      runtime.requestCache = summarizeRequestCacheMetrics(requestCacheMetrics);
      if (adaptiveScopePlan.skippedByPathPolicy > 0) {
        log(
          `[tooling] ${cmd} path policy skipped ${adaptiveScopePlan.skippedByPathPolicy}/${adaptiveScopePlan.sourceDocCount} `
          + 'document(s) before LSP collection.'
        );
      }
      if (adaptiveScopePlan.skippedByDocumentSymbolPolicy > 0) {
        log(
          `[tooling] ${cmd} path policy skipped documentSymbol on `
          + `${adaptiveScopePlan.skippedByDocumentSymbolPolicy}/${adaptiveScopePlan.totalDocs} `
          + 'low-value document(s).'
        );
      }
      if (adaptiveScopePlan.skippedByMissingTargets > 0) {
        log(
          `[tooling] ${cmd} skipped ${adaptiveScopePlan.skippedByMissingTargets}/${adaptiveScopePlan.sourceDocCount} `
          + 'document(s) with no selected targets.'
        );
      }
      const interactiveSuppressedDocs = adaptiveScopePlan.interactiveSuppressedDocs;
      if (interactiveSuppressedDocs > 0) {
        log(
          `[tooling] ${cmd} path policy disabled interactive LSP stages for `
          + `${interactiveSuppressedDocs}/${selectedEntries.length} document(s).`
        );
      }
      if (selectedDocsToOpen.length < adaptiveScopePlan.selectedDocs) {
        log(
          `[tooling] ${cmd} documentSymbol-only scope reduced opened docs to `
          + `${selectedDocsToOpen.length}/${adaptiveScopePlan.selectedDocs}.`
        );
      }
      if (
        adaptiveScopePlan.docLimitApplied
        || adaptiveScopePlan.targetLimitApplied
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
      if (vfsColdStartCache !== false) {
        const resolvedIndexDir = indexDir || resolvedRoot || rootDir;
        const indexSignature = resolvedIndexDir ? await buildIndexSignature(resolvedIndexDir) : null;
        const manifestHash = resolvedIndexDir
          ? await computeVfsManifestHash({ indexDir: resolvedIndexDir })
          : null;
        coldStartCache = await createVfsColdStartCache({
          cacheRoot,
          indexSignature,
          manifestHash,
          config: vfsColdStartCache
        });
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
          targetIndexesByPath,
          byChunkUid,
          signatureParseCache,
          hoverEnabled: effectiveHoverEnabled,
          semanticTokensEnabled: effectiveSemanticTokensEnabled,
          signatureHelpEnabled: effectiveSignatureHelpEnabled,
          inlayHintsEnabled: effectiveInlayHintsEnabled,
          definitionEnabled: effectiveDefinitionEnabled,
          typeDefinitionEnabled: effectiveTypeDefinitionEnabled,
          referencesEnabled: effectiveReferencesEnabled,
          docPathPolicy: docPathPolicyByPath.get(String(doc?.virtualPath || '')) || null,
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
          requestCacheEntries,
          requestCachePersistedKeys,
          requestCacheMetrics,
          markRequestCacheDirty,
          requestBudgetControllers,
          requestCacheContext: {
            providerId: resolvedProviderId,
            providerVersion: resolvedProviderVersion,
            workspaceKey: resolvedWorkspaceKey
          },
          providerConfidenceBias: resolveProviderConfidenceBias(resolvedProviderId),
          semanticTokensLegend: initializeResult?.capabilities?.semanticTokensProvider?.legend
            || initializeResult?.capabilities?.textDocument?.semanticTokens?.legend
            || null,
          hoverControl,
          hoverFileStats,
          hoverLatencyMs,
          hoverMetrics,
          documentSymbolControl,
          symbolProcessingConcurrency: resolvedSymbolProcessingConcurrency,
          softDeadlineAt,
          positionEncoding,
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

      if (requestCacheDirty) {
        try {
          await persistLspRequestCache({
            cachePath: requestCacheState.path,
            entries: requestCacheEntries,
            maxEntries: resolvedRequestCacheMaxEntries
          });
        } catch {}
      }
      throwIfAborted(toolingAbortSignal);

      const { diagnosticsByChunkUid, diagnosticsCount } = shapeDiagnosticsByChunkUid({
        captureDiagnostics,
        diagnosticsByUri,
        docs: selectedDocsToOpen,
        openDocs,
        targetIndexesByPath,
        diskPathMap,
        resolvedRoot,
        resolvedScheme,
        lineIndexFactory,
        maxDiagnosticsPerChunk: resolvedMaxDiagnosticsPerChunk,
        checks,
        checkFlags,
        findTargetForOffsets,
        positionEncoding
      });

      if (coldStartCache?.flush) {
        try {
          await coldStartCache.flush();
        } catch (err) {
          log(`[tooling] vfs cold-start cache flush failed: ${err?.message || err}`);
        }
      }

      const lifecycleState = lifecycleHealth.getState();
      refreshRuntimeState({ includeRequests: true });
      runtime.requestCache = summarizeRequestCacheMetrics(requestCacheMetrics);
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
      const isQuarantined = err?.code === 'TOOLING_QUARANTINED';
      if (isQuarantined) {
        runtime.lifecycle = err?.detail
          ? { ...(runtime.lifecycle || {}), quarantine: err.detail }
          : runtime.lifecycle;
        checks.push({
          name: 'tooling_provider_quarantined',
          status: 'warn',
          message: `${cmd} provider quarantine active${err?.detail?.remainingMs != null ? ` (${err.detail.remainingMs}ms remaining)` : ''}.`
        });
        return buildEmptyCollectResult(checks, runtime);
      }
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
