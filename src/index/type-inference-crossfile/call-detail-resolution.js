const formatCandidateId = candidate => {
  if (!candidate) return null;
  return candidate.chunkUid || candidate.symbolId || candidate.symbolKey || null;
};

const buildCandidateIds = symbolRef => {
  if (!symbolRef || !Array.isArray(symbolRef.candidates)) return [];
  return symbolRef.candidates.map(formatCandidateId).filter(Boolean);
};

/** Shared projection of an established binding, independent of type propagation. */
export const syncCallDetailResolution = (detail, symbolRef) => {
  if (!detail || typeof detail !== 'object') return;
  const resolvedChunkUid = symbolRef?.resolved?.chunkUid || null;
  detail.calleeRef = symbolRef || null;
  detail.resolvedCalleeChunkUid = resolvedChunkUid;
  detail.targetChunkUid = resolvedChunkUid;
  detail.targetCandidates = buildCandidateIds(symbolRef);
};
