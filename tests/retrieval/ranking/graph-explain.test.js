#!/usr/bin/env node
import assert from 'node:assert';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';

const entries = [
  { idx: 0, score: 1, chunk: { chunkUid: 'a' }, scoreBreakdown: {} }
];

const graphRelations = {
  callGraph: { nodes: [{ id: 'a', out: [], in: [] }] },
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
  },
  explain: true
});

assert(result.entries[0].scoreBreakdown.graph, 'expected graph score breakdown');
console.log('graph ranking explain test passed');
