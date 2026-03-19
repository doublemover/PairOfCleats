import {
  DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
  toFiniteInt
} from './hover-types.js';
import { classifyLspDocumentPathPolicy } from './path-policy.js';
import { listLspProviderDeltas } from '../../../../index/tooling/lsp-provider-deltas.js';

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

export const resolveAdaptiveLspScopePlanForTests = ({
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
  const applyTargetCap = (entriesToLimit, targetCap) => {
    const rankedEntries = rankAdaptiveLspDocumentEntries(entriesToLimit);
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
        Math.max(
          1,
          Math.max(
            DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
            Math.floor(Number(documentSymbolConcurrency) || DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY)
          )
        ) * 4,
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
