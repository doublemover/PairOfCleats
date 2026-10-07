#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCodeRelations } from '../../../src/lang/javascript.js';
import { buildTypeScriptRelations } from '../../../src/lang/typescript.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { discoverSegments, chunkSegments } from '../../../src/index/segments.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
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

{
  const stableChunkId = 'chunk_graph_1';
  const stableChunkUid = 'ck64:graph-1';
  const collisionChunkA = 'chunk_graph_a';
  const collisionChunkB = 'chunk_graph_b';
  const collisionChunkUidA = 'ck64:dup-a';
  const collisionChunkUidB = 'ck64:dup-b';
  const graphs = buildRelationGraphs({
    chunks: [
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
    ],
    fileRelations: new Map()
  });
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
}

{
  const graphs = buildRelationGraphs({
    chunks: [
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
    ],
    fileRelations: new Map()
  });
  const callerNode = graphs.callGraph.nodes.find((node) => node.id === 'uid-caller');
  assert.ok(callerNode, 'expected caller node');
  assert.deepEqual(callerNode.out, ['uid-target'], 'only resolved edges should be emitted');
}

{
  const rows = createCallSites({
    chunks: [
      {
        id: 1,
        file: 'b.ts',
        lang: 'typescript',
        codeRelations: {
          callDetails: [
            {
              caller: 'beta',
              callee: 'zeta.do',
              start: 20,
              end: 24,
              startLine: 2,
              startCol: 1,
              endLine: 2,
              endCol: 5,
              args: ['b']
            }
          ]
        }
      },
      {
        id: 0,
        file: 'a.ts',
        lang: 'typescript',
        codeRelations: {
          callDetails: [
            {
              caller: 'alpha',
              callee: 'alpha.run',
              start: 5,
              end: 9,
              startLine: 1,
              startCol: 1,
              endLine: 1,
              endCol: 5,
              args: ['a']
            }
          ]
        }
      }
    ]
  });
  const reversed = createCallSites({
    chunks: [
      {
        id: 0,
        file: 'a.ts',
        lang: 'typescript',
        codeRelations: {
          callDetails: [
            {
              caller: 'alpha',
              callee: 'alpha.run',
              start: 5,
              end: 9,
              startLine: 1,
              startCol: 1,
              endLine: 1,
              endCol: 5,
              args: ['a']
            }
          ]
        }
      },
      {
        id: 1,
        file: 'b.ts',
        lang: 'typescript',
        codeRelations: {
          callDetails: [
            {
              caller: 'beta',
              callee: 'zeta.do',
              start: 20,
              end: 24,
              startLine: 2,
              startCol: 1,
              endLine: 2,
              endCol: 5,
              args: ['b']
            }
          ]
        }
      }
    ]
  });
  assert.equal(rows.length, 2, 'expected two call_sites rows');
  assert.equal(rows[0].file, 'a.ts', 'call_sites should be ordered by file');
  assert.equal(rows[1].file, 'b.ts', 'call_sites should be ordered by file');
  assert.equal(rows[0].calleeNormalized, 'run', 'calleeNormalized should be derived');
  assert.deepEqual(rows, reversed, 'call_sites ordering should be deterministic');
}

{
  const source = `
function alpha() {
  obj.method("alpha", 1, true, foo, bar, baz);
  fn(a(b()));
}
`;
  const relations = buildCodeRelations(source, 'sample.js', { ext: '.js' });
  const details = Array.isArray(relations?.callDetails) ? relations.callDetails : [];
  assert.ok(details.length >= 2, 'expected at least two JS call details');
  const methodCall = details.find((detail) => detail.calleeRaw === 'obj.method');
  assert.ok(methodCall, 'expected obj.method call detail');
  assert.equal(methodCall.calleeNormalized, 'method');
  assert.equal(methodCall.receiver, 'obj');
  assert.ok(Number.isFinite(methodCall.startLine));
  assert.ok(Number.isFinite(methodCall.startCol));
  assert.ok(Array.isArray(methodCall.args));
  assert.ok(methodCall.args.length <= 5);
}

{
  const tsSource = `
function beta() {
  foo?.bar(1, 2, 3, 4, 5, 6);
}
`;
  const tsRelations = buildTypeScriptRelations(tsSource, null, { ext: '.ts' });
  const tsDetails = Array.isArray(tsRelations?.callDetails) ? tsRelations.callDetails : [];
  assert.ok(tsDetails.length >= 1, 'expected call details from TS');
  const call = tsDetails[0];
  assert.ok(call.calleeRaw);
  assert.ok(call.calleeNormalized);
  assert.ok(Number.isFinite(call.startLine));
  assert.ok(Number.isFinite(call.startCol));
  assert.ok(call.args.length <= 5);

  const tsxSource = `
const View = () => <div>{bar()}</div>;
`;
  const tsxRelations = buildTypeScriptRelations(tsxSource, null, { ext: '.tsx' });
  const tsxDetails = Array.isArray(tsxRelations?.callDetails) ? tsxRelations.callDetails : [];
  assert.ok(tsxDetails.length >= 1, 'expected TSX call details');
  assert.ok(tsxDetails.some((detail) => detail.calleeNormalized === 'bar'));

  const segments = discoverSegments({
    text: tsxSource,
    ext: '.tsx',
    relPath: 'sample.tsx',
    mode: 'code',
    languageId: 'typescript',
    segmentsConfig: null,
    extraSegments: []
  });
  const chunks = chunkSegments({
    text: tsxSource,
    ext: '.tsx',
    relPath: 'sample.tsx',
    mode: 'code',
    segments,
    lineIndex: buildLineIndex(tsxSource)
  });
  const barCall = tsxDetails.find((detail) => detail.calleeNormalized === 'bar');
  assert.ok(barCall, 'expected bar() call detail');
  assert.ok(Number.isFinite(barCall.start) && Number.isFinite(barCall.end));
  assert.ok(tsxSource.slice(barCall.start, barCall.end).includes('bar'));
  const containingChunk = chunks.find((chunk) => barCall.start >= chunk.start && barCall.end <= chunk.end);
  assert.ok(containingChunk, 'expected callsite to map to a chunk in container space');
}

console.log('relations call graph contract matrix test passed');
