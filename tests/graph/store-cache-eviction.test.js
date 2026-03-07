#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraphIndexCacheKey, createGraphStore } from '../../src/graph/store.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-store-evict-'));
const piecesDir = path.join(tmpDir, 'pieces');
fs.mkdirSync(piecesDir, { recursive: true });

const manifest = {
  compatibilityKey: 'compat-graph-store-evict',
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
const key1 = buildGraphIndexCacheKey({ indexSignature: 'sig-1', graphs: ['symbolEdges'] });
const key2 = buildGraphIndexCacheKey({ indexSignature: 'sig-2', graphs: ['symbolEdges'] });
const key3 = buildGraphIndexCacheKey({ indexSignature: 'sig-3', graphs: ['symbolEdges'] });
const key4 = buildGraphIndexCacheKey({ indexSignature: 'sig-4', graphs: ['symbolEdges'] });

const first = await store.loadGraphIndex({ cacheKey: key1, graphs: ['symbolEdges'], repoRoot: tmpDir });
await store.loadGraphIndex({ cacheKey: key2, graphs: ['symbolEdges'], repoRoot: tmpDir });
await store.loadGraphIndex({ cacheKey: key3, graphs: ['symbolEdges'], repoRoot: tmpDir });
await store.loadGraphIndex({ cacheKey: key4, graphs: ['symbolEdges'], repoRoot: tmpDir });

const reloaded = await store.loadGraphIndex({ cacheKey: key1, graphs: ['symbolEdges'], repoRoot: tmpDir });
assert.notStrictEqual(first, reloaded);

const stats = store.stats();
assert.ok(Number.isFinite(stats?.cache?.index?.evictions), 'expected index cache eviction metric');
assert.ok(Number.isFinite(stats?.cache?.artifacts?.evictions), 'expected artifact cache eviction metric');
assert.ok(stats.cache.index.evictions >= 1, 'expected index cache eviction to occur');
assert.ok(stats.cache.artifacts.evictions >= 1, 'expected artifact cache eviction to occur');
assert.ok(Number.isFinite(stats.cache.index.peakSize), 'expected index peak cache size metric');
assert.ok(Number.isFinite(stats.cache.artifacts.peakSize), 'expected artifact peak cache size metric');
assert.ok(stats.cache.index.peakSize <= stats.cache.index.max, 'index peak size should respect cap');
assert.ok(stats.cache.artifacts.peakSize <= stats.cache.artifacts.max, 'artifact peak size should respect cap');

console.log('graph store cache eviction test passed');
