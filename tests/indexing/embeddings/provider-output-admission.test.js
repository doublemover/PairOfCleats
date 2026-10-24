import assert from 'node:assert/strict';
import { createXenovaAdapter } from '../../../src/shared/embedding-provider-adapters.js';
import { normalizeEmbeddingBatchOutput } from '../../../src/shared/embedding-utils.js';
import { normalizeEmbeddingGemma2Output } from '../../../src/shared/embedding-model-profile.js';
import { observeEmbeddingOwnership } from '../../../src/shared/embedding-cache-lifetime.js';

const invalid = [
  [[1, 2], [3, 4]], [], [[1, 2], [3]], [['1', '2']], [[1, NaN]], [[1, Infinity]], [[1e100]],
  { dims: [2, 2], data: Float32Array.of(1, 2, 3, 4) },
  { dims: [1, 3], data: Float32Array.of(1, 2) },
  { dims: [3], data: Float32Array.of(1, 2) },
  { dims: [1, 2], data: Float32Array.of(1, 2, 3) },
  { dims: [1, 2.5], data: Float32Array.of(1, 2) },
  { dims: [1, 0], data: new Float32Array() },
  { dims: [], data: Float32Array.of(1) },
  { dims: [1, 1, 2], data: Float32Array.of(1, 2) },
  { dims: [1, 2], type: 'int32', data: Int32Array.of(1, 2) },
  { dims: [1, 2], type: 'float32', data: Float64Array.of(1, 2) },
  [{ type: 'int32', data: Float32Array.of(1, 2) }],
  { dims: [1, 2], data: ['1', '2'] },
  { dims: [1, 2], data: Float64Array.of(1e100, 2) }, null
];
for (const output of invalid) assert.throws(() => normalizeEmbeddingBatchOutput(output, 1), { code: 'ERR_EMBEDDING_OUTPUT' });
assert.throws(() => normalizeEmbeddingBatchOutput([[1, 2], [3]], 2), /dimensions/);
const backing = Float32Array.of(99, 1, 2, 99);
assert.deepEqual(normalizeEmbeddingBatchOutput({ dims: [1, 2], data: backing.subarray(1, 3) }, 1), [Float32Array.of(1, 2)]);
assert.deepEqual(normalizeEmbeddingBatchOutput({ dims: [2], data: Float32Array.of(1, 2) }, 1), [Float32Array.of(1, 2)]);

// Exercise the actual provider, including output ownership before validation.
for (const output of invalid) {
  let outputCloses = 0, pipelineCloses = 0;
  const owned = output && !Array.isArray(output) ? { ...output, dispose() { outputCloses++; } } : output;
  const pipeline = Object.assign(async () => owned, { dispose() { pipelineCloses++; } });
  const adapter = createXenovaAdapter({ modelId: 'fixture-admission', loadPipeline: async () => pipeline });
  try {
    await assert.rejects(adapter.embedOne('source text is excluded from errors'), error => {
      assert.equal(error.code, 'ERR_EMBEDDING_OUTPUT');
      assert.equal(error.provider, 'xenova');
      assert.equal(error.expectedRows, 1);
      assert.equal(error.message.includes('source text'), false);
      return true;
    });
    assert.equal(outputCloses, owned === output ? 0 : 1);
  } finally { await adapter.dispose(); }
  assert.equal(pipelineCloses, 1);
}
let calls = 0;
const stable = createXenovaAdapter({ modelId: 'fixture-stable-width', loadPipeline: async () =>
  Object.assign(async () => [[1, 2, ...(calls++ ? [3] : [])]], { dispose() {} }) });
try {
  assert.deepEqual(await stable.embedOne('first'), Float32Array.of(1, 2));
  await assert.rejects(stable.embedOne('second'), /dimensions/);
} finally { await stable.dispose(); }

const cleanup = Object.freeze(new Error('controlled failed tensor disposal'));
let closes = 0;
const badTensor = { dims: [2, 2], data: Float32Array.of(1, 2, 3, 4),
  dispose() { if (++closes === 1) throw cleanup; } };
const adapter = createXenovaAdapter({ modelId: 'fixture-invalid-owned',
  loadPipeline: async () => Object.assign(async () => badTensor, { dispose() {} }) });
try {
  const error = await adapter.embedOne('invalid shape').then(() => assert.fail('expected rejection'), value => value);
  assert.equal(error.cause.code, 'ERR_EMBEDDING_OUTPUT');
  assert.equal(typeof observeEmbeddingOwnership(error), 'function');
  await assert.rejects(adapter.dispose(), /controlled failed tensor disposal/);
  await adapter.dispose();
  assert.equal(observeEmbeddingOwnership(error)(), true);
  assert.equal(closes, 2, 'cleanup retries the original captured tensor owner');
} finally { await adapter.dispose(); }

for (const tensor of [
  { dims: [1, 768], type: 'int32', data: new Int32Array(768).fill(1) },
  { dims: [1, 768], data: new Float64Array(768).fill(1e100) }
]) assert.throws(() => normalizeEmbeddingGemma2Output({ sentence_embedding: tensor }, 1, 128), { code: 'ERR_EMBEDDING_OUTPUT' });
console.log('Provider cardinality, shape, numeric admission and cleanup assertions complete');
