#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { Tensor } from 'onnxruntime-common';
import { createOnnxEmbedder, __resetOnnxSessionCacheForTests } from '../../../src/shared/onnx-embeddings.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('onnx-feed-session-ownership');
const records = [];
let creates = 0, active = 0, peak = 0, releases = 0, failNext = false;
const tokenizer = (texts) => ({
  input_ids: texts.map(text => Array.from({ length: text.length }, (_, i) => 101 + i)),
  attention_mask: texts.map(text => Array(text.length).fill(1)),
  token_type_ids: texts.map(text => Array(text.length).fill(0))
});
tokenizer.pad_token_id = 7;
globalThis.__onnxOwnershipFixture = {
  Tensor, env: {}, AutoTokenizer: { from_pretrained: async () => tokenizer },
  InferenceSession: { create: async (filename) => {
    creates += 1;
    const inputNames = filename.includes('two') ? ['input_ids', 'attention_mask']
      : ['input_ids', 'attention_mask', 'token_type_ids'];
    return { inputNames, release: async () => { releases += 1; }, run: async (feeds) => {
      active += 1; peak = Math.max(peak, active);
      const values = Object.fromEntries(Object.entries(feeds).map(([name, tensor]) => [name, Array.from(tensor.data, Number)]));
      assert.equal(new Set(Object.values(feeds).map(tensor => tensor.data.buffer)).size, inputNames.length);
      records.push({ values, dims: feeds.input_ids.dims });
      await new Promise(resolve => setTimeout(resolve, 2));
      // The storage remains unchanged while the native run owns its feeds.
      for (const name of inputNames) assert.deepEqual(Array.from(feeds[name].data, Number), values[name]);
      active -= 1;
      if (failNext) { failNext = false; throw new Error('controlled inference rejection'); }
      return { sentence_embedding: new Tensor('float32', new Float32Array(feeds.input_ids.dims[0] * 2).fill(1), [feeds.input_ids.dims[0], 2]) };
    } };
  } }
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['onnxruntime-node', '@huggingface/transformers'].includes(specifier)) return { url: `ownership:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('ownership:')) return { format: 'module', shortCircuit: true,
      source: 'export const { Tensor, env, AutoTokenizer, InferenceSession } = globalThis.__onnxOwnershipFixture;' };
    return next(url, context);
  }
});
const adapters = [];
try {
  for (const kind of ['two', 'three']) {
    const modelPath = path.join(dir, `${kind}.onnx`);
    await fs.writeFile(modelPath, 'controlled model; no native inference');
    const modelId = `fixture-${kind}`;
    await fs.mkdir(path.join(dir, modelId));
    await fs.writeFile(path.join(dir, modelId, 'tokenizer.json'), '{}');
    const options = { rootDir: dir, modelsDir: dir, modelId, onnxConfig: { modelPath }, normalize: false };
    const a = createOnnxEmbedder(options), b = createOnnxEmbedder({ ...options, normalize: true });
    adapters.push(a, b);
    const start = records.length;
    await a.getEmbeddings(['abc', 'x']);
    assert.deepEqual(records[start].values.input_ids, [101, 102, 103, 101, 7, 7]);
    assert.deepEqual(records[start].values.attention_mask, [1, 1, 1, 1, 0, 0]);
    if (kind === 'three') assert.deepEqual(records[start].values.token_type_ids, [0, 0, 0, 0, 0, 0]);
    await a.getEmbeddings(['abcdefgh']);
    await a.getEmbeddings(['x']);
    assert.deepEqual(records.at(-1).values.input_ids, [101]);
    await Promise.all([a.getEmbeddings(['abc']), b.prewarm({ model: true, texts: ['xy'] })]);
    assert.equal(peak, 1, 'different adapters must serialize one shared native session');
    failNext = true;
    await assert.rejects(a.getEmbeddings(['abc']), /controlled inference rejection/);
    await b.getEmbeddings(['abc']);
    __resetOnnxSessionCacheForTests();
    const releasedBefore = releases;
    const pending = a.getEmbeddings(['abcd']);
    await a.dispose();
    await pending;
    assert.equal(releases, releasedBefore, 'retired shared session remains owned by the second adapter');
    await assert.rejects(a.getEmbeddings(['x']), /disposed/);
    await b.getEmbeddings(['x']);
    await b.dispose();
    assert.equal(releases, releasedBefore + 1);
  }
  assert.equal(creates, 2);
  assert.equal(active, 0);
  assert.equal(releases, creates);
} finally {
  await Promise.allSettled(adapters.map(adapter => adapter.dispose()));
  hooks.deregister();
  delete globalThis.__onnxOwnershipFixture;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Production ONNX feeds, shared-session inference/prewarm, rejection recovery and ownership release pass.');
