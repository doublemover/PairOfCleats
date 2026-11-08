import assert from 'node:assert/strict';
import { createAbortError } from '../../../src/shared/abort.js';
import { runAnnStage } from '../../../src/retrieval/pipeline/ann-stage.js';
import { createProviderRuntime } from '../../../src/retrieval/pipeline/provider-runtime.js';

for (const scenario of ['already-aborted', 'preflight-throws', 'preflight-resolves-after-abort']) {
  const controller = new AbortController();
  const runtime = createProviderRuntime();
  let calls = 0;
  const provider = {
    id: 'dense',
    preflight: async () => {
      calls += 1;
      if (scenario === 'preflight-throws') throw createAbortError();
      controller.abort();
      return true;
    }
  };
  const health = runtime.getProviderModeState(provider, 'code');
  const before = { ...health };
  if (scenario === 'already-aborted') controller.abort();
  await assert.rejects(runtime.ensureProviderPreflight(provider, {
    idx: {}, mode: 'code', embedding: [1, 0], signal: controller.signal
  }), { name: 'AbortError' });
  assert.deepEqual(health, before, `${scenario} must not change provider health`);
  assert.equal(calls, scenario === 'already-aborted' ? 0 : 1);
  provider.preflight = async () => true;
  assert.equal(await runtime.ensureProviderPreflight(provider, { mode: 'code' }), true);
  assert.equal(runtime.isProviderCoolingDown(provider, 'code'), false);
}

for (const scenario of ['query-throws', 'query-resolves-after-abort']) {
  const controller = new AbortController();
  const runtime = createProviderRuntime();
  let fallbackCalls = 0;
  let minhashCalls = 0;
  const primary = {
    id: 'dense', isAvailable: () => true,
    query: async () => {
      if (scenario === 'query-throws') throw createAbortError();
      controller.abort();
      return [{ idx: 0, sim: 0.9 }];
    }
  };
  const fallback = {
    id: 'hnsw', isAvailable: () => true,
    query: async () => { fallbackCalls += 1; return []; }
  };
  const health = runtime.getProviderModeState(primary, 'code');
  const before = { ...health };
  const input = {
    idx: { loadDenseVectors() {}, minhash: { signatures: [[1]] } },
    mode: 'code', meta: [{}], queryEmbedding: [1, 0], queryTokens: ['needle'],
    searchTopN: 1, expandedTopN: 1, annEnabledForMode: true,
    vectorOnlyProfile: true, profileId: 'vector_only',
    annOrder: ['dense', 'hnsw'], adaptiveProvidersEnabled: false,
    getAnnProviders: () => new Map([['dense', primary], ['hnsw', fallback]]),
    warnAnnFallback: () => { throw new Error('cancelled request must not warn fallback'); },
    providerRuntime: runtime, signal: controller.signal,
    candidatePool: { acquire: () => new Set() }, trackReleaseSet() {},
    candidates: null, bmHits: [], allowedIdx: null, allowedCount: 1,
    filtersEnabled: false, annCandidatePolicyConfig: {},
    hasAllowedId: (set, id) => set.has(id), ensureAllowedSet: value => value,
    bitmapToSet: value => value, rankMinhash: () => { minhashCalls += 1; return []; },
    annMetrics: {}
  };
  await assert.rejects(runAnnStage(input), { name: 'AbortError' });
  assert.deepEqual(health, before, `${scenario} must not record failure or success latency`);
  assert.equal(fallbackCalls, 0);
  assert.equal(minhashCalls, 0);
  primary.query = async () => [{ idx: 0, sim: 0.9 }];
  const next = await runAnnStage({ ...input, signal: new AbortController().signal, annMetrics: {} });
  assert.deepEqual(next.annHits, [{ idx: 0, sim: 0.9 }]);
  assert.equal(runtime.isProviderCoolingDown(primary, 'code'), false);
  assert.equal(health.failures, 0);
  assert.equal(health.latencySamples, 1);
}

console.log('provider cancellation health test passed');
