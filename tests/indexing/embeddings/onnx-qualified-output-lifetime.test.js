import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createOnnxEmbedder } from '../../../src/shared/onnx-embeddings.js';
import { observeEmbeddingOwnership } from '../../../src/shared/embedding-cache-lifetime.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Actual deferred ONNX adapter/session queue with inert runtime dependencies.
const { dir } = await prepareIsolatedTestCacheDir('onnx-qualified-output-lifetime');
const modelId = 'Xenova/bge-m3', adapters = [], controls = [], tokenOptions = [];
const cleanup = Object.freeze(new Error('controlled ONNX output disposal failure'));
let nextControl;
class Tensor {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims, closes: 0, failClose: false }); }
  dispose() {
    this.closes++;
    if (this.failClose) { this.failClose = false; throw cleanup; }
    this.data.fill(this.data instanceof BigInt64Array ? 99n : 99);
  }
}
const tokenizer = Object.assign((texts, options) => {
  tokenOptions.push(options);
  return { input_ids: texts.map(() => [1, 2]), attention_mask: texts.map(() => [1, 1]) };
}, { dispose() {} });
globalThis.__onnxQualifiedLifetimeFixture = { Tensor, env: {},
  AutoTokenizer: { from_pretrained: async () => tokenizer },
  InferenceSession: { create: async () => {
    const control = nextControl;
    const session = { inputNames: ['input_ids', 'attention_mask'], outputNames: ['last_hidden_state', 'pooler_output'],
      outputMetadata: [
        { name: 'last_hidden_state', isTensor: true, type: 'float32', shape: ['batch', 'sequence', 1024] },
        { name: 'pooler_output', isTensor: true, type: 'float32', shape: ['batch', 1024] }
      ], release() { control.sessionCloses++; },
      run: async (feeds, fetches) => {
        assert.deepEqual(fetches, ['last_hidden_state']);
        control.runs++; control.feeds.push(...Object.values(feeds));
        if (control.nativeError) throw control.nativeError;
        const count = feeds.input_ids.dims[0], rows = control.mode === 'extra-row' ? count + 1 : count;
        const data = new Float32Array(rows * 2 * 1024);
        for (let row = 0; row < rows; row++) { data[row * 2048] = 3; data[row * 2048 + 1] = 4; data[row * 2048 + 1024] = 99; }
        if (control.mode === 'nonfinite') data[0] = NaN;
        if (control.mode === 'zero') data.fill(0);
        const output = new Tensor('float32', data, [rows, 2, 1024]);
        output.failClose = control.mode === 'cleanup'; control.outputs.push(output);
        if (control.mode === 'short') output.dims = [rows, 3, 1024];
        return control.mode === 'missing' ? { unrelated: output } : { last_hidden_state: output };
      } };
    return session;
  } }
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['onnxruntime-node', '@huggingface/transformers'].includes(specifier)) return { url: `qualified-lifetime:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('qualified-lifetime:')) return { format: 'module', shortCircuit: true,
      source: 'export const { Tensor, env, AutoTokenizer, InferenceSession } = globalThis.__onnxQualifiedLifetimeFixture;' };
    return next(url, context);
  }
});
const create = async mode => {
  const control = { mode, runs: 0, sessionCloses: 0, outputs: [], feeds: [] };
  controls.push(control); nextControl = control;
  const modelPath = path.join(dir, `model-${controls.length}.onnx`);
  await fs.writeFile(modelPath, 'inert graph bytes, no native inference');
  const adapter = createOnnxEmbedder({ modelId, modelsDir: dir, rootDir: dir, onnxConfig: { modelPath } });
  adapters.push(adapter); await adapter.embedderPromise;
  return { adapter, control };
};
try {
  await fs.mkdir(path.join(dir, modelId), { recursive: true });
  await fs.writeFile(path.join(dir, modelId, 'tokenizer.json'), '{}');
  const { adapter, control } = await create('valid');
  const vectors = await adapter.getEmbeddings(['first', 'second']);
  assert(Math.abs(vectors[0][0] - 0.6) < 1e-6); assert(Math.abs(vectors[0][1] - 0.8) < 1e-6);
  assert.equal(control.outputs[0].closes, 1); assert.deepEqual(control.feeds.map(value => value.closes), [1, 1]);
  assert.equal(control.outputs[0].data[0], 99); assert.notEqual(vectors[0][0], 99);
  const observed = adapter.executionInfo().measurements;
  assert.equal(observed.tensorResourcesObserved, 3); assert.equal(observed.tensorResourcesSettled, 3);
  assert.equal(observed.retainedTensorScopes, 0); assert.equal(observed.peakRetainedTensorScopes, 1);
  assert(observed.tensorCleanupWallMs >= 0);
  assert.equal(observed.tensorCleanupEvidence, 'captured-disposal-settlement; native-memory-freeing-unobserved');
  assert.equal(tokenOptions[0].max_length, 8192);
  await adapter.prewarm({ model: true, texts: ['warm'] });
  assert(control.outputs.every(value => value.closes === 1), 'prewarm outputs are disposed too');
  await adapter.dispose(); assert.equal(control.sessionCloses, 1);

  for (const mode of ['extra-row', 'short', 'missing', 'nonfinite', 'zero']) {
    const { adapter: rejected, control: bad } = await create(mode);
    await assert.rejects(rejected.getEmbedding('invalid output'), { code: 'ERR_ONNX_EMBEDDING_OUTPUT' });
    assert(bad.outputs.every(value => value.closes === 1)); assert(bad.feeds.every(value => value.closes === 1));
    await rejected.dispose(); assert.equal(bad.sessionCloses, 1);
  }
  const { adapter: failed, control: pending } = await create('cleanup');
  const error = await failed.getEmbedding('failed disposal').then(() => assert.fail('expected disposal rejection'), value => value);
  assert.equal(observeEmbeddingOwnership(error)(), false);
  await assert.rejects(failed.getEmbedding('must not reuse pending session'), value => value === error);
  await assert.rejects(failed.dispose()); assert.equal(pending.sessionCloses, 0);
  pending.outputs[0].dispose = () => assert.fail('retry must retain captured disposal');
  await failed.dispose(); assert.equal(pending.sessionCloses, 1);
  assert.equal(pending.outputs[0].closes, 2); assert.equal(observeEmbeddingOwnership(error)(), true);

  const { adapter: active, control: native } = await create('valid');
  let settled = false;
  const nativeError = Object.freeze(Object.assign(new Error('controlled native work pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
  }));
  native.nativeError = nativeError;
  const nativeFailure = await active.getEmbedding('pending native run').then(() => assert.fail('expected rejection'), value => value);
  assert.equal(nativeFailure.cause, nativeError);
  assert(native.feeds.every(value => value.closes === 0), 'native work keeps its feed buffers alive');
  await assert.rejects(active.dispose()); assert.equal(native.sessionCloses, 0);
  settled = true;
  await active.dispose(); assert(native.feeds.every(value => value.closes === 1)); assert.equal(native.sessionCloses, 1);
  assert.equal(observeEmbeddingOwnership(nativeFailure)(), true);
} finally {
  for (const control of controls) if (control.nativeError) control.nativeError = null;
  await Promise.allSettled(adapters.map(adapter => adapter.dispose()));
  hooks.deregister(); delete globalThis.__onnxQualifiedLifetimeFixture;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual ONNX dense contract, malformed output, prewarm and native tensor lifetime assertions complete');
