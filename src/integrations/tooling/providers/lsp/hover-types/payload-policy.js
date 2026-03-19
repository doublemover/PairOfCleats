import { canonicalizeTypeText } from '../../../../../shared/type-normalization.js';
import {
  buildScopedSymbolId,
  buildSignatureKey,
  buildSymbolId,
  buildSymbolKey
} from '../../../../../shared/identity.js';

export const normalizeTypeText = (value) => {
  if (!value) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
};

export const normalizeParamNames = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    const name = String(entry || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
};

export const normalizeParamTypes = (paramTypes, options = {}) => {
  if (!paramTypes || typeof paramTypes !== 'object') return null;
  const configuredDefaultConfidence = Number(options?.defaultConfidence);
  const defaultConfidence = Number.isFinite(configuredDefaultConfidence)
    ? Math.max(0, Math.min(1, configuredDefaultConfidence))
    : 0.7;
  const languageId = String(options?.languageId || '').trim().toLowerCase() || null;
  const output = {};
  for (const [name, entries] of Object.entries(paramTypes)) {
    if (!name) continue;
    if (Array.isArray(entries)) {
      const normalized = entries
        .map((entry) => (typeof entry === 'string' ? { type: entry } : entry))
        .filter((entry) => entry?.type)
        .map((entry) => {
          const normalizedType = canonicalizeTypeText(entry.type, { languageId });
          return {
            type: normalizedType.displayText,
            normalizedType: normalizedType.canonicalText,
            originalText: normalizedType.originalText,
            confidence: Number.isFinite(entry.confidence) ? entry.confidence : defaultConfidence,
            source: entry.source || 'tooling'
          };
        })
        .filter((entry) => entry.type);
      if (normalized.length) output[name] = normalized;
      continue;
    }
    if (typeof entries === 'string') {
      const normalizedType = canonicalizeTypeText(entries, { languageId });
      if (normalizedType.displayText) {
        output[name] = [{
          type: normalizedType.displayText,
          normalizedType: normalizedType.canonicalText,
          originalText: normalizedType.originalText,
          confidence: defaultConfidence,
          source: 'tooling'
        }];
      }
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

const FUNCTION_LIKE_SYMBOL_KINDS = new Set([6, 9, 12]);

const signatureDeclaresParameters = (signature) => {
  const text = normalizeTypeText(signature);
  if (!text) return false;
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < 0 || close <= open) return false;
  const inside = text.slice(open + 1, close).trim();
  if (!inside) return false;
  return !/^(void|\(\s*\))$/i.test(inside);
};

const hasTypedParamEntry = (value) => {
  if (Array.isArray(value)) {
    return value.some((entry) => normalizeTypeText(typeof entry === 'string' ? entry : entry?.type));
  }
  return normalizeTypeText(value) != null;
};

const hasTypedParamName = (paramTypes, name) => {
  if (!paramTypes || typeof paramTypes !== 'object') return false;
  if (!name) return false;
  return hasTypedParamEntry(paramTypes[name]);
};

const isAmbiguousReturnType = (info) => {
  const signatureText = normalizeTypeText(info?.signature);
  const hasSignatureArrow = typeof signatureText === 'string' && signatureText.includes('->');
  const normalizedReturnType = normalizeTypeText(info?.returnType);
  const treatVoidAsMissing = normalizedReturnType === 'Void' && hasSignatureArrow;
  return !normalizedReturnType
    || /^unknown$/i.test(normalizedReturnType)
    || /^any\b/i.test(normalizedReturnType)
    || treatVoidAsMissing;
};

export const isIncompleteTypePayload = (info, options = {}) => {
  if (!info || typeof info !== 'object') {
    return {
      incomplete: true,
      missingReturn: true,
      missingParamTypes: true,
      paramCoverage: 0
    };
  }
  const symbolKind = Number.isInteger(options?.symbolKind) ? options.symbolKind : null;
  const functionLike = symbolKind == null || FUNCTION_LIKE_SYMBOL_KINDS.has(symbolKind);
  const missingReturn = functionLike ? isAmbiguousReturnType(info) : false;
  const paramNames = normalizeParamNames(info?.paramNames);
  const declaredParams = paramNames.length > 0 || signatureDeclaresParameters(info?.signature);
  let paramCoverage = 1;
  let missingParamTypes = false;
  if (functionLike && declaredParams) {
    if (paramNames.length) {
      const typedCount = paramNames.filter((name) => hasTypedParamName(info?.paramTypes, name)).length;
      paramCoverage = typedCount / paramNames.length;
      missingParamTypes = typedCount < paramNames.length;
    } else {
      const hasAnyTypedParam = hasParamTypes(info?.paramTypes);
      paramCoverage = hasAnyTypedParam ? 1 : 0;
      missingParamTypes = !hasAnyTypedParam;
    }
  }
  return {
    incomplete: missingReturn || missingParamTypes,
    missingReturn,
    missingParamTypes,
    paramCoverage
  };
};

export const scoreSignatureInfo = (info, options = {}) => {
  if (!info || typeof info !== 'object') {
    return {
      total: 0,
      returnScore: 0,
      paramScore: 0,
      signatureScore: 0,
      evidenceScore: 0,
      incomplete: true
    };
  }
  const completeness = isIncompleteTypePayload(info, options);
  const returnScore = completeness.missingReturn ? 0 : 4;
  const paramScore = Math.round(Math.max(0, Math.min(1, completeness.paramCoverage || 0)) * 4);
  const signatureScore = normalizeTypeText(info.signature) ? 1 : 0;
  const evidenceScore = hasParamTypes(info.paramTypes) ? 1 : 0;
  return {
    total: returnScore + paramScore + signatureScore + evidenceScore,
    returnScore,
    paramScore,
    signatureScore,
    evidenceScore,
    incomplete: completeness.incomplete
  };
};

const choosePreferredSignatureInfo = (base, next, options = {}) => {
  const baseScore = scoreSignatureInfo(base, options);
  const nextScore = scoreSignatureInfo(next, options);
  if (nextScore.total > baseScore.total) return { preferred: next, alternate: base };
  if (nextScore.total < baseScore.total) return { preferred: base, alternate: next };
  const baseSignature = normalizeTypeText(base?.signature) || '';
  const nextSignature = normalizeTypeText(next?.signature) || '';
  if (nextSignature.length > baseSignature.length) {
    return { preferred: next, alternate: base };
  }
  return { preferred: base, alternate: next };
};

const mergeParamTypesByQuality = (preferred, alternate, paramNames) => {
  const preferredParamTypes = preferred?.paramTypes && typeof preferred.paramTypes === 'object'
    ? preferred.paramTypes
    : null;
  const alternateParamTypes = alternate?.paramTypes && typeof alternate.paramTypes === 'object'
    ? alternate.paramTypes
    : null;
  if (!preferredParamTypes && !alternateParamTypes) return null;
  const names = Array.from(new Set([
    ...paramNames,
    ...Object.keys(preferredParamTypes || {}),
    ...Object.keys(alternateParamTypes || {})
  ])).filter(Boolean);
  const out = {};
  for (const name of names) {
    const preferredBucket = preferredParamTypes?.[name];
    const alternateBucket = alternateParamTypes?.[name];
    if (hasTypedParamEntry(preferredBucket)) {
      out[name] = preferredBucket;
      continue;
    }
    if (hasTypedParamEntry(alternateBucket)) {
      out[name] = alternateBucket;
      continue;
    }
    if (preferredBucket != null) out[name] = preferredBucket;
    else if (alternateBucket != null) out[name] = alternateBucket;
  }
  return Object.keys(out).length ? out : null;
};

export const mergeSignatureInfo = (base, next, options = {}) => {
  if (!next) return base;
  if (!base) return next;
  const { preferred, alternate } = choosePreferredSignatureInfo(base, next, options);
  const merged = { ...preferred };
  const preferredReturnAmbiguous = isAmbiguousReturnType(preferred);
  const alternateReturnAmbiguous = isAmbiguousReturnType(alternate);
  if (preferredReturnAmbiguous && !alternateReturnAmbiguous) {
    merged.returnType = alternate.returnType;
  }
  const preferredSignature = normalizeTypeText(preferred?.signature);
  const alternateSignature = normalizeTypeText(alternate?.signature);
  if (!preferredSignature && alternateSignature) {
    merged.signature = alternate.signature;
  }
  const paramNames = Array.from(new Set([
    ...normalizeParamNames(preferred?.paramNames),
    ...normalizeParamNames(alternate?.paramNames)
  ]));
  if (paramNames.length) merged.paramNames = paramNames;
  const mergedParamTypes = mergeParamTypesByQuality(preferred, alternate, paramNames);
  if (mergedParamTypes) merged.paramTypes = mergedParamTypes;
  if (!merged.semanticClass && alternate?.semanticClass) {
    merged.semanticClass = alternate.semanticClass;
  }
  if (!merged.semanticTokenType && alternate?.semanticTokenType) {
    merged.semanticTokenType = alternate.semanticTokenType;
  }
  if ((!Array.isArray(merged.semanticTokenModifiers) || !merged.semanticTokenModifiers.length)
    && Array.isArray(alternate?.semanticTokenModifiers)
    && alternate.semanticTokenModifiers.length) {
    merged.semanticTokenModifiers = alternate.semanticTokenModifiers.slice();
  }
  return merged;
};

const isFunctionLikeTargetHint = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'function'
      || normalized === 'method'
      || normalized === 'constructor';
  }
  return FUNCTION_LIKE_SYMBOL_KINDS.has(Number(value));
};

export const scoreChunkPayloadCandidate = ({ info, symbol, target }) => {
  const detailScore = scoreSignatureInfo(info, { symbolKind: symbol?.kind });
  let total = detailScore.total;
  const hintName = typeof target?.symbolHint?.name === 'string'
    ? target.symbolHint.name.trim()
    : '';
  const symbolName = typeof symbol?.name === 'string' ? symbol.name.trim() : '';
  if (hintName) {
    if (hintName === symbolName) total += 100;
    else if (symbolName) total -= 40;
  }
  const hintIsFunctionLike = isFunctionLikeTargetHint(target?.symbolHint?.kind);
  const symbolIsFunctionLike = FUNCTION_LIKE_SYMBOL_KINDS.has(Number(symbol?.kind));
  if (hintIsFunctionLike && symbolIsFunctionLike) total += 20;
  else if (hintIsFunctionLike && !symbolIsFunctionLike) total -= 20;
  if (!detailScore.incomplete) total += 30;
  return total;
};

const resolveEvidenceConfidenceTier = (tier) => {
  if (tier === 'full') return 'high';
  if (tier === 'hinted') return 'medium';
  if (tier === 'inferred') return 'medium';
  return 'low';
};

export const countParamTypeConflicts = (paramTypes) => {
  if (!paramTypes || typeof paramTypes !== 'object' || Array.isArray(paramTypes)) return 0;
  let conflicts = 0;
  for (const entries of Object.values(paramTypes)) {
    if (!Array.isArray(entries) || entries.length <= 1) continue;
    const distinct = new Set(
      entries
        .map((entry) => normalizeTypeText(entry?.type))
        .filter(Boolean)
    );
    if (distinct.size > 1) conflicts += 1;
  }
  return conflicts;
};

export const scoreLspConfidence = ({
  evidenceTier,
  completeness,
  conflictCount,
  unresolvedRate,
  stabilityTier,
  sourceFallbackUsed,
  providerConfidenceBias = 0
}) => {
  let score = evidenceTier === 'full'
    ? 0.92
    : (evidenceTier === 'hinted' ? 0.72 : (evidenceTier === 'inferred' ? 0.78 : 0.62));
  if (completeness?.incomplete) {
    score -= completeness?.missingReturn && completeness?.missingParamTypes ? 0.3 : 0.18;
  }
  score -= Math.min(0.15, Math.max(0, Number(conflictCount || 0)) * 0.05);
  score -= Math.min(0.2, Math.max(0, Number(unresolvedRate || 0)) * 0.25);
  if (stabilityTier !== 'stable') score -= 0.08;
  if (sourceFallbackUsed) score -= 0.05;
  score += Math.max(-0.1, Math.min(0.1, Number(providerConfidenceBias) || 0));
  const normalizedScore = Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))));
  const tier = normalizedScore >= 0.85
    ? 'high'
    : (normalizedScore >= 0.65 ? 'medium' : 'low');
  return { score: normalizedScore, tier };
};

export const buildLspSymbolRef = ({
  record,
  payload,
  languageId,
  evidenceConfidence
}) => {
  const target = record?.target || null;
  const symbol = record?.symbol || null;
  const virtualPath = String(target?.virtualPath || target?.chunkRef?.file || '').trim();
  const qualifiedName = String(
    symbol?.fullName
      || symbol?.name
      || target?.symbolHint?.name
      || ''
  ).trim();
  const kindGroup = target?.symbolHint?.kind ?? symbol?.kind ?? 'other';
  const semanticClass = String(record?.semanticClass || '').trim() || null;
  const symbolKey = buildSymbolKey({
    virtualPath,
    qualifiedName,
    kindGroup: semanticClass || kindGroup
  });
  if (!symbolKey) return null;
  const signatureKey = buildSignatureKey({
    qualifiedName,
    signature: payload?.signature || null
  });
  const scopedId = buildScopedSymbolId({
    kindGroup: String(kindGroup || 'other'),
    symbolKey,
    signatureKey,
    chunkUid: target?.chunkRef?.chunkUid || null
  });
  return {
    symbolKey,
    symbolId: buildSymbolId({ scopedId, scheme: 'lsp' }),
    signatureKey,
    scopedId,
    kind: semanticClass || kindGroup,
    qualifiedName,
    languageId: languageId || null,
    definingChunk: target?.chunkRef || null,
    evidence: {
      scheme: 'lsp',
      confidence: evidenceConfidence?.tier || 'low'
    }
  };
};

export const buildLspProvenanceEntry = ({
  cmd,
  record,
  completeness,
  detailScore,
  candidateScore,
  evidenceTier,
  conflictCount,
  unresolvedRate,
  stabilityTier,
  confidence
}) => ({
  provider: cmd,
  version: '1.0.0',
  collectedAt: new Date().toISOString(),
  source: 'lsp',
  symbol: {
    name: record?.symbol?.name || record?.target?.symbolHint?.name || null,
    qualifiedName: record?.symbol?.fullName || record?.symbol?.name || record?.target?.symbolHint?.name || null,
    kind: record?.symbol?.kind ?? record?.target?.symbolHint?.kind ?? null,
    semanticClass: record?.semanticClass || null
  },
  stages: {
    documentSymbol: true,
    hover: { requested: record?.hoverRequested === true, succeeded: record?.hoverSucceeded === true },
    semanticTokens: { requested: record?.semanticTokensRequested === true, succeeded: record?.semanticTokensSucceeded === true },
    signatureHelp: { requested: record?.signatureHelpRequested === true, succeeded: record?.signatureHelpSucceeded === true },
    inlayHints: { requested: record?.inlayHintsRequested === true, succeeded: record?.inlayHintsSucceeded === true },
    definition: { requested: record?.definitionRequested === true, succeeded: record?.definitionSucceeded === true },
    typeDefinition: { requested: record?.typeDefinitionRequested === true, succeeded: record?.typeDefinitionSucceeded === true },
    references: { requested: record?.referencesRequested === true, succeeded: record?.referencesSucceeded === true },
    sourceBootstrapUsed: record?.sourceBootstrapUsed === true,
    sourceFallbackUsed: record?.sourceFallbackUsed === true
  },
  evidence: {
    scheme: 'lsp',
    tier: evidenceTier,
    confidence: resolveEvidenceConfidenceTier(evidenceTier)
  },
  quality: {
    score: detailScore.total,
    candidateScore,
    incomplete: completeness.incomplete === true,
    missingReturn: completeness.missingReturn === true,
    missingParamTypes: completeness.missingParamTypes === true,
    paramCoverage: Number(completeness.paramCoverage || 0),
    conflictCount,
    unresolvedRate: Number(unresolvedRate.toFixed(4)),
    stability: stabilityTier
  },
  confidence
});

export const createEmptyHoverMetricsResult = () => ({
  requested: 0,
  succeeded: 0,
  sourceBootstrapUsed: 0,
  hoverTimedOut: 0,
  semanticTokensRequested: 0,
  semanticTokensSucceeded: 0,
  semanticTokensTimedOut: 0,
  signatureHelpRequested: 0,
  signatureHelpSucceeded: 0,
  signatureHelpTimedOut: 0,
  inlayHintsRequested: 0,
  inlayHintsSucceeded: 0,
  inlayHintsTimedOut: 0,
  definitionRequested: 0,
  definitionSucceeded: 0,
  definitionTimedOut: 0,
  typeDefinitionRequested: 0,
  typeDefinitionSucceeded: 0,
  typeDefinitionTimedOut: 0,
  referencesRequested: 0,
  referencesSucceeded: 0,
  referencesTimedOut: 0,
  timedOut: 0,
  incompleteSymbols: 0,
  hoverTriggeredByIncomplete: 0,
  fallbackUsed: 0,
  fallbackReasonCounts: Object.create(null),
  skippedByBudget: 0,
  skippedBySoftDeadline: 0,
  skippedByKind: 0,
  skippedByReturnSufficient: 0,
  skippedByAdaptiveDisable: 0,
  skippedByGlobalDisable: 0,
  files: []
});

export const buildFallbackReasonCodes = ({
  incompleteState,
  hoverRequested,
  hoverSucceeded,
  signatureHelpRequested,
  signatureHelpSucceeded,
  inlayHintsRequested,
  inlayHintsSucceeded,
  definitionRequested,
  definitionSucceeded,
  typeDefinitionRequested,
  typeDefinitionSucceeded,
  referencesRequested,
  referencesSucceeded
}) => {
  const reasons = [];
  if (incompleteState?.missingReturn) reasons.push('missing_return_type');
  if (incompleteState?.missingParamTypes) reasons.push('missing_param_types');
  if (!hoverRequested) reasons.push('hover_not_requested');
  else if (!hoverSucceeded) reasons.push('hover_unavailable_or_failed');
  else reasons.push('post_hover_still_incomplete');
  if (!signatureHelpRequested) reasons.push('signature_help_not_requested');
  else if (!signatureHelpSucceeded) reasons.push('signature_help_unavailable_or_failed');
  else reasons.push('post_signature_help_still_incomplete');
  if (!inlayHintsRequested) reasons.push('inlay_hints_not_requested');
  else if (!inlayHintsSucceeded) reasons.push('inlay_hints_unavailable_or_failed');
  else reasons.push('post_inlay_hints_still_incomplete');
  if (!definitionRequested) reasons.push('definition_not_requested');
  else if (!definitionSucceeded) reasons.push('definition_unavailable_or_failed');
  else reasons.push('post_definition_still_incomplete');
  if (!typeDefinitionRequested) reasons.push('type_definition_not_requested');
  else if (!typeDefinitionSucceeded) reasons.push('type_definition_unavailable_or_failed');
  else reasons.push('post_type_definition_still_incomplete');
  if (!referencesRequested) reasons.push('references_not_requested');
  else if (!referencesSucceeded) reasons.push('references_unavailable_or_failed');
  else reasons.push('post_references_still_incomplete');
  return reasons;
};
