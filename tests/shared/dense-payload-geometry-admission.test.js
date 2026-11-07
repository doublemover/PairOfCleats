import assert from 'node:assert/strict';
import { isDenseVectorPayloadAvailable, materializeDenseVectorRows, resolveDenseVectorCountFromBuffer } from '../../src/shared/dense-vector-meta.js';
import { buildDenseVectorValidity } from '../../src/shared/dense-vector-validity.js';
import { normalizeDenseVectorStreamMeta } from '../../src/shared/dense-vector-stream.js';

const buffer = Uint8Array.of(1, 2, 3, 4, 5, 6);
for (const count of [0, -1, 1.5, null, '2', Number.MAX_SAFE_INTEGER]) {
  const payload = { dims: 3, count, buffer };
  assert.equal(isDenseVectorPayloadAvailable(payload), false);
  assert.deepEqual(materializeDenseVectorRows(payload), []);
  assert.equal(resolveDenseVectorCountFromBuffer(payload, buffer.length).dims, 0);
}
for (const extra of [{ bytes: 5 }, { bytes: null }, { totalRecords: 3 }, { totalRecords: null }, { dims: '3' }, { dims: 2.5 }]) {
  assert.equal(isDenseVectorPayloadAvailable({ dims: 3, count: 2, buffer, ...extra }), false);
}
assert.equal(isDenseVectorPayloadAvailable({ dims: 3, buffer }), true, 'only absent count can infer an exact legacy extent');
assert.equal(isDenseVectorPayloadAvailable({ dims: 3, count: 2, buffer: Uint8Array.of(...buffer, 7) }), false);
assert.equal(isDenseVectorPayloadAvailable({ dims: 3, count: 2, buffer: Int8Array.from(buffer) }), false);
assert.deepEqual(materializeDenseVectorRows({ dims: 3, buffer }).map(row => [...row]), [[1, 2, 3], [4, 5, 6]]);
for (const extra of [{ count: 0 }, { count: null }, { count: 2.5 }, { totalRecords: null }, { dims: null }]) {
  assert.throws(() => materializeDenseVectorRows({ dims: 3, vectors: [[1, 2, 3]], ...extra }), { code: 'ERR_DENSE_VECTOR_SHAPE' });
}
const validity = buildDenseVectorValidity([[1, 2, 3], []]);
assert.deepEqual(materializeDenseVectorRows({ dims: 3, buffer, validity }).map(row => [...row]), [[1, 2, 3], []]);
assert.throws(() => materializeDenseVectorRows({ dims: 3, vectors: [[], []], validity }), { code: 'ERR_EMBEDDING_QUANTIZATION' });
assert.throws(() => isDenseVectorPayloadAvailable({ dims: 3, buffer, validity: buildDenseVectorValidity([[1]]) }), { code: 'ERR_DENSE_VECTOR_VALIDITY' });
assert.throws(() => isDenseVectorPayloadAvailable({ dims: 3, count: 2, buffer, quantizationVersion: 99 }), { code: 'ERR_EMBEDDING_QUANTIZATION' });
assert.throws(() => isDenseVectorPayloadAvailable({ dims: 3, count: 2, buffer, levels: 4 }), { code: 'ERR_EMBEDDING_QUANTIZATION' });
for (const extra of [{ count: null }, { count: 1.5 }, { totalRecords: null }, { bytes: null }, { format: 'float32' }]) {
  assert.throws(() => normalizeDenseVectorStreamMeta({ count: 2, dims: 3, ...extra }), { code: 'ERR_DENSE_VECTOR_STREAM' });
}
console.log('Dense payload admission binds exact counts, widths, byte extents, masks and quantization codecs.');
