import assert from 'node:assert/strict';
import { createLanceVectorContract } from '../../../tools/build/embeddings/lancedb-arrow.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';

// Authored pure Arrow/shared decoder controls; no LanceDB native or model work.
const output = new Float32Array(6).fill(19), slice = output.subarray(2, 4);
const original = dequantizeUint8ToFloat32([0, 255]);
assert.equal(dequantizeUint8ToFloat32([0, 255], -1, 1, 256, slice), slice);
assert.deepEqual(slice, original);
assert.deepEqual([...output], [19, 19, -1, 1, 19, 19], 'only the exact destination window is written');
assert.throws(() => dequantizeUint8ToFloat32([1, 2], -1, 1, 256, new Float32Array(1)), /exact-length/);
assert.throws(() => dequantizeUint8ToFloat32([1], -1, 1, 256, new Float64Array(1)), /exact-length/);
assert.equal(dequantizeUint8ToFloat32(null, -1, 1, 256, slice), null, 'missing source retains its allocating API contract');
const shared = new ArrayBuffer(16), byteSource = new Uint8Array(shared, 0, 2);
byteSource.set([0, 255]);
assert.throws(() => dequantizeUint8ToFloat32(byteSource, -1, 1, 256, new Float32Array(shared, 0, 2)), /must not overlap/);
assert.deepEqual(dequantizeUint8ToFloat32(byteSource, -1, 1, 256, new Float32Array(shared, 8, 2)), original,
  'disjoint slices may share one backing allocation without corrupting source bytes');
for (const dims of [1, 2, 33, 4096]) for (const normalize of [false, true]) for (const levels of [2, 17, 256]) {
  const quantization = { minVal: -.75, maxVal: .5, levels };
  const vector = Uint8Array.from({ length: dims }, (_, index) => index * 17 % levels);
  const expected = dequantizeUint8ToFloat32(vector, quantization.minVal, quantization.maxVal, levels);
  if (normalize) normalizeEmbeddingVectorInPlace(expected);
  const contract = createLanceVectorContract({ dims, idColumn: 'document', embeddingColumn: 'features',
    batchSize: 2, quantization, normalize });
  contract.append(0, vector); contract.append(3, vector);
  vector.fill(0);
  const table = contract.take();
  assert.deepEqual([...table.getChild('features').get(0)], [...expected]);
  assert.deepEqual([...table.getChild('features').get(1)], [...expected]);
  assert.equal(table.getChild('document').get(1), 3n);
  assert.throws(() => contract.append(4, vector), /finish ingestion/);
  contract.release(); contract.append(7, vector);
  assert.equal(contract.take().numRows, 1, 'tail capacity does not expose previous batch rows');
  contract.release();
}

// Count backing-store construction only around actual append, excluding Arrow
// wrapper/IPC allocation. A subarray view is not a new Float32 backing store.
const OriginalFloat32Array = globalThis.Float32Array;
let numericAllocations = 0;
globalThis.Float32Array = new Proxy(OriginalFloat32Array, { construct(target, args) {
  if (typeof args[0] === 'number') numericAllocations++;
  return Reflect.construct(target, args);
} });
try {
  const contract = createLanceVectorContract({ dims: 3, idColumn: 'id', embeddingColumn: 'vector', batchSize: 3 });
  const before = numericAllocations;
  contract.append(0, [0, 128, 255]); contract.append(1, [0, 128, 255]); contract.append(2, [0, 128, 255]);
  assert.equal(numericAllocations, before, 'append does not allocate temporary Float32 backing storage per row');
} finally { globalThis.Float32Array = OriginalFloat32Array; }
console.log('LanceDB direct owned-batch fill parity/allocation controls authored; execution deferred.');
