#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rankDenseVectors, rankDenseVectorsAsync } from '../../../src/retrieval/rankers.js';
import { createDenseAnnProvider } from '../../../src/retrieval/ann/providers/dense.js';
import { buildDenseVectorValidity } from '../../../src/shared/dense-vector-validity.js';

const dims = 3;
const rows = Array.from({ length: 273 }, (_, id) => id % 13 ? [id % 256, (id * 7) % 256, (id * 11) % 256] : []);
rows[1] = [0, 0, 0]; rows[2] = [255, 128, 128]; rows[3] = [...rows[2]];
const validity = buildDenseVectorValidity(rows);
const bytes = new Uint8Array(rows.length * dims);
rows.forEach((row, id) => { if (row.length) bytes.set(row, id * dims); });
Object.defineProperty(bytes, 'subarray', { value: () => { throw new Error('per-row view allocation is forbidden'); } });
const dense = { dims, minVal: -1, maxVal: 1, levels: 256, scale: 2 / 255, validity };
const contiguous = { denseVec: { ...dense, buffer: bytes } }, nested = { denseVec: { ...dense, vectors: rows } };

// Independent stored-byte scalar reference. This is deliberately not an
// original-FP32 oracle and does not invoke a production ranker/reducer.
const reference = (query, limit, ids) => {
  const scored = [];
  for (const id of ids || rows.keys()) {
    if (!Number.isSafeInteger(id) || id < 0 || id >= rows.length || rows[id].length < dims) continue;
    let sim = 0;
    for (let coordinate = 0; coordinate < dims; coordinate++) {
      const value = rows[id][coordinate] * dense.scale + dense.minVal;
      sim += value * query[coordinate];
    }
    if (Number.isFinite(sim)) scored.push({ idx: id, sim });
  }
  return scored.sort((left, right) => right.sim - left.sim || left.idx - right.idx).slice(0, limit);
};
for (const query of [[1, 0, 0], [1e-16, -1, 1], [-1, -1, -1], [0, 0, 0]]) {
  const eligible = [255, 2, 3, 1, 0, -1, 1.5, 999];
  const candidates = { size: eligible.length, values: function* () { yield* eligible; },
    toArray: () => { throw new Error('candidate materialization is forbidden for iterable domains'); } };
  for (const [domain, ids] of [[null, null], [candidates, eligible], [new Set(), []]]) {
    const expected = reference(query, 17, ids), work = {};
    assert.deepEqual(rankDenseVectors(contiguous, query, 17, domain, { metrics: work }), expected);
    assert.deepEqual(rankDenseVectors(nested, query, 17, domain), expected);
    assert.deepEqual(await rankDenseVectorsAsync(contiguous, query, 17, domain), expected);
    assert.equal(work.rowViewsCreated, 0);
    assert.equal(work.candidateIdsCopied, 0);
  }
}
const work = {};
await rankDenseVectorsAsync(contiguous, [1, 0, 0], 5, null, { metrics: work });
assert.equal(work.vectorsScored, validity.validCount);
assert.equal(work.coordinatesScored, validity.validCount * dims);
assert.ok(work.yieldedBlocks >= 2, 'a nonmultiple tail remains exact across cooperative blocks');
const legacyWork = {};
rankDenseVectors(contiguous, [1, 0, 0], 2, { toArray: () => [2, 3] }, { metrics: legacyWork });
assert.equal(legacyWork.candidateIdsCopied, 2, 'noniterable compatibility fallback reports its remaining copy honestly');
const invalidRows = { denseVec: { dims, scale: dense.scale, minVal: -1, vectors: [[1], [1, NaN, 3], null] } };
assert.deepEqual(rankDenseVectors(invalidRows, [1, 1, 1], 5, null), []);

const controller = new AbortController(), provider = createDenseAnnProvider();
setImmediate(() => controller.abort());
await assert.rejects(provider.query({ idx: contiguous, embedding: [1, 0, 0], topN: 5, candidateSet: null, signal: controller.signal }),
  { name: 'AbortError' }, 'the real provider yields to cancellation and never returns a partial top-k');
console.log('Direct-offset dense scoring matches the independent stored-byte scalar order across domains, masks and cooperative blocks.');
