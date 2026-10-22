import assert from 'node:assert/strict';
import { createLanceVectorContract } from '../../../tools/build/embeddings/lancedb-arrow.js';
import { normalizeLanceDbConfig } from '../../../src/shared/lancedb.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
const quantization = { minVal: -1, maxVal: 1, levels: 256 };
for (const embeddingColumn of ['vector', 'embedding', 'features']) {
  const contract = createLanceVectorContract({ dims: 2, embeddingColumn, idColumn: 'document', batchSize: 2,
    quantization, normalize: false });
  contract.append(0, [255, 128]); contract.append(2, Uint8Array.of(128, 255));
  const table = contract.take();
  assert.equal(table.numRows, 2);
  contract.assertSchema(table.schema);
  assert.equal(table.getChild('document').get(1), 2n);
  assert.deepEqual(Array.from(table.getChild(embeddingColumn).get(0)), Array.from(dequantizeUint8ToFloat32([255, 128], -1, 1, 256)));
  assert.throws(() => contract.append(3, [0, 0]), /finish ingestion/);
  // A delayed native consumer must observe unchanged buffer bytes until its
  // promise settles; only then may the producer release/reuse the buffers.
  await Promise.resolve();
  assert.equal(table.getChild('document').get(0), 0n);
  contract.release(); contract.append(5, [255, 255]);
  const tail = contract.take();
  assert.equal(tail.numRows, 1); assert.equal(tail.getChild('document').get(0), 5n);
  assert.throws(() => contract.assertSchema({ fields: [] }), /physical schema/);
  contract.release();
  assert.throws(() => contract.append(1, [255]), /dimension mismatch/);
  assert.throws(() => contract.append(1, [NaN, 1]), /non-finite/);
}
assert.throws(() => normalizeLanceDbConfig({ idColumn: 'same', embeddingColumn: 'same' }), /distinct/);
const bounded = createLanceVectorContract({ dims: 4096, idColumn: 'id', embeddingColumn: 'features', batchSize: 1e9, normalize: false });
assert.ok(bounded.capacity * (4096 * 4 + 8) <= 16 * 1024 * 1024);
console.log('explicit byte-bounded Arrow schema and ingestion-buffer ownership');
