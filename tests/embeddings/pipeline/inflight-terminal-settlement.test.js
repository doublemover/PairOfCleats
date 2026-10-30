import assert from 'node:assert/strict';
import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { createEmbeddingInFlightCoalescer, createEmbeddingTextReuseCache } from '../../../tools/build/embeddings/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const entry = texts => ({ items: texts.map((_, index) => ({ index })), codeTexts: texts,
  docTexts: texts.map(() => ''), codeMapping: texts.map((_, index) => index), docMapping: texts.map((_, index) => index) });
const makeProcessor = (cache, coalescer, overrides) => createFileEmbeddingsProcessor({
  embeddingBatchSize: 64, embeddingBatchTokenBudget: 4096,
  estimateEmbeddingTokens: text => Math.max(1, text.length),
  runBatched: ({ texts, embed }) => embed(texts),
  assertVectorArrays: (vectors, length) => {
    assert.equal(vectors.length, length);
    for (const vector of vectors) assert.ok(Array.isArray(vector) && vector.length > 0);
  }, scheduleCompute: fn => fn(), processFileEmbeddings: async () => {}, mode: 'code',
  embeddingTextCache: cache, embeddingInFlightCoalescer: coalescer, ...overrides
});

for (const failAt of [1, 2, null]) {
  const ready = deferred(), compute = deferred();
  const terminal = new AggregateError([new Error('persistent cache terminal failure')], 'publication failure');
  let sets = 0, calls = 0;
  const cache = createEmbeddingTextReuseCache({ persistentStore: { get: () => null, set() {
    if (++sets === failAt) throw terminal;
  } } });
  const coalescer = createEmbeddingInFlightCoalescer();
  const processor = makeProcessor(cache, coalescer, { getChunkEmbeddings: async texts => {
    calls += 1; ready.resolve(); await compute.promise;
    return texts.map(text => [text.length]);
  } });
  const first = entry(['alpha', 'alpha', 'beta']), second = entry(['alpha', 'beta']);
  const owner = processor(first); owner.catch(() => {});
  await ready.promise;
  const follower = processor(second); follower.catch(() => {});
  const firstClaim = coalescer.claim('alpha'), secondClaim = coalescer.claim('beta');
  const witnessed = Promise.allSettled([firstClaim.promise, secondClaim.promise]);
  compute.resolve();
  const outcomes = await Promise.allSettled([owner, follower]);
  assert.equal(calls, 1, 'followers do not retry inference after publication failure');
  assert.equal(coalescer.stats().size, 0, 'every owned claim is settled on every exit');
  const claims = await witnessed;
  if (failAt === null) {
    assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'fulfilled']);
    assert.deepEqual(first.codeEmbeds, [[5], [5], [4]]);
    assert.deepEqual(second.codeEmbeds, [[5], [4]]);
  } else {
    for (const outcome of outcomes) { assert.equal(outcome.status, 'rejected'); assert.equal(outcome.reason, terminal); }
    assert.equal(claims[failAt - 1].reason, terminal);
    assert.equal(cache.get(failAt === 1 ? 'alpha' : 'beta'), null, 'terminal persistence cannot warm a healthy memory hit');
    if (failAt === 2) { assert.equal(claims[0].status, 'fulfilled'); assert.deepEqual(claims[0].value, [5]); }
  }
  await processor.drain();
}

// A stale finalizer cannot delete or settle a later owner for the same text.
const coalescer = createEmbeddingInFlightCoalescer();
const old = coalescer.claim('replacement'); old.resolve([1]);
const replacement = coalescer.claim('replacement');
old.reject(new Error('late old rejection')); old.resolve([2]);
assert.equal(coalescer.stats().size, 1);
const joined = coalescer.claim('replacement'); assert.equal(joined.owner, false);
replacement.resolve([3]); assert.deepEqual(await joined.promise, [3]);
assert.equal(coalescer.stats().size, 0);

for (const phase of ['inference', 'estimate', 'release']) {
  const ready = deferred(), barrier = deferred();
  const terminal = Object.freeze(Object.assign(new Error(`terminal ${phase}`), phase === 'estimate'
    ? { name: 'AbortError', code: 'ABORT_ERR' } : {}));
  const claims = createEmbeddingInFlightCoalescer();
  let calls = 0;
  const cache = createEmbeddingTextReuseCache();
  const processor = makeProcessor(cache, claims, {
    estimateEmbeddingTokensBatch: phase === 'estimate' ? async () => {
      ready.resolve(); await barrier.promise; throw terminal;
    } : async texts => Object.assign(texts.map(text => text.length), {
      release() { assert.ok(Array.isArray(this), 'original estimate release receiver is retained'); if (phase === 'release') throw terminal; }
    }),
    getChunkEmbeddings: async texts => {
      calls += 1; ready.resolve(); await barrier.promise;
      if (phase === 'inference') throw terminal;
      return texts.map(text => [text.length]);
    }
  });
  const owner = processor(entry(['shared'])); owner.catch(() => {});
  await ready.promise;
  const follower = processor(entry(['shared'])); follower.catch(() => {});
  barrier.resolve();
  for (const outcome of await Promise.allSettled([owner, follower])) {
    assert.equal(outcome.status, 'rejected'); assert.equal(outcome.reason, terminal);
  }
  assert.equal(claims.stats().size, 0);
  assert.equal(calls, phase === 'estimate' ? 0 : 1);
}

const advisoryCache = createEmbeddingTextReuseCache({ persistentStore: { set() { throw new Error('ordinary advisory write'); } } });
advisoryCache.set('safe', [7]); assert.deepEqual(advisoryCache.get('safe'), [7]);
const capped = createEmbeddingInFlightCoalescer({ maxEntries: 1 });
const uncached = entry(['one', 'second']);
await makeProcessor(createEmbeddingTextReuseCache(), capped, {
  estimateEmbeddingTokensBatch: async () => { throw new Error('ordinary estimate fallback'); },
  getChunkEmbeddings: async texts => texts.map(text => [text.length])
})(uncached);
assert.deepEqual(uncached.codeEmbeds, [[3], [6]]);
assert.equal(capped.stats().size, 0); assert.equal(capped.stats().bypassed, 1);
console.log('Production embedding coalescer settles publication/estimate/provider/release failures and preserves replacement ownership.');
