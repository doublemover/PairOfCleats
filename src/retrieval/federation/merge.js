import { MinHeap } from '../../shared/min-heap.js';

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
    sourceScore: hit.score,
    sourceScoreType: hit.scoreType || null,
    score: Number(rrfScore.toFixed(12)),
    scoreType: 'federated_rrf',
    rankMethod: 'reciprocal-rank',
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

  const limit = Math.trunc(Math.max(0, topN)) || 0;
  if (!limit) return output;

  for (const [mode, payloadKey] of Object.entries(MODE_TO_PAYLOAD_KEY)) {
    const streams = [];
    let insertIndex = 0;
    for (const repoResult of perRepoResults) {
      const hits = Array.isArray(repoResult?.result?.[payloadKey])
        ? repoResult.result[payloadKey]
        : [];
      const length = Math.min(hits.length, Math.trunc(Math.max(0, perRepoTop)) || 0);
      if (length) streams.push({ hits, repoResult, length, offset: insertIndex });
      insertIndex += length;
    }
    const describe = (stream, rank) => {
      const hit = stream.hits[rank];
      return {
        hit, stream, rank,
        id: hit.id, file: hit.file, start: hit.start,
        repoId: stream.repoResult.repoId,
        repoPriority: stream.repoResult.priority ?? 0,
        rrfScore: 1 / (rrfK + (rank + 1)),
        __insertIndex: stream.offset + rank
      };
    };
    // Rounding can tie adjacent RRF contributions at large accepted k values.
    // Prove complete local comparator order before using a head-only merge.
    let ordered = true;
    for (const stream of streams) {
      let previous = describe(stream, 0);
      for (let rank = 1; rank < stream.length; rank += 1) {
        const next = describe(stream, rank);
        if (compareMergedHits(previous, next) > 0) { ordered = false; break; }
        previous = next;
      }
      if (!ordered) break;
    }
    const selected = [];
    if (ordered) {
      const heap = new MinHeap(compareMergedHits);
      for (const stream of streams) heap.push(describe(stream, 0));
      while (heap.size && selected.length < limit) {
        const next = heap.pop();
        selected.push(next);
        if (next.rank + 1 < next.stream.length) heap.push(describe(next.stream, next.rank + 1));
      }
    } else {
      const descriptors = [];
      for (const stream of streams) {
        for (let rank = 0; rank < stream.length; rank += 1) descriptors.push(describe(stream, rank));
      }
      descriptors.sort(compareMergedHits);
      selected.push(...descriptors.slice(0, limit));
    }
    output[payloadKey] = selected.map((entry) => {
      const { hit, stream, rrfScore, __insertIndex } = entry;
      const { repoResult } = stream;
      return compactMergedHit({
        ...hit,
        repoId: repoResult.repoId,
        repoAlias: repoResult.repoAlias || null,
        globalId: `${repoResult.repoId}:${hit.id}`,
        repoPriority: repoResult.priority ?? 0,
        rrfScore,
        __insertIndex
      });
    });
  }

  return output;
};
