import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createOnnxCacheLifetime } from '../../../src/shared/onnx-embeddings/cache-lifetime.js';
import { createOnnxResourceOwner } from '../../../src/shared/onnx-embeddings/resource-lifetime.js';

// Actual ONNX provider with inert native/acquisition modules and a controlled
// FinalizationRegistry callback boundary. This does not invoke GC or a model.
const key = Symbol.for('poc.tests.onnx-cache-retirement'), values = new Map(), registrations = new WeakMap();
const originalFinalizationRegistry = globalThis.FinalizationRegistry;
const originalNow = Date.now;
globalThis.FinalizationRegistry = class {
  constructor(callback) { this.callback = callback; this.tokens = new Set(); }
  register(target, value, token) { this.tokens.add(token); registrations.set(target, { value, deliver: () => this.callback(value) }); }
  unregister(token) { return this.tokens.delete(token); }
};
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const { dir } = await prepareIsolatedTestCacheDir('onnx-cache-retirement-ownership');
globalThis[key] = {
  env: {}, AutoTokenizer: { from_pretrained: async modelId => values.get(modelId).tokenizer },
  Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
  InferenceSession: { create: async file => {
    const value = values.get(file); value.creates++; value.createEntered?.resolve();
    if (value.createGate) await value.createGate.promise;
    if (value.createError) throw value.createError;
    return value.session;
  } },
  verify: async options => {
    const value = values.get(options.onnx.modelPath); value.verifications++;
    return value.modelArtifact;
  }
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['onnxruntime-node', '@huggingface/transformers'].includes(specifier)) return { url: `retirement:${specifier}`, shortCircuit: true };
    if (specifier === './embedding-artifact-lease.js' && context.parentURL?.endsWith('/src/shared/onnx-embeddings.js')) {
      return { url: 'retirement:artifact', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'retirement:artifact') return { format: 'module', shortCircuit: true,
      source: `export const resolveEmbeddingArtifactIdentityAsync = options => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})].verify(options);` };
    if (url.startsWith('retirement:')) return { format: 'module', shortCircuit: true,
      source: `export const { env, AutoTokenizer, InferenceSession, Tensor } = globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})];` };
    return next(url, context);
  }
});
const fixtures = [], adapters = [];
const fixture = async name => {
  const modelPath = path.join(dir, `${name}.onnx`); await fs.writeFile(modelPath, 'inert owned graph fixture');
  const value = { name, creates: 0, verifications: 0, nativeCloses: 0, tokenizerCloses: 0, runs: 0,
    releaseErrors: [], tokenizerErrors: [], modelArtifact: { status: 'unknown', reuse: 'refuse', attempt: `fixture:${name}` } };
  value.tokenizer = Object.assign(texts => {
    assert.equal(value.nativeClosed, undefined, 'accepted tokenization keeps its original native owner');
    return { input_ids: texts.map(() => [101, 102]), attention_mask: texts.map(() => [1, 1]) };
  }, { dispose: async () => { value.tokenizerCloses++; if (value.tokenizerErrors.length) throw value.tokenizerErrors.shift(); } });
  value.session = { inputNames: ['input_ids', 'attention_mask'],
    release: async () => { value.nativeCloses++; if (value.releaseErrors.length) throw value.releaseErrors.shift(); value.nativeClosed = true; },
    run: async () => {
      value.runs++; value.runEntered?.resolve(); if (value.runGate) await value.runGate.promise;
      assert.equal(value.nativeClosed, undefined, 'accepted inference retains its session through actual settlement');
      return {};
    } };
  value.options = { rootDir: dir, modelId: name, onnxConfig: { modelPath }, modelArtifact: value.modelArtifact };
  values.set(name, value); values.set(modelPath, value); fixtures.push(value); return value;
};
let api;
const create = (value, overrides = {}) => {
  const adapter = api.createOnnxEmbedder({ ...value.options, ...overrides }); adapters.push(adapter); return adapter;
};
const rejection = async promise => {
  try { await promise; assert.fail('expected pending cleanup'); }
  catch (error) { assert.equal(error.cacheOwnershipPending, true); return error; }
};
try {
  api = await import('../../../src/shared/onnx-embeddings.js');
  const shared = await fixture('shared'), a = create(shared), b = create(shared);
  await Promise.all([a.embedderPromise, b.embedderPromise]);
  await a.dispose();
  const c = create(shared); await c.embedderPromise;
  assert.equal(shared.creates, 1, 'disposing one shared reference must preserve current cache lookup');
  const bFinalizer = registrations.get(b); bFinalizer.deliver(); await bFinalizer.value.releasing;
  assert.equal(shared.nativeCloses, 0, 'another live reference retains the native owner');
  await c.dispose(); assert.equal(shared.nativeCloses, 1); assert.equal(shared.tokenizerCloses, 1);
  bFinalizer.deliver(); await turn(); await b.dispose();
  assert.equal(shared.nativeCloses, 1, 'stale finalization/disposal cannot decrement the same reference twice');
  assert.equal(api.getRetiredOnnxSessionOwners().length, 0);

  // A backwards clock can make a newly inserted entry the capacity victim.
  // It must already own its first reference before the capacity prune runs.
  const capacityPeers = [];
  Date.now = () => originalNow() + 60 * 60 * 1000;
  for (let index = 0; index < 8; index++) {
    const peer = await fixture(`capacity-peer-${index}`), peerAdapter = create(peer);
    await peerAdapter.embedderPromise; capacityPeers.push(peerAdapter);
  }
  Date.now = originalNow;
  const capacity = await fixture('capacity-new-victim'), capacityAdapter = create(capacity);
  const capacityLoaded = await capacityAdapter.embedderPromise; await turn();
  const capacityOwner = api.getRetiredOnnxSessionOwners().find(owner => owner.resourceOwner === capacityLoaded.resourceOwner);
  assert.equal(capacityOwner.references, 1); assert.equal(capacity.nativeCloses, 0);
  await capacityAdapter.prewarm({ model: true, texts: ['retired but owned'] });
  await capacityAdapter.dispose(); assert.equal(capacity.nativeCloses, 1);
  await Promise.all(capacityPeers.map(adapter => adapter.dispose()));
  assert.equal(api.getRetiredOnnxSessionOwners().length, 0);

  const active = await fixture('active-startup'); active.createGate = deferred(); active.createEntered = deferred();
  active.runGate = deferred(); active.runEntered = deferred();
  const activeAdapter = create(active), activeWork = activeAdapter.prewarm({ model: true, texts: ['owned work'] });
  await active.createEntered.promise;
  const activeFinalizer = registrations.get(activeAdapter); activeFinalizer.deliver();
  api.__resetOnnxSessionCacheForTests(); await turn();
  assert.equal(active.nativeCloses, 0); assert.equal(activeFinalizer.value.released, false,
    'finalizer keeps a reference through accepted startup/tokenization/inference work');
  active.createGate.resolve(); await active.runEntered.promise;
  assert.equal(active.nativeCloses, 0); active.runGate.resolve(); await activeWork; await activeFinalizer.value.releasing;
  assert.equal(active.nativeCloses, 1); assert.equal(active.tokenizerCloses, 1);
  assert.equal(api.getRetiredOnnxSessionOwners().length, 0);

  const failed = await fixture('failed-finalizer'), failedAdapter = create(failed);
  const loaded = await failedAdapter.embedderPromise;
  const leafFailure = Object.freeze(new Error('exact nested native close cause'));
  const nativeFailure = Object.freeze(Object.assign(new AggregateError([leafFailure], 'frozen retired native close failure',
    { cause: leafFailure }), { code: 'CONTROLLED_CLOSE' }));
  failed.releaseErrors.push(nativeFailure, nativeFailure);
  failed.session.release = () => assert.fail('retirement must keep the captured native method');
  const failedFinalizer = registrations.get(failedAdapter); failedFinalizer.deliver();
  const failedError = await rejection(failedFinalizer.value.releasing);
  assert.equal(failedError.cause, failedError.retirementError);
  assert.deepEqual(failedError.errors, [failedError.retirementError]);
  assert.equal(failedError.retirementError.cause, nativeFailure);
  assert.deepEqual(failedError.retirementError.errors, [nativeFailure]);
  assert.equal(nativeFailure.cause, leafFailure); assert.deepEqual(nativeFailure.errors, [leafFailure]);
  assert.equal(failedError.onnxResourceOwner, loaded.resourceOwner);
  assert.equal(failedError.onnxCacheOwner.resourceOwner, loaded.resourceOwner);
  assert.equal(failed.nativeCloses, 1); assert.equal(failed.tokenizerCloses, 1);
  const [retained] = api.getRetiredOnnxSessionOwners();
  assert.equal(retained, failedError.onnxCacheOwner); assert.equal(retained.lastError, failedError);
  const sibling = await fixture('new-sibling'), siblingAdapter = create(sibling); await siblingAdapter.embedderPromise;
  api.__resetOnnxSessionCacheForTests(); await turn();
  assert.equal(failed.nativeCloses, 1, 'later cache retirement does not automatically retry a failed native close');
  await rejection(retained.release());
  assert.equal(failed.nativeCloses, 2); assert.equal(failed.tokenizerCloses, 1);
  const retry = retained.release(); assert.equal(retained.release(), retry, 'exact reconciliation joins one cache-entry flight');
  assert.deepEqual(await retry, { settled: true, pending: false, references: 0 });
  assert.equal(failed.nativeCloses, 3); assert.equal(failed.tokenizerCloses, 1);
  assert.equal(failedError.cacheOwnershipReleased(), true); assert.equal(sibling.nativeCloses, 0);
  await siblingAdapter.dispose();

  const startup = await fixture('startup-pending'); let externalClosed = false;
  const externalOwner = Object.freeze({ release: async () => { externalClosed = true; } });
  const primary = new Error('startup retained an unknown native child');
  Object.defineProperties(primary, { code: { value: 'CONTROLLED_STARTUP' }, cacheOwnershipPending: { value: true },
    onnxSessionOwner: { value: externalOwner }, cacheOwnershipReleased: { value() { assert.equal(this, primary); return externalClosed; } } });
  startup.createError = Object.freeze(primary);
  const startupAdapter = create(startup), startupError = await rejection(startupAdapter.embedderPromise);
  assert.equal(startup.creates, 1, 'pending native acquisition cannot trigger the low-memory create retry');
  assert.equal(startupError.cause, startupError.retirementError); assert.equal(startupError.retirementError.cause, primary);
  assert.equal(startupError.onnxCacheOwner.resourceOwner, startupError.onnxResourceOwner);
  const startupFinalizer = registrations.get(startupAdapter); startupFinalizer.deliver();
  assert.equal(await rejection(startupFinalizer.value.releasing), startupError,
    'first finalizer retirement preserves the observed startup cleanup failure without retry');
  assert.equal(startup.tokenizerCloses, 1);
  await rejection(startupError.onnxCacheOwner.release()); assert.equal(startup.tokenizerCloses, 1);
  await externalOwner.release(); await startupError.onnxResourceOwner.release();
  assert.equal(startupError.cacheOwnershipReleased(), true);
  assert.equal(api.getRetiredOnnxSessionOwners().includes(startupError.onnxCacheOwner), false,
    'direct exact resource reconciliation retires the strong failed entry through its settlement observer');

  const deferredValue = await fixture('deferred-retry'), deferredAdapter = create(deferredValue, { modelArtifact: null });
  await deferredAdapter.embedderPromise;
  deferredValue.releaseErrors.push(nativeFailure);
  const deferredError = await rejection(deferredAdapter.dispose()), verifiedBeforeRetry = deferredValue.verifications;
  await deferredAdapter.dispose();
  assert.equal(deferredError.cacheOwnershipReleased(), true); assert.equal(deferredValue.creates, 1);
  assert.equal(deferredValue.verifications, verifiedBeforeRetry, 'disposal retry never reacquires model bytes or a new native session');
  assert.equal(deferredValue.nativeCloses, 2); assert.equal(deferredValue.tokenizerCloses, 1);

  const providerValue = await fixture('provider-pending-dlopen'); let providerExternalClosed = false, fallbackLoads = 0;
  const providerPrimary = new Error('pending native dlopen owner');
  Object.defineProperties(providerPrimary, { code: { value: 'ERR_DLOPEN_FAILED' }, cacheOwnershipPending: { value: true },
    cacheOwnershipReleased: { value: () => providerExternalClosed } });
  providerValue.createError = Object.freeze(providerPrimary);
  const { createEmbeddingProviderAdapter } = await import('../../../src/shared/embedding-provider-adapters.js');
  const provider = createEmbeddingProviderAdapter({ ...providerValue.options, provider: 'onnx',
    normalizeEmbeddingProvider: value => value,
    loadPipeline: async () => { fallbackLoads++; throw new Error('fallback must not start while native ownership is pending'); } });
  adapters.push(provider);
  const providerPending = await rejection(provider.embedderPromise);
  for (const invoke of [() => provider.embed(['query']), () => provider.embedOne('query'),
    () => provider.estimateTokensBatch(['query']), () => provider.prewarm({ model: true, texts: ['query'] })]) {
    assert.equal(await rejection(invoke()), providerPending);
  }
  assert.equal(fallbackLoads, 0); assert.equal(providerValue.creates, 1);
  assert.equal(provider.executionInfo().fallback, null);
  await rejection(provider.dispose()); providerExternalClosed = true;
  await providerPending.onnxResourceOwner.release(); await provider.dispose();

  // The private lifetime owner cannot manufacture successful empty cleanup when
  // startup rejected without ever supplying an authoritative resource owner.
  const isolatedCache = new Map(), lifetime = createOnnxCacheLifetime(isolatedCache);
  const unobserved = lifetime.adopt({ key: 'unknown-startup', references: 0, queue: { onIdle: async () => {} } });
  const startupCause = Object.freeze(new Error('startup owner was not observed'));
  unobserved.promise = Promise.reject(startupCause); unobserved.promise.catch(() => {});
  lifetime.startupFailed(unobserved, startupCause);
  const unobservedError = await rejection(unobserved.releasing);
  assert.equal(unobservedError.code, 'ERR_ONNX_RESOURCE_UNOBSERVED'); assert.equal(unobservedError.startupError, startupCause);
  assert.equal(unobserved.cacheOwner.resourceOwner, null); assert.equal(lifetime.retiredOwners()[0], unobserved.cacheOwner);

  const falselyConfirmed = false;
  let falseReleaseCalls = 0;
  const unconfirmed = lifetime.adopt({ key: 'unconfirmed-release', references: 0, queue: { onIdle: async () => {} } });
  unconfirmed.promise = Promise.resolve(); lifetime.startupLoaded(unconfirmed);
  const unconfirmedOwner = Object.freeze({ get settled() { return falselyConfirmed; },
    release: async () => { falseReleaseCalls++; return false; } });
  lifetime.observeResourceOwner(unconfirmed, unconfirmedOwner);
  const unconfirmedError = await rejection(lifetime.retire(unconfirmed.key, unconfirmed));
  assert.equal(unconfirmedError.code, 'ERR_ONNX_RESOURCE_UNCONFIRMED'); assert.equal(falseReleaseCalls, 1);
  assert.equal(unconfirmed.cacheOwner.pending, true); assert.equal(unconfirmed.cacheOwner.resourceOwner, unconfirmedOwner);

  let releaseCalls = 0, settled = false, observed = 0;
  const resource = createOnnxResourceOwner({ session: { release: async () => { releaseCalls++; } } });
  resource.onSettled(() => { settled = true; observed++; }); resource.onSettled(() => { throw new Error('bookkeeping observer'); });
  await resource.release(); await resource.release();
  assert.equal(settled, true); assert.equal(observed, 1); assert.equal(releaseCalls, 1);
  assert.equal(api.getRetiredOnnxSessionOwners().length, 0);

  const direct = await fixture('direct-cap-accepted-work'), directAdapter = create(direct);
  const directLoaded = await directAdapter.embedderPromise;
  direct.runGate = deferred(); direct.runEntered = deferred();
  direct.session.run = async () => { direct.runEntered.resolve(); await direct.runGate.promise; return {}; };
  const directWork = directAdapter.prewarm({ model: true, texts: ['accepted work'] });
  await direct.runEntered.promise; api.__resetOnnxSessionCacheForTests();
  let directDisposed = false;
  const directDisposal = directAdapter.dispose().then(() => { directDisposed = true; });
  await directLoaded.resourceOwner.release(); await turn();
  const directCacheOwner = api.getRetiredOnnxSessionOwners().find(owner => owner.resourceOwner === directLoaded.resourceOwner);
  assert.equal(directCacheOwner.pending, true); assert.equal(directCacheOwner.references, 1);
  assert.equal(directDisposed, false, 'direct native-cap settlement cannot claim accepted adapter work drained');
  direct.runGate.resolve(); await directWork; await directDisposal;
  assert.equal(directCacheOwner.pending, false); assert.equal(direct.nativeCloses, 1);
  assert.equal(api.getRetiredOnnxSessionOwners().length, 0);

  const gatedQueue = deferred();
  const gated = lifetime.adopt({ key: 'gated-queue', references: 0, queue: { onIdle: () => gatedQueue.promise } });
  gated.promise = Promise.resolve(); lifetime.startupLoaded(gated);
  const gatedResource = createOnnxResourceOwner({ session: { release: async () => {} } });
  lifetime.observeResourceOwner(gated, gatedResource);
  const gatedRetirement = lifetime.retire(gated.key, gated);
  await gatedResource.release();
  assert.equal(gated.cacheOwner.pending, true, 'resource-cap settlement cannot bypass an unconfirmed queue drain');
  gatedQueue.resolve(); await gatedRetirement; assert.equal(gated.cacheOwner.pending, false);
} finally {
  for (const value of fixtures) { value.releaseErrors.length = 0; value.tokenizerErrors.length = 0; value.createGate?.resolve(); value.runGate?.resolve(); }
  await Promise.allSettled(adapters.map(adapter => adapter.dispose()));
  for (const owner of api?.getRetiredOnnxSessionOwners() || []) await owner.release().catch(() => {});
  hooks.deregister(); delete globalThis[key]; globalThis.FinalizationRegistry = originalFinalizationRegistry;
  Date.now = originalNow;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual ONNX cache/finalizer exact retirement controls authored; all native/runtime/GC execution deferred.');
