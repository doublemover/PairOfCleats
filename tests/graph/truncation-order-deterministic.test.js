#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 1,
    edgeCount: 2,
    nodes: [{ id: 'chunk-a', out: ['chunk-c', 'chunk-b'], in: [] }]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  depth: 1,
  caps: { maxEdges: 1 }
});

assert.strictEqual(result.edges.length, 1);
assert.strictEqual(result.edges[0]?.to?.chunkUid, 'chunk-b');
console.log('graph truncation order determinism test passed');
