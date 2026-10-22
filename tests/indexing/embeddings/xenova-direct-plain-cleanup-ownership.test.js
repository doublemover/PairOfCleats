import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createXenovaAdapter } from '../../../src/shared/embedding-provider-adapters.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';
import { getPendingTransformersResourceOwners } from '../../../src/shared/embedding-transformers-resources.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Actual exported direct provider, plain close failure, inert pipeline only.
const { dir } = await prepareIsolatedTestCacheDir('xenova-direct-plain-cleanup');
const modelId = 'fixture/direct', root = path.join(dir, modelId), adapters = [];
const leaf = Object.freeze(new Error('original plain cleanup leaf'));
const cleanup = Object.freeze(new AggregateError([leaf], 'plain unbranded pipeline close failure', { cause: leaf }));
const rejected = work => work.then(() => assert.fail('expected exact pending cleanup'), error => error);
let refuse = true, externalClosed = false;
try {
  await fs.mkdir(path.join(root, 'onnx'), { recursive: true });
  await fs.writeFile(path.join(root, 'onnx/model_quantized.onnx'), 'inert local graph bytes');
  await fs.writeFile(path.join(root, 'tokenizer.json'), '{}');
  const artifact = resolveEmbeddingArtifactIdentity({ provider: 'xenova', modelId, modelsDir: dir });
  let loads = 0, closes = 0, reads = 0;
  const pipeline = async texts => texts.map(() => Float32Array.of(1, 2));
  Object.defineProperty(pipeline, 'dispose', { configurable: true, get() {
    reads++; return async function () { assert.equal(this, pipeline); closes++; if (refuse) throw cleanup; };
  } });
  const provider = createXenovaAdapter({ modelId, modelsDir: dir, modelArtifact: artifact, loadPipeline: async () => {
    loads++; await fs.writeFile(path.join(root, 'tokenizer.json'), '{"changed":"during load"}'); return pipeline;
  } }); adapters.push(provider);
  const startup = await rejected(provider.embedderPromise);
  assert.equal(startup.code, 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE'); assert.equal(startup.cacheOwnershipPending, true);
  const actualCleanup = startup.cleanupErrors[0];
  assert.equal(actualCleanup.cause, cleanup); assert.deepEqual(actualCleanup.errors, [cleanup]);
  assert.equal(actualCleanup.transformersResourceOwner.resource, pipeline); assert.equal(reads, 1); assert.equal(closes, 1);
  assert.equal(cleanup.cacheOwnershipPending, undefined, 'unbranded immutable original is not modified');
  assert.equal(await rejected(provider.embedderPromise), startup); assert.equal(loads, 1);
  assert.equal(await rejected(provider.dispose()), startup, 'first later disposal reports observed failed cleanup without retry');
  assert.equal(closes, 1); assert.equal(startup.cacheOwnershipReleased(), false);
  Object.defineProperty(pipeline, 'dispose', { value: () => assert.fail('direct provider keeps original pipeline method') });
  refuse = false; const retry = provider.dispose(); assert.equal(provider.dispose(), retry); await retry;
  assert.equal(closes, 2); assert.equal(loads, 1); assert.equal(startup.cacheOwnershipReleased(), true);
  await assert.rejects(provider.embedOne('after disposal'), /disposed/); assert.equal(loads, 1);

  let ordinaryCloses = 0, ordinaryLoads = 0;
  const ordinaryPipeline = Object.assign(async texts => texts.map(() => Float32Array.of(1, 2)), { dispose: async () => {
    ordinaryCloses++; if (ordinaryCloses === 1) throw cleanup;
  } });
  const ordinary = createXenovaAdapter({ modelId, modelsDir: dir, loadPipeline: async () => { ordinaryLoads++; return ordinaryPipeline; } }); adapters.push(ordinary);
  await ordinary.embedOne('loaded');
  const ordinaryFailure = await rejected(ordinary.dispose()); assert.equal(ordinaryFailure.cause, cleanup);
  await ordinary.dispose(); assert.equal(ordinaryCloses, 2); assert.equal(ordinaryLoads, 1);
  assert.equal(ordinaryFailure.cacheOwnershipReleased(), true);

  let unknownLoads = 0;
  const unknown = new Error('direct acquisition retained its original native owner');
  Object.defineProperties(unknown, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
    assert.equal(this, unknown); return externalClosed;
  } } }); Object.freeze(unknown);
  const pending = createXenovaAdapter({ modelId, modelsDir: dir, loadPipeline: async () => { unknownLoads++; throw unknown; } }); adapters.push(pending);
  assert.equal(await rejected(pending.embedderPromise), unknown);
  assert.equal(await rejected(pending.dispose()), unknown); await rejected(pending.dispose());
  assert.equal(unknownLoads, 1); externalClosed = true; await pending.dispose(); assert.equal(unknownLoads, 1);
} finally {
  refuse = false; externalClosed = true;
  await Promise.allSettled(adapters.map(adapter => adapter.dispose()));
  for (const owner of getPendingTransformersResourceOwners()) await owner.release().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Direct Xenova unbranded failed close ownership controls authored; all execution deferred.');
