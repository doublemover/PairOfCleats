#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';
import { graphFromEdges } from '../../graph/helpers/graph-fixtures.js';

const baseConfig = {
  enabled: true,
  weights: { degree: 0.1, proximity: 0.5 },
  maxGraphWorkUnits: 100,
  seedSelection: 'top1'
};

const createEntries = (chunkUids) => chunkUids.map((chunkUid, index) => ({
  idx: index,
  score: 1 - (index * 0.1),
  chunk: { chunkUid },
  scoreBreakdown: {}
}));

const createCallGraphRelations = (edges = []) => ({
  callGraph: graphFromEdges(edges),
  usageGraph: { nodes: [] }
});

const cases = [
  {
    name: 'explain mode emits graph breakdown',
    run() {
      const entries = createEntries(['a']);
      const graphRelations = createCallGraphRelations([['a', []]]);
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
      const entries = createEntries(['a', 'b']);
      const graphRelations = createCallGraphRelations([['a', 'b']]);
      const first = JSON.stringify(applyGraphRanking({ entries, graphRelations, config: baseConfig, explain: true }));
      const second = JSON.stringify(applyGraphRanking({ entries, graphRelations, config: baseConfig, explain: true }));
      assert.equal(first, second);
    }
  },
  {
    name: 'membership remains invariant after graph ranking',
    run() {
      const entries = createEntries(['a', 'b', 'c']);
      const graphRelations = createCallGraphRelations([['a', ['b', 'c']]]);
      const result = applyGraphRanking({ entries, graphRelations, config: baseConfig });
      const before = entries.map((entry) => entry.idx).sort().join(',');
      const after = result.entries.map((entry) => entry.idx).sort().join(',');
      assert.equal(before, after);
    }
  },
  {
    name: 'disabled mode is a no-op while enabled mode preserves entry count',
    run() {
      const entries = createEntries(['a', 'b']);
      const graphRelations = createCallGraphRelations([['a', 'b']]);
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
