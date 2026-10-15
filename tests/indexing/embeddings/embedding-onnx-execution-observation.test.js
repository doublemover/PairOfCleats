#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const key = Symbol.for('pairofcleats.tests.onnx-execution-observation');
const onnxUrl = new URL('../../../src/shared/onnx-embeddings.js', import.meta.url).href;
const configUrl = new URL('../../../src/shared/onnx-embeddings/config.js', import.meta.url).href;
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url === onnxUrl) return {
      format: 'module', shortCircuit: true,
      source: `export { normalizeEmbeddingProvider, normalizeOnnxConfig } from ${JSON.stringify(configUrl)};
export const createOnnxEmbedder = (options) => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](options);`
    };
    return nextLoad(url, context);
  }
});
const { createEmbedder } = await import('../../../src/index/embedding.js');
const { __setTransformersModuleLoaderForTests, __resetEmbeddingAdapterCachesForTests } = await import('../../../src/shared/embedding-adapter.js');
const options = {
  modelId: 'mock-onnx', provider: 'onnx', dims: 384,
  onnx: { executionProviders: ['cuda', 'cpu'], intraOpNumThreads: 9 }
};
const createMockOnnx = (load, vectors = [Float32Array.from([1, 2, 3])]) => ({
  embedderPromise: load.promise,
  getEmbeddings: async () => { await load.promise; return vectors; },
  getEmbedding: async () => { await load.promise; return vectors[0]; },
  estimateTokens: async () => { await load.promise; return [3]; },
  prewarm: async () => { await load.promise; },
  executionInfo: () => ({ provider: 'onnx', modelArtifact: null, effectiveSessionOptions: null,
    effectiveNativeThreads: null, device: null, maxConcurrentInference: 1 })
});
try {
  const load = deferred();
  globalThis[key] = () => createMockOnnx(load);
  const embedder = createEmbedder(options);
  assert.equal(embedder.executionInfo().loaded, false);
  assert.equal(embedder.executionInfo().loading, true);
  assert.equal(embedder.executionInfo().observedDims, null);
  assert.equal(embedder.executionInfo().requestedOnnxConfig.intraOpNumThreads, 9);
  assert.equal(embedder.executionInfo().requestedSessionOptions.intraOpNumThreads, 9);
  assert.equal(embedder.executionInfo().effectiveNativeThreads, null);
  const result = embedder.getChunkEmbeddings(['alpha']);
  load.resolve({ session: {} });
  await result;
  assert.equal(embedder.executionInfo().loaded, true);
  assert.equal(embedder.executionInfo().observedDims, 3);
  assert.equal(embedder.executionInfo().provider, 'onnx');
  assert.equal(embedder.executionInfo().device, null, 'requested CUDA is not an observed device');
  assert.equal(embedder.executionInfo().executionProviders, null);
  assert.equal(embedder.executionInfo().effectiveSessionOptions, null);

  __resetEmbeddingAdapterCachesForTests();
  const nativeLoad = deferred();
  const xenovaLoad = deferred();
  const xenovaRequested = deferred();
  globalThis[key] = () => createMockOnnx(nativeLoad);
  __setTransformersModuleLoaderForTests(async () => ({
    env: {}, pipeline: () => { xenovaRequested.resolve(); return xenovaLoad.promise; }
  }));
  const fallback = createEmbedder(options);
  const fallbackResult = fallback.getChunkEmbedding('alpha');
  nativeLoad.reject(Object.assign(new Error('mock native load failed'), { code: 'ERR_DLOPEN_FAILED' }));
  await xenovaRequested.promise;
  const pendingFallback = fallback.executionInfo();
  assert.equal(pendingFallback.requestedProvider, 'onnx');
  assert.equal(pendingFallback.requestedOnnxConfig.intraOpNumThreads, 9);
  assert.equal(pendingFallback.provider, 'xenova');
  assert.equal(fallback.getActiveProvider(), 'xenova');
  assert.equal(pendingFallback.loaded, false);
  assert.equal(pendingFallback.loading, true);
  assert.equal(pendingFallback.inferenceSucceeded, false);
  assert.deepEqual(pendingFallback.fallback, {
    from: 'onnx', to: 'xenova', reason: 'native-load-failed', code: 'ERR_DLOPEN_FAILED'
  });
  xenovaLoad.resolve(async (texts) => texts.map(() => Float32Array.from([1, 2, 3, 4, 5])));
  assert.equal((await fallbackResult).length, 5);
  assert.equal(fallback.executionInfo().loaded, true);
  assert.equal(fallback.executionInfo().observedDims, 5);
  assert.equal(fallback.executionInfo().device, null);
  assert.equal((await fallback.getChunkEmbeddings(['beta']))[0].length, 5);
  assert.equal(fallback.executionInfo().provider, 'xenova');

  __resetEmbeddingAdapterCachesForTests();
  const failure = deferred();
  globalThis[key] = () => createMockOnnx(failure);
  const failed = createEmbedder(options);
  const rejected = assert.rejects(failed.getChunkEmbedding('alpha'), /missing mock model artifact/);
  failure.reject(new Error('missing mock model artifact'));
  await rejected;
  assert.equal(failed.executionInfo().loaded, false);
  assert.equal(failed.executionInfo().loading, false);
  assert.equal(failed.executionInfo().fallback, null, 'ordinary model errors must not change providers');
  assert.equal(failed.executionInfo().inferenceSucceeded, false);
  assert.equal(failed.executionInfo().observedDims, null);
} finally {
  hook.deregister();
  delete globalThis[key];
  __setTransformersModuleLoaderForTests(null);
}
console.log('ONNX session acknowledgement and native-load fallback observations passed (mock only)');
