#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const buildGraph = (neighbors) => ({
  version: 1,
  callGraph: {
    nodeCount: 1,
    edgeCount: neighbors.length,
    nodes: [{ id: 'chunk-a', out: neighbors, in: [] }]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
});

const graphA = buildGraph(['chunk-c', 'chunk-b', 'chunk-d']);
const graphB = buildGraph(['chunk-d', 'chunk-b', 'chunk-c']);

const caps = { maxFanoutPerNode: 2 };
const first = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations: graphA,
  depth: 1,
  caps
});
const second = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations: graphB,
  depth: 1,
  caps
});

assert.deepStrictEqual(second.truncation, first.truncation);
console.log('graph truncation determinism test passed');
