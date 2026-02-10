#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildGraphContextPack } from '../../../src/graph/context-pack.js';
import { compareGraphEdges, compareGraphNodes } from '../../../src/graph/ordering.js';

applyTestEnv();

const graphRelations = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  callGraph: {
    nodeCount: 3,
    edgeCount: 2,
    nodes: [
      { id: 'chunk-c', file: 'src/c.js', name: 'gamma', kind: 'function', chunkId: 'c', out: [], in: ['chunk-a'] },
      { id: 'chunk-a', file: 'src/a.js', name: 'alpha', kind: 'function', chunkId: 'a', out: ['chunk-c', 'chunk-b'], in: [] },
      { id: 'chunk-b', file: 'src/b.js', name: 'beta', kind: 'function', chunkId: 'b', out: [], in: ['chunk-a'] }
    ]
  },
  usageGraph: {
    nodeCount: 0,
    edgeCount: 0,
    nodes: []
  },
  importGraph: {
    nodeCount: 0,
    edgeCount: 0,
    nodes: []
  }
};

const build = () => buildGraphContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  direction: 'out',
  depth: 1,
  caps: {
    maxDepth: 2,
    maxFanoutPerNode: 10,
    maxNodes: 10,
    maxEdges: 10,
    maxPaths: 5,
    maxCandidates: 5,
    maxWorkUnits: 100
  },
  indexCompatKey: 'graph-ordering-contract',
  now: () => '2026-02-10T00:00:00.000Z'
});

const stripDynamic = (value) => {
  const clone = JSON.parse(JSON.stringify(value));
  delete clone.stats;
  return clone;
};

const first = build();
const second = build();
assert.deepEqual(stripDynamic(first), stripDynamic(second), 'expected deterministic graph context pack output');

const sortedNodes = first.nodes.slice().sort(compareGraphNodes);
const sortedEdges = first.edges.slice().sort(compareGraphEdges);
assert.deepEqual(first.nodes, sortedNodes, 'expected nodes to be graph-order sorted');
assert.deepEqual(first.edges, sortedEdges, 'expected edges to be graph-order sorted');

console.log('graph artifact ordering contract test passed');
