const MODE_TO_PAYLOAD_KEY = Object.freeze({
  code: 'code',
  prose: 'prose',
  'extracted-prose': 'extractedProse',
  records: 'records'
});

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const compareMergedHits = (left, right) => (
  right.rrfScore - left.rrfScore
  || (toFiniteNumber(right.repoPriority, 0) - toFiniteNumber(left.repoPriority, 0))
  || String(left.repoId || '').localeCompare(String(right.repoId || ''))
  || String(left.id || '').localeCompare(String(right.id || ''))
  || String(left.file || '').localeCompare(String(right.file || ''))
  || (toFiniteNumber(left.start, 0) - toFiniteNumber(right.start, 0))
  || (left.__insertIndex - right.__insertIndex)
);

const compactMergedHit = (entry) => {
  const {
    __insertIndex,
    rrfScore,
    repoPriority,
    ...hit
  } = entry;
  return {
    ...hit,
    score: Number(rrfScore.toFixed(12)),
    repoPriority
  };
};

export const mergeFederatedResults = ({
  perRepoResults = [],
  topN = 10,
  perRepoTop = 20,
  rrfK = 60
} = {}) => {
  const output = {
    code: [],
    prose: [],
    extractedProse: [],
    records: []
  };

  for (const [mode, payloadKey] of Object.entries(MODE_TO_PAYLOAD_KEY)) {
    const merged = [];
    let insertIndex = 0;
    for (const repoResult of perRepoResults) {
      const hits = Array.isArray(repoResult?.result?.[payloadKey])
        ? repoResult.result[payloadKey].slice(0, Math.max(1, perRepoTop))
        : [];
      for (let i = 0; i < hits.length; i += 1) {
        const hit = hits[i];
        const rrfScore = 1 / (rrfK + (i + 1));
        merged.push({
          ...hit,
          repoId: repoResult.repoId,
          repoAlias: repoResult.repoAlias || null,
          globalId: `${repoResult.repoId}:${hit.id}`,
          repoPriority: repoResult.priority ?? 0,
          rrfScore,
          __insertIndex: insertIndex
        });
        insertIndex += 1;
      }
    }
    merged.sort(compareMergedHits);
    output[payloadKey] = merged
      .slice(0, Math.max(0, topN))
      .map((entry) => compactMergedHit(entry));
  }

  return output;
};
