#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'map-chunkuid-join');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunkMeta = [
  {
    id: 1,
    start: 0,
    end: 10,
    file: 'src/caller.js',
    name: 'caller',
    kind: 'function',
    chunkUid: 'uid-caller',
    metaV2: {
      chunkUid: 'uid-caller',
      file: 'src/caller.js',
      name: 'caller',
      kind: 'function',
      symbol: {
        v: 1,
        scheme: 'heur',
        kindGroup: 'function',
        qualifiedName: 'caller',
        symbolKey: 'src/caller.js::caller::function',
        signatureKey: null,
        scopedId: 'function|src/caller.js::caller::function|uid-caller',
        symbolId: 'sym1:heur:caller'
      }
    }
  },
  {
    id: 2,
    start: 0,
    end: 10,
    file: 'src/target.js',
    name: 'target',
    kind: 'function',
    chunkUid: 'uid-target',
    metaV2: {
      chunkUid: 'uid-target',
      file: 'src/target.js',
      name: 'target',
      kind: 'function',
      symbol: {
        v: 1,
        scheme: 'heur',
        kindGroup: 'function',
        qualifiedName: 'target',
        symbolKey: 'src/target.js::target::function',
        signatureKey: null,
        scopedId: 'function|src/target.js::target::function|uid-target',
        symbolId: 'sym1:heur:target'
      }
    }
  }
];

const graphRelations = {
  version: 2,
  generatedAt: new Date().toISOString(),
  callGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      {
        id: 'uid-caller',
        file: 'src/caller.js',
        name: 'caller',
        kind: 'function',
        chunkId: 'chunk-caller',
        chunkUid: 'uid-caller',
        legacyKey: 'src/caller.js::caller',
        symbolId: 'sym1:heur:caller',
        out: ['uid-target'],
        in: []
      },
      {
        id: 'uid-target',
        file: 'src/target.js',
        name: 'target',
        kind: 'function',
        chunkId: 'chunk-target',
        chunkUid: 'uid-target',
        legacyKey: 'src/target.js::target',
        symbolId: 'sym1:heur:target',
        out: [],
        in: ['uid-caller']
      }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

await fs.writeFile(path.join(tempRoot, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2));
await fs.writeFile(path.join(tempRoot, 'graph_relations.json'), JSON.stringify(graphRelations, null, 2));
await writePiecesManifest(tempRoot, [
  { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
  { name: 'graph_relations', path: 'graph_relations.json', format: 'json' }
]);

const mapModel = await buildCodeMap({
  repoRoot: root,
  indexDir: tempRoot,
  options: { include: ['calls'], strict: false }
});

const callEdges = mapModel.edges.filter((edge) => edge.type === 'call');
assert.equal(callEdges.length, 1, 'expected one call edge');
assert.equal(callEdges[0].from?.member, 'sym1:heur:caller');
assert.equal(callEdges[0].to?.member, 'sym1:heur:target');

console.log('map chunkUid join test passed');
