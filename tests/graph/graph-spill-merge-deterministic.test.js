#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const neighborCount = 20005;
const neighbors = Array.from({ length: neighborCount }, (_, idx) => `chunk-${String(idx).padStart(5, '0')}`);

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 1 + neighborCount,
    edgeCount: neighborCount,
    nodes: [{ id: 'chunk-a', out: neighbors, in: [] }]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const build = () => buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  depth: 1
});

const first = build();
const second = build();

assert.strictEqual(first.edges.length, neighborCount);
assert.deepStrictEqual(
  second.edges.map((edge) => edge.to.chunkUid),
  first.edges.map((edge) => edge.to.chunkUid)
);

console.log('graph spill merge determinism test passed');
