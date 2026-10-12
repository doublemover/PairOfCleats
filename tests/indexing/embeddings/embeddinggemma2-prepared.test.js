#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPreparedTextEncoder, normalizeEg2SessionOptions } from '../../../src/shared/embedding-prepared.js';
import { __setTransformersModuleLoaderForTests, getEmbeddingAdapter } from '../../../src/shared/embedding-adapter.js';

const options = normalizeEg2SessionOptions({
  intraOpNumThreads: 6, interOpNumThreads: 1, executionMode: 'sequential',
  extra: { 'session.intra_op.allow_spinning': '0' }, enableProfiling: true,
  profileFilePrefix: process.cwd() + '/temp/tasks/eg2-runtime-tests/profile',
  optimizedModelFilePath: process.cwd() + '/temp/tasks/eg2-runtime-tests/optimized.onnx'
});
assert.ok(Object.isFrozen(options));
assert.ok(Object.isFrozen(options.extra));
for (const invalid of [
  { executionProviders: ['dml'] }, { intraOpNumThreads: 0 }, { intraOpNumThreads: '6' },
  { interOpNumThreads: 257 }, { executionMode: 'unknown' }, { profileFilePrefix: './profile' },
  { extra: { 'session.intra_op.allow_spinning': 0 } }, { extra: { unknown: '1' } },
  { enableProfiling: 'true' }, { graphOptimizationLevel: '__proto__' }
]) assert.throws(() => normalizeEg2SessionOptions(invalid));

class Tensor {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
}
let tokenCalls = 0;
let modelCalls = 0;
let ended = 0;
let disposed = 0;
let hold = null;
const inputsSeen = [];
const tokenizer = async (texts, request) => {
  tokenCalls += 1;
  assert.equal(request.return_tensor, false);
  assert.equal(request.padding, false);
  assert.equal(request.max_length, 8192);
  const input_ids = texts.map((text) => [101, ...Array.from(text, (char) => char.codePointAt(0)), 102]);
  return { input_ids, attention_mask: input_ids.map((row) => row.map(() => 1)), token_type_ids: input_ids.map((row) => row.map(() => 0)) };
};
tokenizer.pad_token_id = 99;
tokenizer.padding_side = 'right';
const model = async (inputs) => {
  modelCalls += 1;
  inputsSeen.push(inputs);
  if (hold) await hold;
  const [count, length] = inputs.input_ids.dims;
  const data = new Float32Array(count * 768);
  for (let index = 0; index < count; index += 1) {
    const row = inputs.input_ids.data.subarray(index * length, (index + 1) * length);
    const mask = inputs.attention_mask.data.subarray(index * length, (index + 1) * length);
    const values = row.filter((_, offset) => mask[offset] === 1n);
    data[index * 768] = Number(values[1]);
    data[index * 768 + 1] = 1;
  }
  return { sentence_embedding: { dims: [count, 768], data } };
};
model.sessions = { model: { endProfiling: async () => { ended += 1; } } };
model.dispose = async () => { disposed += 1; };
const profile = { dimensions: 768, maxLength: 8192 };
const encoder = createPreparedTextEncoder({ tokenizer, model, Tensor, profile, sessionOptions: options });
const prepared = await encoder.prepare(['a', 'zzzz', 'é😀']);
assert.deepEqual(prepared.map((item) => item.tokenLength), [3, 6, 4], 'actual special-token inclusive lengths');
assert.ok(prepared.every(Object.isFrozen));
const selected = [prepared[1], prepared[0]];
const vectors = await encoder.embedPrepared(selected);
assert.equal(tokenCalls, 1, 'subset assembly must not re-tokenize');
assert.equal(vectors.length, 2);
assert.ok(vectors[0][0] > vectors[1][0], 'vectors follow selected item order');
assert.deepEqual(Array.from(inputsSeen[0].input_ids.data), [101n,122n,122n,122n,122n,102n,101n,97n,102n,99n,99n,99n]);
assert.deepEqual(Array.from(inputsSeen[0].attention_mask.data), [1n,1n,1n,1n,1n,1n,1n,1n,1n,0n,0n,0n]);
assert.deepEqual(inputsSeen[0].input_ids.dims, [2, 6]);
tokenizer.padding_side = 'left';
const left = await encoder.embedPrepared([prepared[0], prepared[1]]);
assert.deepEqual(Array.from(inputsSeen[1].input_ids.data).slice(0,6), [99n,99n,99n,101n,97n,102n]);
assert.deepEqual(Array.from(left[0]), Array.from(vectors[1]), 'padding side preserves projected result mapping');
assert.equal(tokenCalls, 1);
await assert.rejects(() => encoder.embedPrepared([{ tokenLength: 3 }]), /different encoder/);
await assert.rejects(() => encoder.embedPrepared(Array(65).fill(prepared[0])), /at most 64/);
await assert.rejects(() => encoder.prepare(Array(1025).fill('x')), /at most 1024/);
assert.deepEqual(await encoder.prepare([]), []);
assert.deepEqual(await encoder.embedPrepared([]), []);
const other = createPreparedTextEncoder({ tokenizer, model, Tensor, profile, sessionOptions: {} });
await assert.rejects(() => other.embedPrepared([prepared[0]]), /different encoder/);
let release;
hold = new Promise((resolve) => { release = resolve; });
const inFlight = encoder.embedPrepared([prepared[0]]);
await assert.rejects(() => encoder.embedPrepared([prepared[0]]), /one inference/);
await assert.rejects(() => encoder.dispose(), /inference is active/);
await assert.rejects(() => encoder.endProfiling(), /inference is active/);
release();
await inFlight;
hold = null;
const info = encoder.executionInfo();
assert.equal(info.effectiveNativeThreads, null);
assert.equal(info.device, 'cpu');
assert.deepEqual(info.sessions, ['model']);
assert.equal(info.metrics.preparationCalls, 1);
assert.equal(info.metrics.inferenceCalls, 3);
assert.equal(info.lastBatch.usefulTokens, 3);
assert.equal(info.lastBatch.paddedTokens, 3);
assert.equal(info.maxConcurrentInference, 1);
assert.ok(info.metrics.inferenceMs >= 0 && info.metrics.outputMs >= 0);
info.requestedSessionOptions.extra['session.intra_op.allow_spinning'] = '1';
assert.equal(encoder.executionInfo().requestedSessionOptions.extra['session.intra_op.allow_spinning'], '0');
assert.equal((await encoder.endProfiling()).sessions[0].status, 'ended');
assert.equal((await encoder.endProfiling()).alreadyEnded, true);
assert.equal(ended, 1);
await assert.rejects(() => encoder.embedPrepared([prepared[0]]), /session has ended/);
await encoder.dispose();
await encoder.dispose();
assert.equal(disposed, 1);
await assert.rejects(() => encoder.prepare(['x']), /disposed/);

let failedDisposals = 0;
const brokenModel = Object.assign(async () => {}, {
  dispose: async () => { failedDisposals += 1; throw new Error('uncertain native disposal'); }
});
const broken = createPreparedTextEncoder({ tokenizer, model: brokenModel, Tensor, profile, sessionOptions: {} });
await assert.rejects(() => broken.dispose(), /uncertain native disposal/);
await assert.rejects(() => broken.dispose(), /uncertain native disposal/);
await assert.rejects(() => broken.prepare(['x']), /disposed/);
assert.equal(failedDisposals, 1, 'uncertain disposal must not be retried automatically');

const loads = [];
__setTransformersModuleLoaderForTests(async () => ({
  Tensor, env: { version: '4.3.1' }, EmbeddingGemma2Model: class {},
  AutoConfig: { from_pretrained: async () => ({ model_type: 'embedding_gemma2' }) },
  AutoTokenizer: { from_pretrained: async () => tokenizer },
  AutoModel: { from_pretrained: async (_, request) => { loads.push(request); return model; } }
}));
try {
  const config = { modelId: 'onnx-community/embeddinggemma-2-ONNX', provider: 'xenova', sessionOptions: options };
  const adapter = getEmbeddingAdapter(config);
  const unloaded = adapter.executionInfo();
  assert.equal(typeof unloaded.then, 'undefined', 'executionInfo must be synchronous');
  assert.equal(unloaded.loaded, false);
  assert.deepEqual(unloaded.sessions, []);
  assert.equal(unloaded.requestedSessionOptions.intraOpNumThreads, 6);
  assert.equal(loads.length, 0, 'telemetry must not trigger model loading');
  assert.equal(adapter, getEmbeddingAdapter({ ...config, sessionOptions: { ...options } }));
  const items = await adapter.prepare(['a']);
  assert.equal((await adapter.embedPrepared(items))[0].length, 768);
  assert.deepEqual(loads[0].session_options, options);
  assert.equal(loads[0].device, 'cpu');
  assert.equal(adapter.executionInfo().loaded, true);
  assert.deepEqual(adapter.executionInfo().sessions, ['model']);
  await getEmbeddingAdapter({ ...config, sessionOptions: { intraOpNumThreads: 7 } }).prepare(['b']);
  assert.equal(loads.length, 2, 'session options segregate both adapter and loaded model caches');
  assert.equal(adapter.executionInfo().requestedSessionOptions.intraOpNumThreads, 6);
  assert.equal(adapter.supportsParallelDispatch, false);
  await adapter.dispose();
  const reloaded = getEmbeddingAdapter(config);
  assert.notEqual(reloaded, adapter);
  await reloaded.prepare(['c']);
  assert.equal(loads.length, 3, 'explicit disposal evicts loaded session cache without automatic unload');
  const customGraph = getEmbeddingAdapter({ ...config, modelFileName: 'model_w8a8' });
  assert.notEqual(customGraph, reloaded);
  await customGraph.prepare(['d']);
  assert.equal(loads.length, 4, 'different graph basename segregates loaded session cache');
  assert.equal(loads.at(-1).model_file_name, 'model_w8a8');
  assert.equal(customGraph.executionInfo().modelFileName, 'model_w8a8');
  for (const modelFileName of ['../model', 'model.onnx', 'a/b', '', 1]) {
    assert.throws(() => getEmbeddingAdapter({ ...config, modelFileName }), /basename/);
  }
  assert.throws(() => getEmbeddingAdapter({ modelId: 'legacy', modelFileName: 'model_w8a8' }), /qualified EG2/);
} finally {
  __setTransformersModuleLoaderForTests(null);
}
assert.ok(modelCalls > 0);
console.log('Prepared EG2 token assembly, CPU options, telemetry and explicit lifecycle passed (mocked model only).');
