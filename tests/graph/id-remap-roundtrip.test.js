#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphIndex } from '../../src/graph/store.js';

const graph = {
  version: 1,
  callGraph: {
    nodeCount: 2,
    edgeCount: 0,
    nodes: [
      { id: 'chunk-a', out: [], in: [] },
      { id: 'chunk-b', out: [], in: [] }
    ]
  },
  usageGraph: {
    nodeCount: 1,
    edgeCount: 0,
    nodes: [{ id: 'chunk-u', out: [], in: [] }]
  },
  importGraph: {
    nodeCount: 1,
    edgeCount: 0,
    nodes: [{ id: 'src/app.js', out: [], in: [] }]
  }
};

const index = buildGraphIndex({ graphRelations: graph, repoRoot: null });

const verifyRoundTrip = (table, expectedCount) => {
  assert(table?.idToIndex, 'expected idToIndex to be present');
  if (!Array.isArray(table.ids)) {
    if (Number.isFinite(expectedCount)) {
      assert.strictEqual(table.idToIndex.size, expectedCount);
    }
    return;
  }
  for (const id of table.ids) {
    const idx = table.idToIndex.get(id);
    assert.strictEqual(table.ids[idx], id);
  }
};

verifyRoundTrip(index.callGraphIds, graph.callGraph.nodeCount);
verifyRoundTrip(index.usageGraphIds, graph.usageGraph.nodeCount);
verifyRoundTrip(index.importGraphIds, graph.importGraph.nodeCount);

console.log('graph id remap roundtrip test passed');
