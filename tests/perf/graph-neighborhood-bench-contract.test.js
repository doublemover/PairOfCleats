#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonArrayFile, writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { createGraphStore, buildGraphIndexCacheKey } from '../../src/graph/store.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { loadPiecesManifest, MAX_JSON_BYTES } from '../../src/shared/artifact-io.js';
import { buildIndexSignature } from '../../src/retrieval/index-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'graph-neighborhood-bench-contract');
const repoRoot = path.join(tempRoot, 'repo');
const indexDir = path.join(tempRoot, 'index-code');

const pad = (value, width = 6) => String(value).padStart(width, '0');
const chunkId = (i) => `chunk-${pad(i)}`;

const buildGraphFixture = ({ nodes, fanout, file }) => {
  const edgesOut = Array.from({ length: nodes }, () => []);
  for (let i = 0; i < nodes; i += 1) {
    const targets = [];
    for (let j = 1; j <= fanout; j += 1) {
      targets.push((i + j) % nodes);
    }
    targets.sort((a, b) => a - b);
    edgesOut[i] = targets;
  }

  const edgesIn = Array.from({ length: nodes }, () => []);
  for (let i = 0; i < nodes; i += 1) {
    for (const target of edgesOut[i]) edgesIn[target].push(i);
  }
  for (const list of edgesIn) list.sort((a, b) => a - b);

  const ids = Array.from({ length: nodes }, (_, i) => chunkId(i));
  const graphNodes = ids.map((id, i) => ({
    id,
    file,
    out: edgesOut[i].map((target) => ids[target]),
    in: edgesIn[i].map((source) => ids[source])
  }));

  const graphRelations = {
    version: 1,
    generatedAt: new Date().toISOString(),
    callGraph: {
      nodeCount: nodes,
      edgeCount: nodes * fanout,
      nodes: graphNodes
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  };

  const offsets = new Array(nodes + 1);
  offsets[0] = 0;
  const edges = [];
  for (let i = 0; i < nodes; i += 1) {
    const targets = edgesOut[i];
    offsets[i + 1] = offsets[i] + targets.length;
    for (const target of targets) edges.push(target);
  }

  const graphRelationsCsr = {
    version: 1,
    generatedAt: graphRelations.generatedAt,
    graphs: {
      callGraph: {
        nodeCount: nodes,
        edgeCount: edges.length,
        nodes: ids,
        offsets,
        edges
      },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [], offsets: [0], edges: [] },
      importGraph: { nodeCount: 0, edgeCount: 0, nodes: [], offsets: [0], edges: [] }
    }
  };

  return { graphRelations, graphRelationsCsr, ids };
};

const stripStats = (value) => {
  const cloned = JSON.parse(JSON.stringify(value));
  delete cloned.stats;
  return cloned;
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const repoFile = path.join(repoRoot, 'src', 'file.js');
const repoText = 'export const value = 1;\n';
await fs.writeFile(repoFile, repoText, 'utf8');
const repoBytes = Buffer.byteLength(repoText, 'utf8');

const nodes = 2000;
const fanout = 6;
const fileRel = 'src/file.js';
const { graphRelations, graphRelationsCsr, ids } = buildGraphFixture({
  nodes,
  fanout,
  file: fileRel
});

const chunkMeta = ids.map((chunkUid, i) => ({
  id: i,
  chunkUid,
  file: fileRel,
  start: 0,
  end: repoBytes,
  startLine: 1,
  endLine: 1,
  kind: 'code',
  name: chunkUid
}));

await writeJsonArrayFile(path.join(indexDir, 'chunk_meta.json'), chunkMeta, { atomic: true });
await writeJsonObjectFile(path.join(indexDir, 'graph_relations.json'), { fields: graphRelations, atomic: true });
await writeJsonObjectFile(path.join(indexDir, 'graph_relations_csr.json'), { fields: graphRelationsCsr, atomic: true });
await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), {
  fields: {
    artifactSurfaceVersion: 'test',
    buildId: 'bench-contract',
    mode: 'code',
    compatibilityKey: 'compat-test'
  },
  atomic: true
});
await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
  fields: {
    fields: {
      version: 2,
      artifactSurfaceVersion: 'test',
      compatibilityKey: 'compat-test',
      generatedAt: new Date().toISOString(),
      mode: 'code',
      stage: 'bench-contract',
      pieces: [
        { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
        { name: 'graph_relations', path: 'graph_relations.json', format: 'json' },
        { name: 'graph_relations_csr', path: 'graph_relations_csr.json', format: 'json' }
      ]
    }
  },
  atomic: true
});

const benchScript = path.join(root, 'tools', 'bench', 'graph', 'neighborhood-index-dir.js');
const result = spawnSync(process.execPath, [
  benchScript,
  '--mode',
  'compare',
  '--index',
  indexDir,
  '--repo',
  repoRoot,
  '--iterations',
  '6',
  '--depth',
  '2'
], { cwd: root, env: process.env, encoding: 'utf8' });

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
const match = output.match(/\{[\s\S]*\}\s*$/);
assert.ok(match, 'expected bench to emit trailing JSON');

const payload = JSON.parse(match[0]);
assert.equal(payload.ok, true);

const bench = payload.result;
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

const seed = { type: 'chunk', chunkUid: ids[0] };
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
