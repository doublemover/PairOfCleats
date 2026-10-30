import assert from 'node:assert/strict';
import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { createEmbeddingInFlightCoalescer, createEmbeddingTextReuseCache } from '../../../tools/build/embeddings/runner.js';
import { assertVectorArrays } from '../../../src/shared/embedding-batches.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = texts => ({ items: texts.map((_text, index) => ({ index })), codeTexts: texts,
  docTexts: [], codeMapping: texts.map((_text, index) => index), docMapping: [] });
const vector = text => [text.length, text.charCodeAt(0)];
for (const scenario of ['success', 'first', 'second', 'inference', 'estimate', 'estimate-advisory', 'advisory', 'cancel', 'pending', 'cleanup']) {
  const entered = gate(), release = gate(), joined = gate();
  const primary = scenario === 'cancel' ? Object.assign(new Error('original cancellation'), { name: 'AbortError', code: 'ABORT_ERR' })
    : scenario === 'pending' ? Object.assign(new Error('original storage owner remains pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => settled })
      : new AggregateError([new Error('original terminal cache/provider failure')], scenario);
  const secondary = new Error('original token-row release failure');
  let settled = false, calls = 0, writes = 0, releases = 0;
  const coalescer = createEmbeddingInFlightCoalescer();
  const cache = createEmbeddingTextReuseCache({ persistentStore: { get: () => null,
    set() {
      writes++;
      if ((scenario === 'first' || scenario === 'cancel' || scenario === 'pending') && writes === 1
        || scenario === 'second' && writes === 2) throw primary;
      if (scenario === 'advisory') throw new Error('settled optional persistence error');
    } } });
  const originalClaim = coalescer.claim;
  coalescer.claim = function (text) { const result = originalClaim.call(this, text); if (!result.owner) joined.resolve(); return result; };
  const processor = createFileEmbeddingsProcessor({ embeddingBatchSize: 8, mode: 'code',
    getChunkEmbeddings: async texts => {
      calls++; entered.resolve(); await release.promise;
      if (scenario === 'inference' || scenario === 'cleanup') throw primary;
      return texts.map(vector);
    },
    estimateEmbeddingTokensBatch: async texts => {
      if (scenario === 'estimate') { entered.resolve(); await release.promise; throw primary; }
      if (scenario === 'estimate-advisory') throw new Error('settled estimation fallback');
      if (scenario === 'cleanup') return Object.assign(texts.map(() => 1), { release() { releases++; throw secondary; } });
      return texts.map(() => 1);
    }, runBatched: ({ texts, embed }) => embed(texts), assertVectorArrays,
    scheduleCompute: action => action(), processFileEmbeddings: async () => {},
    embeddingTextCache: cache, embeddingInFlightCoalescer: coalescer });
  const ownerEntry = entry(['alpha', 'beta']), followerEntry = entry(['alpha', 'beta']);
  const owner = processor(ownerEntry); owner.catch(() => {});
  await entered.promise;
  const follower = processor(followerEntry); follower.catch(() => {});
  await joined.promise;
  release.resolve();
  const outcomes = await Promise.allSettled([owner, follower]);
  const failed = ['first', 'second', 'inference', 'estimate', 'cancel', 'pending', 'cleanup'].includes(scenario);
  assert.equal(outcomes[0].status, failed ? 'rejected' : 'fulfilled', scenario);
  assert.equal(outcomes[1].status, failed ? 'rejected' : 'fulfilled', scenario);
  if (failed) for (const outcome of outcomes) {
    assert.ok(errorGraphIncludes(outcome.reason, primary), scenario);
    if (scenario === 'cleanup') assert.ok(errorGraphIncludes(outcome.reason, secondary));
    if (scenario === 'pending') assert.equal(outcome.reason.cacheOwnershipReleased(), false);
  }
  else {
    assert.deepEqual(ownerEntry.codeEmbeds, ['alpha', 'beta'].map(vector));
    assert.deepEqual(followerEntry.codeEmbeds, ownerEntry.codeEmbeds);
  }
  assert.equal(coalescer.stats().size, 0, 'every acquired claim is settled');
  assert.equal(calls, scenario === 'estimate' ? 0 : 1, 'followers never repeat inference after a terminal failure');
  assert.equal(releases, scenario === 'cleanup' ? 1 : 0);
  assert.equal(processor.batchingStats().activeProviderCalls, 0);
  if (scenario === 'second') assert.deepEqual(cache.get('alpha'), vector('alpha'), 'earlier committed success survives later failure');
  settled = true;
  await processor.drain();
}
const coalescer = createEmbeddingInFlightCoalescer();
const old = coalescer.claim('replacement'); old.resolve([1]);
const replacement = coalescer.claim('replacement');
old.reject(new Error('late stale finalizer')); old.resolve([99]);
const follower = coalescer.claim('replacement');
assert.equal(follower.owner, false); assert.equal(follower.promise, replacement.promise);
assert.equal(coalescer.stats().size, 1);
replacement.resolve([2]); assert.deepEqual(await follower.promise, [2]);
assert.equal(coalescer.stats().size, 0);
console.log('Actual production claims settle across post-inference cache, cancellation, estimation and cleanup failures without abandoning followers.');
