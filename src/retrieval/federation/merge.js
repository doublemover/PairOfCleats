import { MinHeap } from '../../shared/min-heap.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';

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

const materializeMergedHit = ({ hit: source, stream, rrfScore }) => {
  const {
    __insertIndex,
    rrfScore: discardedSourceRrf,
    ...hit
  } = source;
  const { repoResult } = stream;
  return Object.assign(hit, {
    repoId: repoResult.repoId,
    repoAlias: repoResult.repoAlias || null,
    globalId: `${repoResult.repoId}:${source.id}`,
    sourceScore: hit.score,
    sourceScoreType: hit.scoreType || null,
    score: Number(rrfScore.toFixed(12)),
    scoreType: 'federated_rrf',
    rankMethod: 'reciprocal-rank',
    repoPriority: repoResult.priority ?? 0
  });
};

/** One admitted mode is selected and materialized exactly once by the coordinator. */
export const mergeFederatedModeResults = ({
  perRepoResults = [],
  mode,
  topN = 10,
  perRepoTop = 20,
  rrfK = 60,
  signal = null
} = {}) => {
  const checkAbort = () => {
    if (signal?.aborted) throw createError(ERROR_CODES.CANCELLED, 'Federated merge cancelled.');
  };
  checkAbort();
  const payloadKey = MODE_TO_PAYLOAD_KEY[mode];
  const limit = Math.trunc(Math.max(0, topN)) || 0;
  if (!limit || !payloadKey) return [];
  const streams = [];
  let insertIndex = 0;
  for (const repoResult of perRepoResults) {
    checkAbort();
    const candidate = repoResult?.result?.[payloadKey];
    const hits = Array.isArray(candidate) ? candidate : [];
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
  // Strictly decreasing numeric contributions prove local order without
  // reading hit fields. Rounded ties still require the complete comparator.
  let ordered = true;
  for (const stream of streams) {
    let previousScore = 1 / (rrfK + 1);
    for (let rank = 1; rank < stream.length; rank += 1) {
      if (rank % 256 === 0) checkAbort();
      const nextScore = 1 / (rrfK + (rank + 1));
      if (!(previousScore > nextScore) && compareMergedHits(describe(stream, rank - 1), describe(stream, rank)) > 0) {
        ordered = false; break;
      }
      previousScore = nextScore;
    }
    if (!ordered) break;
  }
  const selected = [];
  if (ordered) {
    const heap = new MinHeap(compareMergedHits);
    for (const stream of streams) heap.push(describe(stream, 0));
    while (heap.size && selected.length < limit) {
      if (selected.length % 256 === 0) checkAbort();
      const next = heap.pop();
      selected.push(next);
      if (next.rank + 1 < next.stream.length) heap.push(describe(next.stream, next.rank + 1));
    }
  } else {
    // Unordered tied streams retain only the best N lightweight descriptors.
    // The worst retained descriptor is the heap head under the reverse order.
    const heap = new MinHeap((left, right) => -compareMergedHits(left, right));
    for (const stream of streams) {
      for (let rank = 0; rank < stream.length; rank += 1) {
        if (rank % 256 === 0) checkAbort();
        const next = describe(stream, rank);
        if (heap.size < limit) heap.push(next);
        else if (compareMergedHits(next, heap.items[0]) < 0) { heap.pop(); heap.push(next); }
      }
    }
    while (heap.size) selected.push(heap.pop());
    selected.sort(compareMergedHits);
  }
  return selected.map(entry => {
    checkAbort();
    const result = materializeMergedHit(entry);
    checkAbort();
    return result;
  });
};

export const mergeFederatedResults = (options = {}) => Object.fromEntries(
  Object.entries(MODE_TO_PAYLOAD_KEY).map(([mode, payloadKey]) => [payloadKey, mergeFederatedModeResults({ ...options, mode })])
);
