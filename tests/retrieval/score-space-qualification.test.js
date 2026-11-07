import assert from 'node:assert/strict';
import { compareRetrievalHitLists, resolveRetrievalHitScore } from '../../src/retrieval/hit-comparison.js';
import { observeRetrievalHitScore, aggregateRetrievalScoreDeltas, captureRetrievalScoreSpace } from '../../src/retrieval/score-observation.js';
import { resolveEffectiveScorePolicyIdentity, resolveEffectiveSearchPlanIdentity, resolveObservedSearchSystemIdentity } from '../../src/retrieval/cli/effective-plan.js';
import { createScoreCoordinateIdentity, bindRetrievalScoreSpaces } from '../../src/retrieval/scoring/score-space.js';
import { createFixtureRetrievalMetadata, bindFixtureRetrievalScores } from '../helpers/retrieval-response-fixture.js';
import { compactHit } from '../../src/retrieval/cli/render-output.js';
import { fuseRankedHits } from '../../src/retrieval/pipeline/fusion.js';
import { createScoreBufferPool } from '../../src/retrieval/pipeline/score-buffer.js';
import { runRankStage } from '../../src/retrieval/pipeline/rank-stage.js';
import { rerankEvidence } from '../../src/retrieval/pipeline/evidence-reranker.js';

const metadata = createFixtureRetrievalMetadata({ fixtureId: 'score-space-qualification', backend: 'memory' });
const hits = values => bindFixtureRetrievalScores(values.map((score, index) => ({ chunkUid: `chunk:${index}`, score })), metadata);
const compare = (left, right) => compareRetrievalHitLists(left, right, { topN: 10 });
const zero = compare(hits([0]), hits([0]));
assert.equal(zero.avgDelta, 0); assert.equal(zero.scoreDelta.comparedPairs, 1); assert.equal(zero.scoreDelta.complete, true);
assert.equal(resolveRetrievalHitScore({ sparseScore: 9, annScore: 4, scoreBreakdown: { selected: { score: 7 } } }), null);
for (const value of [undefined, null, '0', false, NaN, Infinity]) {
  const result = compare(hits([0]), hits([value]));
  assert.equal(result.avgDelta, null); assert.equal(result.scoreDelta.missingValuePairs, 1);
  assert.equal(result.overlap, 1, 'missing scores do not erase known membership');
}
for (const [left, right] of [[[], []], [hits([1]), [{ ...hits([1])[0], chunkUid: 'different' }]]]) {
  const result = compare(left, right);
  assert.equal(result.avgDelta, null); assert.equal(result.scoreDelta.comparedPairs, 0); assert.equal(result.scoreDelta.complete, false);
}
const component = { ...hits([1])[0], sparseScore: 1 };
delete component.score;
assert.equal(compare(hits([1]), [component]).scoreDelta.missingValuePairs, 1);
const noSpace = { ...hits([1])[0] }; delete noSpace.scoreSpace;
assert.equal(compare(hits([1]), [noSpace]).scoreDelta.unknownSpacePairs, 1);
for (const field of ['type', 'stage', 'policyIdentity', 'sourceIdentity', 'coordinateIdentity']) {
  const right = hits([100, 200]);
  for (const hit of right) hit.scoreSpace = { ...hit.scoreSpace, [field]: field === 'type' ? 'ann'
    : field === 'stage' ? 'sparse-component' : `${field === 'policyIdentity' ? 'sqp1-' : field === 'sourceIdentity' ? 'ss1-' : 'sc1-'}${'b'.repeat(64)}` };
  const result = compare(hits([1, 2]), right);
  assert.equal(result.rankCorr, 1, 'monotone rescaling retains relative order');
  assert.equal(result.overlap, 1); assert.equal(result.avgDelta, null, field);
  assert.equal(result.scoreDelta.comparedPairs, 0);
}
let invoked = 0;
const hostile = Object.defineProperty({}, 'score', { get() { invoked++; throw new Error('must not execute'); } });
assert.equal(observeRetrievalHitScore(hostile).value, null);
assert.equal(captureRetrievalScoreSpace(Object.create(hits([1])[0].scoreSpace)), null);
assert.equal(invoked, 0);
const single = compare(hits([0]), hits([2]));
const triple = compare(hits([0, 0, 0]), hits([8, 8, 8]));
const summary = aggregateRetrievalScoreDeltas([single, triple, compare([], [])]);
assert.equal(summary.meanAbsoluteDelta, 5, 'each defined comparison contributes once');
assert.equal(summary.pooledMeanAbsoluteDelta, 6.5, 'pair pooling retains its distinct denominator');
assert.equal(summary.definedComparisons, 2); assert.equal(summary.requestedComparisons, 3);
assert.equal(summary.comparedPairs, 4); assert.equal(summary.complete, false);
assert.equal(aggregateRetrievalScoreDeltas([compare([], [])]).meanAbsoluteDelta, null);
const overflow = compare(hits([-Number.MAX_VALUE]), hits([Number.MAX_VALUE]));
assert.equal(overflow.avgDelta, null); assert.equal(overflow.scoreDelta.nonFiniteDeltaPairs, 1);

const config = { normalized: { backendArg: 'memory', annEnabled: false, query: 'same query' },
  modelConfig: { id: 'same-model' }, dictConfig: {}, userConfig: {}, policy: {}, useStubEmbeddings: false };
assert.equal(resolveObservedSearchSystemIdentity(config), resolveObservedSearchSystemIdentity({ ...config,
  normalized: { ...config.normalized, query: 'another query' } }));
const sqlite = { ...config, normalized: { ...config.normalized, backendArg: 'sqlite' } };
assert.notEqual(resolveEffectiveSearchPlanIdentity(config), resolveEffectiveSearchPlanIdentity(sqlite));
assert.equal(resolveEffectiveScorePolicyIdentity(config), resolveEffectiveScorePolicyIdentity(sqlite), 'storage choice alone is not a numeric unit');
for (const changed of [{ ...config, modelConfig: { id: 'other-model' } },
  { ...config, normalized: { ...config.normalized, bm25K1: 2 } },
  { ...config, normalized: { ...config.normalized, scoreBlendAnnWeight: 0.9 } }]) {
  assert.notEqual(resolveEffectiveScorePolicyIdentity(config), resolveEffectiveScorePolicyIdentity(changed));
}
const coordinate = { type: 'ann', usesAnn: true, annSource: 'explicit-provider', ann: { kind: 'negative-distance', metric: 'l2' } };
assert.notEqual(createScoreCoordinateIdentity(coordinate), createScoreCoordinateIdentity({ ...coordinate, ann: { kind: 'cosine', metric: 'cosine' } }));
assert.equal(createScoreCoordinateIdentity({ ...coordinate, ann: null }), null, 'requested ANN alone is not observed metric evidence');
const blend = { ...coordinate, type: 'blend', fusion: { calibration: 'reciprocal-distance' } };
assert.notEqual(createScoreCoordinateIdentity(blend), createScoreCoordinateIdentity({ ...blend, fusion: { calibration: 'atan-similarity' } }));

// Actual pooled fusion -> rank -> output ownership, independently checked using
// known sparse arithmetic. No index, backend, real model or latency qualification.
const pool = createScoreBufferPool({ maxBuffers: 1, maxEntries: 4 });
const fields = ['idx', 'score', 'scoreType', 'sparseScore', 'annScore', 'annSource', 'annScoreSpace', 'sparseType', 'blendInfo'];
const buffer = pool.acquire({ fields, capacity: 2 });
const fused = fuseRankedHits({ bmHits: [{ idx: 0, score: 2 }, { idx: 1, score: 1 }], annHits: [],
  sparseType: 'bm25', annSource: null, rrfEnabled: false, blendEnabled: false, scoreBuffer: buffer });
const ranked = runRankStage({ idx: {}, meta: [{ chunkUid: 'ranked:0', file: 'a.js' }, { chunkUid: 'ranked:1', file: 'b.js' }],
  fusedScores: fused.scored, useRrf: false, abortIfNeeded() {}, searchTopN: 2, topkSlack: 0,
  poolSnapshotStart: { candidate: {}, score: {} }, poolSnapshot: () => ({ candidate: {}, score: {} }),
  rankMetrics: {}, matchesQueryAst: () => true, graphRankingConfig: { enabled: false } });
pool.release(buffer);
assert.deepEqual(ranked.map(hit => hit.score), [2, 1]);
assert.ok(ranked.every(hit => /^sc1-[a-f0-9]{64}$/.test(hit.scoreCoordinateIdentity)));
const bind = rows => bindRetrievalScoreSpaces(rows, { policyIdentity: metadata.scorePolicyIdentity, freshness: metadata.freshness.byMode.code });
const output = bind(ranked.map(hit => compactHit(hit)));
assert.equal(compare(output, bind(ranked)).avgDelta, 0);
assert.ok(output.every(hit => !Object.hasOwn(hit, 'scoreCoordinateIdentity') && observeRetrievalHitScore(hit).qualified));
assert.equal(bindRetrievalScoreSpaces(ranked, { policyIdentity: metadata.scorePolicyIdentity })[0].scoreSpace, null);
const reranked = await rerankEvidence({ hits: ranked, adapter: { id: 'fixture-model', identityKey: 'model-v1',
  formattingIdentity: 'format-v1', rerank: async () => [{ index: 0, score: 0.4 }, { index: 1, score: 0.2 }] } });
assert.equal(compare(bind(reranked), output).scoreDelta.incompatibleSpacePairs, 2);
assert.equal(compare(bind(reranked), bind(reranked)).avgDelta, 0);
console.log('Final score spaces preserve measured zeros, missingness, compatible pair denominators and independent rank evidence.');
