#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphIndex } from '../../src/graph/store.js';

const graphA = {
  version: 1,
  callGraph: {
    nodeCount: 2,
    edgeCount: 2,
    nodes: [
      { id: 'chunk-a', out: ['chunk-c', 'chunk-b'], in: [] },
      { id: 'chunk-b', out: [], in: ['chunk-a'] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const graphB = {
  version: 1,
  callGraph: {
    nodeCount: 2,
    edgeCount: 2,
    nodes: [
      { id: 'chunk-b', out: [], in: ['chunk-a'] },
      { id: 'chunk-a', out: ['chunk-b', 'chunk-c'], in: [] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const indexA = buildGraphIndex({ graphRelations: graphA });
const indexB = buildGraphIndex({ graphRelations: graphB });

const outA = indexA.callGraphAdjacency.get('chunk-a')?.out || [];
const outB = indexB.callGraphAdjacency.get('chunk-a')?.out || [];

assert.deepStrictEqual(outA, outB);
console.log('graph adjacency determinism test passed');
