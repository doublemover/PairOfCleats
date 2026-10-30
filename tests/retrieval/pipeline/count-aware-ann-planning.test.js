import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { eligibleAnnCardinality, planCountAwareAnn, resolveCountAwareAnnPolicy,
  snapshotCountAwareStoredDense, createCountAwareAnnWork } from '../../../src/retrieval/pipeline/count-aware-ann.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';
import { getGenerationProviderRuntime } from '../../../src/retrieval/pipeline/provider-runtime.js';

const settings = { enabled: true, exactRows: 8, coordinateWork: 32, maxAttempts: 3,
  requestedHitWork: 64, maxTopN: 32, maxMs: 1000 };
const policy = resolveCountAwareAnnPolicy(settings);
assert.equal(resolveCountAwareAnnPolicy(null), null); assert.equal(resolveCountAwareAnnPolicy({ enabled: false }), null);
assert.equal(eligibleAnnCardinality(null), null); assert.equal(eligibleAnnCardinality({}), null);
assert.equal(eligibleAnnCardinality(new Set()), 0); assert.equal(eligibleAnnCardinality(null, 4), 4);
for (const changed of [{ enabled: true }, { ...settings, coordinateWork: Infinity }, { ...settings, exactRows: -1 },
  { ...settings, arbitrary: 1 }, { ...settings, maxAttempts: 5 }]) assert.throws(() => resolveCountAwareAnnPolicy(changed));
assert.notEqual(resolveCountAwareAnnPolicy({ ...settings, exactRows: 7 }).key, policy.key);
const request = { policy, documentCount: 4, dims: 2, storedDenseAvailable: true, requestedTopN: 3 };
assert.equal(planCountAwareAnn({ ...request, eligibleIds: new Set() }).route, 'empty');
assert.equal(planCountAwareAnn({ ...request, eligibleIds: new Set([3]) }).route, 'stored-exhaustive');
assert.equal(planCountAwareAnn({ ...request, eligibleIds: {}, documentCount: null }).eligibleCount, null);
assert.equal(planCountAwareAnn({ ...request, storedDenseAvailable: false }).route, 'ann');
const dense = { dims: 2, minVal: -1, maxVal: 1, levels: 256, scale: 2 / 255,
  vectors: [[0, 0], [255, 0], [], [255, 255]] };
const saved = snapshotCountAwareStoredDense({ dense, eligibleIds: new Set([3, 1, 2]), documentCount: 4, policy });
assert.deepEqual(saved.sourceIds, [1, 2, 3]); assert.equal(saved.index.denseVec.vectors[1].length, 0);
dense.vectors[1][0] = 0; assert.equal(saved.index.denseVec.vectors[0][0], 255, 'exact route owns bounded selected bytes before yielding');
dense.vectors[1][0] = 255;
for (const invalid of [{ ...dense, scale: 1 }, { ...dense, dims: 3 }, { ...dense, vectors: [[NaN, 0], ...dense.vectors.slice(1)] }]) {
  assert.equal(snapshotCountAwareStoredDense({ dense: invalid, documentCount: 4, policy }), null);
}
const work = createCountAwareAnnWork({ policy, plan: planCountAwareAnn(request) });
for (let index = 0; index < 3; index++) assert(work.reserve('inert', 1));
assert.equal(work.reserve('inert', 1), null); assert.equal(work.receipt.reasonEnded, 'attempt-limit');
assert.equal(work.finish({ hits: [{ idx: 1 }] }).complete, false, 'filled output never certifies approximate recall');

let providerCalls = 0;
const fixture = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, {
  id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true, query: async () => { providerCalls++; throw new Error('exact route must bypass ANN'); }
}]]) });
fixture.context.topN = 1; fixture.context.countAwareAnnPolicy = settings;
fixture.context.scoreBlend = { enabled: true, sparseWeight: 0, annWeight: 1 };
fixture.idx.chunkMeta = Array.from({ length: 4 }, (_, id) => ({ id, file: `src/${id}.js`, tokens: ['alpha'], weight: 1 }));
fixture.idx.tokenIndex = { vocab: ['alpha'], postings: [[]], docLengths: [1, 1, 1, 1], totalDocs: 4, avgDocLen: 1 };
fixture.idx.denseVec = dense;
const exact = await createSearchPipeline(fixture.context)(fixture.idx, 'code', [1, 0]);
assert.equal(providerCalls, 0); assert.equal(exact[0].id, 1, 'production stored-dot ties preserve original document ordinals');
const exactReceipt = fixture.stageTracker.stages.find(row => row.stage === 'ann').countAware;
assert.equal(exactReceipt.eligibleCount, 4); assert.equal(exactReceipt.vectorsScored, 3);
assert.equal(exactReceipt.unscorableEligible, 1); assert.equal(exactReceipt.complete, true);
assert.match(exactReceipt.exactness, /not-original-fp32/);
assert.equal(exactReceipt.policyKey, policy.key);

let lazyLoads = 0;
const attempts = [], fallback = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, {
  id: ANN_PROVIDER_IDS.DENSE, capabilities: { progressiveEffort: true }, isAvailable: () => true,
  query: async ({ topN, candidateSet, signal }) => {
    attempts.push(topN); assert.equal(candidateSet, null); signal.throwIfAborted();
    return topN < 6 ? [{ idx: 0, sim: 0.1 }] : [{ idx: 3, sim: 1 }, { idx: 1, sim: 0.8 }, { idx: 0, sim: 0.1 }];
  }
}]]) });
fallback.context.topN = 1; fallback.context.countAwareAnnPolicy = { ...settings, exactRows: 0 };
fallback.context.scoreBlend = { enabled: true, sparseWeight: 0, annWeight: 1 };
fallback.idx.chunkMeta = fixture.idx.chunkMeta; fallback.idx.tokenIndex = fixture.idx.tokenIndex;
fallback.idx.denseVec = null; fallback.idx.loadDenseVectors = async () => { lazyLoads++; throw new Error('full corpus load forbidden by small-set planning'); };
const approximate = await createSearchPipeline(fallback.context)(fallback.idx, 'code', [1, 0]);
assert.equal(approximate[0].id, 3); assert.equal(lazyLoads, 0); assert(attempts.length >= 2 && attempts.length <= 3);
assert(attempts.every((value, index) => index === 0 || value > attempts[index - 1]));
const approximateReceipt = fallback.stageTracker.stages.find(row => row.stage === 'ann').countAware;
assert.equal(approximateReceipt.complete, false); assert.equal(approximateReceipt.recallCertified, false);
assert.equal(approximateReceipt.exactness, 'approximate-or-unknown'); assert.equal(approximateReceipt.actualProviderWork, null);
assert(approximateReceipt.requestedHitWork <= settings.requestedHitWork);
const deadlineProvider = { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true,
  query: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) };
const deadline = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, deadlineProvider]]) });
deadline.context.countAwareAnnPolicy = { ...settings, exactRows: 0, maxMs: 10 };
const keepAlive = setTimeout(() => {}, 100);
try {
  await createSearchPipeline(deadline.context)(deadline.idx, 'code', [1, 0]);
  const ended = deadline.stageTracker.stages.find(row => row.stage === 'ann').countAware;
  assert.equal(ended.reasonEnded, 'deadline');
  assert.equal(ended.attempts.at(-1).status, 'deadline');
  assert.equal(ended.complete, false); assert.equal(ended.recallCertified, false);
  assert.equal(deadline.context.signal?.aborted ?? false, false, 'planner deadline does not cancel the caller');
  assert.equal(getGenerationProviderRuntime(deadline.idx).getProviderModeState(deadlineProvider, 'code').failures, 0,
    'planner deadline is not a native provider health failure');
} finally { clearTimeout(keepAlive); }
const cancelled = new AbortController(); cancelled.abort(); fallback.context.signal = cancelled.signal;
await assert.rejects(createSearchPipeline(fallback.context)(fallback.idx, 'code', [1, 0]));
console.log('Count-aware production route, bounded stored snapshot, independent count, underfill effort and cancellation assertions complete');
