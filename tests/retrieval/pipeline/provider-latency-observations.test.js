import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { getGenerationProviderRuntime } from '../../../src/retrieval/pipeline/provider-runtime.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';

const raw = [];
for (let trial = 0; trial < 3; trial++) {
  let preflights = 0, queries = 0, delay = 0;
  const provider = { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true,
    preflight: async () => { preflights++; return true; },
    query: async ({ embedding, topN }) => {
      queries++; assert.equal(embedding.length, 2); assert.ok(topN > 0);
      await new Promise(resolve => setTimeout(resolve, delay));
      return [{ idx: 1, sim: 0.95 }, { idx: 0, sim: 0.8 }];
    } };
  const fixture = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[provider.id, provider]]) });
  const pipeline = createSearchPipeline(fixture.context);
  const runtime = getGenerationProviderRuntime(fixture.idx), state = runtime.getProviderModeState(provider, 'code');
  await runtime.ensureProviderPreflight(provider, { idx: fixture.idx, mode: 'code', embedding: [0.2, 0.1] });
  assert.equal(state.latencySamples, 0); assert.equal(state.latencyEwmaMs, null);
  for (const [sample, delayMs] of [0, 2, 4, 2, 0, 4].entries()) {
    delay = delayMs;
    const start = performance.now(), hits = await pipeline(fixture.idx, 'code', [0.2, 0.1]);
    const elapsedMs = performance.now() - start;
    assert.ok(hits.some(hit => hit.id === 1), 'a useful real pipeline result accompanies the timing observation');
    assert.equal(state.latencySamples, sample + 1);
    assert.ok(Number.isFinite(state.latencyEwmaMs) && state.latencyEwmaMs >= 0);
    const before = state.latencyEwmaMs;
    runtime.recordProviderSuccess(provider, 'code');
    assert.equal(state.latencySamples, sample + 1); assert.equal(state.latencyEwmaMs, before);
    raw.push({ trial, sample, delayMs, elapsedMs, latencySamples: state.latencySamples,
      latencyEwmaMs: state.latencyEwmaMs, providerQueries: queries, providerPreflights: preflights,
      hitIds: hits.map(hit => hit.id) });
  }
  assert.equal(queries, 6); assert.equal(preflights, 1, 'cached health success is not another query latency');
}
console.log(JSON.stringify({ scope: 'serial controlled-provider requests through the actual ANN pipeline; no native-model or application speedup claim',
  runtime: process.version, platform: process.platform, raw }));
