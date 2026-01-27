#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRelationGraphs } from '../../src/index/build/graphs.js';

const chunks = [
  {
    file: 'dup.js',
    name: 'dup',
    kind: 'function',
    chunkUid: 'uid-dup-1'
  },
  {
    file: 'dup.js',
    name: 'dup',
    kind: 'function',
    chunkUid: 'uid-dup-2'
  },
  {
    file: 'caller.js',
    name: 'caller',
    kind: 'function',
    chunkUid: 'uid-caller',
    codeRelations: {
      callLinks: [
        { file: 'dup.js', target: 'dup', kind: 'function' }
      ]
    }
  }
];

const graphs = buildRelationGraphs({ chunks });
const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
assert.ok(callerNode, 'expected caller node in call graph');
assert.deepEqual(callerNode.out, [], 'ambiguous file::name should not create call graph edges');

console.log('file name collision guard test passed');
