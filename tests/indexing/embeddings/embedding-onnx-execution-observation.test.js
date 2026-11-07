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
  modelId: 'mock-onnx', provider: 'onnx', dims: 3,
  onnx: { executionProviders: ['cuda', 'cpu'], intraOpNumThreads: 9 }
};
const createMockOnnx = (load, vectors = [Float32Array.from([1, 2, 3])]) => ({
  embedderPromise: load.promise,
  getEmbeddings: async () => { await load.promise; return vectors; },
  getEmbedding: async () => { await load.promise; return vectors[0]; },
  estimateTokens: async () => { await load.promise; return [3]; },
  prewarm: async () => { await load.promise; },
  dispose: async () => { await load.promise.catch(() => {}); },
  executionInfo: () => ({ provider: 'onnx', modelArtifact: null, effectiveSessionOptions: null,
    effectiveNativeThreads: null, device: null, maxConcurrentInference: 1 })
});
const warning = console.warn, warnings = [];
console.warn = (...args) => warnings.push(args.join(' '));
try {
  const load = deferred();
  const nativeRequested = deferred();
  globalThis[key] = () => { nativeRequested.resolve(); return createMockOnnx(load); };
  const embedder = createEmbedder(options);
  assert.equal(embedder.executionInfo().loaded, false);
  assert.equal(embedder.executionInfo().loading, false, 'native acquisition is deferred until an operation');
  assert.equal(embedder.executionInfo().observedDims, null);
  assert.equal(embedder.executionInfo().requestedOnnxConfig.intraOpNumThreads, 9);
  assert.equal(embedder.executionInfo().requestedSessionOptions.intraOpNumThreads, 9);
  assert.equal(embedder.executionInfo().effectiveNativeThreads, null);
  const result = embedder.getChunkEmbeddings(['alpha']);
  await nativeRequested.promise;
  assert.equal(embedder.executionInfo().loading, true);
  load.resolve({ session: {} });
  await result;
  assert.equal(embedder.executionInfo().loaded, true);
  assert.equal(embedder.executionInfo().observedDims, 3);
  assert.equal(embedder.executionInfo().provider, 'onnx');
  assert.equal(embedder.executionInfo().device, null, 'requested CUDA is not an observed device');
  assert.equal(embedder.executionInfo().executionProviders, null);
  assert.equal(embedder.executionInfo().effectiveSessionOptions, null);
  await embedder.dispose();

  __resetEmbeddingAdapterCachesForTests();
  const nativeLoad = deferred();
  const fallbackRequested = deferred();
  const xenovaLoad = deferred();
  const xenovaRequested = deferred();
  globalThis[key] = () => { fallbackRequested.resolve(); return createMockOnnx(nativeLoad); };
  __setTransformersModuleLoaderForTests(async () => ({
    env: {}, pipeline: () => { xenovaRequested.resolve(); return xenovaLoad.promise; }
  }));
  const fallback = createEmbedder({ ...options, dims: 5 });
  const fallbackResult = fallback.getChunkEmbedding('alpha');
  await fallbackRequested.promise;
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
  assert.equal(warnings.length, 1, 'only the expected native-load fallback emits a warning');
  assert.match(warnings[0], /ERR_DLOPEN_FAILED.*falling back to xenova/);
  await fallback.dispose();

  __resetEmbeddingAdapterCachesForTests();
  const failure = deferred();
  const failureRequested = deferred();
  globalThis[key] = () => { failureRequested.resolve(); return createMockOnnx(failure); };
  const failed = createEmbedder(options);
  const rejected = assert.rejects(failed.getChunkEmbedding('alpha'), /missing mock model artifact/);
  await failureRequested.promise;
  failure.reject(new Error('missing mock model artifact'));
  await rejected;
  assert.equal(failed.executionInfo().loaded, false);
  assert.equal(failed.executionInfo().loading, false);
  assert.equal(failed.executionInfo().fallback, null, 'ordinary model errors must not change providers');
  assert.equal(failed.executionInfo().inferenceSucceeded, false);
  assert.equal(failed.executionInfo().observedDims, null);
  assert.equal(warnings.length, 1, 'an ordinary model error does not emit a fallback warning');
  await failed.dispose();
} finally {
  console.warn = warning;
  hook.deregister();
  delete globalThis[key];
  __setTransformersModuleLoaderForTests(null);
}
console.log('ONNX session acknowledgement and native-load fallback observations passed (mock only)');
