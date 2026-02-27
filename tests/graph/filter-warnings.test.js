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

const unknownFilters = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  edgeFilters: {
    graphs: ['callGraph', 'mysteryGraph'],
    edgeTypes: ['call', 'mysteryType']
  },
  depth: 1
});

const unknownCodes = unknownFilters.warnings?.map((warning) => warning.code) || [];
assert(unknownCodes.includes('UNKNOWN_GRAPH_FILTER'), 'expected unknown graph filter warning');
assert(unknownCodes.includes('UNKNOWN_EDGE_TYPE_FILTER'), 'expected unknown edge type filter warning');

const noMatch = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  edgeFilters: {
    edgeTypes: ['dataflow']
  },
  depth: 1
});

const noMatchCodes = noMatch.warnings?.map((warning) => warning.code) || [];
assert(noMatchCodes.includes('EDGE_TYPE_FILTER_NO_MATCH'), 'expected edge type no-match warning');
assert.strictEqual(noMatch.edges.length, 0, 'expected no edges with dataflow filter');

console.log('graph filter warnings test passed');
