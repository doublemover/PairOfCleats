#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGraphIndexCacheKey, createGraphStore } from '../../src/graph/store.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { createGraphStoreFixture, graphRelationsFromEdges } from './helpers/graph-fixtures.js';

const graphRelations = graphRelationsFromEdges({ callEdges: Array.from({ length: 64 }, (_, id) =>
  [`chunk-${id}`, [`chunk-${(id + 1) % 64}`, `chunk-${(id + 3) % 64}`]]),
usageEdges: [['chunk-0', ['chunk-8', 'chunk-9']]], importEdges: [['src/a.js', ['src/b.js']]] });
const { tmpDir } = createGraphStoreFixture({ prefix: 'graph-concurrent-build-', graphRelations });
let badRoot = null;
const neighborhood = (graphIndex) => {
  const result = buildGraphNeighborhood({ graphIndex, seed: { type: 'chunk', chunkUid: 'chunk-0' },
    direction: 'both', depth: 2, includePaths: true,
    caps: { maxFanoutPerNode: 3, maxNodes: 20, maxEdges: 40, maxPaths: 20, maxWorkUnits: 200 } });
  const { stats, ...stable } = result;
  return stable;
};
try {
  const store = createGraphStore({ indexDir: tmpDir, strict: true });
  const joined = [];
  for (const includeCsr of [false, true]) {
    const options = { repoRoot: tmpDir, indexSignature: tmpDir,
      graphs: ['callGraph', 'usageGraph', 'importGraph', 'symbolEdges'], includeCsr };
    const cacheKey = buildGraphIndexCacheKey(options);
    const beforeCache = store.stats().cache.index;
    const before = beforeCache.builds;
    const indexes = await Promise.all(Array.from({ length: 6 }, () => store.loadGraphIndex({ ...options, cacheKey })));
    assert.equal(store.stats().cache.index.builds - before, 1,
      'concurrent compatible callers must reuse the completed synchronous graph build after awaiting artifact admission');
    const afterCache = store.stats().cache.index;
    assert.equal(afterCache.hits + afterCache.misses - beforeCache.hits - beforeCache.misses, 6,
      'the internal post-load recheck must not double-count public request cache observations');
    assert.ok(indexes.every((index) => index === indexes[0]));
    const reference = await store.loadGraphIndex(options);
    assert.deepEqual(neighborhood(indexes[0]), neighborhood(reference), 'actual paths/caps/order preserve uncached output');
    assert.deepEqual(indexes[0].callGraphAdjacency, reference.callGraphAdjacency);
    assert.deepEqual(indexes[0].callGraphIds, reference.callGraphIds);
    assert.equal(Boolean(indexes[0].graphRelationsCsr), includeCsr);
    joined.push(indexes[0]);
    const unkeyedBefore = store.stats().cache.index.builds;
    const unkeyed = await Promise.all([store.loadGraphIndex(options), store.loadGraphIndex(options)]);
    assert.notEqual(unkeyed[0], unkeyed[1], 'calls without a generation key do not acquire shared cache authority');
    assert.equal(store.stats().cache.index.builds - unkeyedBefore, 2);
  }
  assert.notEqual(joined[0], joined[1], 'CSR selection retains its distinct cache key');
  const selected = { repoRoot: tmpDir, indexSignature: tmpDir, graphs: ['symbolEdges'] };
  const symbolIndex = await store.loadGraphIndex({ ...selected, cacheKey: buildGraphIndexCacheKey(selected) });
  assert.equal(symbolIndex.callGraphIndex.size, 0, 'graph selection is not widened by completed-build reuse');
  assert.equal(store.stats().cache.index.max, 3);
  assert.ok(store.stats().cache.index.peakSize <= 3);

  const separateStores = [store, createGraphStore({ indexDir: tmpDir, strict: true }),
    createGraphStore({ indexDir: tmpDir, strict: true })];
  const separateOptions = { repoRoot: tmpDir, indexSignature: `${tmpDir}:separate-stores`, graphs: ['callGraph'] };
  const separateKey = buildGraphIndexCacheKey(separateOptions);
  const separateBefore = separateStores.map((entry) => entry.stats().cache.index.builds);
  const separateIndexes = await Promise.all(separateStores.map((entry) => entry.loadGraphIndex({
    ...separateOptions, cacheKey: separateKey
  })));
  assert.ok(separateIndexes.every((index) => index === separateIndexes[0]), 'separate request stores reuse the same completed index');
  assert.equal(separateStores.reduce((total, entry, id) =>
    total + entry.stats().cache.index.builds - separateBefore[id], 0), 1);

  // A joined result cannot replace this caller's failed artifact admission.
  ({ tmpDir: badRoot } = createGraphStoreFixture({ prefix: 'graph-concurrent-invalid-', graphRelations }));
  await fs.writeFile(path.join(badRoot, 'pieces/graph_relations.json'), '{invalid');
  const bad = createGraphStore({ indexDir: badRoot, strict: true });
  const coldKey = buildGraphIndexCacheKey({ indexSignature: `${tmpDir}:cold-error`, graphs: ['callGraph'] });
  const outcomes = await Promise.allSettled([
    store.loadGraphIndex({ repoRoot: tmpDir, cacheKey: coldKey, graphs: ['callGraph'] }),
    bad.loadGraphIndex({ repoRoot: tmpDir, cacheKey: coldKey, graphs: ['callGraph'] })
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected', 'invalid artifact still fails after a concurrent compatible build finishes');
  await fs.writeFile(path.join(badRoot, 'pieces/graph_relations.json'), JSON.stringify(graphRelations));
  const retryKey = buildGraphIndexCacheKey({ indexSignature: `${tmpDir}:retry`, graphs: ['callGraph'] });
  const retried = await bad.loadGraphIndex({ repoRoot: badRoot, cacheKey: retryKey, graphs: ['callGraph'] });
  assert.equal(retried.callGraphIndex.size, 64, 'failed local artifact promises remain retryable');
  console.log('Graph concurrent build reuse passed: six callers build once per legacy/CSR key; actual traversal, selection, keyless and failed-admission controls preserved');
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
  if (badRoot) await fs.rm(badRoot, { recursive: true, force: true });
}
