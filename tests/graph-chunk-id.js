#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRelationGraphs } from '../src/index/build/graphs.js';

const stableChunkId = 'chunk_graph_1';
const chunks = [
  {
    file: 'src/graph.js',
    name: 'buildWidget',
    kind: 'Function',
    metaV2: { chunkId: stableChunkId },
    codeRelations: {
      callLinks: [{ file: 'src/other.js', target: 'helper', kind: 'Function' }]
    }
  }
];

const graphs = buildRelationGraphs({ chunks, fileRelations: new Map() });
const node = graphs.callGraph.nodes.find((entry) => entry.id === 'src/graph.js::buildWidget');
assert.ok(node, 'expected call graph node');
assert.equal(node.chunkId, stableChunkId, 'expected stable chunkId in graph output');

console.log('graph chunk id test passed');
