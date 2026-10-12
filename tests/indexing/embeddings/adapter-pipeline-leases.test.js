#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEmbeddingAdapter, __setTransformersModuleLoaderForTests,
  __resetEmbeddingAdapterCachesForTests } from '../../../src/shared/embedding-adapter.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('adapter-pipeline-leases');
const modelId = 'fixture/model';
const root = path.join(dir, modelId);
await fs.mkdir(path.join(root, 'onnx'), { recursive: true });
await fs.writeFile(path.join(root, 'onnx/model_quantized.onnx'), 'controlled local weights');
await fs.writeFile(path.join(root, 'tokenizer.json'), '{}');
let creates = 0, releases = 0, entered;
let mutateNext = false;
let releaseRun;
const running = new Promise(resolve => { entered = resolve; });
const held = new Promise(resolve => { releaseRun = resolve; });
__setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => {
  creates++;
  if (mutateNext) {
    mutateNext = false;
    await fs.writeFile(path.join(root, 'tokenizer.json'), '{"changed":"during initialization"}');
  }
  let disposed = false;
  const pipeline = async (texts) => {
    assert.equal(disposed, false, 'a released sibling cannot dispose an owned pipeline');
    if (texts.includes('held')) { entered(); await held; }
    assert.equal(disposed, false, 'pipeline storage is owned until in-flight work settles');
    return texts.map(() => new Float32Array([1, 2]));
  };
  pipeline.dispose = async () => { assert.equal(disposed, false); disposed = true; releases++; };
  return pipeline;
} }));
const adapters = [];
try {
  const options = { provider: 'xenova', modelId, modelsDir: dir };
  const a = getEmbeddingAdapter({ ...options, normalize: false });
  const b = getEmbeddingAdapter({ ...options, normalize: true });
  adapters.push(a, b);
  await Promise.all([a.embed(['alpha']), b.embed(['beta'])]);
  assert.equal(creates, 1, 'normalization adapters share a reference-counted pipeline');
  const pending = a.embed(['held']);
  await running;
  const disposing = a.dispose();
  await b.embed(['still owned']);
  assert.equal(releases, 0);
  __resetEmbeddingAdapterCachesForTests();
  releaseRun(); await pending; await disposing;
  assert.equal(releases, 0, 'cache retirement preserves the second pipeline lease');
  await assert.rejects(a.embed(['closed']), /disposed/);
  await b.embed(['after retirement']);
  await b.dispose();
  assert.equal(releases, 1);
  const c = getEmbeddingAdapter(options);
  adapters.push(c);
  await c.embed(['fresh']);
  assert.equal(creates, 2, 'the disposed pipeline is never returned by the cache');
  await c.dispose();
  assert.equal(releases, 2);
  mutateNext = true;
  const changed = getEmbeddingAdapter(options);
  adapters.push(changed);
  await assert.rejects(changed.embed(['artifact changed']), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  assert.equal(releases, 3, 'post-load identity rejection releases the newly acquired raw pipeline');
} finally {
  releaseRun();
  await Promise.allSettled(adapters.map(adapter => adapter.dispose()));
  __setTransformersModuleLoaderForTests(null);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Adapter and shared pipeline leases drain active work and retire without stale reuse.');
