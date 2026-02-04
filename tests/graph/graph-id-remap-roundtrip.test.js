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

const verifyRoundTrip = (table) => {
  for (const id of table.ids) {
    const idx = table.idToIndex.get(id);
    assert.strictEqual(table.ids[idx], id);
  }
};

verifyRoundTrip(index.callGraphIds);
verifyRoundTrip(index.usageGraphIds);
verifyRoundTrip(index.importGraphIds);

console.log('graph id remap roundtrip test passed');
