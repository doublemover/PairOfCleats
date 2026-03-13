#!/usr/bin/env node
import assert from 'node:assert';
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

const disabled = applyGraphRanking({
  entries,
  graphRelations,
  config: { enabled: false }
});
assert.strictEqual(disabled.entries[0].score, 1, 'disabled graph ranking should not change scores');

const enabled = applyGraphRanking({
  entries,
  graphRelations,
  config: {
    enabled: true,
    weights: { degree: 0.1, proximity: 0.5 },
    maxGraphWorkUnits: 100,
    seedSelection: 'top1'
  }
});
assert.strictEqual(enabled.entries.length, entries.length, 'membership should remain the same');

console.log('graph ranking toggle test passed');
