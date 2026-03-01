#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'chunk-a', out: ['chunk-b'], in: [] },
      { id: 'chunk-b', out: [], in: ['chunk-a'] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  edgeFilters: { edgeTypes: ['call'] },
  depth: 1
});

assert(result.edges.length > 0, 'expected callGraph edges to remain when edgeTypes filter supplied');

console.log('graph edgeTypes include graph test passed');
