import { buildRetrievalHitKey } from '../../src/retrieval/hit-comparison.js';

const assertRanks = (ranks, totalRelevant = ranks.length, k = 1) => {
  if (!Array.isArray(ranks) || ranks.some(rank => !Number.isSafeInteger(rank) || rank < 1)
    || new Set(ranks).size !== ranks.length || !Number.isSafeInteger(totalRelevant)
    || totalRelevant < ranks.length || !Number.isSafeInteger(k) || k < 1) {
    throw new Error('Retrieval metrics require unique positive ranks, distinct relevant slots, and a positive cutoff.');
  }
};
export const computeRecallAtK = (ranks, totalRelevant, k) => {
  assertRanks(ranks, totalRelevant, k);
  return totalRelevant ? ranks.filter(rank => rank <= k).length / totalRelevant : 0;
};
export const computeMRR = ranks => {
  assertRanks(ranks);
  return ranks.length ? 1 / Math.min(...ranks) : 0;
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
  const judgments = new Map();
  for (const expected of expectedItems || []) {
    const key = JSON.stringify([expected?.file || null, String(expected?.name || '').toLowerCase(), String(expected?.kind || '').toLowerCase()]);
    if (!judgments.has(key)) judgments.set(key, expected);
  }
  const expected = [...judgments.values()];
  const assigned = new Array(expected.length).fill(-1);
  const actual = [];
  const seenHits = new Set();
  for (let index = 0; index < (hits || []).length; index++) {
    const hit = hits[index];
    const identity = buildRetrievalHitKey(hit, index, { mode }) ?? `unresolved:${index}`;
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
