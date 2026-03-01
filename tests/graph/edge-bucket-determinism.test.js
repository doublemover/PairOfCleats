#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 3,
    edgeCount: 2,
    nodes: [
      { id: 'chunk-a', out: ['chunk-b', 'chunk-c'], in: [] },
      { id: 'chunk-b', out: [], in: ['chunk-a'] },
      { id: 'chunk-c', out: [], in: ['chunk-a'] }
    ]
  },
  usageGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'chunk-a', out: ['chunk-d'], in: [] },
      { id: 'chunk-d', out: [], in: ['chunk-a'] }
    ]
  },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const neighborhood = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  depth: 1,
  caps: { maxFanoutPerNode: 2 }
});

assert.strictEqual(neighborhood.edges.length, 2);
for (const edge of neighborhood.edges) {
  assert.strictEqual(edge.graph, 'callGraph');
}

console.log('graph edge bucket determinism test passed');
