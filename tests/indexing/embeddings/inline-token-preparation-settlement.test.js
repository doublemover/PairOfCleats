import assert from 'node:assert/strict';
import { createInlineEmbeddingBatcher } from '../../../src/shared/embedding-inline-batcher.js';
import { createEmbeddingTokenEstimator, isTerminalEmbeddingTokenEstimateFailure } from '../../../src/shared/embedding-token-estimation.js';
import { errorGraphSome } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/embeddings/inline-token-preparation-settlement/')[1];
assert.ok(['awaited-release-and-late-join', 'provider-and-release-failures', 'original-pending-preparation',
  'guarded-single-release', 'strict-falsy-estimator-failures', 'bounded-held-results-and-cancellation'].includes(mode));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const contains = (error, target) => errorGraphSome(error, value => Object.is(value, target));
const turn = () => new Promise(resolve => setImmediate(resolve));
const countsWithRelease = (counts, release) => Object.defineProperty(counts, 'release', { value: release });

if (mode === 'awaited-release-and-late-join') {
  const started = deferred(), finish = deferred(); let releases = 0, dispatches = 0, completed = false;
  const provider = async texts => { dispatches++; return texts.map(text => Float32Array.of(text.length)); };
  let original;
  provider.estimateTokensBatch = texts => {
    original = countsWithRelease(texts.map(() => 1), async function () {
      assert.equal(this, original); releases++; started.resolve(); await finish.promise;
    }); return original;
  };
  const batcher = createInlineEmbeddingBatcher(provider);
  const first = batcher.request(['shared']).then(value => { completed = true; return value; });
  await started.promise; await turn(); assert.equal(completed, false, 'success waits for original preparation cleanup');
  const late = batcher.request(['shared']);
  finish.resolve();
  assert.deepEqual(Array.from((await first)[0]), [6]); assert.deepEqual(Array.from((await late)[0]), [6]);
  assert.equal(dispatches, 1, 'a requester joining during cleanup receives the retained shared vector');
  assert.equal(releases, 1); await batcher.close(); assert.equal(batcher.stats().pendingBytes, 0);
} else if (mode === 'provider-and-release-failures') {
  for (const primary of [undefined, false, new Error('provider failed')]) {
    let releases = 0; const cleanup = Object.freeze(new Error('preparation release failed'));
    const provider = async () => { throw primary; };
    provider.estimateTokensBatch = () => countsWithRelease([1], async () => { releases++; throw cleanup; });
    const batcher = createInlineEmbeddingBatcher(provider);
    await assert.rejects(batcher.request(['one']), error => contains(error, primary) && contains(error, cleanup));
    assert.equal(releases, 1); await batcher.close(); assert.equal(batcher.stats().pendingItems, 0);
  }
} else if (mode === 'original-pending-preparation') {
  let settled = false, dispatches = 0, releases = 0;
  const original = countsWithRelease([1], () => { releases++; });
  Object.defineProperties(original, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() { assert.equal(this, original); return settled; } } });
  const provider = async () => { dispatches++; return [Float32Array.of(1)]; };
  provider.estimateTokensBatch = () => original;
  const batcher = createInlineEmbeddingBatcher(provider);
  await assert.rejects(batcher.request(['one']), error => contains(error, original) && error.cacheOwnershipReleased() === false);
  await assert.rejects(batcher.request(['two']), error => contains(error, original));
  await assert.rejects(batcher.close(), error => contains(error, original));
  assert.equal(dispatches, 0); assert.equal(releases, 0, 'unknown original work grants no automatic release authority');
  settled = true; await batcher.close(); assert.equal(batcher.stats().pendingItems, 0);
} else if (mode === 'guarded-single-release') {
  let settled = true, releases = 0;
  const original = countsWithRelease([1], function () { assert.equal(this, original); releases++; });
  Object.defineProperty(original, 'cacheOwnershipReleased', { value: () => settled });
  const estimate = createEmbeddingTokenEstimator({ estimate: () => original, fallback: () => 1 });
  const counts = await estimate(['one']); settled = false;
  const releasing = counts.release();
  await assert.rejects(releasing, error => contains(error, original) && isTerminalEmbeddingTokenEstimateFailure(error));
  settled = true;
  assert.equal(counts.release(), releasing, 'a failed release is not automatically replayed'); assert.equal(releases, 0);
  let safeReleases = 0;
  const safe = await createEmbeddingTokenEstimator({ estimate: () => countsWithRelease([1], () => { safeReleases++; return 'done'; }), fallback: () => 1 })(['one']);
  const completion = safe.release(); assert.equal(safe.release(), completion); assert.equal(await completion, 'done'); assert.equal(safeReleases, 1);
} else if (mode === 'strict-falsy-estimator-failures') {
  for (const primary of [undefined, null, false, 0, '', new Error('ordinary estimator rejected')]) {
    let dispatches = 0;
    const provider = async () => { dispatches++; return [Float32Array.of(1)]; };
    provider.estimateTokensBatch = () => { throw primary; };
    const batcher = createInlineEmbeddingBatcher(provider);
    const [result] = await Promise.allSettled([batcher.request(['one'])]);
    assert.equal(result.status, 'rejected'); assert.equal(result.reason, primary); assert.equal(dispatches, 0);
    await batcher.close(); assert.equal(batcher.stats().pendingBytes, 0);
  }
} else {
  const releaseStarted = deferred(), releaseFinish = deferred(), abort = new AbortController();
  const provider = async texts => texts.map(() => Float32Array.of(1, 2));
  provider.estimateTokensBatch = texts => countsWithRelease(texts.map(() => 1), async () => { releaseStarted.resolve(); await releaseFinish.promise; });
  const batcher = createInlineEmbeddingBatcher(provider, { maxQueuedBytes: 1024 });
  const waiting = batcher.request(['one'], { signal: abort.signal });
  const rejected = assert.rejects(waiting, error => error.name === 'AbortError');
  await releaseStarted.promise;
  assert.ok(batcher.stats().pendingBytes >= 142, 'held vectors count against the existing queue byte admission');
  abort.abort(); await rejected;
  let closed = false; const closing = batcher.close().then(() => { closed = true; });
  await turn(); assert.equal(closed, false); releaseFinish.resolve(); await closing;
  assert.equal(batcher.stats().pendingBytes, 0); assert.equal(batcher.stats().pendingItems, 0);
  const oversized = createInlineEmbeddingBatcher(async () => [new Float32Array(256)], { maxQueuedBytes: 1024 });
  await assert.rejects(oversized.request(['one']), RangeError); await oversized.close(); assert.equal(oversized.stats().pendingBytes, 0);
}
console.log('Inline preparation settles before request success, retains original failures and bounds held results.');
