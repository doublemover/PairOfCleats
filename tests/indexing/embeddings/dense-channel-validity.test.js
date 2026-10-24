import assert from 'node:assert/strict';
import { buildDenseVectors } from '../../../src/index/build/postings/dense-vectors.js';
import { buildDenseVectorValidity, decodeDenseVectorValidity } from '../../../src/shared/dense-vector-validity.js';
import { materializeDenseVectorRows } from '../../../src/shared/dense-vector-meta.js';
import { rankDenseVectors } from '../../../src/retrieval/rankers.js';
import { fillMissingVectors } from '../../../tools/build/embeddings/embed.js';
const result = await buildDenseVectors({ chunks: [
  { embedding_u8: new Uint8Array([255, 128]), embed_doc_u8: new Uint8Array(0) },
  { embedding: [0, 1], embed_doc: [0, 0], embed_code: [] },
  { embedding: [0, 0], embed_doc: [0.00001, -0.00001] }
], embeddingsEnabled: true, useStubEmbeddings: true, modelId: 'test' });
assert.equal(result.dims, 2);
assert.deepEqual([...result.quantizedVectors[0]], [255, 128]);
assert.ok(result.quantizedVectors[1][1] > result.quantizedVectors[1][0], 'float rows remain present beside byte rows');
assert.deepEqual(result.quantizedDocVectors.map(row => row.length), [0, 2, 2]);
assert.deepEqual(result.quantizedCodeVectors.map(row => row.length), [2, 0, 2]);
const validity = buildDenseVectorValidity(result.quantizedDocVectors);
assert.equal(validity.validCount, 2, 'actual zero and low amplitude embeddings remain valid');
const payload = { dims: 2, count: 3, validity, minVal: -1, scale: 2 / 255,
  buffer: new Uint8Array([0, 0, ...result.quantizedDocVectors[1], ...result.quantizedDocVectors[2]]) };
assert.deepEqual(materializeDenseVectorRows(payload).map(row => row.length), [0, 2, 2]);
const ranked = rankDenseVectors({ denseVec: payload }, [-1, -1], 10, null);
assert.equal(ranked.some(hit => hit.idx === 0), false, 'fixed-width padding cannot become a dense match');
decodeDenseVectorValidity(payload);
assert.throws(() => decodeDenseVectorValidity({ ...payload, count: 2 }), { code: 'ERR_DENSE_VECTOR_VALIDITY' }, 'warm mask reads remain count bound');
const missing = [null, [], new Uint8Array(0), new Uint8Array([128, 128])];
fillMissingVectors(missing, 2);
assert.deepEqual(missing.map(row => row.length), [0, 0, 0, 2]);
assert.throws(() => fillMissingVectors([[1]], 2), /dimensions/);
console.log('dense channel validity passed');
