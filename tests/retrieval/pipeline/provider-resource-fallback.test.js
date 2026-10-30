import assert from 'node:assert/strict';
import { runCandidateStage } from '../../../src/retrieval/pipeline/candidate-stage.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';

const sparse = failure => runCandidateStage({ idx: { chunkMeta: [] }, mode: 'code',
  allowedIdx: null, allowedCount: 0, filtersEnabled: false, sqliteEnabledForMode: false,
  sqliteFtsDesiredForMode: false, sqliteFtsCompilation: { match: '', variant: null },
  sqliteFtsProvider: {}, bm25Provider: { id: 'explicit-fixture', search: () => { throw failure; } },
  postingsConfig: {}, sparseRequiredTables: [], queryTokens: ['alpha'], expandedTopN: 2,
  ensureAllowedSet: value => value, buildCandidateSet: () => null, candidatePool: { acquire: () => new Set() },
  trackReleaseSet: () => {}, getTokenIndexForQuery: () => null, candidateMetrics: {}, needLexicalCandidates: false });
const pending = () => {
  let settled = false, diagnosticReads = 0;
  const original = new Error('original provider still owns work');
  Object.defineProperties(original, {
    cacheOwnershipPending: { value: true, configurable: true },
    cacheOwnershipReleased: { value: () => settled, configurable: true },
    message: { get: () => { diagnosticReads++; return 'original provider still owns work'; }, configurable: true }
  });
  const check = error => {
    assert.equal(error.cacheOwnershipPending, true);
    assert.equal(error.cacheOwnershipReleased(), false);
    Object.defineProperty(original, 'cacheOwnershipReleased', { value: () => true, configurable: true });
    assert.equal(error.cacheOwnershipReleased(), false, 'replacement callback cannot release the original observer');
    settled = true;
    assert.equal(error.cacheOwnershipReleased(), true);
    assert.ok(diagnosticReads <= 1, 'only the canonical failure-composition owner may capture the original message');
    return true;
  };
  return { original, check };
};
const first = pending();
assert.throws(() => sparse(first.original), first.check);
const ordinary = sparse(new Error('settled optional sparse backend unavailable'));
assert.equal(ordinary.sparseType, 'none');
assert.equal(ordinary.sqliteFtsDiagnostics[0].reason, 'provider_error');
assert.match(ordinary.sqliteFtsDiagnostics[0].message, /settled optional/);
for (const thrown of [undefined, null, false, 0, '']) {
  const inspected = new Error('diagnostic inspection fails');
  Object.defineProperty(inspected, 'message', { get: () => { throw thrown; } });
  assert.throws(() => sparse(inspected), error => error !== inspected,
    'failed diagnostics cannot be downgraded to an unavailable-provider result');
}
for (const phase of ['availability', 'preflight', 'query']) {
  const failure = pending(); let queryCalls = 0;
  const provider = { id: ANN_PROVIDER_IDS.DENSE,
    isAvailable: () => { if (phase === 'availability') throw failure.original; return true; },
    preflight: async () => { if (phase === 'preflight') throw failure.original; return true; },
    query: async () => { queryCalls++; throw failure.original; } };
  const { context, idx } = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[provider.id, provider]]) });
  const pipeline = createSearchPipeline(context);
  await assert.rejects(pipeline(idx, 'code', [.1, .2]), failure.check);
  assert.equal(queryCalls, phase === 'query' ? 1 : 0,
    'unsettled preparation cannot reach a query or successful sparse fallback');
}
// An ordinary closed backend failure keeps the established sparse fallback.
const provider = { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true,
  preflight: async () => { throw new Error('settled preflight unavailable'); },
  query: async () => assert.fail('unavailable preflight must not launch a query') };
const { context, idx } = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[provider.id, provider]]) });
assert.ok((await createSearchPipeline(context)(idx, 'code', [.1, .2])).length > 0);
console.log('Sparse and ANN actual consumers retain original provider resources before optional fallback.');
