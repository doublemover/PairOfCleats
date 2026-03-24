const RETRIEVAL_MODES = ['code', 'prose', 'extractedProse', 'records'];

const normalizeRequestedBackend = (backendPolicyInfo = null) => {
  const requested = backendPolicyInfo?.requested ?? backendPolicyInfo?.policy?.requested;
  return typeof requested === 'string' && requested.trim() ? requested : null;
};

const normalizeDefaultBackend = (backendPolicyInfo = null) => {
  const fallback = backendPolicyInfo?.defaultBackend ?? backendPolicyInfo?.policy?.defaultBackend;
  return typeof fallback === 'string' && fallback.trim() ? fallback : null;
};

const normalizeSelectionReason = (backendPolicyInfo = null) => {
  const reason = backendPolicyInfo?.reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
};

const hasAvailabilityFallback = (backendPolicyInfo = null) => {
  const reason = normalizeSelectionReason(backendPolicyInfo);
  if (!reason) return false;
  return /unavailable|missing|fallback/i.test(reason);
};

const isForcedBackendSelection = (backendPolicyInfo = null) => Boolean(
  backendPolicyInfo?.backendForcedSqlite
  || backendPolicyInfo?.backendForcedLmdb
  || backendPolicyInfo?.backendForcedMemory
  || backendPolicyInfo?.backendForcedTantivy
);

const normalizeModeFreshness = (mode, idx, indexSignaturePayload = null) => {
  const state = idx?.state && typeof idx.state === 'object' ? idx.state : null;
  const payloadModeKey = mode === 'extractedProse' ? 'extracted-prose' : mode;
  const payloadFreshness = indexSignaturePayload?.generationByMode?.[payloadModeKey] || null;
  const signature = indexSignaturePayload?.modes?.[payloadModeKey] || null;
  const buildId = payloadFreshness?.buildId || state?.buildId || null;
  const artifactSurfaceVersion = payloadFreshness?.artifactSurfaceVersion || state?.artifactSurfaceVersion || null;
  const generationKey = payloadFreshness?.generationKey || null;
  const activeBuildRoot = payloadFreshness?.activeBuildRoot || null;
  const profileId = state?.profile?.id || null;
  if (!buildId && !artifactSurfaceVersion && !profileId && !signature && !generationKey && !activeBuildRoot) return null;
  return {
    buildId,
    artifactSurfaceVersion,
    generationKey,
    activeBuildRoot,
    profileId,
    signature
  };
};

export function buildRetrievalMetadata({
  backendLabel,
  backendPolicyInfo = null,
  cacheInfo = null,
  idxCode = null,
  idxProse = null,
  idxExtractedProse = null,
  idxRecords = null,
  indexSignaturePayload = null,
  asOfContext = null,
  generationContext = null
} = {}) {
  const requested = normalizeRequestedBackend(backendPolicyInfo);
  const forced = isForcedBackendSelection(backendPolicyInfo);
  const availabilityDriven = hasAvailabilityFallback(backendPolicyInfo) || backendPolicyInfo?.backendDisabled === true;
  const fallbackDerived = availabilityDriven || backendPolicyInfo?.backendDisabled === true;
  const selectionKind = forced || (requested && requested !== 'auto') ? 'requested' : 'policy';
  const byMode = {
    code: normalizeModeFreshness('code', idxCode, indexSignaturePayload),
    prose: normalizeModeFreshness('prose', idxProse, indexSignaturePayload),
    extractedProse: normalizeModeFreshness('extractedProse', idxExtractedProse, indexSignaturePayload),
    records: normalizeModeFreshness('records', idxRecords, indexSignaturePayload)
  };
  const freshnessByMode = Object.fromEntries(
    Object.entries(byMode).filter(([, value]) => value && typeof value === 'object')
  );

  return {
    backend: {
      selected: typeof backendLabel === 'string' && backendLabel.trim() ? backendLabel : null,
      requested,
      defaultBackend: normalizeDefaultBackend(backendPolicyInfo),
      selectionKind,
      selectionReason: normalizeSelectionReason(backendPolicyInfo),
      forced,
      availabilityDriven
    },
    fidelity: {
      status: fallbackDerived ? 'fallback-derived' : 'complete',
      fallbackDerived
    },
    freshness: {
      activeGeneration: generationContext
        ? {
          buildId: generationContext.buildId || null,
          activeBuildRoot: generationContext.activeBuildRoot || null,
          buildGenerationKey: generationContext.buildGenerationKey || null
        }
        : null,
      byMode: freshnessByMode,
      asOf: asOfContext
        ? {
          ref: asOfContext.ref || 'latest',
          type: asOfContext.type || 'latest',
          identityHash: asOfContext.identityHash || null
        }
        : null
    },
    cache: {
      hit: cacheInfo?.hit === true,
      strategy: typeof cacheInfo?.strategy === 'string' && cacheInfo.strategy.trim()
        ? cacheInfo.strategy
        : null,
      memoryHotPath: cacheInfo?.memoryHotPath === true
    }
  };
}

export { RETRIEVAL_MODES };
