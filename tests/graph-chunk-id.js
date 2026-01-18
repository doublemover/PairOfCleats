#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRelationGraphs } from '../src/index/build/graphs.js';

const stableChunkId = 'chunk_graph_1';
const collisionChunkA = 'chunk_graph_a';
const collisionChunkB = 'chunk_graph_b';
const chunks = [
  {
    file: 'src/graph.js',
    name: 'buildWidget',
    kind: 'Function',
    metaV2: { chunkId: stableChunkId },
    codeRelations: {
      callLinks: [{ file: 'src/other.js', target: 'helper', kind: 'Function' }]
    }
  },
  {
    file: 'src/collision.js',
    name: 'dupName',
    kind: 'Function',
    metaV2: { chunkId: collisionChunkA }
  },
  {
    file: 'src/collision.js',
    name: 'dupName',
    kind: 'Function',
    metaV2: { chunkId: collisionChunkB }
  }
];

const graphs = buildRelationGraphs({ chunks, fileRelations: new Map() });
const node = graphs.callGraph.nodes.find((entry) => entry.id === stableChunkId);
assert.ok(node, 'expected call graph node');
assert.equal(node.chunkId, stableChunkId, 'expected stable chunkId in graph output');
assert.equal(node.legacyKey, 'src/graph.js::buildWidget', 'expected legacy key to be preserved');

const collisionNodes = graphs.callGraph.nodes.filter((entry) => entry.legacyKey === 'src/collision.js::dupName');
assert.equal(collisionNodes.length, 2, 'expected distinct nodes for colliding legacy keys');
assert.ok(collisionNodes.some((entry) => entry.id === collisionChunkA));
assert.ok(collisionNodes.some((entry) => entry.id === collisionChunkB));

console.log('graph chunk id test passed');
