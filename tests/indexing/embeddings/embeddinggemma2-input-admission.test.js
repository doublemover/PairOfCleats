import assert from 'node:assert/strict';
import { createPreparedTextEncoder } from '../../../src/shared/embedding-prepared.js';
import { resolveEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';

// Actual prepared/direct encoder boundaries; inert tokenizers and model only.
const tensors = [], requests = [];
let response = null, modelCalls = 0, tokenCalls = 0, modelCloses = 0, tokenCloses = 0;
class Tensor {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims, closes: 0 }); tensors.push(this); }
  dispose() { this.closes++; }
}
const tokenizer = Object.assign(async (texts, options) => {
  tokenCalls++; requests.push(options);
  if (response) return response(texts, options);
  if (options.return_tensor === false) return { input_ids: texts.map(() => [1, 2]), attention_mask: texts.map(() => [1, 1]) };
  return { input_ids: new Tensor('int64', new BigInt64Array(texts.length * 2).fill(1n), [texts.length, 2]),
    attention_mask: new Tensor('int64', new BigInt64Array(texts.length * 2).fill(1n), [texts.length, 2]) };
}, { pad_token_id: 0, dispose() { tokenCloses++; } });
const model = Object.assign(async inputs => {
  modelCalls++;
  const count = inputs.input_ids.dims[0], data = new Float32Array(count * 768);
  for (let row = 0; row < count; row++) data[row * 768] = 1;
  return { sentence_embedding: new Tensor('float32', data, [count, 768]) };
}, { dispose() { modelCloses++; } });
const profile = resolveEmbeddingModelProfile('onnx-community/embeddinggemma-2-ONNX', { dimensions: 128 }), options = { enableProfiling: false };
const encoder = createPreparedTextEncoder({ tokenizer, model, Tensor, profile, sessionOptions: options });
try {
  profile.dimensions = 768; profile.maxLength = 2; options.enableProfiling = true;
  const items = await encoder.prepare(['first', 'second']);
  assert.equal(requests[0].max_length, 8192); assert.equal((await encoder.embedPrepared(items))[0].length, 128);
  assert.equal(encoder.executionInfo().profilingEnabled, false);
  for (const value of [
    { input_ids: [[1], [2], [3]], attention_mask: [[1], [1], [1]] },
    { input_ids: [[1]], attention_mask: [[1]] }, { input_ids: [[1], [2]], attention_mask: [[1]] },
    { input_ids: [[1], [2]], attention_mask: [[1], []] }, { input_ids: [[1], [2]], attention_mask: [[1], [2]] },
    { input_ids: [[1], [2]], attention_mask: [[1], [0]] }, { input_ids: [[1], [-1]], attention_mask: [[1], [1]] },
    { input_ids: [[1], ['2']], attention_mask: [[1], [1]] }, { input_ids: [[1], [1.5]], attention_mask: [[1], [1]] },
    { input_ids: [[1], [NaN]], attention_mask: [[1], [1]] }, { input_ids: [[1], [Infinity]], attention_mask: [[1], [1]] },
    { input_ids: [[1], [2]], attention_mask: [[1], [1]], token_type_ids: [[0], [0], [0]] }
  ]) {
    response = () => value;
    await assert.rejects(encoder.prepare(['first', 'second']), { code: 'ERR_EMBEDDING_PREPARED_INPUT' });
    assert.equal(modelCalls, 1, 'invalid prepared rows never reach inference');
  }
  response = null;
  assert.equal((await encoder(['direct valid']))[0].length, 128);
  const callsBeforeMalformed = modelCalls;
  for (const mode of ['extra', 'short', 'width', 'type', 'data-length', 'mask', 'zero-mask', 'negative']) {
    response = texts => {
      const count = mode === 'extra' ? texts.length + 1 : mode === 'short' ? texts.length - 1 : texts.length;
      const ids = new Tensor(mode === 'type' ? 'float32' : 'int64', new BigInt64Array(count * 2).fill(1n), [count, 2]);
      const mask = new Tensor('int64', new BigInt64Array(count * 2).fill(1n), [count, mode === 'width' ? 3 : 2]);
      if (mode === 'data-length') ids.data = new BigInt64Array(1);
      if (mode === 'mask') mask.data[0] = 2n;
      if (mode === 'zero-mask') mask.data.fill(0n);
      if (mode === 'negative') ids.data[0] = -1n;
      return { input_ids: ids, attention_mask: mask };
    };
    const offset = tensors.length;
    await assert.rejects(encoder(['first', 'second']), { code: 'ERR_EMBEDDING_PREPARED_INPUT' });
    assert.equal(modelCalls, callsBeforeMalformed);
    assert(tensors.slice(offset).every(tensor => tensor.closes === 1), 'rejected native input tensors retain exact disposal');
  }
  response = null;
  tokenizer.pad_token_id = '0'; await assert.rejects(encoder.embedPrepared(items), { code: 'ERR_EMBEDDING_PREPARED_INPUT' });
  tokenizer.pad_token_id = 0;
  const beforeEmpty = tokenCalls;
  assert.deepEqual(await encoder([]), []); assert.equal(tokenCalls, beforeEmpty);
  await assert.rejects(encoder([null]), /strings/); assert.equal(tokenCalls, beforeEmpty);
  await encoder.dispose(); assert.equal(modelCloses, 1); assert.equal(tokenCloses, 1);
} finally { response = null; await encoder.dispose(); }
console.log('Actual EG2 prepared/direct cardinality, field/value admission, selected profile and native disposal controls authored; execution deferred.');
