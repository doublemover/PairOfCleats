import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildDenseVectorValidity, createDenseVectorRowPresence, decodeDenseVectorValidity } from '../../../../src/shared/dense-vector-validity.js';
import { createVectorIngestor } from '../../../../src/storage/sqlite/build/from-artifacts/vector-ingest.js';

const dims = 4, row = id => id === 0 ? new Uint8Array(dims)
  : id === 2 ? new Uint8Array(dims).fill(128) : Uint8Array.of(id % 255, 0, 1, 2);
for (const form of ['array', 'buffer', 'stream']) for (const shape of ['all', 'sparse', 'absent']) {
  const count = 1025, present = id => shape === 'all' || shape === 'sparse' && id % 3 !== 1;
  const vectors = Array.from({ length: count }, (_, id) => present(id) ? row(id) : []);
  const validity = buildDenseVectorValidity(vectors), encoded = validity.bits;
  let metadataReads = 0, base64Decodes = 0, serialization = 0, batches = 0;
  Object.defineProperty(validity, 'bits', { enumerable: true, get() { metadataReads++; return encoded; } });
  Object.defineProperty(validity, 'toJSON', { value() { serialization++; throw new Error('whole validity serialization is forbidden'); } });
  const dense = { count, dims, validity };
  if (form === 'array') dense.vectors = vectors;
  else if (form === 'buffer') dense.buffer = Uint8Array.from(vectors.flatMap(value => value.length ? [...value] : Array(dims).fill(0)));
  else dense.rows = (async function* () {
    for (let id = 0; id < count; id++) {
      yield { docId: id, vector: present(id) ? row(id) : [] };
      if (id === 0) {
        // Producer-side metadata replacement between awaits cannot redirect an
        // ingestion that already owns its admitted immutable presence snapshot.
        dense.validity = { version: 999, count: 0, bits: 'corrupt replacement' };
        validity.validCount = 0;
      }
    }
  })();
  const db = new Database(':memory:');
  db.exec('CREATE TABLE dense_vectors(mode TEXT, doc_id INTEGER, vector BLOB); CREATE TABLE dense_meta(mode TEXT,dims INTEGER,scale REAL,model TEXT,min REAL,max REAL,levels INTEGER); CREATE TABLE ann(id INTEGER,vector BLOB)');
  const originalFrom = Buffer.from;
  Buffer.from = function (value, ...args) { if (value === encoded && args[0] === 'base64') base64Decodes++; return originalFrom.call(this, value, ...args); };
  try {
    const { ingestDense } = createVectorIngestor({ db, resolvedBatchSize: 127,
      recordBatch: () => { batches++; }, recordTable() {}, warn: message => { throw new Error(message); },
      validationStats: { dense: 0 }, modelConfig: { id: 'validity-fixture' },
      quantization: { minVal: -1, maxVal: 1, levels: 256 },
      insertDenseMeta: db.prepare('INSERT INTO dense_meta VALUES(?,?,?,?,?,?,?)'),
      insertDense: db.prepare('INSERT INTO dense_vectors VALUES(?,?,?)'),
      vectorExtension: { encoding: 'float32' }, vectorAnn: { insert: db.prepare('INSERT INTO ann VALUES(?,?)') },
      encodeVector: values => Buffer.from(values.buffer, values.byteOffset, values.byteLength) });
    await ingestDense(dense, 'code');
    const expected = Array.from({ length: count }, (_, id) => id).filter(present);
    const actual = db.prepare('SELECT doc_id,vector FROM dense_vectors ORDER BY doc_id').all();
    assert.deepEqual(actual.map(value => value.doc_id), expected);
    for (const value of actual) assert.deepEqual([...value.vector], [...row(value.doc_id)]);
    const ann = db.prepare('SELECT id,vector FROM ann ORDER BY id').all();
    assert.deepEqual(ann.map(value => value.id), expected, 'SQLite vector rows retain the original zero-based document ordinals');
    for (const value of ann) {
      const decoded = Float32Array.from(row(value.id), byte => -1 + byte * 2 / 255);
      assert.deepEqual(value.vector, Buffer.from(decoded.buffer), 'ANN input bytes independently decode the selected quantization');
    }
    assert.equal(metadataReads, 1); assert.equal(base64Decodes, 1); assert.equal(serialization, 0);
    assert.equal(batches, Math.ceil(expected.length / 127));
  } finally { Buffer.from = originalFrom; db.close(); }
}
const vectors = [[0, 0], [], [1, 1]], payload = { count: 3, vectors };
const legacy = createDenseVectorRowPresence(payload); vectors[1] = [5, 5];
assert.deepEqual([0, 1, 2].map(legacy), [true, false, true], 'legacy array presence is captured rather than read live');
const metadata = { count: 3, validity: buildDenseVectorValidity([[0], [], [1]]) };
decodeDenseVectorValidity(metadata).fill(0);
assert.deepEqual([0, 1, 2].map(createDenseVectorRowPresence(metadata)), [true, false, true], 'public decoded buffers cannot mutate the private admitted bitmap');
for (const mutate of [value => { value.validCount++; }, value => { value.bits = 'not canonical base64'; },
  value => { value.bits = Buffer.from([0xff]).toString('base64'); value.validCount = 3; }, value => { value.count++; }]) {
  const changed = structuredClone(metadata); mutate(changed.validity);
  assert.throws(() => createDenseVectorRowPresence(changed), { code: 'ERR_DENSE_VECTOR_VALIDITY' });
}
console.log('Native SQLite vector ingestion pins exact presence/bytes/ANN input membership for array, buffer and async streams, with independent mutable-envelope negatives.');
