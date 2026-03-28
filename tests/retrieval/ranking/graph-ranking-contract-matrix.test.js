#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';

const baseConfig = {
  enabled: true,
  weights: { degree: 0.1, proximity: 0.5 },
  maxGraphWorkUnits: 100,
  seedSelection: 'top1'
};

const cases = [
  {
    name: 'explain mode emits graph breakdown',
    run() {
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
        config: baseConfig,
        explain: true
      });
      assert.ok(result.entries[0].scoreBreakdown.graph);
    }
  },
  {
    name: 'determinism holds across repeated runs',
    run() {
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
      const first = JSON.stringify(applyGraphRanking({ entries, graphRelations, config: baseConfig, explain: true }));
      const second = JSON.stringify(applyGraphRanking({ entries, graphRelations, config: baseConfig, explain: true }));
      assert.equal(first, second);
    }
  },
  {
    name: 'membership remains invariant after graph ranking',
    run() {
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
      const result = applyGraphRanking({ entries, graphRelations, config: baseConfig });
      const before = entries.map((entry) => entry.idx).sort().join(',');
      const after = result.entries.map((entry) => entry.idx).sort().join(',');
      assert.equal(before, after);
    }
  },
  {
    name: 'disabled mode is a no-op while enabled mode preserves entry count',
    run() {
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
      assert.equal(disabled.entries[0].score, 1);
      const enabled = applyGraphRanking({
        entries,
        graphRelations,
        config: baseConfig
      });
      assert.equal(enabled.entries.length, entries.length);
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('graph ranking contract matrix test passed');
