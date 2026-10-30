import { buildRetrievalHitKey } from '../../src/retrieval/hit-comparison.js';
import { assertEvaluationMode, captureEvaluationJudgments } from './judgments.js';
import { captureEvaluationArray } from './passive-evidence.js';
import { captureEvaluationHit } from './hit-evidence.js';

const invalidRanks = () => new Error('Retrieval metrics require unique positive ranks, distinct relevant slots, and a positive cutoff.');
const captureRanks = original => {
  const ranks = captureEvaluationArray(original, invalidRanks);
  const seen = new Set();
  for (const rank of ranks) {
    if (!Number.isSafeInteger(rank) || rank < 1 || seen.has(rank)) throw invalidRanks();
    seen.add(rank);
  }
  return ranks;
};
const assertWindow = (ranks, totalRelevant, k) => {
  if (!Number.isSafeInteger(totalRelevant) || totalRelevant < ranks.length || !Number.isSafeInteger(k) || k < 1) throw invalidRanks();
};
export const computeRecallAtK = (ranks, totalRelevant, k) => {
  ranks = captureRanks(ranks); assertWindow(ranks, totalRelevant, k);
  return totalRelevant ? ranks.filter(rank => rank <= k).length / totalRelevant : 0;
};
export const computeMRR = ranks => {
  ranks = captureRanks(ranks);
  return ranks.length ? 1 / ranks.reduce((minimum, rank) => Math.min(minimum, rank), Infinity) : 0;
};
export const computeNDCG = (ranks, totalRelevant, k) => {
  ranks = captureRanks(ranks); assertWindow(ranks, totalRelevant, k);
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
  hits = captureEvaluationArray(hits, message => Object.assign(new Error(message), { code: 'ERR_EVAL_HIT_IDENTITY' }));
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
    const original = hits[index];
    if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Judged retrieval hits must be dense object rows.');
    if (!expected.length) continue;
    const hit = captureEvaluationHit(original);
    if (mode !== null && Object.hasOwn(hit, 'mode') && hit.mode !== mode) throw new Error('Retrieved hit mode differs from its selected judged cohort.');
    const identity = buildRetrievalHitKey(hit, index, { mode });
    if (identity === null) throw Object.assign(new Error('Judged retrieval requires stable chunk or file/range identity; rank-local ordinals cannot prove distinct documents.'), { code: 'ERR_EVAL_HIT_IDENTITY' });
    if (seenHits.has(identity)) continue;
    seenHits.add(identity);
    actual.push({ hit, rank: index + 1 });
  }
  const decisions = actual.map(() => new Map());
  const matches = (hit, judgment) => {
    if (!decisions[hit].has(judgment)) {
      const decision = isMatch(actual[hit].hit, expected[judgment]);
      if (typeof decision !== 'boolean') throw Object.assign(new Error('A relevance matcher must return its original boolean decision.', { cause: decision }), { code: 'ERR_EVAL_MATCH' });
      decisions[hit].set(judgment, decision);
    }
    return decisions[hit].get(judgment);
  };
  const assign = (hitIndex, visited) => {
    for (let judgment = 0; judgment < expected.length; judgment++) {
      if (visited.has(judgment) || !matches(hitIndex, judgment)) continue;
      visited.add(judgment);
      if (assigned[judgment] === -1 || assign(assigned[judgment], visited)) {
        assigned[judgment] = hitIndex;
        return true;
      }
    }
    return false;
  };
  for (let hit = 0; hit < actual.length; hit++) assign(hit, new Set());
  return Object.freeze({ ranks: Object.freeze(assigned.filter(index => index >= 0).map(index => actual[index].rank).sort((a, b) => a - b)),
    totalRelevant: expected.length, policy: 'distinct-document-one-to-one.v1' });
};
