import assert from 'node:assert/strict';
import { rankBM25, rankBM25Fields } from '../../../src/retrieval/rankers.js';
import { admitSortedPostings } from '../../../src/shared/posting-order.js';

const count = 2048;
const make = () => {
  const tokenIndex = { vocab: ['common', 'rare'], postings: [
    Array.from({ length: count }, (_, id) => [id, id % 3 + 1]),
    [[3, 2], [101, 1], [count - 1, 3]]
  ], docLengths: Array.from({ length: count }, (_, id) => id % 7 + 1), avgDocLen: 4, totalDocs: count };
  return { chunkMeta: Array.from({ length: count }, (_, id) => ({ weight: id % 5 ? 1 : 2 })),
    tokenIndex, fieldPostings: { fields: { title: structuredClone(tokenIndex) } } };
};
for (const allowed of [null, new Set(), new Set([count - 1]), new Set([3, 101, count - 1]),
  new Set(Array.from({ length: count }, (_, id) => id))]) {
  for (const topN of [0, 1, 5, count + 1]) {
    const linear = make(), seeking = make();
    admitSortedPostings(seeking.tokenIndex);
    admitSortedPostings(seeking.fieldPostings.fields.title);
    for (const tokens of [['common'], ['common', 'common', 'rare'], ['absent']]) {
      const options = { tokens, topN, allowedIdx: allowed, includeZeroScores: true };
      assert.deepEqual(rankBM25({ idx: seeking, ...options }), rankBM25({ idx: linear, ...options }));
      assert.deepEqual(rankBM25Fields({ idx: seeking, ...options, fieldWeights: { body: 1, title: 2 } }),
        rankBM25Fields({ idx: linear, ...options, fieldWeights: { body: 1, title: 2 } }));
    }
  }
}
const idx = make();
let reads = 0;
idx.tokenIndex.postings[0] = new Proxy(idx.tokenIndex.postings[0], { get(target, key, receiver) {
  if (/^\d+$/.test(String(key))) reads++;
  return Reflect.get(target, key, receiver);
} });
admitSortedPostings(idx.tokenIndex);
reads = 0;
const selected = rankBM25({ idx, tokens: ['common'], topN: 1, allowedIdx: new Set([count - 1]) });
assert.ok(reads < 32, 'the sparse query seeks an admitted posting instead of scanning its corpus');
const unfiltered = rankBM25({ idx, tokens: ['common'], topN: count });
assert.equal(selected[0].score, unfiltered.find(hit => hit.idx === count - 1).score, 'eligibility preserves full-corpus df');
reads = 0;
rankBM25({ idx, tokens: ['common'], topN: 1, allowedIdx: new Set(Array.from({ length: count }, (_, id) => id)) });
assert.ok(reads >= count, 'broad eligibility keeps linear traversal');
const unsorted = make();
unsorted.tokenIndex.postings[0].reverse();
admitSortedPostings(unsorted.tokenIndex);
assert.deepEqual(rankBM25({ idx: unsorted, tokens: ['common'], topN: 5, allowedIdx: new Set([3, 101]) }),
  rankBM25({ idx: make(), tokens: ['common'], topN: 5, allowedIdx: new Set([3, 101]) }));
for (const [k1, b] of [[NaN, 0.5], [-1, 0.5], [1, Infinity], [1, -0.1], [1, 1.1]]) {
  assert.throws(() => rankBM25({ idx, tokens: ['common'], topN: 1, k1, b }), { code: 'INVALID_REQUEST' });
  assert.throws(() => rankBM25Fields({ idx, tokens: ['common'], topN: 1, k1, b }), { code: 'INVALID_REQUEST' });
}
assert.equal(rankBM25({ idx, tokens: ['common'], topN: 1, k1: 0, b: 0 }).length, 1);
console.log('Selective BM25 retains linear score parity and admits seeking only for ordered postings.');
