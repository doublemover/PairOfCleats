import assert from 'node:assert/strict';
import { fuseRankedHits } from '../../../src/retrieval/pipeline/fusion.js';
import { runRankStage } from '../../../src/retrieval/pipeline/rank-stage.js';
import { applyRankFactor } from '../../../src/retrieval/scoring/score-adjustment.js';
import { withAnnScoreSpace } from '../../../src/shared/ann-similarity.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { normalizeSearchOptions } from '../../../src/retrieval/cli/normalize-options.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';
import { buildQueryCacheKey } from '../../../src/retrieval/cli-index.js';
import { buildLocalCacheKey } from '../../../src/shared/cache-key.js';
import { buildFederatedQueryCacheKeyPayload, buildFederatedQueryCacheKey } from '../../../src/retrieval/federation/query-cache.js';

const snapshot = () => ({ candidate: {}, score: {} });
for (const space of [{ kind: 'cosine', metric: 'cosine' }, { kind: 'negative-distance', metric: 'l2' },
  { kind: 'dot-product', metric: 'ip' }]) {
  for (const base of [-0.8, 0, 1]) {
    for (const feature of ['definition', 'export', 'exact-symbol', 'exact-file', 'phrase', 'neutral', 'disabled']) {
      const meta = [{ id: 0, file: 'src/target.js', name: 'target', kind: 'Text', exported: feature === 'export' },
        { id: 1, file: 'src/other.js', name: 'other', kind: 'Text' }];
      if (feature === 'definition' || feature === 'exact-symbol') meta[0].kind = 'FunctionDeclaration';
      const annHits = [base, base - 0.1].map((sim, idx) => withAnnScoreSpace({ idx, sim }, space));
      const fused = fuseRankedHits({ bmHits: [], annHits, annSource: 'dense', rrfEnabled: false,
        blendEnabled: true, blendSparseWeight: 0, blendAnnWeight: 1 });
      const ranked = runRankStage({ idx: {}, meta, fusedScores: fused.scored, useRrf: fused.useRrf,
        allowedIdx: null, abortIfNeeded: () => {}, searchTopN: 2, topkSlack: 0,
        poolSnapshot: snapshot, poolSnapshotStart: snapshot(), rankMetrics: {}, explain: true,
        matchesQueryAst: () => true, getPhraseMatchInfo: (_, id) => ({ matches: id === 0 ? 1 : 0 }),
        phraseNgramSet: feature === 'phrase' ? new Set(['two words']) : null,
        symbolBoostEnabled: feature !== 'disabled', symbolBoostDefinitionWeight: feature === 'definition' ? 1.2 : 1,
        symbolBoostExportWeight: feature === 'export' ? 1.1 : 1,
        isDefinitionKind: kind => kind === 'FunctionDeclaration', isExportedChunk: chunk => chunk.exported === true,
        relationBoostEnabled: false, relationBoostConfig: { caseFile: false }, resolveFileRelations: () => null,
        query: feature === 'exact-symbol' ? 'target' : feature === 'exact-file' ? 'target.js' : 'ordinary query',
        graphRankingConfig: { enabled: false }, blendEnabled: true });
      assert.deepEqual(ranked.map(hit => hit.id), [0, 1]);
      assert.ok(ranked[0].score >= base, `${space.metric}/${base}/${feature} promotion cannot penalize the higher-is-better score`);
      if (feature === 'neutral' || feature === 'disabled') assert.equal(ranked[0].score, base);
      const breakdown = ranked[0].scoreBreakdown;
      assert.equal(breakdown.ann.score, base, 'provider evidence stays raw');
      assert.equal(breakdown.selected.score, ranked[0].score);
      const contribution = (breakdown.symbol?.boost || 0) + (breakdown.phrase?.boost || 0);
      assert.ok(Math.abs(base + contribution - ranked[0].score) < 1e-12);
    }
  }
}
assert.equal(applyRankFactor(-1, 1.2), -1 / 1.2);
assert.equal(applyRankFactor(-1, 0), -Number.MAX_VALUE);
assert.equal(applyRankFactor(-1, 0.5), -2);

// Actual CLI option defaults enter the production dense fusion/rank path.
const defaults = normalizeSearchOptions({ argv: { _: ['ordinary query'], mode: 'code' }, rawArgs: [],
  rootDir: process.cwd(), userConfig: { indexing: { embeddings: { provider: 'onnx' } } }, policy: {} });
const fixture = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, {
  id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true,
  query: async () => [{ idx: 0, sim: -1 }, { idx: 1, sim: -1.1 }]
}]]) });
fixture.context.symbolBoost = { enabled: defaults.symbolBoostEnabled,
  definitionWeight: defaults.symbolBoostDefinitionWeight, exportWeight: defaults.symbolBoostExportWeight };
fixture.context.scoreBlend = { enabled: true, sparseWeight: 0, annWeight: 1 };
fixture.context.explain = true;
fixture.idx.chunkMeta[0].kind = 'FunctionDeclaration';
const actual = await createSearchPipeline(fixture.context)(fixture.idx, 'code', [1, 0]);
assert.deepEqual(actual.map(hit => hit.id), [0, 1]);
assert.ok(actual[0].score > -1);
const payload = { query: 'ordinary query', mode: 'code', explain: true };
assert.notEqual(buildQueryCacheKey(payload).key, buildLocalCacheKey({ namespace: 'query-cache', version: 7, payload }).key);
const federated = buildFederatedQueryCacheKeyPayload({ query: payload.query });
assert.notEqual(buildFederatedQueryCacheKey(federated).keyHash, buildFederatedQueryCacheKey({ ...federated, v: 7 }).keyHash);
console.log('Dense promotion retains ordering/sign semantics and exact explanation contributions under real CLI defaults.');
