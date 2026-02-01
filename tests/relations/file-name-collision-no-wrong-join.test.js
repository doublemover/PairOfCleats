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
        {
          v: 1,
          edgeKind: 'call',
          fromChunkUid: 'uid-caller',
          to: {
            v: 1,
            targetName: 'dup',
            kindHint: null,
            importHint: null,
            candidates: [
              { symbolId: 'sym1:heur:dup-1', chunkUid: 'uid-dup-1', symbolKey: 'dup', signatureKey: null, kindGroup: 'function' },
              { symbolId: 'sym1:heur:dup-2', chunkUid: 'uid-dup-2', symbolKey: 'dup', signatureKey: null, kindGroup: 'function' }
            ],
            status: 'ambiguous',
            resolved: null
          },
          legacy: { legacy: true, file: 'dup.js', target: 'dup', kind: 'function' }
        }
      ]
    }
  }
];

const graphs = buildRelationGraphs({ chunks });
const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
assert.ok(callerNode, 'expected caller node in call graph');
assert.deepEqual(callerNode.out, [], 'ambiguous file::name should not create call graph edges');

console.log('file name collision guard test passed');
