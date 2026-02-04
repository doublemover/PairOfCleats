#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { compareGraphEdges, compareGraphNodes, edgeKey, nodeKey } from '../../src/graph/ordering.js';

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 3,
    edgeCount: 2,
    nodes: [
      { id: 'chunk-a', file: 'src/a.js', out: ['chunk-b'], in: [] },
      { id: 'chunk-b', file: 'src/b.js', out: ['chunk-c'], in: ['chunk-a'] },
      { id: 'chunk-c', file: 'src/c.js', out: [], in: ['chunk-b'] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const seedA = { type: 'chunk', chunkUid: 'chunk-a' };
const seedC = { type: 'chunk', chunkUid: 'chunk-c' };

const multi = buildGraphNeighborhood({
  seeds: [seedA, seedC],
  graphRelations,
  depth: 2,
  includePaths: false
});

const singleA = buildGraphNeighborhood({
  seed: seedA,
  graphRelations,
  depth: 2,
  includePaths: false
});

const singleC = buildGraphNeighborhood({
  seed: seedC,
  graphRelations,
  depth: 2,
  includePaths: false
});

const unionNodes = new Map();
for (const node of [...singleA.nodes, ...singleC.nodes]) {
  unionNodes.set(nodeKey(node.ref), node);
}
const unionEdges = new Map();
for (const edge of [...singleA.edges, ...singleC.edges]) {
  unionEdges.set(edgeKey(edge), edge);
}

const expectedNodes = Array.from(unionNodes.values()).sort(compareGraphNodes);
const expectedEdges = Array.from(unionEdges.values()).sort(compareGraphEdges);

assert.deepStrictEqual(multi.nodes, expectedNodes);
assert.deepStrictEqual(multi.edges, expectedEdges);

console.log('graph multi-seed deterministic test passed');
