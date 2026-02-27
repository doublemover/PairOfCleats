#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const graphRelations = {
  version: 1,
  callGraph: {
    nodeCount: 1,
    edgeCount: 0,
    nodes: [{ id: 'chunk-a', out: [], in: [] }]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: {
    nodeCount: 1,
    edgeCount: 0,
    nodes: [{ id: 'src/a.js', out: [], in: [] }]
  }
};

const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  includeImports: true,
  depth: 1
});

const codes = result.warnings?.map((warning) => warning.code) || [];
assert(codes.includes('IMPORT_GRAPH_MISSING_FILE'), 'expected import graph missing file warning');

console.log('graph import missing file warning test passed');
