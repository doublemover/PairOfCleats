#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { createGraphStore, buildGraphIndexCacheKey } from '../../src/graph/store.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { loadPiecesManifest, MAX_JSON_BYTES } from '../../src/shared/artifact-io.js';
import { buildIndexSignature } from '../../src/retrieval/index-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createGraphBenchFixture, runGraphBenchCompare } from './helpers/graph-bench-fixture.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const { indexDir, repoRoot } = await createGraphBenchFixture({
  tempLabel: 'graph-neighborhood-bench-contract',
  repoText: 'export const value = 1;\n'
});

const stripStats = (value) => {
  const cloned = JSON.parse(JSON.stringify(value));
  delete cloned.stats;
  return cloned;
};

const bench = runGraphBenchCompare({
  benchScript: path.join(root, 'tools', 'bench', 'graph', 'neighborhood-index-dir.js'),
  indexDir,
  repoRoot
});
assert.equal(bench.mode, 'compare');

const cold = bench.neighborhood?.includePathsFalse?.currentCold;
const warm = bench.neighborhood?.includePathsFalse?.currentWarm;
const baseline = bench.neighborhood?.includePathsFalse?.baseline;

assert.ok(cold && warm && baseline, 'expected neighborhood includePaths=false cases');
assert.ok(warm.throughput > cold.throughput, 'expected warm cache to outperform cold in same run');
assert.ok(warm.throughput > baseline.throughput, 'expected current warm to outperform baseline');

// Determinism + cache-boundary coverage:
// - CSR vs legacy output equality (sorted inputs, stable witness-paths).
// - GraphStore cache reuse does not affect output ordering.
const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
const indexSignature = await buildIndexSignature(indexDir);
const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
const graphs = ['callGraph', 'usageGraph', 'importGraph'];

const keyLegacy = buildGraphIndexCacheKey({ indexSignature, repoRoot, graphs, includeCsr: false });
const keyCsr = buildGraphIndexCacheKey({ indexSignature, repoRoot, graphs, includeCsr: true });
const graphIndexLegacy = await graphStore.loadGraphIndex({
  repoRoot,
  cacheKey: keyLegacy,
  graphs,
  includeCsr: false,
  indexSignature
});
const graphIndexCsrLoaded = await graphStore.loadGraphIndex({
  repoRoot,
  cacheKey: keyCsr,
  graphs,
  includeCsr: true,
  indexSignature
});
const graphIndexLegacyCached = await graphStore.loadGraphIndex({
  repoRoot,
  cacheKey: keyLegacy,
  graphs,
  includeCsr: false,
  indexSignature
});

const seed = { type: 'chunk', chunkUid: 'chunk-000000' };
const caps = {
  maxDepth: 3,
  maxFanoutPerNode: 25,
  maxNodes: 200,
  maxEdges: 400,
  maxPaths: 200,
  maxWorkUnits: 50000
};

const legacyOut = stripStats(buildGraphNeighborhood({
  seed,
  graphIndex: graphIndexLegacy,
  direction: 'both',
  depth: 2,
  includePaths: true,
  caps
}));
const csrOut = stripStats(buildGraphNeighborhood({
  seed,
  graphIndex: graphIndexCsrLoaded,
  direction: 'both',
  depth: 2,
  includePaths: true,
  caps
}));
const legacyCachedOut = stripStats(buildGraphNeighborhood({
  seed,
  graphIndex: graphIndexLegacyCached,
  direction: 'both',
  depth: 2,
  includePaths: true,
  caps
}));

assert.deepStrictEqual(csrOut, legacyOut, 'expected CSR output to match legacy output');
assert.deepStrictEqual(legacyCachedOut, legacyOut, 'expected GraphStore cache reuse to preserve output determinism');

console.log('graph neighborhood bench contract test passed');

