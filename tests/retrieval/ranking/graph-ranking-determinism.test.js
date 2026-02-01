#!/usr/bin/env node
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';

const entries = [
  { idx: 0, score: 1, chunk: { chunkUid: 'a' }, scoreBreakdown: {} },
  { idx: 1, score: 0.9, chunk: { chunkUid: 'b' }, scoreBreakdown: {} }
];

const graphRelations = {
  callGraph: {
    nodes: [
      { id: 'a', out: ['b'], in: [] },
      { id: 'b', out: [], in: ['a'] }
    ]
  },
  usageGraph: { nodes: [] }
};

const config = {
  enabled: true,
  weights: { degree: 0.1, proximity: 0.5 },
  maxGraphWorkUnits: 100,
  seedSelection: 'top1'
};

const first = JSON.stringify(applyGraphRanking({ entries, graphRelations, config, explain: true }));
const second = JSON.stringify(applyGraphRanking({ entries, graphRelations, config, explain: true }));

if (first !== second) {
  console.error('Expected deterministic graph ranking output.');
  process.exit(1);
}

console.log('graph ranking determinism test passed');
