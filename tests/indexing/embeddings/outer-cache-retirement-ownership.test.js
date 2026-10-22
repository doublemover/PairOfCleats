import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createEmbeddingCacheLifetime } from '../../../src/shared/embedding-cache-lifetime.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Source-only controls: actual outer cache/provider paths use inert factories.
// Registry delivery is controlled, with no real GC or native model execution.
const gates = [], cleanups = [];
const deferred = () => {
  let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve };
  gates.push(gate); return gate;
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const rejected = work => work.then(() => assert.fail('expected retained ownership failure'), error => error);
const originalRegistry = globalThis.FinalizationRegistry, registrations = new WeakMap();
globalThis.FinalizationRegistry = class {
  constructor(callback) { this.callback = callback; }
  register(target, value, token) { registrations.set(target, { value, token, deliver: () => this.callback(value) }); }
  unregister() { return true; }
};
const { dir } = await prepareIsolatedTestCacheDir('outer-cache-retirement-ownership');
const leases = [], fixtures = [];
let api, releaseRun;
const originalNow = Date.now;
try {
  api = await import('../../../src/shared/embedding-adapter.js');
  const { getEmbeddingAdapter, getRetiredEmbeddingCacheOwners, disposeEmbeddingAdapterCaches,
    __setAdapterFactoryForTests, __setTransformersModuleLoaderForTests } = api;
  const artifact = Object.freeze({ status: 'stub', reuse: 'allow', digest: null, revision: null, method: 'deterministic-stub' });
  const leaf = Object.freeze(new Error('frozen cleanup leaf'));
  const nativeFailure = Object.freeze(Object.assign(new AggregateError([leaf], 'frozen exact native cleanup', { cause: leaf }), { code: 'EIO' }));
  let factories = 0;
  const fake = config => {
    factories++;
    const value = { config, closes: 0, reads: 0, errors: [], closed: false };
    value.adapter = { provider: 'xenova', embedOne: async () => Float32Array.of(1, 2),
      executionInfo: () => ({ provider: 'xenova', requestedProvider: 'xenova', modelArtifact: config.modelArtifact }) };
    Object.defineProperty(value.adapter, 'dispose', { configurable: true, get() {
      value.reads++;
      return async function () {
        assert.equal(this, value.adapter); value.closes++;
        if (value.closeGate) await value.closeGate.promise;
        if (value.errors.length) throw value.errors.shift();
        assert.equal(value.closed, false, 'successful closure is never repeated'); value.closed = true;
      };
    } });
    fixtures.push(value); return value.adapter;
  };
  __setAdapterFactoryForTests(fake);
  const first = getEmbeddingAdapter({ provider: 'xenova', modelId: 'controlled-first', modelArtifact: artifact }); leases.push(first);
  const firstValue = fixtures.at(-1); firstValue.errors.push(nativeFailure, nativeFailure);
  Object.defineProperty(firstValue.adapter, 'dispose', { value: () => assert.fail('must use original captured dispose') });
  const failure = await rejected(first.dispose()), owner = failure.embeddingCacheOwner;
  assert.equal(failure.cause, nativeFailure); assert.deepEqual(failure.errors, [nativeFailure]);
  assert.equal(nativeFailure.cause, leaf); assert.deepEqual(nativeFailure.errors, [leaf]);
  assert.equal(failure.code, 'EIO'); assert.equal(owner.resource, firstValue.adapter); assert.equal(firstValue.reads, 1);
  assert.equal(firstValue.closes, 1); assert.equal(owner.references, 0); assert.equal(owner.pending, true);
  assert.ok(getRetiredEmbeddingCacheOwners().includes(owner));
  assert.equal(await rejected(disposeEmbeddingAdapterCaches()), failure);
  assert.equal(firstValue.closes, 1, 'global shutdown does not retry observed native cleanup failure');
  await rejected(owner.release()); assert.equal(firstValue.closes, 2);
  const finalClose = first.dispose(); assert.equal(first.dispose(), finalClose);
  await finalClose;
  assert.equal(firstValue.closes, 3); assert.equal(owner.pending, false); assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(factories, 1, 'reconciliation never constructs a replacement adapter');

  const bad = getEmbeddingAdapter({ provider: 'xenova', modelId: 'bad-shutdown', modelArtifact: artifact }); leases.push(bad);
  const badValue = fixtures.at(-1); badValue.errors.push(nativeFailure); badValue.closeGate = deferred();
  const good = getEmbeddingAdapter({ provider: 'xenova', modelId: 'good-shutdown', modelArtifact: artifact }); leases.push(good);
  const goodValue = fixtures.at(-1); goodValue.closeGate = deferred();
  const badClosing = rejected(bad.dispose()), goodClosing = good.dispose();
  await turn(); let shutdownDone = false;
  const shutdown = disposeEmbeddingAdapterCaches();
  shutdown.then(() => { shutdownDone = true; }, () => { shutdownDone = true; });
  badValue.closeGate.resolve(); const badError = await badClosing; await turn();
  assert.equal(shutdownDone, false, 'shutdown joins an independent healthy close after another close rejects');
  assert.equal(badValue.closes, 1, 'joining shutdown does not retry a failed owner');
  goodValue.closeGate.resolve(); await goodClosing; assert.equal(await rejected(shutdown), badError);
  await badError.embeddingCacheOwner.release(); assert.equal(badValue.closes, 2); assert.equal(goodValue.closes, 1);

  // A stale finalizer cannot surrender a live sibling, decrement twice or close
  // an exact entry after successful disposal.
  const sharedOptions = { provider: 'xenova', modelId: 'controlled-shared', modelArtifact: artifact };
  const a = getEmbeddingAdapter(sharedOptions), b = getEmbeddingAdapter(sharedOptions); leases.push(a, b);
  const sharedValue = fixtures.at(-1), delivered = registrations.get(a);
  delivered.deliver(); await delivered.value.releasing;
  const c = getEmbeddingAdapter(sharedOptions); leases.push(c);
  assert.equal(fixtures.at(-1), sharedValue, 'returning one reference preserves shared cache lookup');
  await a.dispose(); delivered.deliver(); await delivered.value.releasing;
  const d = getEmbeddingAdapter(sharedOptions); leases.push(d);
  assert.equal(fixtures.at(-1), sharedValue, 'stale delivery and repeated disposal preserve owned lookup');
  assert.equal(sharedValue.closes, 0);
  await b.dispose(); assert.equal(sharedValue.closes, 0); await c.dispose(); assert.equal(sharedValue.closes, 0);
  await d.dispose(); assert.equal(sharedValue.closes, 1);

  // The held reference drains accepted operation and startup work at the same
  // finalizer boundary as ordinary disposal, without real GC.
  const startup = deferred(), entered = deferred(), held = deferred(); releaseRun = held.resolve;
  let heldCloses = 0;
  __setAdapterFactoryForTests(() => ({ embedderPromise: startup.promise,
    embedOne: async () => { entered.resolve(); await held.promise; return Float32Array.of(1); },
    dispose: async () => { heldCloses++; } }));
  const active = getEmbeddingAdapter({ provider: 'xenova', modelId: 'controlled-drain', modelArtifact: artifact }); leases.push(active);
  const loading = active.embedderPromise, work = active.embedOne('accepted'); await entered.promise;
  const activeDelivery = registrations.get(active); activeDelivery.deliver();
  let drained = false; activeDelivery.value.releasing.then(() => { drained = true; });
  await turn(); assert.equal(drained, false); assert.equal(heldCloses, 0);
  held.resolve(); await work; await turn(); assert.equal(heldCloses, 0, 'accepted startup still owns the reference');
  startup.resolve({ loaded: true }); await loading; await activeDelivery.value.releasing;
  assert.equal(heldCloses, 1); await active.dispose(); assert.equal(heldCloses, 1);

  // Clock rollback makes a newly inserted entry the LRU victim. Its first
  // reference must already be pinned when capacity retirement is requested.
  __setAdapterFactoryForTests(fake);
  const peers = []; let now = originalNow() + 60_000; Date.now = () => now;
  for (let index = 0; index < 64; index++) {
    const peer = getEmbeddingAdapter({ provider: 'xenova', modelId: `future-${index}`, modelArtifact: artifact });
    peers.push(peer); leases.push(peer);
  }
  now -= 30_000;
  const victim = getEmbeddingAdapter({ provider: 'xenova', modelId: 'older-new-victim', modelArtifact: artifact }); leases.push(victim);
  const victimValue = fixtures.at(-1); await turn();
  const victimOwner = getRetiredEmbeddingCacheOwners().find(candidate => candidate.resource === victimValue.adapter);
  assert.equal(victimOwner.references, 1); assert.equal(victimValue.closes, 0);
  assert.deepEqual(await victim.embedOne('still owned'), Float32Array.of(1, 2)); await victim.dispose();
  assert.equal(victimValue.closes, 1); await Promise.all(peers.map(peer => peer.dispose())); Date.now = originalNow;

  // A fulfilled adapter dispose still needs the original native observer, with
  // its original receiver, before the retained outer owner can claim closure.
  let externalClosed = false, partialCloses = 0;
  const unknown = Object.freeze(Object.assign(new Error('unobserved native startup owner'), { cacheOwnershipPending: true }));
  let pending;
  __setAdapterFactoryForTests(() => ({ embedOne: async () => { throw pending; }, dispose: async () => { partialCloses++; } }));
  const observed = new Error('original native observer');
  Object.defineProperties(observed, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
    assert.equal(this, observed); return externalClosed;
  } } });
  pending = Object.freeze(observed);
  const observedLease = getEmbeddingAdapter({ provider: 'xenova', modelId: 'observed-native', modelArtifact: artifact }); leases.push(observedLease);
  await rejected(observedLease.embedOne('fail'));
  const observedFailure = await rejected(observedLease.dispose());
  externalClosed = true; await observedFailure.embeddingCacheOwner.release();
  assert.equal(observedFailure.cacheOwnershipReleased(), true); assert.equal(partialCloses, 1);

  // A private isolated owner supplies the intentionally unknown-marker control
  // without allowing a global cleanup request to invent successful settlement.
  const privateCache = new Map(), lifetime = createEmbeddingCacheLifetime({ cache: privateCache, kind: 'controlled-private' });
  const privateEntry = lifetime.adopt({ key: 'unknown-startup', references: 0 });
  privateEntry.promise = Promise.reject(unknown); privateEntry.promise.catch(() => {}); lifetime.failed(privateEntry, unknown);
  const privateFailure = await rejected(lifetime.retire(privateEntry));
  assert.equal(privateFailure.cacheOwnershipPending, true); await rejected(privateEntry.owner.release());
  assert.equal(privateEntry.owner.resource, null);
  let privateCloses = 0;
  const privateLoaded = lifetime.adopt({ key: 'unknown-loaded-child', references: 0 });
  const loadedResource = { dispose: async () => { privateCloses++; } };
  lifetime.loaded(privateLoaded, loadedResource); privateLoaded.promise = Promise.resolve(loadedResource);
  lifetime.recordFailure(privateLoaded, unknown);
  await rejected(lifetime.retire(privateLoaded)); await rejected(privateLoaded.owner.release());
  assert.equal(privateCloses, 1); assert.equal(privateLoaded.owner.pending, true);

  // Actual Xenova provider + shared pipeline: mutation during loaded-byte
  // verification preserves both the artifact failure and failed exact close.
  __setAdapterFactoryForTests(null);
  const modelId = 'fixture/outer', root = path.join(dir, modelId);
  await fs.mkdir(path.join(root, 'onnx'), { recursive: true });
  await fs.writeFile(path.join(root, 'onnx/model_quantized.onnx'), 'controlled weights');
  await fs.writeFile(path.join(root, 'tokenizer.json'), '{}');
  let pipelineCreates = 0, pipelineCloses = 0, refuseClose = true, rawPipeline;
  cleanups.push(() => { refuseClose = false; });
  __setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => {
    pipelineCreates++;
    rawPipeline = async texts => texts.map(() => Float32Array.of(1, 2));
    rawPipeline.dispose = async function () {
      assert.equal(this, rawPipeline); pipelineCloses++;
      if (refuseClose) throw nativeFailure;
    };
    await fs.writeFile(path.join(root, 'tokenizer.json'), '{"changed":"during load"}');
    return rawPipeline;
  } }));
  const verified = getEmbeddingAdapter({ provider: 'xenova', modelId, modelsDir: dir }); leases.push(verified);
  const verificationFailure = await rejected(verified.embedOne('verification failure'));
  assert.equal(verificationFailure.code, 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE');
  assert.equal(verificationFailure.cause.code, 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE');
  assert.equal(verificationFailure.cleanupErrors[0].cause, nativeFailure); assert.equal(pipelineCloses, 1);
  rawPipeline.dispose = () => assert.fail('must keep original raw pipeline dispose');
  assert.equal(await rejected(verified.embedOne('no automatic reload')), verificationFailure);
  const verificationDisposal = await rejected(verified.dispose()); assert.equal(pipelineCloses, 1);
  refuseClose = false; await verificationDisposal.embeddingCacheOwner.release();
  assert.equal(pipelineCloses, 2); assert.equal(pipelineCreates, 1);
  assert.equal(verificationFailure.cacheOwnershipReleased(), true);

  const loadedPipelines = [];
  __setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => {
    const value = { closes: 0 };
    value.pipeline = async texts => {
      assert.equal(value.closes, 0); return texts.map(() => Float32Array.of(1, 2));
    };
    value.pipeline.dispose = async () => { value.closes++; assert.equal(value.closes, 1); };
    loadedPipelines.push(value); return value.pipeline;
  } }));
  const modelArtifact = resolveEmbeddingArtifactIdentity({ provider: 'xenova', modelId, modelsDir: dir });
  const pipelinePeers = []; now = originalNow() + 60_000; Date.now = () => now;
  for (let index = 1; index <= 16; index++) {
    const peer = getEmbeddingAdapter({ provider: 'xenova', modelId, modelsDir: dir, modelArtifact,
      sessionOptions: { intraOpNumThreads: index } }); leases.push(peer); pipelinePeers.push(peer);
    await peer.embedOne('pipeline peer');
  }
  now -= 30_000;
  const pipelineVictim = getEmbeddingAdapter({ provider: 'xenova', modelId, modelsDir: dir, modelArtifact,
    sessionOptions: { intraOpNumThreads: 17 } }); leases.push(pipelineVictim);
  await pipelineVictim.embedOne('new pipeline LRU victim');
  const pipelineVictimValue = loadedPipelines.at(-1);
  const pipelineVictimOwner = getRetiredEmbeddingCacheOwners().find(candidate => candidate.resource === pipelineVictimValue.pipeline);
  assert.equal(pipelineVictimOwner.kind, 'embedding-pipeline-cache-entry'); assert.equal(pipelineVictimOwner.references, 1);
  assert.equal(pipelineVictimValue.closes, 0); await pipelineVictim.embedOne('still owned after lookup retirement');
  await pipelineVictim.dispose(); assert.equal(pipelineVictimValue.closes, 1);
  await Promise.all(pipelinePeers.map(peer => peer.dispose())); Date.now = originalNow;
} finally {
  Date.now = originalNow; releaseRun?.();
  for (const gate of gates) gate.resolve();
  for (const cleanup of cleanups) cleanup();
  for (const fixture of fixtures) fixture.errors.length = 0;
  await Promise.allSettled(leases.map(lease => lease.dispose()));
  for (const owner of api?.getRetiredEmbeddingCacheOwners() || []) await owner.release().catch(() => {});
  await api?.disposeEmbeddingAdapterCaches().catch(() => {});
  api?.__setAdapterFactoryForTests(null); api?.__setTransformersModuleLoaderForTests(null);
  globalThis.FinalizationRegistry = originalRegistry;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Outer cache exact retirement/finalizer/provider controls authored; all execution deferred.');
