#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../src/graph/store.js';

const graphA = {
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

const graphB = {
  version: 1,
  callGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'chunk-a', out: ['chunk-c'], in: [] },
      { id: 'chunk-c', out: [], in: ['chunk-a'] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const graphIndex = buildGraphIndex({ graphRelations: graphA });
const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations: graphB,
  graphIndex,
  depth: 1
});

const codes = result.warnings?.map((warning) => warning.code) || [];
assert(codes.includes('GRAPH_INDEX_MISMATCH'), 'expected graph index mismatch warning');
assert(result.edges.some((edge) => edge.to?.chunkUid === 'chunk-c'), 'expected edges from graphRelations');

console.log('graph index mismatch warning test passed');
