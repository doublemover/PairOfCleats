import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AutoModel, AutoTokenizer, Tensor } from '@huggingface/transformers';
import { TransformersEmbeddingFunction } from '@lancedb/lancedb/embedding/transformers';

// The scoped dependency migration must use the already patched runtime, rather
// than loading an independent old Transformers/Sharp/ONNX installation.
const lanceRequire = createRequire(import.meta.resolve('@lancedb/lancedb'));
assert.equal(lanceRequire.resolve('@huggingface/transformers'),
  createRequire(import.meta.url).resolve('@huggingface/transformers'));
const originalModel = AutoModel.from_pretrained, originalTokenizer = AutoTokenizer.from_pretrained;
const calls = [];
try {
  AutoModel.from_pretrained = async (name, options) => {
    calls.push({ name, options });
    return { config: { hidden_size: 2 }, forward: async inputs => {
      assert.deepEqual(inputs, { fixtureInput: true });
      return { last_hidden_state: new Tensor('float32', Float32Array.from([2, 4, 6, 8]), [1, 2, 2]) };
    } };
  };
  AutoTokenizer.from_pretrained = async name => {
    assert.equal(name, 'fixture/no-network-model');
    return async (data, options) => {
      assert.deepEqual(data, ['bounded text']); assert.equal(options.padding, true);
      return { fixtureInput: true };
    };
  };
  const embedding = new TransformersEmbeddingFunction({ model: 'fixture/no-network-model' });
  await assert.rejects(embedding.computeSourceEmbeddings(['bounded text']), /not initialized/);
  await embedding.init();
  assert.deepEqual(calls, [{ name: 'fixture/no-network-model', options: { dtype: 'fp32' } }]);
  assert.equal(embedding.ndims(), 2);
  assert.deepEqual(await embedding.computeSourceEmbeddings(['bounded text']), [[4, 6]]);
  assert.deepEqual(await embedding.computeQueryEmbeddings('bounded text'), [4, 6]);
  assert.equal(embedding.embeddingDataType().toString(), 'Float32');
} finally {
  AutoModel.from_pretrained = originalModel;
  AutoTokenizer.from_pretrained = originalTokenizer;
}
console.log('LanceDB uses the current shared Transformers API and real tensor reduction; model inference remains separate qualification');
