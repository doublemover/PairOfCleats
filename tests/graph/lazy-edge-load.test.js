#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphIndexCacheKey, createGraphStore } from '../../src/graph/store.js';
import { createGraphStoreFixture } from './helpers/graph-fixtures.js';

const { tmpDir } = createGraphStoreFixture({ prefix: 'graph-store-' });

const store = createGraphStore({ indexDir: tmpDir, strict: true });
const cacheKey = buildGraphIndexCacheKey({
  indexSignature: 'graph-lazy-edge-load',
  graphs: ['symbolEdges']
});

await store.loadGraphIndex({
  cacheKey,
  graphs: ['symbolEdges'],
  repoRoot: tmpDir
});

const used = store.getArtifactsUsed().sort();
assert.deepStrictEqual(used, ['symbol_edges']);

console.log('graph lazy edge load test passed');
