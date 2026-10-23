import assert from 'node:assert/strict';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';
import { rerankEvidence } from '../../../src/retrieval/pipeline/evidence-reranker.js';
import { mergeFederatedModeResults } from '../../../src/retrieval/federation/merge.js';
import { createScoreBreakdown, applyScoreBreakdownBudget } from '../../../src/retrieval/output/score-breakdown.js';
import { formatScoreBreakdown } from '../../../src/retrieval/output/explain.js';
import { graphFromEdges } from '../../graph/helpers/graph-fixtures.js';

const hit = { id: 'a', file: 'src/a.js', score: 2, scoreType: 'bm25',
  scoreBreakdown: createScoreBreakdown({ selected: { type: 'bm25', score: 2 }, sparse: { type: 'bm25', score: 2 } }) };
const entries = [{ idx: 0, score: hit.score, scoreType: hit.scoreType, scoreBreakdown: hit.scoreBreakdown,
  chunk: { chunkUid: 'a' } }];
const graph = applyGraphRanking({ entries, graphRelations: { callGraph: graphFromEdges([['a', []]]), usageGraph: { nodes: [] } },
  config: { enabled: true, weights: { degree: 0, proximity: 3 }, seedSelection: 'top1', maxGraphWorkUnits: 100 }, explain: true });
const ranked = graph.entries[0];
assert.equal(ranked.score, 5);
assert.equal(ranked.scoreBreakdown.selected.score, 5);
assert.equal(ranked.scoreBreakdown.graph.score, 3);
assert.deepEqual(ranked.scoreBreakdown.selected.sources.graph, { type: 'bm25', score: 2 });
assert.equal(hit.scoreBreakdown.selected.score, 2, 'source explanations are not mutated');
const zero = applyGraphRanking({ entries, graphRelations: { callGraph: graphFromEdges([['a', []]]), usageGraph: { nodes: [] } },
  config: { enabled: true, weights: { degree: 1, proximity: 0 }, maxGraphWorkUnits: 100 }, explain: true }).entries[0];
assert.equal(zero.score, 2); assert.equal(zero.scoreBreakdown.selected.score, 2);
const unexplained = applyGraphRanking({ entries: [{ idx: 0, score: 2, chunk: { chunkUid: 'a' } }],
  graphRelations: { callGraph: graphFromEdges([['a', []]]), usageGraph: { nodes: [] } },
  config: { enabled: true, weights: { degree: 0, proximity: 3 }, maxGraphWorkUnits: 100 }, explain: false }).entries[0];
assert.equal(unexplained.score, 5); assert.equal(Object.hasOwn(unexplained, 'scoreBreakdown'), false);
const model = await rerankEvidence({ query: 'intent', hits: [{ ...hit, score: ranked.score, scoreBreakdown: ranked.scoreBreakdown }],
  adapter: { id: 'controlled-model', rerank: async () => [{ index: 0, score: 0.9 }] } });
assert.equal(model[0].score, 0.9);
assert.equal(model[0].scoreBreakdown.selected.type, 'model_rerank');
assert.equal(model[0].scoreBreakdown.selected.score, 0.9);
assert.deepEqual(model[0].scoreBreakdown.selected.sources.model, { type: 'bm25', score: 5 });
assert.equal(model[0].scoreBreakdown.graph.score, 3);
const merged = mergeFederatedModeResults({ perRepoResults: [{ repoId: 'repo', result: { code: model } }], mode: 'code' });
const final = merged[0], selected = final.scoreBreakdown.selected;
assert.equal(final.score, Number((1 / 61).toFixed(12)));
assert.equal(selected.score, final.score); assert.equal(selected.type, final.scoreType);
assert.deepEqual(selected.sources, { graph: { type: 'bm25', score: 2 }, model: { type: 'bm25', score: 5 },
  federation: { type: 'model_rerank', score: 0.9 } });
assert.equal(final.sourceScore, 0.9);
assert.match(formatScoreBreakdown(final.scoreBreakdown).join('\n'), /Score=federated_rrf,0\.016/);
const budgeted = applyScoreBreakdownBudget(final.scoreBreakdown, { maxBytes: 64 });
if (budgeted.selected) { assert.equal(budgeted.selected.score, final.score); assert.equal(budgeted.selected.type, final.scoreType); }
const fallback = await rerankEvidence({ hits: [hit], fallback: true,
  adapter: { id: 'failed-model', rerank: async () => { throw new Error('controlled settled failure'); } } });
assert.equal(fallback[0].scoreBreakdown.selected.score, fallback[0].score);
const plain = await rerankEvidence({ hits: [{ id: 'plain', score: 2, scoreType: 'bm25' }],
  adapter: { id: 'plain-model', rerank: async () => [{ index: 0, score: 0.7 }] } });
assert.equal(Object.hasOwn(plain[0], 'scoreBreakdown'), false);
assert.equal(Object.hasOwn(mergeFederatedModeResults({ perRepoResults: [{ repoId: 'repo', result: { code: plain } }], mode: 'code' })[0],
  'scoreBreakdown'), false);
console.log('Graph, model and federated transformations reconcile final explanations with bounded named source evidence.');
