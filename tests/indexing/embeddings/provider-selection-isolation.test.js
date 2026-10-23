import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEmbeddingAdapter, disposeEmbeddingAdapterCaches, __setAdapterFactoryForTests, __setTransformersModuleLoaderForTests } from '../../../src/shared/embedding-adapter.js';
import { acquireEmbeddingArtifactLease } from '../../../src/shared/embedding-artifact-lease.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { resolveEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { createXenovaAdapter } from '../../../src/shared/embedding-provider-adapters.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('provider-selection-isolation');
const leases = [], created = [];
const assets = async (root, modelId, bytes) => {
  const selected = path.join(root, modelId); await fs.mkdir(path.join(selected, 'onnx'), { recursive: true });
  await fs.writeFile(path.join(selected, 'onnx/model_quantized.onnx'), bytes); await fs.writeFile(path.join(selected, 'tokenizer.json'), '{}');
};
const factoryCalls = [];
__setAdapterFactoryForTests(config => {
  factoryCalls.push(config);
  return { provider: config.provider, embedOne: async () => Float32Array.of(1, 2),
    executionInfo: () => ({ provider: config.provider, requestedProvider: config.provider, modelArtifact: config.modelArtifact }), dispose() {} };
});
try {
  await assets(dir, 'fixture/a', 'selected model A'); await assets(dir, 'fixture/b', 'different model B');
  const request = { provider: 'xenova', modelId: 'fixture/a', modelsDir: dir, dims: 2,
    onnxConfig: { tokenizerId: 'fixture/a' }, retainInCache: true };
  const adapter = getEmbeddingAdapter(request); leases.push(adapter);
  request.modelId = 'fixture/b'; request.onnxConfig.tokenizerId = 'fixture/b'; request.dims = 20;
  await adapter.embedOne('captured request');
  assert.equal(factoryCalls[0].modelId, 'fixture/a'); assert.equal(factoryCalls[0].onnxConfig.tokenizerId, 'fixture/a');
  assert.equal(factoryCalls[0].dims, 2);
  const artifact = { status: 'verified', reuse: 'allow', revision: null, digest: 'a'.repeat(64),
    inventory: [{ path: 'weights/model.onnx', bytes: 2, sha256: 'b'.repeat(64) }] };
  const explicit = getEmbeddingAdapter({ ...request, modelId: 'fixture/explicit', modelArtifact: artifact }); leases.push(explicit);
  artifact.digest = 'c'.repeat(64); artifact.inventory[0].sha256 = 'd'.repeat(64);
  await explicit.embedOne('captured artifact');
  const recorded = factoryCalls.at(-1).modelArtifact;
  assert.equal(recorded.digest, 'a'.repeat(64)); assert.equal(recorded.inventory[0].sha256, 'b'.repeat(64));
  assert(Object.isFrozen(recorded)); assert(Object.isFrozen(recorded.inventory[0]));
  const verification = { provider: 'xenova', modelId: 'fixture/a', modelsDir: dir };
  const artifactLease = await acquireEmbeddingArtifactLease(verification);
  verification.modelId = 'fixture/b';
  assert.deepEqual(await artifactLease.verifyLoaded(), artifactLease.artifact, 'verification lease retains its original selected request');
  artifactLease.release();
  for (const lease of leases.splice(0)) await lease.dispose(); await disposeEmbeddingAdapterCaches();

  const env = { cacheDir: 'user-owned-default' }, loads = [];
  __setTransformersModuleLoaderForTests(async () => ({ env, pipeline: async (task, modelId, options) => {
    const owner = { closes: 0 }; created.push(owner); loads.push({ modelId, options, globalCache: env.cacheDir });
    return Object.assign(async () => [[1, 2]], { dispose() { owner.closes++; } });
  } }));
  const a = getEmbeddingAdapter({ modelId: 'fixture/a', modelsDir: dir }), b = getEmbeddingAdapter({ modelId: 'fixture/b', modelsDir: dir });
  const fallback = getEmbeddingAdapter({ modelId: 'fixture/default' }); leases.push(a, b, fallback);
  await Promise.all([a.embedOne('a'), b.embedOne('b'), fallback.embedOne('default')]);
  assert.equal(env.cacheDir, 'user-owned-default'); assert(loads.every(row => row.globalCache === 'user-owned-default'));
  assert.equal(loads.find(row => row.modelId === 'fixture/a').options.cache_dir, dir);
  assert.equal(loads.find(row => row.modelId === 'fixture/b').options.cache_dir, dir);
  assert.equal(loads.find(row => row.modelId === 'fixture/default').options.cache_dir, undefined);
  for (const lease of leases.splice(0)) await lease.dispose(); await disposeEmbeddingAdapterCaches();
  assert(created.every(owner => owner.closes === 1));

  const local = path.join(dir, 'local/embeddinggemma-2-ONNX'), profile = resolveEmbeddingModelProfile(local);
  await fs.mkdir(path.join(local, 'onnx'), { recursive: true }); await fs.writeFile(path.join(local, 'onnx/model.onnx'), 'unverified direct local weights');
  const localArtifact = resolveEmbeddingArtifactIdentity({ provider: 'xenova', modelId: local, modelProfile: profile });
  assert.equal(localArtifact.status, 'unknown'); assert.equal(localArtifact.reuse, 'refuse');
  assert.equal(buildEmbeddingIdentity({ modelId: local, modelProfile: profile }).modelArtifact.reuse, 'refuse');
  const remoteId = 'onnx-community/embeddinggemma-2-ONNX', remoteProfile = resolveEmbeddingModelProfile(remoteId);
  await assets(path.join(dir, 'profile-cache'), path.join(remoteId, remoteProfile.revision), 'unreceipted profile weights');
  assert.equal(resolveEmbeddingArtifactIdentity({ provider: 'xenova', modelId: remoteId, modelsDir: path.join(dir, 'profile-cache'), modelProfile: remoteProfile }).reuse, 'refuse');

  let release;
  const gate = new Promise(resolve => { release = resolve; }); let observed;
  const direct = createXenovaAdapter({ modelId: 'fixture/input-snapshot', loadPipeline: async () => {
    await gate; return Object.assign(async texts => { observed = texts; return [[1, 2]]; }, { dispose() {} });
  } }); leases.push(direct);
  const texts = ['selected text'], work = direct.embed(texts); texts[0] = 'later mutation'; release(); await work;
  assert.deepEqual(observed, ['selected text']);
} finally {
  await Promise.allSettled(leases.map(lease => lease.dispose())); await disposeEmbeddingAdapterCaches();
  __setAdapterFactoryForTests(null); __setTransformersModuleLoaderForTests(null); await fs.rm(dir, { recursive: true, force: true });
}
console.log('Provider configuration, original input/artifact metadata, cache isolation and local-profile provenance controls authored; execution deferred.');
