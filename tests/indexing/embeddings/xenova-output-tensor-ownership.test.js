import assert from 'node:assert/strict';
import { createXenovaAdapter } from '../../../src/shared/embedding-provider-adapters.js';
import { createPreparedTextEncoder } from '../../../src/shared/embedding-prepared.js';
import { resolveEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { getPendingTransformersResourceOwners, transformersCleanupFailure } from '../../../src/shared/embedding-transformers-resources.js';
import { observeEmbeddingOwnership } from '../../../src/shared/embedding-cache-lifetime.js';
import { getEmbeddingAdapter, getRetiredEmbeddingCacheOwners, __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import fs from 'node:fs/promises';

// Actual direct provider and prepared-owner delegation, inert pipelines only.
const { dir } = await prepareIsolatedTestCacheDir('xenova-output-tensor-owner');
const leaf = Object.freeze(new Error('original generic output leaf'));
const cleanup = Object.freeze(new AggregateError([leaf], 'frozen output cleanup failure', { cause: leaf }));
const gates = [], adapters = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const value = { promise, resolve }; gates.push(value); return value; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const rejected = work => work.then(() => assert.fail('expected pending output owner'), error => error);
const tensor = (errors = []) => ({ dims: [1, 2], data: Float32Array.of(3, 4), closes: 0, errors,
  async dispose() {
    this.closes++; this.closeEntered?.resolve(); if (this.closeGate) await this.closeGate.promise;
    this.data.fill(99); if (this.errors.length) throw this.errors.shift();
  } });
const provider = (run, options = {}) => {
  const value = { loads: 0, closes: 0 };
  const pipeline = Object.assign(run, { dispose: async () => { value.closes++; } });
  value.adapter = createXenovaAdapter({ modelId: 'fixture-generic-output', modelsDir: dir, ...options,
    loadPipeline: async () => { value.loads++; return pipeline; } });
  adapters.push(value.adapter); return value;
};
let externalClosed = false, releasePendingAbort = null, releaseMixedUnknown = null, releaseKnownEncoder = null, releaseBrandedUnknown = null;
try {
  const newlyOwned = new Error('ordinary error later acquires its first actual resource owner');
  assert.equal(observeEmbeddingOwnership(newlyOwned), null);
  let newlyClosed = false;
  newlyOwned.cacheOwnershipReleased = function () { assert.equal(this, newlyOwned); return newlyClosed; };
  const newlyObserved = observeEmbeddingOwnership(newlyOwned);
  assert.equal(typeof newlyObserved, 'function', 'an earlier absence cannot hide later actual ownership');
  newlyOwned.cacheOwnershipReleased = () => true;
  assert.equal(observeEmbeddingOwnership(newlyOwned), newlyObserved, 'once present, retain the exact original observer');
  assert.equal(newlyObserved(), false);
  newlyClosed = true;
  assert.equal(newlyObserved(), true);

  const alias = tensor(), healthy = provider(async () => [alias, alias]);
  const vectors = await healthy.adapter.embed(['first', 'second']);
  assert.deepEqual(vectors.map(vector => Array.from(vector)), [[3, 4], [3, 4]]);
  assert.equal(alias.closes, 1); assert.deepEqual(Array.from(alias.data), [99, 99]);
  assert.notEqual(vectors[0], alias.data); assert.notEqual(vectors[1], alias.data);
  await healthy.adapter.dispose(); assert.equal(healthy.closes, 1);
  const pure = Float32Array.of(5, 6), pureProvider = provider(async () => [pure]);
  assert.equal((await pureProvider.adapter.embed(['pure JS vector']))[0], pure, 'no extra vector copy for already-owned plain JS vectors');
  await pureProvider.adapter.dispose();
  const original = Float32Array.of(7, 8); let dataReads = 0;
  const observedOnce = { dims: [2], type: 'float32',
    get data() { if (++dataReads > 1) throw new Error('native output data must not be reread after admission'); return original; },
    dispose() { original.fill(99); } };
  const singleObservation = provider(async () => [observedOnce]);
  assert.deepEqual(await singleObservation.adapter.embedOne('one native data observation'), Float32Array.of(7, 8));
  assert.equal(dataReads, 1); assert.deepEqual(original, Float32Array.of(99, 99));
  await singleObservation.adapter.dispose();

  const failed = tensor([cleanup]), failedProvider = provider(async () => failed);
  const outputFailure = await rejected(failedProvider.adapter.embedOne('failed output'));
  const scope = outputFailure.transformersResourceOwner, exactOutput = scope.resources[0];
  assert.equal(exactOutput.resource, failed); assert.equal(exactOutput.lastError.cause, cleanup);
  assert.equal(failed.closes, 1); assert.equal(failedProvider.closes, 0);
  failed.dispose = () => assert.fail('keep captured output disposal');
  assert.equal(await rejected(failedProvider.adapter.embedOne('no retry admission')), outputFailure);
  const providerFailure = await rejected(failedProvider.adapter.dispose());
  assert.equal(failed.closes, 1); assert.equal(failedProvider.closes, 0, 'pending output keeps original pipeline alive');
  await exactOutput.release(); await failedProvider.adapter.dispose();
  assert.equal(failed.closes, 2); assert.equal(failedProvider.closes, 1); assert.equal(failedProvider.loads, 1);
  assert.equal(outputFailure.cacheOwnershipReleased(), true); assert.equal(providerFailure.cacheOwnershipReleased(), true);

  const runGate = deferred(), runEntered = deferred(), held = tensor(); held.closeGate = deferred(); held.closeEntered = deferred();
  const active = provider(async () => { runEntered.resolve(); await runGate.promise; return held; });
  const activeWork = active.adapter.embedOne('accepted'); await runEntered.promise;
  let closed = false; const closing = active.adapter.dispose().then(() => { closed = true; });
  await turn(); assert.equal(closed, false); assert.equal(active.closes, 0);
  runGate.resolve(); await held.closeEntered.promise; await turn();
  assert.equal(closed, false); assert.equal(active.closes, 0, 'pipeline remains owned through accepted async output cleanup');
  held.closeGate.resolve(); assert.deepEqual(Array.from(await activeWork), [3, 4]); await closing;
  assert.equal(held.closes, 1); assert.equal(active.closes, 1);

  const unknown = new Error('generic pipeline native work remains pending');
  Object.defineProperties(unknown, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
    assert.equal(this, unknown); return externalClosed;
  } } }); Object.freeze(unknown);
  const blocked = provider(async () => { throw unknown; });
  const blockedFailure = await rejected(blocked.adapter.embedOne('native unknown'));
  assert.equal(blockedFailure.cause, unknown); await rejected(blocked.adapter.dispose()); assert.equal(blocked.closes, 0);
  externalClosed = true; await blocked.adapter.dispose(); assert.equal(blocked.closes, 1); assert.equal(blocked.loads, 1);
  assert.equal(blockedFailure.cacheOwnershipReleased(), true);

  // The actual prepared encoder owns its tensor cleanup. Its child scope must
  // delegate through that same encoder instead of creating a parent cycle.
  const profile = resolveEmbeddingModelProfile('onnx-community/embeddinggemma-2-ONNX', { dimensions: 128 });
  const created = []; let modelCloses = 0, tokenizerCloses = 0;
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims, closes: 0, errors: [] }); created.push(this); }
    async dispose() { this.closes++; if (this.errors.length) throw this.errors.shift(); }
  }
  const tokenizer = Object.assign(async texts => ({
    input_ids: new Tensor('int64', BigInt64Array.of(1n), [texts.length, 1]),
    attention_mask: new Tensor('int64', BigInt64Array.of(1n), [texts.length, 1])
  }), { dispose: async () => { tokenizerCloses++; } });
  const model = Object.assign(async () => {
    const data = new Float32Array(768); data[0] = 1;
    const output = new Tensor('float32', data, [1, 768]); output.errors.push(cleanup); return { sentence_embedding: output };
  }, { dispose: async () => { modelCloses++; } });
  const encoder = createPreparedTextEncoder({ tokenizer, model, Tensor, profile, sessionOptions: {} });
  let preparedLoads = 0;
  const prepared = createXenovaAdapter({ modelId: 'onnx-community/embeddinggemma-2-ONNX', modelProfile: profile,
    loadPipeline: async () => { preparedLoads++; return encoder; } }); adapters.push(prepared);
  const preparedFailure = await rejected(prepared.embedOne('known prepared output'));
  await rejected(prepared.dispose()); assert.equal(modelCloses, 0);
  await prepared.dispose();
  assert.equal(preparedFailure.cacheOwnershipReleased(), true); assert.equal(modelCloses, 1); assert.equal(tokenizerCloses, 1);
  assert.equal(preparedLoads, 1); assert.deepEqual(created.map(value => value.closes), [1, 1, 2]);

  // Negative: a copied known owner and known causal member cannot authorize
  // dropping the independent native observer on an unbranded aggregate.
  let mixedUnknownClosed = false, mixedModelCloses = 0, mixedPipelineCloses = 0;
  releaseMixedUnknown = () => { mixedUnknownClosed = true; };
  const mixedTokenizer = Object.assign(async () => ({}), { dispose: async () => {} });
  const mixedModel = Object.assign(async () => ({}), { dispose: async () => { mixedModelCloses++; } });
  const knownEncoder = createPreparedTextEncoder({ tokenizer: mixedTokenizer, model: mixedModel, Tensor, profile, sessionOptions: {} });
  releaseKnownEncoder = () => knownEncoder.dispose();
  const knownFailure = transformersCleanupFailure(knownEncoder.transformersResourceOwner, [cleanup]);
  const mixedUnknown = new Error('independent unknown native child');
  Object.defineProperties(mixedUnknown, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
    assert.equal(this, mixedUnknown); return mixedUnknownClosed;
  } } }); Object.freeze(mixedUnknown);
  const mixed = new AggregateError([knownFailure, mixedUnknown], 'mixed known and independent unknown');
  Object.defineProperties(mixed, { transformersResourceOwner: { value: knownEncoder.transformersResourceOwner },
    cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
      assert.equal(this, mixed); return knownFailure.cacheOwnershipReleased() && mixedUnknown.cacheOwnershipReleased();
    } } }); Object.freeze(mixed);
  const copiedPipeline = Object.assign(async () => { throw mixed; }, {
    transformersResourceOwner: knownEncoder.transformersResourceOwner,
    dispose: async () => { mixedPipelineCloses++; await knownEncoder.dispose(); }
  });
  const mixedProvider = createXenovaAdapter({ modelId: 'mixed-known-unknown', modelsDir: dir, loadPipeline: async () => copiedPipeline }); adapters.push(mixedProvider);
  const mixedFailure = await rejected(mixedProvider.embedOne('mixed negative'));
  assert.equal(mixedFailure.cause, mixed); await rejected(mixedProvider.dispose());
  assert.equal(mixedPipelineCloses, 0); assert.equal(mixedModelCloses, 0, 'copied owner/known causal member cannot bypass independent observer');
  await knownEncoder.dispose(); assert.equal(knownFailure.cacheOwnershipReleased(), true);
  await rejected(mixedProvider.dispose()); assert.equal(mixedPipelineCloses, 0, 'settling known child alone cannot settle independent unknown');
  releaseMixedUnknown(); await mixedProvider.dispose();
  assert.equal(mixedPipelineCloses, 1); assert.equal(mixedModelCloses, 1); assert.equal(mixedFailure.cacheOwnershipReleased(), true);

  // The original producer's own mixed composition may delegate the acquired
  // encoder, but must still retain its independently pending native child.
  let brandedUnknownClosed = false, brandedModelCloses = 0, replaceBrandedObserver = false;
  releaseBrandedUnknown = () => { brandedUnknownClosed = true; };
  const brandedUnknown = new Error('original producer independent native child');
  const originalBrandedObserver = function () { assert.equal(this, brandedUnknown); return brandedUnknownClosed; };
  Object.defineProperties(brandedUnknown, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { get() {
    assert.equal(this, brandedUnknown); return replaceBrandedObserver ? () => true : originalBrandedObserver;
  } } }); Object.freeze(brandedUnknown);
  const brandedTokenizer = Object.assign(async texts => ({
    input_ids: new Tensor('int64', BigInt64Array.of(1n), [texts.length, 1]),
    attention_mask: new Tensor('int64', BigInt64Array.of(1n), [texts.length, 1])
  }), { dispose: async () => {} });
  const brandedModel = Object.assign(async () => {
    throw brandedUnknown;
  }, { dispose: async () => { brandedModelCloses++; } });
  const brandedEncoder = createPreparedTextEncoder({ tokenizer: brandedTokenizer, model: brandedModel, Tensor, profile, sessionOptions: {} });
  const brandedProvider = createXenovaAdapter({ modelId: 'original-mixed-producer', modelProfile: profile, loadPipeline: async () => brandedEncoder }); adapters.push(brandedProvider);
  const brandedFailure = await rejected(brandedProvider.embedOne('original mixed negative'));
  replaceBrandedObserver = true;
  await rejected(brandedProvider.dispose()); assert.equal(brandedModelCloses, 0);
  await rejected(brandedProvider.dispose()); assert.equal(brandedModelCloses, 0, 'producer provenance delegates only its own closure');
  releaseBrandedUnknown(); await brandedProvider.dispose();
  assert.equal(brandedModelCloses, 1); assert.equal(brandedFailure.cacheOwnershipReleased(), true);

  // Pending cleanup takes precedence over otherwise ordinary cancellation for
  // warm lookup retirement. Pure admission cancellation still keeps warmth.
  const artifact = { status: 'stub', reuse: 'allow', digest: null, revision: null, method: 'deterministic-stub' };
  let pendingClosed = false, factories = 0; const cacheCloses = [];
  releasePendingAbort = () => { pendingClosed = true; };
  const pendingAbort = Object.assign(new Error('cancelled with pending native cleanup'), { name: 'AbortError', code: 'ABORT_ERR' });
  Object.defineProperties(pendingAbort, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => pendingClosed } }); Object.freeze(pendingAbort);
  __setAdapterFactoryForTests(() => {
    const index = factories++; cacheCloses[index] = 0;
    return { embedOne: async () => { if (index === 0) throw pendingAbort; return Float32Array.of(1); },
      dispose: async () => { cacheCloses[index]++; } };
  });
  const cacheOptions = { provider: 'xenova', modelId: 'pending-abort-cache', modelArtifact: artifact, retainInCache: true };
  const cancelled = getEmbeddingAdapter(cacheOptions);
  assert.equal(await rejected(cancelled.embedOne('pending abort')), pendingAbort);
  const cancelledCleanup = await rejected(cancelled.dispose()); assert.equal(cacheCloses[0], 1);
  const replacement = getEmbeddingAdapter(cacheOptions); await replacement.embedOne('replacement'); await replacement.dispose();
  assert.equal(factories, 2, 'pending cancellation cannot keep a failed provider in warm lookup');
  pendingClosed = true; await cancelledCleanup.embeddingCacheOwner.release(); assert.equal(cacheCloses[0], 1);
  await disposeEmbeddingAdapterCaches(); assert.equal(cacheCloses[1], 1);

  const ordinaryAbort = Object.assign(new Error('ordinary admission cancellation'), { name: 'AbortError', code: 'ABORT_ERR' });
  let ordinaryFactories = 0, ordinaryCloses = 0, attempts = 0;
  __setAdapterFactoryForTests(() => {
    ordinaryFactories++;
    return { embedOne: async () => { if (attempts++ === 0) throw ordinaryAbort; return Float32Array.of(1); }, dispose: async () => { ordinaryCloses++; } };
  });
  const ordinaryOptions = { ...cacheOptions, modelId: 'ordinary-abort-cache' };
  const ordinaryLease = getEmbeddingAdapter(ordinaryOptions); assert.equal(await rejected(ordinaryLease.embedOne('abort')), ordinaryAbort); await ordinaryLease.dispose();
  const ordinaryWarm = getEmbeddingAdapter(ordinaryOptions); await ordinaryWarm.embedOne('warm'); await ordinaryWarm.dispose();
  assert.equal(ordinaryFactories, 1); assert.equal(ordinaryCloses, 0); await disposeEmbeddingAdapterCaches(); assert.equal(ordinaryCloses, 1);
} finally {
  externalClosed = true; releasePendingAbort?.(); releaseMixedUnknown?.(); releaseBrandedUnknown?.(); for (const gate of gates) gate.resolve();
  await releaseKnownEncoder?.().catch(() => {});
  await Promise.allSettled(adapters.map(adapter => adapter.dispose()));
  for (const owner of getPendingTransformersResourceOwners()) await owner.release().catch(() => {});
  for (const owner of getRetiredEmbeddingCacheOwners()) await owner.release().catch(() => {});
  await disposeEmbeddingAdapterCaches().catch(() => {}); __setAdapterFactoryForTests(null);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Generic Xenova tensor outputs and original prepared-owner delegation authored; execution deferred.');
