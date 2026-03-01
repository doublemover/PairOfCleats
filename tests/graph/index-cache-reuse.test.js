#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraphIndexCacheKey, createGraphStore } from '../../src/graph/store.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-index-cache-'));
const piecesDir = path.join(tmpDir, 'pieces');
fs.mkdirSync(piecesDir, { recursive: true });

const manifest = {
  compatibilityKey: 'compat-graph-index-cache',
  pieces: [
    { name: 'graph_relations', path: 'pieces/graph_relations.json' },
    { name: 'symbol_edges', path: 'pieces/symbol_edges.json' },
    { name: 'call_sites', path: 'pieces/call_sites.json' }
  ]
};

fs.writeFileSync(path.join(piecesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(piecesDir, 'graph_relations.json'),
  JSON.stringify(
    {
      version: 1,
      callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
      importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
    },
    null,
    2
  )
);
fs.writeFileSync(path.join(piecesDir, 'symbol_edges.json'), JSON.stringify([], null, 2));
fs.writeFileSync(path.join(piecesDir, 'call_sites.json'), JSON.stringify([], null, 2));

const store = createGraphStore({ indexDir: tmpDir, strict: true });
const cacheKey = buildGraphIndexCacheKey({
  indexSignature: 'graph-index-cache',
  graphs: ['symbolEdges']
});

const first = await store.loadGraphIndex({ cacheKey, graphs: ['symbolEdges'], repoRoot: tmpDir });
const second = await store.loadGraphIndex({ cacheKey, graphs: ['symbolEdges'], repoRoot: tmpDir });

assert.strictEqual(first, second);
console.log('graph index cache reuse test passed');
