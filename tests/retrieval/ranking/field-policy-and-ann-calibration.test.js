import assert from 'node:assert/strict';
import { rankBM25Fields } from '../../../src/retrieval/rankers.js';
import { fuseRankedHits } from '../../../src/retrieval/pipeline/fusion.js';
import { withAnnScoreSpace, calibrateAnnScore } from '../../../src/shared/ann-similarity.js';
const tokens = { vocab: ['body'], postings: [[[0, 1]]], docLengths: [1], totalDocs: 1, avgDocLen: 1 };
const idx = { chunkMeta: [{ id: 0 }], tokenIndex: tokens, fieldPostings: { fields: { name: { ...tokens, vocab: [] } } } };
const rank = fieldWeights => rankBM25Fields({ idx, tokens: ['body'], topN: 2, fieldWeights, tokenIndexOverride: tokens });
assert.deepEqual(rank({ name: 1, body: 0 }), []);
assert.deepEqual(rank({ name: 0, body: 0 }), []);
assert.deepEqual(rank({ absent: 1 }), []);
assert.equal(rank({ body: 1 }).length, 1);
assert.equal(rank({ body: 3 })[0].score, rank({ body: 1 })[0].score * 3);
idx.fieldPostings.fields.name = { ...tokens, vocab: ['body'] };
assert.equal(rank({ name: 1, body: 0 }).length, 1);
const fuse = (annHits, extra = {}) => fuseRankedHits({ bmHits: [{ idx: 99, score: 100 }], annHits,
  sparseType: 'bm25', annSource: 'test', blendEnabled: true, blendSparseWeight: 0,
  blendAnnWeight: 1, rrfEnabled: false, ...extra }).scored;
for (const space of [{ kind: 'negative-distance', metric: 'l2' }, { kind: 'negative-distance', metric: 'ip' }, { kind: 'dot-product' }]) {
  const hits = [-2, -10, -100].map((sim, idx) => withAnnScoreSpace({ idx, sim }, space));
  const dense = fuse(hits).sort((a, b) => b.score - a.score);
  assert.deepEqual(dense.map(hit => hit.idx), [0, 1, 2]);
  assert.deepEqual(dense.map(hit => hit.score), [-2, -10, -100]);
  const hybrid = fuse(hits, { blendSparseWeight: 1 }).filter(hit => hit.annScore != null);
  assert.ok(hybrid[0].blendInfo.annNormalized > hybrid[1].blendInfo.annNormalized);
}
assert.equal(calibrateAnnScore(-2, { kind: 'negative-distance', metric: 'l2' }), 1 / 3);
assert.equal(calibrateAnnScore(-1, { kind: 'cosine' }), 0);
assert.equal(calibrateAnnScore(1, { kind: 'cosine' }), 1);
const rrf = fuse([withAnnScoreSpace({ idx: 1, sim: -100 }, { kind: 'dot-product' })],
  { blendEnabled: false, rrfEnabled: true, rrfK: 60 });
assert.ok(rrf.every(hit => hit.scoreType === 'rrf'));
console.log('field policy and ANN calibration passed');
