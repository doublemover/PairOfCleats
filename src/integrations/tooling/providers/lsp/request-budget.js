import {
  LSP_REQUEST_CACHE_POLICY_VERSION,
  toFiniteInt
} from './hover-types.js';
import { getLspProviderDelta, listLspProviderDeltas } from '../../../../index/tooling/lsp-provider-deltas.js';

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

export const resolveProviderConfidenceBias = (providerId) => {
  const delta = getLspProviderDelta(providerId);
  const bias = Number(delta?.confidenceBias);
  return Number.isFinite(bias) ? bias : 0;
};

const toNonNegativeInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

export const createBudgetController = (maxRequests) => {
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

export const createEmptyRequestCacheMetrics = (providerId = null) => ({
  providerId: String(providerId || '').trim() || null,
  hits: 0,
  misses: 0,
  memoryHits: 0,
  persistedHits: 0,
  negativeHits: 0,
  writes: 0,
  byKind: Object.create(null)
});

export const summarizeRequestCacheMetrics = (metrics) => {
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

export const resolveAdaptiveLspRequestBudgetPlanForTests = ({
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
    const minimumRequests = kind === 'documentSymbol' ? baseValue : (baseValue > 0 ? 1 : 0);
    const maxRequests = forcedZero
      ? 0
      : (
        baseValue > 0
          ? Math.max(minimumRequests, Math.floor(baseValue * multiplier))
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
