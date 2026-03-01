#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../src/graph/store.js';

const baseGraph = {
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

const graphForIndex = JSON.parse(JSON.stringify(baseGraph));
const graphForCall = JSON.parse(JSON.stringify(baseGraph));
graphForCall.callGraph.nodes.push({ id: 'chunk-c', out: [], in: [] });
graphForCall.callGraph.nodeCount = 3;

const graphIndex = buildGraphIndex({ graphRelations: graphForIndex });

const neighborhood = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations: graphForCall,
  graphIndex,
  depth: 1
});

const ids = neighborhood.nodes.map((node) => node?.ref?.chunkUid).filter(Boolean).sort();
assert.deepStrictEqual(ids, ['chunk-a', 'chunk-b']);

console.log('graph neighborhood cache test passed');
