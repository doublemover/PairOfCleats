#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runAnnStage } from '../../../src/retrieval/pipeline/ann-stage.js';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';
import {
  createBenchQueryCapabilityCollector,
  formatBenchQueryCapabilityLines,
  mergeBenchQueryCapabilities
} from '../../../tools/bench/language/query-capabilities.js';

process.env.PAIROFCLEATS_TESTING = '1';

// Exercise the real ANN-stage owner with inert in-memory providers. This does
// not load a native library, generate an embedding or initialize a model.
const observeStage = async ({ enabled = true, vector = false, minhash = false, adaptive = false } = {}) => {
  const tracker = createRetrievalStageTracker();
  const metrics = { mode: 'code' };
  let providerCalls = 0;
  const provider = {
    id: 'js',
    isAvailable: () => true,
    query: () => {
      providerCalls += 1;
      return [{ idx: 0, sim: 0.8 }];
    }
  };
  const providers = new Map([['js', provider]]);
  const idx = { denseVec: { vectors: [[0.1, 0.2]], dims: 2 }, minhash: { signatures: [[]] } };
  await tracker.span('ann', metrics, () => runAnnStage({
    idx,
    mode: 'code',
    meta: [{ id: 0 }],
    queryEmbedding: vector ? [0.1, 0.2] : null,
    queryTokens: ['alpha'],
    searchTopN: 1,
    expandedTopN: 2,
    annEnabledForMode: enabled,
    vectorOnlyProfile: false,
    profileId: null,
    annOrder: ['js'],
    adaptiveProvidersEnabled: adaptive,
    getAnnProviders: () => providers,
    warnAnnFallback: () => {},
    providerRuntime: {
      isProviderCoolingDown: () => false,
      resolveAnnBackends: () => ['js'],
      ensureProviderPreflight: async () => true,
      recordProviderSuccess: () => {},
      recordProviderFailure: () => {}
    },
    signal: null,
    candidatePool: { acquire: () => new Set() },
    trackReleaseSet: () => {},
    candidates: null,
    bmHits: [{ idx: 0 }],
    allowedIdx: null,
    allowedCount: 1,
    filtersEnabled: false,
    annCandidatePolicyConfig: { cap: 100, minDocCount: 0, maxDocCount: 100 },
    minhashLimit: 10,
    hasAllowedId: () => true,
    ensureAllowedSet: (input) => input,
    bitmapToSet: (input) => input,
    rankMinhash: () => minhash ? [{ idx: 0, sim: 0.5 }] : [],
    vectorAnnState: {},
    hnswAnnState: {},
    lanceAnnState: {},
    annMetrics: metrics
  }));
  return { stages: tracker.stages, providerCalls };
};

const collector = createBenchQueryCapabilityCollector({ annRequested: true });
const vector = await observeStage({ vector: true });
assert.equal(vector.providerCalls, 1);
assert.equal(vector.stages[0].source, 'js');
const minhash = await observeStage({ minhash: true });
assert.equal(minhash.stages[0].source, 'minhash');
const empty = await observeStage();
const disabled = await observeStage({ enabled: false });
const sparse = await observeStage({ vector: true, adaptive: true });
assert.equal(sparse.stages[0].bypassedToSparse, true);
assert.equal(sparse.providerCalls, 0, 'eligible sparse bypass does not establish a vector query');
for (const observation of [vector, minhash, empty, disabled, sparse]) {
  collector.observe('memory', { stats: {
    annEnabled: true, annActive: true, annBackend: 'js', cache: { hit: false },
    pipeline: observation.stages
  } });
}
collector.observe('memory', { stats: { annActive: true, annBackend: 'js', cache: { hit: true } } });
collector.observe('memory', { stats: { pipeline: [{ stage: 'ann', mode: 'unknown-mode', source: 'future-provider' }] } });
collector.observe('sqlite', { stats: { annBackend: 'sqlite-extension', cache: { hit: false }, pipeline: [
  { stage: 'ann', mode: 'code', hits: 1, source: 'sqlite-vector', vectorActive: true },
  { stage: 'ann', mode: 'prose', hits: 0, source: null, vectorActive: false }
] } });
const evidence = JSON.parse(JSON.stringify(collector.snapshot()));
const memory = evidence.byBackend.memory;
assert.equal(evidence.annRequested, true);
assert.equal(memory.searches, 7);
assert.equal(memory.annStages, 6, 'observations count modes independently from searches');
assert.equal(memory.vectorEligibleStages, 2);
assert.equal(memory.vectorResultStages, 1, 'reported js / annActive alone never prove vector results');
assert.equal(memory.minhashResultStages, 1);
assert.equal(memory.noResultStages, 3);
assert.equal(memory.unknownResultStages, 1);
assert.equal(memory.sparseBypassStages, 1);
assert.equal(memory.searchesWithoutAnnStages, 1);
assert.equal(memory.cacheHits, 1);
assert.equal(memory.cacheStatusUnknown, 1);
assert.deepEqual(memory.annSources, { js: 1, minhash: 1, none: 3, unknown: 1 });
assert.deepEqual(memory.modes, { code: 5, unknown: 1 });
assert.deepEqual(memory.reportedAnnBackends, { js: 6, unknown: 1 });
assert.equal(evidence.byBackend.sqlite.searches, 1);
assert.equal(evidence.byBackend.sqlite.annStages, 2);
assert.equal(evidence.byBackend.sqlite.vectorResultStages, 1);
const snapshot = collector.snapshot();
snapshot.byBackend.memory.annSources.js = 99;
assert.equal(collector.snapshot().byBackend.memory.annSources.js, 1, 'snapshots do not alter retained evidence');

const merged = mergeBenchQueryCapabilities([
  { queryCapabilities: evidence }, { queryCapabilities: evidence },
  { annEnabled: true, hitRate: { memory: 1 } }, { queryCapabilities: { schemaVersion: 2, byBackend: {} } }
]);
assert.equal(merged.observedReports, 2);
assert.equal(merged.unobservedReports, 2, 'legacy/unknown-version reports retain missing-evidence status');
assert.equal(merged.byBackend.memory.vectorResultStages, 2);
assert.equal(merged.byBackend.memory.searchesWithoutAnnStages, 2);
assert.equal(merged.byBackend.sqlite.annStages, 4);
assert.deepEqual(createBenchQueryCapabilityCollector().snapshot(), {
  schemaVersion: 1, annRequested: null, byBackend: {}
});
const lines = formatBenchQueryCapabilityLines(evidence);
assert.ok(lines[0].includes('vector results 1'));
assert.ok(lines[0].includes('searches without stage evidence 1, cache hits 1'));
assert.ok(lines[1].startsWith('- sqlite ANN stages:'));
console.log('Benchmark ANN observations retain vector/MinHash/sparse/cache and unknown-evidence distinctions.');
