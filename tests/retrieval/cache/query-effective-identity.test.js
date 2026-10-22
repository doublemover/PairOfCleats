#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';

applyTestEnv({ embeddings: 'on' });
const key = Symbol.for('poc.tests.query-effective-identity');
const onnxUrl = new URL('../../../src/shared/onnx-embeddings.js', import.meta.url).href;
const configUrl = new URL('../../../src/shared/onnx-embeddings/config.js', import.meta.url).href;
const hook = registerHooks({ load(url, context, nextLoad) {
  if (url === onnxUrl) return { format: 'module', shortCircuit: true,
    source: `export { normalizeEmbeddingProvider, normalizeOnnxConfig } from ${JSON.stringify(configUrl)};
export const createOnnxEmbedder = options => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](options);` };
  return nextLoad(url, context);
} });
const { createEmbeddingResolver } = await import('../../../src/retrieval/cli/run-search-session/embedding-cache.js');
const { getQueryEmbedding } = await import('../../../src/retrieval/embedding.js');
const { __setTransformersModuleLoaderForTests, disposeEmbeddingAdapterCaches } = await import('../../../src/shared/embedding-adapter.js');
const { dir } = await prepareIsolatedTestCacheDir('query-effective-identity');
const modelsDir = path.join(dir, 'models'), modelId = 'fixture';
await fs.mkdir(path.join(modelsDir, modelId, 'onnx'), { recursive: true });
await fs.writeFile(path.join(modelsDir, modelId, 'tokenizer.json'), '{"selected":"tokenizer"}');
await fs.writeFile(path.join(modelsDir, modelId, 'onnx/model.onnx'), 'fallback weights B');
const modelPath = path.join(dir, 'custom.onnx');
await fs.writeFile(modelPath, 'custom weights A');
const artifact = resolveEmbeddingArtifactIdentity({ provider: 'onnx', modelId, modelsDir, rootDir: dir, onnx: { modelPath } });
const expectedIdentity = buildEmbeddingIdentity({ provider: 'onnx', modelId, dims: 3, modelArtifact: artifact });
let calls = 0, fallbackCalls = 0, mode = 'fallback';
globalThis[key] = options => ({
  embedderPromise: Promise.resolve(), dispose: async () => {},
  async getEmbedding() {
    calls++;
    if (mode === 'fallback') throw Object.assign(new Error('controlled native failure'), { code: 'ERR_DLOPEN_FAILED' });
    return Float32Array.from([1, 2, 3]);
  },
  executionInfo: () => ({ provider: 'onnx', modelArtifact: mode === 'changed-artifact'
    ? { ...options.modelArtifact, digest: '0'.repeat(64) } : options.modelArtifact })
});
__setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => async texts => {
  fallbackCalls++;
  if (mode === 'failed-fallback') throw new Error('fallback failed');
  return texts.map(() => Float32Array.from([1, 2, 3]));
} }));
const makeResolver = text => createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: text,
  modelConfig: { dir: modelsDir }, embeddingProvider: 'onnx', embeddingOnnx: { modelPath }, rootDir: dir,
  generation: 'fixture-generation' });
const resolve = (text) => makeResolver(text)(modelId, 3, true, null, null, expectedIdentity);
const warnings = [];
const originalWarn = console.warn;
console.warn = message => warnings.push(String(message));
try {
  assert.deepEqual(await Promise.all([resolve('fallback'), resolve('fallback')]), [null, null],
    'same-width fallback vectors cannot enter the requested ONNX cache');
  const firstRuns = fallbackCalls;
  assert.equal(await resolve('fallback'), null);
  assert.equal(fallbackCalls, firstRuns + 1, 'a rejected effective identity is never cached as a query result');
  mode = 'failed-fallback';
  assert.equal(await resolve('fallback fails'), null);
  await disposeEmbeddingAdapterCaches();
  mode = 'changed-artifact';
  assert.equal(await resolve('changed weights or tokenizer'), null, 'same-provider changed artifact is also refused');
  await disposeEmbeddingAdapterCaches();
  mode = 'healthy';
  const before = calls;
  const value = await resolve('healthy');
  assert.deepEqual(value, Float32Array.from([1, 2, 3]));
  assert.deepEqual(await resolve('healthy'), value);
  assert.equal(calls, before + 1, 'verified unchanged-provider vectors remain reusable');
  for (const provider of ['ONNXRuntime', 'transformers', undefined]) {
    assert.deepEqual(await getQueryEmbedding({ text: `provider ${provider}`, modelId, dims: 3,
      modelDir: modelsDir, rootDir: dir, provider, onnxConfig: { modelPath } }), Float32Array.from([1, 2, 3]),
    'provider aliases and omitted default provider preserve successful inference');
  }
  assert.equal(warnings.length, 4, 'only the four exercised refusal/fallback diagnostics are expected');
  for (const pattern of [/onnxruntime-node failed to load.*falling back/i, /provider changed from onnx to xenova/i,
    /skipping ANN\. fallback failed/, /artifact identity is unknown or changed/i]) {
    assert.ok(warnings.some(message => pattern.test(message)), `missing expected diagnostic ${pattern}`);
  }
} finally {
  console.warn = originalWarn;
  await disposeEmbeddingAdapterCaches();
  __setTransformersModuleLoaderForTests(null);
  hook.deregister(); delete globalThis[key];
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Query vectors bind to observed provider and artifact before cache reuse.');
