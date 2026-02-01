#!/usr/bin/env node
import assert from 'node:assert';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';

const entries = [
  { idx: 0, score: 1, chunk: { chunkUid: 'a' }, scoreBreakdown: {} },
  { idx: 1, score: 0.9, chunk: { chunkUid: 'b' }, scoreBreakdown: {} },
  { idx: 2, score: 0.8, chunk: { chunkUid: 'c' }, scoreBreakdown: {} }
];

const graphRelations = {
  callGraph: {
    nodes: [
      { id: 'a', out: ['b', 'c'], in: [] },
      { id: 'b', out: [], in: ['a'] },
      { id: 'c', out: [], in: ['a'] }
    ]
  },
  usageGraph: { nodes: [] }
};

const result = applyGraphRanking({
  entries,
  graphRelations,
  config: {
    enabled: true,
    weights: { degree: 0.1, proximity: 0.5 },
    maxGraphWorkUnits: 100,
    seedSelection: 'top1'
  }
});

const before = entries.map((entry) => entry.idx).sort().join(',');
const after = result.entries.map((entry) => entry.idx).sort().join(',');
assert.strictEqual(before, after, 'expected membership invariant under graph ranking');

console.log('graph ranking membership invariant test passed');
