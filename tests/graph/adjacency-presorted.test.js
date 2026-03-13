#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphIndex } from '../../src/graph/store.js';

const graph = {
  version: 1,
  callGraph: {
    nodeCount: 1,
    edgeCount: 2,
    nodes: [
      { id: 'chunk-a', out: ['chunk-c', 'chunk-b'], in: [] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const index = buildGraphIndex({ graphRelations: graph });
const out = index.callGraphAdjacency.get('chunk-a')?.out || [];

assert.deepStrictEqual(out, ['chunk-b', 'chunk-c']);
console.log('graph adjacency presorted test passed');
