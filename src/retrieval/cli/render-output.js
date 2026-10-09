export function compactHit(hit, includeExplain = false) {
  if (!hit || typeof hit !== 'object') return hit;
  const compact = {};
  const fields = [
    'id',
    'chunkUid',
    'segmentUid',
    'repoId',
    'globalId',
    'generation',
    'generationKey',
    'buildId',
    'sourceHash',
    'citation',
    'references',
    'followups',
    'actions',
    'sourceScore',
    'sourceScoreType',
    'rankMethod',
    'reranker',
    'file',
    'start',
    'end',
    'startLine',
    'endLine',
    'ext',
    'kind',
    'name',
    'headline',
    'score',
    'scoreType',
    'sparseScore',
    'sparseType',
    'annScore',
    'annSource',
    'annType',
    'context'
  ];
  for (const field of fields) {
    if (hit[field] !== undefined) compact[field] = hit[field];
  }
  if (includeExplain && hit.scoreBreakdown !== undefined) {
    compact.scoreBreakdown = hit.scoreBreakdown;
  }
  return compact;
}
