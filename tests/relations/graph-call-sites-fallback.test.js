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
        {
          v: 1,
          edgeKind: 'call',
          fromChunkUid: 'uid-caller',
          to: {
            v: 1,
            targetName: 'target',
            kindHint: null,
            importHint: null,
            candidates: [],
            status: 'resolved',
            resolved: { symbolId: 'sym1:heur:target', chunkUid: 'uid-target' }
          },
          legacy: { legacy: true, file: 'target.js', target: 'target', kind: 'function' }
        }
      ]
    }
  },
  {
    file: 'target.js',
    name: 'target',
    kind: 'function',
    chunkUid: 'uid-target'
  }
];

const graphs = buildRelationGraphs({ chunks });
const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
assert.ok(callerNode, 'expected caller node in call graph');
assert.deepEqual(callerNode.out, ['uid-target'], 'callLinks should populate call graph when callSites absent');

console.log('graph call_sites fallback test passed');
