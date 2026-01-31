#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRelationGraphs } from '../src/index/build/graphs.js';

const stableChunkId = 'chunk_graph_1';
const stableChunkUid = 'ck64:graph-1';
const collisionChunkA = 'chunk_graph_a';
const collisionChunkB = 'chunk_graph_b';
const collisionChunkUidA = 'ck64:dup-a';
const collisionChunkUidB = 'ck64:dup-b';
const chunks = [
  {
    file: 'src/graph.js',
    name: 'buildWidget',
    kind: 'Function',
    metaV2: {
      chunkId: stableChunkId,
      chunkUid: stableChunkUid,
      symbol: { symbolId: 'sym1:heur:graph-1' }
    },
    codeRelations: {
      callLinks: [{
        v: 1,
        edgeKind: 'call',
        fromChunkUid: stableChunkUid,
        to: {
          v: 1,
          targetName: 'helper',
          kindHint: null,
          importHint: null,
          candidates: [],
          status: 'resolved',
          resolved: { symbolId: 'sym1:heur:helper', chunkUid: 'ck64:helper' }
        }
      }]
    }
  },
  {
    file: 'src/collision.js',
    name: 'dupName',
    kind: 'Function',
    metaV2: { chunkId: collisionChunkA, chunkUid: collisionChunkUidA }
  },
  {
    file: 'src/collision.js',
    name: 'dupName',
    kind: 'Function',
    metaV2: { chunkId: collisionChunkB, chunkUid: collisionChunkUidB }
  }
];

const graphs = buildRelationGraphs({ chunks, fileRelations: new Map() });
assert.equal(graphs.version, 2, 'expected graph_relations version 2');
const node = graphs.callGraph.nodes.find((entry) => entry.id === stableChunkUid);
assert.ok(node, 'expected call graph node');
assert.equal(node.chunkUid, stableChunkUid, 'expected chunkUid in graph output');
assert.equal(node.chunkId, stableChunkId, 'expected stable chunkId in graph attrs');
assert.equal(node.legacyKey, 'src/graph.js::buildWidget', 'expected legacy key to be preserved');

const collisionNodes = graphs.callGraph.nodes.filter((entry) => entry.legacyKey === 'src/collision.js::dupName');
assert.equal(collisionNodes.length, 2, 'expected distinct nodes for colliding legacy keys');
assert.ok(collisionNodes.some((entry) => entry.id === collisionChunkUidA));
assert.ok(collisionNodes.some((entry) => entry.id === collisionChunkUidB));

console.log('graph chunk id test passed');
