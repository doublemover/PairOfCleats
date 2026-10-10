const RAW_RELATION_FIELDS = ['calls', 'callDetails', 'usages'];

/**
 * Commit enrichment from an index-aligned inference view while retaining the
 * complete input arrays. Detail objects remain shared so resolution annotations
 * on admitted occurrences reach the canonical list, including on cache hits.
 */
export const mergeCrossFileInferenceView = (canonicalChunks, inferenceChunks) => {
  if (canonicalChunks.length !== inferenceChunks.length) {
    throw new Error('Cross-file inference view changed chunk cardinality.');
  }
  for (let index = 0; index < canonicalChunks.length; index += 1) {
    const canonical = canonicalChunks[index];
    const inferred = inferenceChunks[index];
    if (canonical === inferred) continue;
    const originalRelations = canonical.codeRelations;
    const inferredRelations = inferred.codeRelations;
    Object.assign(canonical, inferred);
    if (!originalRelations || typeof originalRelations !== 'object') continue;
    const merged = { ...inferredRelations };
    const inferredDetails = inferredRelations?.callDetails;
    if (Array.isArray(originalRelations.callDetails) && Array.isArray(inferredDetails)) {
      for (let detailIndex = 0; detailIndex < inferredDetails.length; detailIndex += 1) {
        const original = originalRelations.callDetails[detailIndex];
        const enriched = inferredDetails[detailIndex];
        if (!original || !enriched || original === enriched) continue;
        if (original.callee !== enriched.callee || original.start !== enriched.start
          || original.end !== enriched.end) throw new Error('Inference changed call occurrence order.');
        for (const key of ['calleeRef', 'resolvedCalleeChunkUid', 'targetChunkUid', 'targetCandidates']) {
          if (Object.hasOwn(enriched, key)) original[key] = enriched[key];
        }
      }
    }
    for (const field of RAW_RELATION_FIELDS) {
      if (Object.hasOwn(originalRelations, field)) merged[field] = originalRelations[field];
      else delete merged[field];
    }
    canonical.codeRelations = merged;
  }
};
