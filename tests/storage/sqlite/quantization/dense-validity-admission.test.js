import assert from 'node:assert/strict';
import { buildDenseVectorValidity, createDenseVectorRowPresence, decodeDenseVectorValidity } from '../../../../src/shared/dense-vector-validity.js';
import { createVectorIngestor } from '../../../../src/storage/sqlite/build/from-artifacts/vector-ingest.js';

for (const form of ['array', 'buffer', 'stream']) {
  const vectors = [[1, 2], [], [3, 4], []], validity = buildDenseVectorValidity(vectors);
  let reads = 0, serializations = 0;
  const encodedBits = validity.bits;
  Object.defineProperty(validity, 'bits', { enumerable: true, get: () => { reads++; return encodedBits; } });
  Object.defineProperty(validity, 'toJSON', { value: () => { serializations++; throw new Error('whole bitmap serialized during ingestion'); } });
  const payload = { dims: 2, count: vectors.length, validity,
    ...(form === 'array' ? { vectors } : form === 'buffer' ? { buffer: new Uint8Array([1, 2, 0, 0, 3, 4, 0, 0]) }
      : { rows: (async function* () { for (const [docId, vector] of vectors.entries()) yield { docId, vector }; })() }) };
  const inserted = [], validationStats = { dense: 0 };
  const { ingestDense } = createVectorIngestor({
    db: { transaction: action => action }, resolvedBatchSize: 1, recordBatch() {}, recordTable() {}, warn() {},
    validationStats, modelConfig: { id: 'fixture' }, quantization: { minVal: -1, maxVal: 1, levels: 255 },
    insertDenseMeta: { run() {} }, insertDense: { run: (_mode, id) => { inserted.push(id); } }
  });
  await ingestDense(payload, 'code');
  assert.deepEqual(inserted, [0, 2]); assert.equal(validationStats.dense, 2);
  assert.equal(reads, 1, `${form} admits validity once before per-row work`);
  assert.equal(serializations, 0);
}

const validity = buildDenseVectorValidity([[1], [], [2]]), payload = { count: 3, validity };
const pinned = createDenseVectorRowPresence(payload);
assert.deepEqual([0, 1, 2, 3].map(pinned), [true, false, true, false]);
validity.bits = Buffer.from([2]).toString('base64'); validity.validCount = 1;
assert.deepEqual([0, 1, 2].map(pinned), [true, false, true], 'one operation owns its admitted mask');
const refreshed = createDenseVectorRowPresence(payload);
assert.deepEqual([0, 1, 2].map(refreshed), [false, true, false], 'later operations re-admit changed metadata');
validity.validCount = 2;
assert.throws(() => decodeDenseVectorValidity(payload), { code: 'ERR_DENSE_VECTOR_VALIDITY' });
assert.throws(() => createDenseVectorRowPresence({ ...payload, count: 2 }), { code: 'ERR_DENSE_VECTOR_VALIDITY' });
console.log('dense validity per-ingestion admission passed');
