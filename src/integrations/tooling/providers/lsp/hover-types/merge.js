import { canonicalizeTypeText } from '../../../../../shared/type-normalization.js';
import {
  buildFallbackReasonCodes,
  buildLspProvenanceEntry,
  buildLspSymbolRef,
  countParamTypeConflicts,
  isIncompleteTypePayload,
  mergeSignatureInfo,
  normalizeParamTypes,
  normalizeTypeText,
  scoreChunkPayloadCandidate,
  scoreLspConfidence,
  scoreSignatureInfo
} from './payload-policy.js';

export const buildSourceSignatureCandidate = (text, virtualRange) => {
  if (typeof text !== 'string' || !text) return null;
  const start = Number(virtualRange?.start);
  const end = Number(virtualRange?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const clampedStart = Math.max(0, Math.min(text.length, Math.floor(start)));
  const clampedEnd = Math.max(clampedStart, Math.min(text.length, Math.ceil(end + 1)));
  if (clampedEnd <= clampedStart) return null;
  let candidate = text.slice(clampedStart, clampedEnd);
  if (!candidate.includes('(') || !candidate.includes(')')) return null;
  const terminators = [candidate.indexOf('{'), candidate.indexOf(';')].filter((idx) => idx >= 0);
  if (terminators.length) {
    candidate = candidate.slice(0, Math.min(...terminators));
  }
  const lastParen = candidate.lastIndexOf(')');
  if (lastParen === -1) return null;
  const trailing = candidate.slice(lastParen + 1);
  const lineBreakIdx = trailing.search(/[\r\n]/);
  const cut = lineBreakIdx >= 0
    ? lastParen + 1 + lineBreakIdx
    : candidate.length;
  return String(candidate.slice(0, cut)).replace(/\s+/g, ' ').trim();
};

export const buildLineSignatureCandidate = (text, lineNumber) => {
  if (typeof text !== 'string' || !text) return null;
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 0) return null;
  const lines = text.split(/\r?\n/u);
  if (line >= lines.length) return null;
  let candidate = String(lines[line] || '');
  if (!candidate.includes('(') || !candidate.includes(')')) return null;
  const terminators = [candidate.indexOf('{'), candidate.indexOf(';')].filter((idx) => idx >= 0);
  if (terminators.length) {
    candidate = candidate.slice(0, Math.min(...terminators));
  }
  return String(candidate).replace(/\s+/g, ' ').trim();
};

export const resolveEvidenceTier = (record) => {
  if (
    record?.hoverSucceeded
    || record?.signatureHelpSucceeded
    || record?.definitionSucceeded
    || record?.typeDefinitionSucceeded
    || record?.referencesSucceeded
  ) {
    return 'full';
  }
  if (record?.inlayHintsSucceeded) {
    return 'hinted';
  }
  if (record?.sourceBootstrapUsed || record?.sourceFallbackUsed) {
    return 'heuristic';
  }
  return 'inferred';
};

export const scoreEvidenceTier = (tier) => {
  if (tier === 'full') return 20;
  if (tier === 'hinted') return 12;
  if (tier === 'inferred') return 8;
  return 0;
};

export const defaultParamConfidenceForTier = (tier) => {
  if (tier === 'full') return 0.9;
  if (tier === 'hinted') return 0.65;
  if (tier === 'inferred') return 0.75;
  return 0.6;
};

export const resolveEvidenceConfidenceTier = (tier) => {
  if (tier === 'full') return 'high';
  if (tier === 'hinted') return 'medium';
  if (tier === 'inferred') return 'medium';
  return 'low';
};

export const resolveProviderStabilityTier = ({ fileHoverStats, hoverControl }) => {
  if (hoverControl?.disabledGlobal || fileHoverStats?.disabledAdaptive) return 'degraded';
  const timeoutCount = (
    Number(fileHoverStats?.timedOut || 0)
    + Number(fileHoverStats?.hoverTimedOut || 0)
    + Number(fileHoverStats?.signatureHelpTimedOut || 0)
    + Number(fileHoverStats?.definitionTimedOut || 0)
    + Number(fileHoverStats?.typeDefinitionTimedOut || 0)
    + Number(fileHoverStats?.referencesTimedOut || 0)
  );
  return timeoutCount > 0 ? 'degraded' : 'stable';
};

export const resolveRecordCandidate = async ({
  record,
  recordIndex,
  strict,
  cmd,
  languageId,
  hoverMetrics,
  unresolvedRate,
  stabilityTier,
  providerConfidenceBias,
  parseSignatureCached
}) => {
  let info = record.info;
  const incompleteAfterStages = isIncompleteTypePayload(info, {
    symbolKind: record?.symbol?.kind
  });
  if (incompleteAfterStages.incomplete && record.sourceSignature && !record.sourceBootstrapUsed) {
    const sourceInfo = parseSignatureCached(record.sourceSignature, record?.symbol?.name);
    if (sourceInfo) {
      const fallbackReasons = buildFallbackReasonCodes({
        incompleteState: incompleteAfterStages,
        hoverRequested: record.hoverRequested === true,
        hoverSucceeded: record.hoverSucceeded === true,
        signatureHelpRequested: record.signatureHelpRequested === true,
        signatureHelpSucceeded: record.signatureHelpSucceeded === true,
        inlayHintsRequested: record.inlayHintsRequested === true,
        inlayHintsSucceeded: record.inlayHintsSucceeded === true,
        definitionRequested: record.definitionRequested === true,
        definitionSucceeded: record.definitionSucceeded === true,
        typeDefinitionRequested: record.typeDefinitionRequested === true,
        typeDefinitionSucceeded: record.typeDefinitionSucceeded === true,
        referencesRequested: record.referencesRequested === true,
        referencesSucceeded: record.referencesSucceeded === true
      });
      if (Array.isArray(fallbackReasons) && fallbackReasons.length) {
        hoverMetrics.fallbackUsed += 1;
        if (!hoverMetrics.fallbackReasonCounts || typeof hoverMetrics.fallbackReasonCounts !== 'object') {
          hoverMetrics.fallbackReasonCounts = Object.create(null);
        }
        for (const rawReason of fallbackReasons) {
          const reason = String(rawReason || '').trim();
          if (!reason) continue;
          hoverMetrics.fallbackReasonCounts[reason] = Number(hoverMetrics.fallbackReasonCounts[reason] || 0) + 1;
        }
      }
      info = mergeSignatureInfo(info, sourceInfo, { symbolKind: record?.symbol?.kind });
      record.sourceFallbackUsed = true;
    }
  }
  if (!info) return null;

  const chunkUid = record.target?.chunkRef?.chunkUid;
  if (!chunkUid) {
    if (strict) throw new Error('LSP output missing chunkUid.');
    return null;
  }

  const normalizedSignature = normalizeTypeText(info.signature);
  let normalizedReturn = canonicalizeTypeText(info.returnType, { languageId }).displayText;
  if (normalizedReturn === 'Void' && normalizedSignature?.includes('->')) {
    const arrowMatch = normalizedSignature.split('->').pop();
    const trimmed = arrowMatch ? arrowMatch.trim() : '';
    if (trimmed) {
      normalizedReturn = trimmed === '()' ? 'Void' : trimmed;
    }
  }
  const evidenceTier = resolveEvidenceTier(record);
  const completeness = isIncompleteTypePayload(info, { symbolKind: record?.symbol?.kind });

  const payload = {
    returnType: normalizedReturn,
    paramTypes: normalizeParamTypes(info.paramTypes, {
      defaultConfidence: defaultParamConfidenceForTier(evidenceTier),
      languageId
    }),
    signature: normalizedSignature
  };
  const detailScore = scoreSignatureInfo(info, { symbolKind: record?.symbol?.kind });
  const conflictCount = countParamTypeConflicts(payload.paramTypes);
  const candidateScore = scoreChunkPayloadCandidate({
    info,
    symbol: record.symbol,
    target: record.target
  }) + scoreEvidenceTier(evidenceTier);
  const confidence = scoreLspConfidence({
    evidenceTier,
    completeness,
    conflictCount,
    unresolvedRate,
    stabilityTier,
    sourceFallbackUsed: record?.sourceFallbackUsed === true,
    providerConfidenceBias
  });
  const provenance = buildLspProvenanceEntry({
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
  });
  const symbolRef = buildLspSymbolRef({
    record,
    payload,
    languageId,
    evidenceConfidence: confidence
  });
  return {
    chunkUid,
    chunkRef: record.target.chunkRef,
    payload,
    ...(symbolRef ? { symbolRef } : {}),
    provenance,
    candidateScore,
    evidenceTier,
    signatureLength: String(payload.signature || '').length,
    recordIndex
  };
};
