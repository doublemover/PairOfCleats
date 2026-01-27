#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRelationGraphs } from '../../src/index/build/graphs.js';

const chunks = [
  {
    file: 'caller.js',
    name: 'caller',
    kind: 'function',
    chunkUid: 'uid-caller',
    codeRelations: {
      callLinks: [
        { file: 'other.js', target: 'other', kind: 'function' }
      ]
    }
  },
  {
    file: 'target.js',
    name: 'target',
    kind: 'function',
    chunkUid: 'uid-target'
  },
  {
    file: 'other.js',
    name: 'other',
    kind: 'function',
    chunkUid: 'uid-other'
  }
];

const callSites = [
  { callerChunkUid: 'uid-caller', targetChunkUid: 'uid-target' }
];

const graphs = buildRelationGraphs({ chunks, callSites });
const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
assert.ok(callerNode, 'expected caller node in call graph');
assert.deepEqual(callerNode.out, ['uid-target'], 'callSites should override callLinks for call graph');

console.log('graph call_sites preferred test passed');
