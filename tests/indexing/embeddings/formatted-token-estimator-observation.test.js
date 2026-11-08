import assert from 'node:assert/strict';
import { createEmbedder } from '../../../src/index/embedding.js';
import { __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { createEmbeddingTokenEstimator, isTerminalEmbeddingTokenEstimateFailure } from '../../../src/shared/embedding-token-estimation.js';
import { errorGraphSome } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/embeddings/formatted-token-estimator-observation/')[1];
assert.ok(['formatted-counts-and-release', 'ordinary-fallback-and-cancellation', 'original-native-and-nested-terminal'].includes(mode));
const contains = (error, target) => errorGraphSome(error, value => Object.is(value, target));
let currentEstimate, disposed = 0, settled = true;
const wrappers = [];
__setAdapterFactoryForTests(() => ({ provider: 'xenova', embed: async () => [], embedOne: async () => [],
  estimateTokensBatch(texts) { return currentEstimate.call(this, texts); }, dispose: async () => { disposed++; } }));
const make = () => {
  const wrapper = createEmbedder({ modelId: 'intfloat/e5-small-v2', provider: 'xenova', dims: 3, useStubEmbeddings: true });
  wrappers.push(wrapper); return wrapper;
};
try {
  if (mode === 'formatted-counts-and-release') {
    let calls = 0, releases = 0;
    const original = [3, 0];
    Object.defineProperty(original, 'release', { value: async function () { assert.equal(this, original); releases++; return 'released'; } });
    currentEstimate = function (texts) { calls++; assert.deepEqual(texts, ['passage: alpha', 'passage: beta']); return original; };
    const wrapper = make();
    assert.deepEqual(await wrapper.getChunkEmbeddings.estimateTokensBatch([]), []); assert.equal(calls, 0);
    const counts = await wrapper.getChunkEmbeddings.estimateTokensBatch(['alpha', 'beta']);
    assert.deepEqual([...counts], [3, 4], 'fallback counts include the exact formatted passage');
    assert.equal(await counts.release(), 'released'); assert.equal(releases, 1); assert.equal(calls, 1);
  } else if (mode === 'ordinary-fallback-and-cancellation') {
    for (const failure of [undefined, null, false, 0, new Error('ordinary optional failure')]) {
      currentEstimate = () => { throw failure; };
      assert.deepEqual(await make().getChunkEmbeddings.estimateTokensBatch(['alpha']), [4]);
    }
    for (const failure of [Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      Object.assign(new Error('cancelled by code'), { code: 'ABORT_ERR' }), new AggregateError([new Error('inner failed')])]) {
      currentEstimate = () => { throw failure; };
      await assert.rejects(make().getChunkEmbeddings.estimateTokensBatch(['alpha']), error => contains(error, failure));
    }
    let released = false;
    const malformed = [];
    Object.defineProperty(malformed, 'release', { value: async function () { assert.equal(this, malformed); await Promise.resolve(); released = true; } });
    currentEstimate = () => malformed;
    assert.deepEqual(await make().getChunkEmbeddings.estimateTokensBatch(['alpha']), [4]); assert.equal(released, true);
  } else {
    settled = false;
    const original = Object.freeze(Object.assign(new Error('native estimator still owns work'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    }));
    currentEstimate = () => { throw original; };
    let retained;
    await assert.rejects(make().getChunkEmbeddings.estimateTokensBatch(['alpha']), error => {
      retained = error; return contains(error, original) && isTerminalEmbeddingTokenEstimateFailure(error);
    });
    assert.equal(retained.cacheOwnershipReleased(), false);
    settled = true; assert.equal(retained.cacheOwnershipReleased(), true);
    currentEstimate = () => { throw retained; };
    const nested = createEmbeddingTokenEstimator({ estimate: make().getChunkEmbeddings.estimateTokensBatch, fallback: () => 1 });
    await assert.rejects(nested(['alpha']), error => contains(error, original) && isTerminalEmbeddingTokenEstimateFailure(error),
      'late settlement cannot turn a previously retained terminal failure into a heuristic count');
  }
} finally {
  settled = true;
  await Promise.all(wrappers.map(wrapper => wrapper.dispose()));
  await disposeEmbeddingAdapterCaches(); __setAdapterFactoryForTests(null);
}
assert.ok(disposed > 0);
console.log('Formatted passage token estimation retains ordinary fallback, original preparation and terminal native failures.');
