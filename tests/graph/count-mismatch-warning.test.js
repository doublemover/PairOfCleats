#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 5,
    edgeCount: 2,
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
  depth: 1
});

const codes = result.warnings?.map((warning) => warning.code) || [];
assert(codes.includes('GRAPH_COUNT_MISMATCH'), 'expected graph count mismatch warning');

console.log('graph count mismatch warning test passed');
