import assert from 'node:assert/strict';
import { buildDenseVectors } from '../../../src/index/build/postings/dense-vectors.js';

const quantize = value => Math.round((Math.max(-1, Math.min(1, value)) + 1) / 2 * 255);
const floats = [1, 0, -1], bytes = Uint8Array.of(255, 128, 0);
const channels = ['embedding', 'embed_doc', 'embed_code'];
const build = chunks => buildDenseVectors({ chunks, embeddingsEnabled: true, useStubEmbeddings: true,
  modelId: 'mixed-representation-fixture' });
for (const Type of [Array, Float32Array, Float64Array]) {
  const input = [Object.fromEntries(channels.map(field => [field + '_u8', bytes.slice()])),
    Object.fromEntries(channels.map(field => [field, Type.from(floats)])),
    { embedding: Type.from([0, 0, 0]), embed_doc: [], embed_code: null }];
  const before = structuredClone(input), output = await build(input);
  for (const field of ['quantizedVectors', 'quantizedDocVectors', 'quantizedCodeVectors']) {
    assert.deepEqual([...output[field][0]], [...bytes]);
    assert.deepEqual([...output[field][1]], floats.map(quantize));
  }
  assert.deepEqual([...output.quantizedVectors[2]], [128, 128, 128], 'a real numeric zero vector is present');
  assert.equal(output.quantizedDocVectors[2].length, 0); assert.equal(output.quantizedCodeVectors[2].length, 0);
  assert.deepEqual(input, before, 'mixed selection does not mutate shared byte/float buffers');
}
for (const chunks of [channels.map(field => ({ [field]: [1, 0] })),
  channels.map(field => ({ [field + '_u8']: Uint8Array.of(255, 128) }))]) {
  assert.equal((await build(chunks)).dims, 2, 'pure float and pure byte cohorts retain their valid dimensions');
}
for (const chunks of [[{ embedding: [1, 0] }, { embedding: [1] }], [{ embedding: [NaN, 0] }],
  [{ embedding: [Infinity, 0] }], [{ embedding_u8: [1, 2] }], [{ embed_doc_u8: new Uint16Array([1, 2]) }]]) {
  await assert.rejects(build(chunks), /dimensions|finite|quantized/u);
}
console.log('Independent reference bytes prove mixed representation parity in every dense channel, absence, input ownership and malformed-row rejection.');
