#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRelationGraphs } from '../../../src/index/build/graphs.js';

const chunks = [
  {
    file: 'src/caller.js',
    name: 'caller',
    kind: 'function',
    chunkUid: 'uid-caller',
    metaV2: { chunkUid: 'uid-caller', chunkId: 'chunk-caller', symbol: { symbolId: 'sym1:heur:caller' } },
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
          }
        },
        {
          v: 1,
          edgeKind: 'call',
          fromChunkUid: 'uid-caller',
          to: {
            v: 1,
            targetName: 'ambiguous',
            kindHint: null,
            importHint: null,
            candidates: [
              { symbolId: 'sym1:heur:a1', chunkUid: 'uid-a1', symbolKey: 'amb', signatureKey: null, kindGroup: 'function' },
              { symbolId: 'sym1:heur:a2', chunkUid: 'uid-a2', symbolKey: 'amb', signatureKey: null, kindGroup: 'function' }
            ],
            status: 'ambiguous',
            resolved: null
          }
        }
      ]
    }
  },
  {
    file: 'src/target.js',
    name: 'target',
    kind: 'function',
    chunkUid: 'uid-target',
    metaV2: { chunkUid: 'uid-target', chunkId: 'chunk-target', symbol: { symbolId: 'sym1:heur:target' } }
  }
];

const graphs = buildRelationGraphs({ chunks, fileRelations: new Map() });
assert.equal(graphs.version, 2, 'expected graph_relations version 2');
const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
assert.ok(callerNode, 'expected caller node');
assert.deepEqual(callerNode.out, ['uid-target'], 'only resolved edges should be emitted');

console.log('graph relations v2 chunkUid test passed');
