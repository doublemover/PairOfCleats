#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRelationGraphs } from '../../../src/index/build/graphs.js';

const baseChunks = [
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
            targetName: 'other',
            kindHint: null,
            importHint: null,
            candidates: [],
            status: 'resolved',
            resolved: { symbolId: 'sym1:heur:other', chunkUid: 'uid-other' }
          },
          legacy: { legacy: true, file: 'other.js', target: 'other', kind: 'function' }
        }
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

{
  const chunks = structuredClone(baseChunks);
  chunks[0].codeRelations.callLinks[0].to.targetName = 'target';
  chunks[0].codeRelations.callLinks[0].to.resolved = { symbolId: 'sym1:heur:target', chunkUid: 'uid-target' };
  chunks[0].codeRelations.callLinks[0].legacy = {
    legacy: true,
    file: 'target.js',
    target: 'target',
    kind: 'function'
  };

  const graphs = buildRelationGraphs({ chunks });
  const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
  assert.ok(callerNode, 'expected caller node in call graph');
  assert.deepEqual(callerNode.out, ['uid-target']);
}

{
  const graphs = buildRelationGraphs({
    chunks: structuredClone(baseChunks),
    callSites: [{ callerChunkUid: 'uid-caller', targetChunkUid: 'uid-target' }]
  });
  const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
  assert.ok(callerNode, 'expected caller node in call graph');
  assert.deepEqual(callerNode.out, ['uid-other', 'uid-target']);
}

console.log('relations call graph contract matrix test passed');
