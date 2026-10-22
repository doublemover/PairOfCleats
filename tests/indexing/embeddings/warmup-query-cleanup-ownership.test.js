import assert from 'node:assert/strict';
import { getRetiredEmbeddingCacheOwners, disposeEmbeddingAdapterCaches, __setAdapterFactoryForTests,
  warmEmbeddingAdapter } from '../../../src/shared/embedding-adapter.js';
import { getQueryEmbedding } from '../../../src/retrieval/embedding.js';

// Source-only actual warmup/query consumer controls with inert adapter objects.
const artifact = Object.freeze({ status: 'stub', reuse: 'allow', digest: null, revision: null, method: 'deterministic-stub' });
const options = { provider: 'xenova', modelId: 'fixture-cleanup', modelArtifact: artifact };
const leaf = Object.freeze(new Error('original frozen leaf'));
const primary = Object.freeze(Object.assign(new AggregateError([leaf], 'frozen primary failure', { cause: leaf }), { code: 'CONTROLLED_PRIMARY' }));
const cleanupLeaf = Object.freeze(new Error('cleanup original leaf'));
const cleanup = Object.freeze(new AggregateError([cleanupLeaf], 'frozen cleanup failure', { cause: cleanupLeaf }));
const rejected = work => work.then(() => assert.fail('pending cleanup must be observable'), error => error);
let releaseExternal;
try {
  let closes = 0, creates = 0, raw;
  __setAdapterFactoryForTests(() => {
    creates++;
    raw = { embedderPromise: Promise.reject(primary), dispose: async function () {
      assert.equal(this, raw); closes++; if (closes === 1) throw cleanup;
    } };
    return raw;
  });
  const warming = warmEmbeddingAdapter(options);
  raw.dispose = () => assert.fail('warmup cleanup retains the original adapter method');
  const failure = await rejected(warming);
  assert.equal(failure.cause, primary); assert.deepEqual(failure.errors, [primary, failure.cleanupErrors[0]]);
  assert.equal(failure.code, 'CONTROLLED_PRIMARY'); assert.equal(failure.cleanupErrors[0].cause, cleanup);
  assert.equal(primary.cause, leaf); assert.deepEqual(primary.errors, [leaf]); assert.equal(primary.cleanupErrors, undefined);
  assert.equal(cleanup.cause, cleanupLeaf); assert.deepEqual(cleanup.errors, [cleanupLeaf]);
  assert.equal(failure.cacheOwnershipPending, true); assert.equal(closes, 1);
  const owner = failure.cleanupErrors[0].embeddingCacheOwner;
  const exact = owner.release(); assert.equal(owner.release(), exact); await exact;
  assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(closes, 2); assert.equal(creates, 1);
  assert.equal(getRetiredEmbeddingCacheOwners().includes(owner), false);

  // Established ordinary unavailable handling still returns null, while the
  // caller's explicit throwOnError keeps the exact immutable primary.
  let ordinaryCloses = 0;
  __setAdapterFactoryForTests(() => ({ embedderPromise: Promise.reject(primary), dispose: async () => { ordinaryCloses++; } }));
  assert.equal(await warmEmbeddingAdapter(options), null); assert.equal(ordinaryCloses, 1);
  assert.equal(await rejected(warmEmbeddingAdapter({ ...options, throwOnError: true })), primary);
  assert.equal(ordinaryCloses, 2);

  let externalClosed = false, partialCloses = 0;
  releaseExternal = () => { externalClosed = true; };
  const pendingPrimary = new Error('startup supplied an exact external native observer');
  Object.defineProperties(pendingPrimary, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
    assert.equal(this, pendingPrimary); return externalClosed;
  } } }); Object.freeze(pendingPrimary);
  __setAdapterFactoryForTests(() => ({ embedderPromise: Promise.reject(pendingPrimary), dispose: async () => { partialCloses++; } }));
  const startupFailure = await rejected(warmEmbeddingAdapter(options));
  assert.equal(startupFailure.cause, pendingPrimary); assert.equal(partialCloses, 1);
  const partialOwner = startupFailure.cleanupErrors[0].embeddingCacheOwner;
  await rejected(partialOwner.release()); assert.equal(partialCloses, 1, 'completed outer disposal is not repeated');
  releaseExternal(); await partialOwner.release(); assert.equal(startupFailure.cacheOwnershipReleased(), true);

  // The actual retrieval consumer preserves both frozen failures instead of
  // replacing the inference failure in finally and then returning null.
  let queryCloses = 0, queryCreates = 0;
  __setAdapterFactoryForTests(() => {
    queryCreates++;
    return { embedOne: async () => { throw primary; }, dispose: async () => {
      queryCloses++; if (queryCloses === 1) throw cleanup;
    } };
  });
  const queryFailure = await rejected(getQueryEmbedding({ ...options, text: 'query', dims: 2 }));
  assert.equal(queryFailure.cause, primary); assert.equal(queryFailure.cleanupErrors[0].cause, cleanup);
  assert.equal(queryFailure.cacheOwnershipPending, true); assert.equal(queryCreates, 1); assert.equal(queryCloses, 1);
  await queryFailure.cleanupErrors[0].embeddingCacheOwner.release();
  assert.equal(queryFailure.cacheOwnershipReleased(), true); assert.equal(queryCloses, 2); assert.equal(queryCreates, 1);

  __setAdapterFactoryForTests(() => ({ embedOne: async () => { throw primary; }, dispose: async () => {} }));
  assert.equal(await getQueryEmbedding({ ...options, text: 'ordinary unavailable', dims: 2 }), null);
} finally {
  releaseExternal?.();
  for (const owner of getRetiredEmbeddingCacheOwners()) await owner.release().catch(() => {});
  await disposeEmbeddingAdapterCaches().catch(() => {});
  __setAdapterFactoryForTests(null);
}
console.log('Warmup/query frozen-primary and exact pending cleanup controls authored; execution deferred.');
