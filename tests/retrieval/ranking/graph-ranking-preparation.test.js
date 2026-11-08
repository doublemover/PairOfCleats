import assert from 'node:assert/strict';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

const entries = ['a', 'b', 'c'].map((chunkUid, idx) => ({ idx, score: 0, chunk: { chunkUid } }));
const policy = { enabled: true, weights: { degree: 1, proximity: 0 }, seedSelection: 'top1',
  maxGraphWorkUnits: 0, expansion: { maxDepth: 2, maxWidthPerNode: 1, maxVisitedNodes: 8 } };
let reads = 0;
const neighbors = Array.from({ length: 4096 }, (_, i) => 'node-' + String(i).padStart(4, '0'));
for (let i = 0; i < neighbors.length; i++) {
  const value = neighbors[i];
  Object.defineProperty(neighbors, i, { get() { reads++; return value; }, enumerable: true });
}
const graphRelations = { callGraph: { nodes: [{ id: 'a', out: neighbors, in: [] }] }, usageGraph: { nodes: [] } };
const degree = applyGraphRanking({ entries, graphRelations, config: policy });
assert.equal(reads, 0, 'degree-only ranking must not prepare or walk adjacency');
assert.equal(degree.stats.workUnitsUsed, 0); assert.equal(degree.entries[0].score, 4096);
assert.ok(degree.stats.preparation.nodeSlotsVisited > 0, 'cold lookup work is visible separately');
const degreeWarm = applyGraphRanking({ entries, graphRelations, config: policy });
assert.equal(degreeWarm.stats.preparation.nodeSlotsVisited, 0);
const proximityPolicy = { ...policy, weights: { degree: 0, proximity: 1 } };
reads = 0;
const first = applyGraphRanking({ entries, graphRelations, config: proximityPolicy });
assert.ok(reads > 0); assert.equal(first.stats.preparation.adjacencyInputsVisited, 4096);
reads = 0;
const second = applyGraphRanking({ entries, graphRelations, config: proximityPolicy });
assert.equal(reads, 0, 'warm bounded ranking must not re-read or sort the entire degree');
assert.equal(second.stats.preparation.adjacencyInputsVisited, 0);
assert.deepEqual(second.entries, first.entries);
assert.equal(second.stats.truncated, true); assert.equal(second.stats.stopReason, 'maxWorkUnits');

const smaller = { callGraph: { nodes: [null, { id: '' }, { id: 'a', out: ['unused'] },
  { id: 'a', out: ['c', 'b', 'b', 'a'], in: ['b'] }] }, usageGraph: { nodes: [] } };
const rank = width => applyGraphRanking({ entries, graphRelations: smaller, config: {
  ...proximityPolicy, maxGraphWorkUnits: 100, expansion: { maxDepth: 1, maxWidthPerNode: width, maxVisitedNodes: 8 } }, explain: true });
const narrow = rank(1), wide = rank(8);
assert.deepEqual(rank(1).entries, narrow.entries, 'filtered/width requests cannot mutate cached adjacency');
assert.equal(wide.entries.find(row => row.chunk.chunkUid === 'b').scoreBreakdown.graph.seedDistance, 1);
assert.equal(wide.entries.find(row => row.chunk.chunkUid === 'c').scoreBreakdown.graph.seedDistance, 1);
assert.deepEqual(smaller.callGraph.nodes[3].out, ['c', 'b', 'b', 'a']);
const replacement = applyGraphRanking({ entries, graphRelations: { callGraph: { nodes: [{ id: 'a', out: ['c'] }] },
  usageGraph: { nodes: [] } }, config: { ...proximityPolicy, maxGraphWorkUnits: 100 }, explain: true });
assert.equal(replacement.entries.find(row => row.chunk.chunkUid === 'b').score, 0);
assert.equal(replacement.entries.find(row => row.chunk.chunkUid === 'c').score, 0.5);
assert.ok(replacement.stats.preparation.nodeSlotsVisited > 0, 'replacement generations prepare their own lookup');

const fixture = buildAnnPipelineFixture();
fixture.context.annEnabled = false; fixture.context.graphRankingConfig = policy;
fixture.idx.chunkMeta[0].chunkUid = 'a'; fixture.idx.chunkMeta[1].chunkUid = 'b';
fixture.idx.graphRelations = smaller;
const hits = await createSearchPipeline(fixture.context)(fixture.idx, 'code', null);
assert.ok(hits.length); assert.ok(hits.every(hit => hit.scoreBreakdown === undefined));
const rankStage = fixture.stageTracker.stages.find(stage => stage.stage === 'rank');
assert.ok(rankStage.graph); assert.equal(rankStage.graph.workUnitsUsed, 0,
  'the actual rank stage retains graph metrics when explanations are disabled');
console.log('graph setup, warm adjacency, degree-only work, generation identity and rank metrics passed');
