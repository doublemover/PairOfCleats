import assert from 'node:assert/strict';
import { createEmbeddingTokenEstimator, isTerminalEmbeddingTokenEstimateFailure } from '../../../src/shared/embedding-token-estimation.js';
import { errorGraphSome } from '../../helpers/error-graph.js';
import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { runBatched } from '../../../tools/build/embeddings/embed.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('embeddings/runner/token-estimator-original-observation/')[1];
assert.ok(['counts-and-original-release', 'ordinary-fallback-and-terminal-errors', 'original-frozen-pending-error',
  'pending-result-and-each-field', 'inspection-failure-is-retained'].includes(mode));
const contains = (error, target) => errorGraphSome(error, value => Object.is(value, target));
if (mode === 'counts-and-original-release') {
  let calls = 0, releases = 0, fallbackCalls = 0, coercions = 0;
  const receiver = {}, original = [2, '3', 0, Number.MAX_VALUE, { valueOf() { coercions++; return 5; } }];
  Object.defineProperty(original, 'release', { value() { assert.equal(this, original); releases++; return 'original-completion'; } });
  const estimate = createEmbeddingTokenEstimator({ receiver, estimate(texts) { assert.equal(this, receiver); calls++; assert.equal(texts.length, 5); return original; },
    fallback() { fallbackCalls++; return 7; } });
  const counts = await estimate(['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual([...counts], [2, 3, 7, 7, 7]); assert.equal(calls, 1); assert.equal(fallbackCalls, 3); assert.equal(coercions, 0);
  assert.equal(await counts.release(), 'original-completion'); assert.equal(releases, 1);
  assert.equal(Object.keys(counts).includes('release'), false);
} else if (mode === 'ordinary-fallback-and-terminal-errors') {
  assert.equal(createEmbeddingTokenEstimator({ estimate: null, fallback: () => 1 }), null);
  for (const failure of [undefined, null, false, 0, '', new Error('ordinary optional estimator failure')]) {
    let calls = 0; const estimate = createEmbeddingTokenEstimator({ estimate() { calls++; throw failure; }, fallback: () => 1 });
    assert.equal(await estimate(['one']), null); assert.equal(calls, 1);
  }
  for (const failure of [Object.assign(new Error('cancelled'), { name: 'AbortError' }),
    Object.assign(new Error('cancelled by code'), { code: 'ABORT_ERR' }), new AggregateError([new Error('native estimate failed')], 'terminal aggregate')]) {
    const estimate = createEmbeddingTokenEstimator({ estimate() { throw failure; }, fallback: () => 1 });
    await assert.rejects(estimate(['one']), error => error === failure);
  }
  const malformed = createEmbeddingTokenEstimator({ estimate: () => [], fallback: () => 1 }); assert.equal(await malformed(['one']), null);
  let releases = 0; const original = [];
  Object.defineProperty(original, 'release', { value() { assert.equal(this, original); releases++; } });
  const malformedOwned = createEmbeddingTokenEstimator({ estimate: () => original, fallback: () => 1 });
  assert.equal(await malformedOwned(['one']), null); assert.equal(releases, 1, 'ordinary malformed estimates retire their original pure preparation');
} else if (mode === 'original-frozen-pending-error') {
  let ready = false, codeReads = 0;
  const primary = new Error('original estimate remains outstanding');
  Object.defineProperties(primary, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() { assert.equal(this, primary); return ready; } },
    code: { get() { codeReads++; ready = true; return 'ordinary'; } } }); Object.freeze(primary);
  const estimate = createEmbeddingTokenEstimator({ estimate() { throw primary; }, fallback: () => 1 });
  let failure; try { await estimate(['one']); assert.fail('original unknown work must not become a null estimate'); } catch (error) { failure = error; }
  assert.ok(contains(failure, primary)); assert.equal(codeReads, 0); assert.equal(failure.cacheOwnershipReleased(), false);
  ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(isTerminalEmbeddingTokenEstimateFailure(failure), true, 'late settlement cannot turn the original failure into heuristic fallback');
  ready = false; let dispatches = 0, published = 0;
  const processor = createFileEmbeddingsProcessor({ embeddingBatchSize: 1, mode: 'code', runBatched,
    scheduleCompute: action => action(), getChunkEmbeddings: async () => { dispatches++; return [[1, 2]]; },
    estimateEmbeddingTokensBatch: async texts => {
      try { return await estimate(texts); } catch (error) { ready = true; throw error; }
    }, estimateEmbeddingTokens: () => 1, assertVectorArrays: (vectors, count) => assert.equal(vectors.length, count),
    processFileEmbeddings: async () => { published++; } });
  await assert.rejects(processor({ items: [{ index: 0 }], codeTexts: ['one'], docTexts: [], codeMapping: [0], docMapping: [] }),
    error => contains(error, primary) && isTerminalEmbeddingTokenEstimateFailure(error));
  await assert.rejects(processor.drain(), error => contains(error, primary) && isTerminalEmbeddingTokenEstimateFailure(error),
    'the preparation admission owner retains the same terminal failure at drain');
  assert.equal(dispatches, 0); assert.equal(published, 0); assert.equal(codeReads, 0);
} else if (mode === 'pending-result-and-each-field') {
  for (const trigger of ['initial', 'element', 'release']) {
    let ready = trigger !== 'initial', laterReads = 0, releases = 0;
    const original = [1, 2];
    Object.defineProperties(original, { cacheOwnershipReleased: { value: () => ready },
      release: { get() { if (trigger === 'release') ready = false; return () => { releases++; }; } } });
    if (trigger === 'element') {
      Object.defineProperty(original, 0, { get() { ready = false; return 1; } });
      Object.defineProperty(original, 1, { get() { laterReads++; ready = true; return 2; } });
    }
    const estimate = createEmbeddingTokenEstimator({ estimate: () => original, fallback: () => 1 });
    let failure; try { await estimate(['one', 'two']); assert.fail('original result must remain guarded'); } catch (error) { failure = error; }
    assert.ok(contains(failure, original)); assert.equal(laterReads, 0); assert.equal(releases, 0);
    assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
} else {
  for (const primary of [null, 0, Object.freeze(new Error('release getter failed'))]) {
    const original = [1]; Object.defineProperty(original, 'release', { get() { throw primary; } });
    const estimate = createEmbeddingTokenEstimator({ estimate: () => original, fallback: () => 1 });
    await assert.rejects(estimate(['one']), error => contains(error, original) && contains(error, primary) && isTerminalEmbeddingTokenEstimateFailure(error));
  }
  const original = [], cleanup = Object.freeze(Object.assign(new Error('invalid-result release failed'), { code: 'ERR_CONTROLLED_TOKEN_RELEASE' }));
  Object.defineProperty(original, 'release', { value() { assert.equal(this, original); throw cleanup; } });
  const estimate = createEmbeddingTokenEstimator({ estimate: () => original, fallback: () => 1 });
  await assert.rejects(estimate(['one']), error => contains(error, original) && contains(error, cleanup)
    && error.code === cleanup.code && error.message === cleanup.message);
  const valid = [1];
  Object.defineProperty(valid, 'release', { value() { assert.equal(this, valid); throw cleanup; } });
  const prepared = await createEmbeddingTokenEstimator({ estimate: () => valid, fallback: () => 1 })(['one']);
  await assert.rejects(prepared.release(), error => contains(error, valid) && contains(error, cleanup)
    && error.code === cleanup.code && error.message === cleanup.message);
  const abort = Object.assign(new Error('fallback cancelled'), { name: 'AbortError' }), cancelledPreparation = [0]; let releases = 0;
  Object.defineProperty(cancelledPreparation, 'release', { value() { assert.equal(this, cancelledPreparation); releases++; throw 0; } });
  const cancelled = createEmbeddingTokenEstimator({ estimate: () => cancelledPreparation, fallback() { throw abort; } });
  await assert.rejects(cancelled(['one']), error => contains(error, abort) && contains(error, 0)); assert.equal(releases, 1);
}
console.log('Optional token estimates preserve original result/failure observations and release receiver.');
