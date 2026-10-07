#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { buildGraphIndexCacheKey, createGraphStore } from '../../src/graph/store.js';
import { chunkCallGraphRelations, createGraphStoreFixture } from './helpers/graph-fixtures.js';

const generatedAt = new Date().toISOString();
const { tmpDir } = createGraphStoreFixture({
  prefix: 'graph-store-csr-',
  compatibilityKey: 'compat-graph-store-csr',
  graphRelations: chunkCallGraphRelations({ version: 2, generatedAt }),
  extraPieces: [{ name: 'graph_relations_csr', path: 'pieces/graph_relations.csr.json' }],
  writeExtraPieces({ piecesDir }) {
    fs.writeFileSync(
      path.join(piecesDir, 'graph_relations.csr.json'),
      JSON.stringify(
        {
          version: 2,
          generatedAt,
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
  }
});

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

