#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { chunkCallGraphRelations, graphEdgeKey } from './helpers/graph-fixtures.js';

const graphRelations = chunkCallGraphRelations({
  usageGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'chunk-a', out: ['chunk-c'], in: [] },
      { id: 'chunk-c', out: [], in: ['chunk-a'] }
    ]
  }
});

const build = () => buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  depth: 1,
  edgeFilters: { graphs: ['usageGraph'] }
});

const first = build();
const second = build();

assert.deepStrictEqual(
  second.edges.map((edge) => edgeKey(edge)),
  first.edges.map((edge) => edgeKey(edge))
);
assert.strictEqual(first.edges.length, 1);
assert.strictEqual(first.edges[0].graph, 'usageGraph');

console.log('graph filter predicate determinism test passed');

function edgeKey(edge) {
  return graphEdgeKey(edge);
}
