#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildGraphIndexCacheKey, createGraphStore } from '../../src/graph/store.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-store-csr-'));
const piecesDir = path.join(tmpDir, 'pieces');
fs.mkdirSync(piecesDir, { recursive: true });

const manifest = {
  compatibilityKey: 'compat-graph-store-csr',
  pieces: [
    { name: 'graph_relations', path: 'pieces/graph_relations.json' },
    { name: 'graph_relations_csr', path: 'pieces/graph_relations.csr.json' }
  ]
};

fs.writeFileSync(path.join(piecesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

fs.writeFileSync(
  path.join(piecesDir, 'graph_relations.json'),
  JSON.stringify(
    {
      version: 2,
      generatedAt: new Date().toISOString(),
      callGraph: {
        nodeCount: 2,
        edgeCount: 1,
        nodes: [
          { id: 'chunk-a', out: ['chunk-b'], in: [] },
          { id: 'chunk-b', out: [], in: ['chunk-a'] }
        ]
      },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
      importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
    },
    null,
    2
  )
);

fs.writeFileSync(
  path.join(piecesDir, 'graph_relations.csr.json'),
  JSON.stringify(
    {
      version: 2,
      generatedAt: new Date().toISOString(),
      graphs: {
        callGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: ['chunk-a', 'chunk-b'],
          offsets: [0, 1, 1],
          edges: [1]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [], offsets: [0], edges: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [], offsets: [0], edges: [] }
      }
    },
    null,
    2
  )
);

const store = createGraphStore({ indexDir: tmpDir, strict: true });
assert.ok(store.hasArtifact('graph_relations_csr'), 'expected graph_relations_csr to be present');

const cacheKey = buildGraphIndexCacheKey({
  indexSignature: 'sig-csr',
  graphs: ['importGraph'],
  includeCsr: true
});

const index = await store.loadGraphIndex({
  cacheKey,
  graphs: ['importGraph'],
  repoRoot: tmpDir,
  includeCsr: true
});

assert.ok(index?.graphRelationsCsr, 'expected graphRelationsCsr to be attached');
assert.equal(store.stats()?.lastBuild?.csrSource, 'artifact', 'expected CSR to come from artifact load');
assert.equal(index.graphRelationsCsr.version, 2);
assert.ok(index.graphRelationsCsr.callGraph.offsets instanceof Uint32Array, 'expected CSR offsets to be uint32');
assert.ok(index.graphRelationsCsr.callGraph.edges instanceof Uint32Array, 'expected CSR edges to be uint32');
assert.deepStrictEqual(index.graphRelationsCsr.callGraph.ids, ['chunk-a', 'chunk-b']);
assert.deepStrictEqual(Array.from(index.graphRelationsCsr.callGraph.offsets), [0, 1, 1]);
assert.deepStrictEqual(Array.from(index.graphRelationsCsr.callGraph.edges), [1]);

console.log('graph store CSR artifact load test passed');

