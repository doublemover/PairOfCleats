#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../src/graph/store.js';

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 1,
    edgeCount: 0,
    nodes: [{ id: 'chunk-a', out: [], in: [] }]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const graphIndex = buildGraphIndex({ graphRelations, repoRoot: 'C:/repo-a' });
const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  graphIndex,
  repoRoot: 'C:/repo-b',
  depth: 0
});

const codes = result.warnings?.map((warning) => warning.code) || [];
assert(codes.includes('GRAPH_INDEX_REPOROOT_MISMATCH'), 'expected repoRoot mismatch warning');

console.log('graph repoRoot mismatch warning test passed');
