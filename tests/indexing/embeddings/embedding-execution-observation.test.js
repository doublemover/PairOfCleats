#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createEmbedder } from '../../../src/index/embedding.js';
import {
  __setTransformersModuleLoaderForTests,
  __setAdapterFactoryForTests
} from '../../../src/shared/embedding-adapter.js';
import { createXenovaAdapter } from '../../../src/shared/embedding-provider-adapters.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const options = { modelId: 'mock-known-dimensions', provider: 'xenova', dims: 3 };
let loads = 0;
const load = deferred();
const requested = deferred();
__setTransformersModuleLoaderForTests(async () => ({
  env: {},
  pipeline: () => { loads += 1; requested.resolve(); return load.promise; }
}));
try {
  const embedder = createEmbedder(options);
  assert.equal(loads, 0, 'constructing a known-dimension wrapper must not load a model');
  const pending = embedder.executionInfo();
  assert.equal(typeof pending.then, 'undefined', 'execution observations are synchronous');
  assert.equal(pending.loaded, false);
  assert.equal(pending.loading, false);
  assert.equal(pending.observedDims, null, 'configured dimensions are not observed dimensions');
  assert.equal(pending.inferenceSucceeded, false);
  assert.equal(pending.device, null);
  assert.equal(pending.effectiveNativeThreads, null);
  assert.deepEqual(await embedder.getChunkEmbeddings([]), []);
  assert.equal(loads, 0, 'an empty batch must not trigger model loading');
  const result = embedder.getChunkEmbeddings(['alpha']);
  await requested.promise;
  assert.equal(embedder.executionInfo().loaded, false);
  assert.equal(embedder.executionInfo().loading, true);
  assert.equal(embedder.executionInfo().inferenceSucceeded, false);
  load.resolve(async (texts) => texts.map(() => Float32Array.from([1, 2, 3])));
  assert.equal((await result)[0].length, 3);
  const ready = embedder.executionInfo();
  assert.equal(ready.loaded, true);
  assert.equal(ready.loading, false);
  assert.equal(ready.observedDims, 3, 'observe actual vectors rather than configured dimensions');
  assert.equal(ready.inferenceSucceeded, true);
  assert.equal(ready.device, null, 'ordinary Xenova does not acknowledge a native device');
  assert.equal(ready.modelArtifact.status, 'unknown');
  assert.equal(ready.modelArtifact.reuse, 'refuse');
  assert.equal(ready.effectiveSessionOptions, null);
  const cached = createEmbedder(options);
  assert.equal(cached.executionInfo().loaded, false, 'unknown artifact provenance cannot reuse a loaded adapter across attempts');
  assert.equal(cached.executionInfo().modelArtifact, null, 'a lazy wrapper has not acquired artifact authority');
  assert.equal(cached.executionInfo().observedDims, null, 'a fresh attempt has no fresh vector evidence');
  assert.equal(cached.executionInfo().inferenceSucceeded, false);
  assert.equal(loads, 1);
  await cached.getChunkEmbedding('beta');
  assert.equal(loads, 2, 'unknown artifact provenance requires a fresh actual load');
  assert.notEqual(cached.executionInfo().modelArtifact.attempt, ready.modelArtifact.attempt);
  await Promise.all([embedder.dispose(), cached.dispose()]);
} finally {
  __setTransformersModuleLoaderForTests(null);
}

const failedLoad = deferred();
const failedRequested = deferred();
__setTransformersModuleLoaderForTests(async () => ({
  env: {}, pipeline: () => { failedRequested.resolve(); return failedLoad.promise; }
}));
try {
  const embedder = createEmbedder(options);
  const failure = assert.rejects(embedder.getChunkEmbedding('alpha'), /mock load failed/);
  await failedRequested.promise;
  assert.equal(embedder.executionInfo().loading, true);
  assert.equal(embedder.executionInfo().loaded, false);
  failedLoad.reject(new Error('mock load failed'));
  await failure;
  assert.equal(embedder.executionInfo().loaded, false);
  assert.equal(embedder.executionInfo().loading, false);
  assert.equal(embedder.executionInfo().inferenceSucceeded, false);
  assert.equal(embedder.executionInfo().observedDims, null);
} finally {
  __setTransformersModuleLoaderForTests(null);
}

__setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => async () => [[]] }));
try {
  const empty = createEmbedder(options);
  await assert.rejects(empty.getChunkEmbedding('alpha'), { code: 'ERR_EMBEDDING_OUTPUT' },
    'an empty provider row is rejected without manufacturing vector evidence');
  assert.equal(empty.executionInfo().loaded, true, 'load acknowledgement is distinct from inference output');
  assert.equal(empty.executionInfo().inferenceSucceeded, false);
  assert.equal(empty.executionInfo().observedDims, null);
} finally {
  __setTransformersModuleLoaderForTests(null);
}

const stub = createEmbedder({ ...options, useStubEmbeddings: true, dims: 5 });
assert.equal(stub.executionInfo().stub, true);
assert.equal(stub.executionInfo().loaded, false, 'stub execution never claims a real model load');
assert.equal(stub.executionInfo().observedDims, null);
assert.equal((await stub.getChunkEmbedding('alpha')).length, 5);
assert.equal(stub.executionInfo().observedDims, 5);
assert.equal(stub.executionInfo().inferenceSucceeded, true);
assert.equal(stub.executionInfo().loaded, false);

let getterReads = 0;
__setAdapterFactoryForTests(() => ({
  provider: 'xenova', embed: async () => [], embedOne: async () => [],
  get embedderPromise() { getterReads += 1; return Promise.resolve('acknowledged'); }
}));
try {
  const unsupported = createEmbedder(options);
  assert.equal(unsupported.executionInfo().loaded, false, 'a deferred lease has not acquired its adapter');
  assert.equal(getterReads, 0, 'executionInfo never accesses the loading getter');
  assert.equal(await unsupported.embedderPromise, 'acknowledged', 'explicit preload remains supported');
  assert.equal(getterReads, 1);
  assert.equal(unsupported.executionInfo().loaded, null, 'an acquired adapter without an observation remains unknown');
} finally {
  __setAdapterFactoryForTests(null);
}

const profile = createXenovaAdapter({
  modelId: 'mock-profile', modelProfile: { maxLength: 8192 }, sessionOptions: { intraOpNumThreads: 6 },
  modelFileName: 'model_w8a8', loadPipeline: async () => Object.assign(async () => [], {
    executionInfo: () => ({ device: 'cpu', executionProviders: ['cpu'], effectiveNativeThreads: null })
  })
});
assert.equal(profile.executionInfo().device, null, 'a profile is a request until its runtime acknowledges it');
assert.equal(profile.executionInfo().requestedSessionOptions.intraOpNumThreads, 6);
assert.equal(profile.executionInfo().modelFileName, 'model_w8a8');
assert.equal(profile.executionInfo().modelArtifact, null);
await profile.embedderPromise;
assert.equal(profile.executionInfo().device, 'cpu', 'preserve acknowledged execution observations');
assert.equal(profile.executionInfo().requestedSessionOptions.intraOpNumThreads, 6);
assert.equal(profile.executionInfo().modelFileName, 'model_w8a8');
assert.equal(profile.executionInfo().effectiveNativeThreads, null);
console.log('embedding execution lifecycle observations passed (mock and stub only)');
