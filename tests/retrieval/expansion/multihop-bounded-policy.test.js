#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';

const entries = [
  { idx: 0, score: 1.0, chunk: { chunkUid: 'a' }, scoreBreakdown: {} },
  { idx: 1, score: 0.95, chunk: { chunkUid: 'b' }, scoreBreakdown: {} },
  { idx: 2, score: 0.94, chunk: { chunkUid: 'c' }, scoreBreakdown: {} },
  { idx: 3, score: 0.93, chunk: { chunkUid: 'g' }, scoreBreakdown: {} },
  { idx: 4, score: 0.92, chunk: { chunkUid: 'h' }, scoreBreakdown: {} },
  { idx: 5, score: 0.91, chunk: { chunkUid: 'i' }, scoreBreakdown: {} }
];

const graphRelations = {
  callGraph: {
    nodes: [
      { id: 'a', out: ['b', 'c', 'd', 'e'], in: [] },
      { id: 'b', out: ['g', 'h'], in: ['a'] },
      { id: 'c', out: ['i', 'j'], in: ['a'] },
      { id: 'd', out: [], in: ['a'] },
      { id: 'e', out: [], in: ['a'] },
      { id: 'g', out: [], in: ['b'] },
      { id: 'h', out: [], in: ['b'] },
      { id: 'i', out: [], in: ['c'] },
      { id: 'j', out: [], in: ['c'] }
    ]
  },
  usageGraph: { nodes: [] }
};

const config = {
  enabled: true,
  weights: { degree: 0.05, proximity: 0.5 },
  seedSelection: 'top1',
  maxGraphWorkUnits: 100,
  expansion: {
    maxDepth: 2,
    maxWidthPerNode: 2,
    maxVisitedNodes: 8
  }
};

const first = applyGraphRanking({ entries, graphRelations, config, explain: true });
const second = applyGraphRanking({ entries, graphRelations, config, explain: true });

assert.deepEqual(first, second, 'expected deterministic graph expansion output');
assert.equal(first.stats?.stopReason, 'maxWidthPerNode', 'expected deterministic stop reason');
assert.ok(first.stats?.visitedNodes <= config.expansion.maxVisitedNodes, 'visited nodes must stay within cap');
assert.ok(first.stats?.widthLimitedNodes > 0, 'expected width limit to trigger');

for (const hit of first.entries) {
  const graph = hit.scoreBreakdown?.graph || {};
  assert.equal(graph.expansion?.maxDepth, config.expansion.maxDepth, 'expected depth cap in explain');
  assert.equal(graph.expansion?.maxWidthPerNode, config.expansion.maxWidthPerNode, 'expected width cap in explain');
  assert.equal(graph.expansion?.maxVisitedNodes, config.expansion.maxVisitedNodes, 'expected visited cap in explain');
  if (Number.isFinite(graph.seedDistance)) {
    assert.ok(graph.seedDistance <= config.expansion.maxDepth, 'seed distance must stay within depth cap');
  }
}

console.log('multihop bounded policy test passed');
