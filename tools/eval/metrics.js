import { buildRetrievalHitKey } from '../../src/retrieval/hit-comparison.js';
import { assertEvaluationMode, captureEvaluationJudgments } from './judgments.js';

const assertRanks = (ranks, totalRelevant = ranks?.length, k = 1) => {
  const invalid = () => new Error('Retrieval metrics require unique positive ranks, distinct relevant slots, and a positive cutoff.');
  if (!Array.isArray(ranks) || !Number.isSafeInteger(totalRelevant)
    || totalRelevant < ranks.length || !Number.isSafeInteger(k) || k < 1) {
    throw invalid();
  }
  const seen = new Set();
  for (let index = 0; index < ranks.length; index++) {
    const rank = ranks[index];
    if (!Object.hasOwn(ranks, index) || !Number.isSafeInteger(rank) || rank < 1 || seen.has(rank)) throw invalid();
    seen.add(rank);
  }
};
export const computeRecallAtK = (ranks, totalRelevant, k) => {
  assertRanks(ranks, totalRelevant, k);
  return totalRelevant ? ranks.filter(rank => rank <= k).length / totalRelevant : 0;
};
export const computeMRR = ranks => {
  assertRanks(ranks);
  return ranks.length ? 1 / ranks.reduce((minimum, rank) => Math.min(minimum, rank), Infinity) : 0;
};
export const computeNDCG = (ranks, totalRelevant, k) => {
  assertRanks(ranks, totalRelevant, k);
  if (!totalRelevant) return 0;
  const dcg = ranks.filter(rank => rank <= k).reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
  let ideal = 0;
  for (let rank = 1; rank <= Math.min(totalRelevant, k); rank++) ideal += 1 / Math.log2(rank + 1);
  return ideal ? dcg / ideal : 0;
};

/** Judgments represent distinct relevant-document slots. Exact duplicates are
 * one slot; overlapping predicates use maximum one-to-one hit assignment.
 * Earlier ranks remain admitted when later hits augment the matching. */
export const collectExpectedJudgments = (hits, expectedItems, isMatch, { mode = null } = {}) => {
  if (!Array.isArray(hits) || typeof isMatch !== 'function') throw new Error('Judged retrieval requires an explicit hit array and matching function.');
  if (mode !== null) assertEvaluationMode(mode);
  const judgments = new Map();
  for (const expected of captureEvaluationJudgments(expectedItems)) {
    if (Object.hasOwn(expected, 'mode') && (mode === null || expected.mode !== mode)) {
      throw new Error('Mode-qualified relevance judgments require their matching selected evaluation cohort.');
    }
    const key = JSON.stringify([expected.file ?? null, (expected.name ?? '').toLowerCase(), (expected.kind ?? '').toLowerCase()]);
    if (!judgments.has(key)) judgments.set(key, expected);
  }
  const expected = [...judgments.values()];
  const assigned = new Array(expected.length).fill(-1);
  const actual = [];
  const seenHits = new Set();
  for (let index = 0; index < hits.length; index++) {
    const hit = hits[index];
    if (!Object.hasOwn(hits, index) || !hit || typeof hit !== 'object' || Array.isArray(hit)) throw new Error('Judged retrieval hits must be dense object rows.');
    if (!expected.length) continue;
    if (mode !== null && Object.hasOwn(hit, 'mode') && hit.mode !== mode) throw new Error('Retrieved hit mode differs from its selected judged cohort.');
    const chunkUid = hit.chunkUid ?? hit.metaV2?.chunkUid;
    if ((chunkUid != null && (typeof chunkUid !== 'string' || !chunkUid.trim()))
      || (hit.file != null && (typeof hit.file !== 'string' || !hit.file.trim()))) {
      throw Object.assign(new Error('Judged retrieval requires scalar nonempty chunk/file identity.'), { code: 'ERR_EVAL_HIT_IDENTITY' });
    }
    const identity = buildRetrievalHitKey(hit, index, { mode });
    if (identity === null) throw Object.assign(new Error('Judged retrieval requires stable chunk or file/range identity; rank-local ordinals cannot prove distinct documents.'), { code: 'ERR_EVAL_HIT_IDENTITY' });
    if (seenHits.has(identity)) continue;
    seenHits.add(identity);
    actual.push({ hit, rank: index + 1 });
  }
  const assign = (hitIndex, visited) => {
    for (let judgment = 0; judgment < expected.length; judgment++) {
      if (visited.has(judgment) || !isMatch(actual[hitIndex].hit, expected[judgment])) continue;
      visited.add(judgment);
      if (assigned[judgment] === -1 || assign(assigned[judgment], visited)) {
        assigned[judgment] = hitIndex;
        return true;
      }
    }
    return false;
  };
  for (let hit = 0; hit < actual.length; hit++) assign(hit, new Set());
  return { ranks: assigned.filter(index => index >= 0).map(index => actual[index].rank).sort((a, b) => a - b),
    totalRelevant: expected.length, policy: 'distinct-document-one-to-one.v1' };
};
