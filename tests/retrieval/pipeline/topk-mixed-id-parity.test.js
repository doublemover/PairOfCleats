import assert from 'node:assert/strict';
import { compareTopKEntries, selectTopK } from '../../../src/retrieval/pipeline/topk.js';

const normalizeId = (id) => typeof id === 'number' && Number.isFinite(id)
  ? { type: 'number', value: id }
  : { type: 'string', value: id == null ? '' : String(id) };
// Pre-change oracle, independent of the optimized comparator.
const referenceCompare = (a, b) => {
  const scoreA = Number.isFinite(a?.score) ? a.score : -Infinity;
  const scoreB = Number.isFinite(b?.score) ? b.score : -Infinity;
  if (scoreA !== scoreB) return scoreB - scoreA;
  const left = normalizeId(a?.id);
  const right = normalizeId(b?.id);
  if (left.type !== right.type) return left.type === 'number' ? -1 : 1;
  if (left.value < right.value) return -1;
  if (left.value > right.value) return 1;
  return (Number.isFinite(a?.sourceRank) ? a.sourceRank : 0)
    - (Number.isFinite(b?.sourceRank) ? b.sourceRank : 0);
};
const ids = [0, -0, -1, 2, '2', '10', '', null, undefined, NaN, Infinity,
  -Infinity, 4n, Symbol('id'), '😀', 'é', { toString: () => 'object' }];
for (const idA of ids) {
  for (const idB of ids) {
    for (const rank of [0, 1, NaN, Infinity]) {
      const a = { score: 5, id: idA, sourceRank: rank };
      const b = { score: 5, id: idB, sourceRank: 0 };
      assert.equal(compareTopKEntries(a, b), referenceCompare(a, b));
    }
  }
}
const items = Array.from({ length: 340 }, (_, index) => ({
  id: ids[index % ids.length], score: (index * 53) % 19, sourceRank: index
}));
for (const [k, minHeapSize] of [[7, 32], [40, 1000], [340, 32]]) {
  const stats = {};
  const selected = selectTopK(items, { k, id: (item) => item.id, minHeapSize, stats });
  assert.deepEqual(selected, items.slice().sort(referenceCompare).slice(0, k));
  assert.ok(stats.maxSize <= (stats.usedHeap ? k : items.length));
}
const invalid = [
  { id: 'b', score: NaN }, { id: 'a', score: Infinity },
  { id: 2, score: '2' }, { id: 1, score: undefined }
];
assert.deepEqual(selectTopK(invalid, { k: 4, score: (item) => item.score, id: (item) => item.id }),
  invalid.slice().sort(referenceCompare));
const events = [];
selectTopK([{ label: 'a', score: 1, id: 'a' }, { label: 'b', score: 1, id: 'b' }], {
  k: 2,
  score: (item) => { events.push(['score', item.label]); return item.score; },
  id: (item) => { events.push(['id', item.label]); return item.id; },
  sourceRank: (item) => { events.push(['rank', item.label]); return 0; }
});
assert.ok(events.length > 0 && events.length % 6 === 0);
for (let index = 0; index < events.length; index += 3) {
  assert.deepEqual(events.slice(index, index + 3).map((row) => row[0]), ['score', 'id', 'rank']);
  assert.equal(new Set(events.slice(index, index + 3).map((row) => row[1])).size, 1);
}
const coercions = [];
const objectId = { toString: () => { coercions.push('object'); return 'object'; } };
compareTopKEntries({ score: 1, id: 1 }, { score: 1, id: objectId });
assert.deepEqual(coercions, ['object']);
console.log('TopK mixed-ID, tie, selector, coercion and heap/sort parity passed');
