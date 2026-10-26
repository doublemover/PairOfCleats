import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runGraphStoreBench } from '../../../tools/bench/graph/store-lazy-load.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('graph-lazy-admission-phases');
try {
  const indexDir = path.join(dir, 'index'), repoRoot = path.join(dir, 'repo');
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true }); await fs.mkdir(repoRoot);
  const empty = { nodeCount: 0, edgeCount: 0, nodes: [] };
  const graph = { version: 1, callGraph: { nodeCount: 2, edgeCount: 1,
    nodes: [{ id: 'chunk-a', out: ['chunk-b'], in: [] }, { id: 'chunk-b', out: [], in: ['chunk-a'] }] },
  usageGraph: empty, importGraph: empty };
  const symbolEdges = [{ from: { chunkUid: 'chunk-a' }, type: 'reference', to: {
    v: 1, status: 'resolved', resolved: { symbolId: 'symbol-b' }, candidates: [{ symbolId: 'symbol-b' }]
  } }];
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [] };
  for (const [name, value] of [['graph_relations', graph], ['symbol_edges', symbolEdges], ['call_sites', []]]) {
    const relative = `pieces/${name}.json`; await fs.writeFile(path.join(indexDir, relative), JSON.stringify(value));
    manifest.pieces.push({ name, path: relative, format: 'json' });
  }
  await fs.writeFile(path.join(indexDir, 'pieces/manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'graph-lazy-admission-fixture', mode: 'code', compatibilityKey: 'graph-fixture' }));
  const input = { indexDir, repoRoot, iterations: 2, mode: 'compare' };
  const result = await runGraphStoreBench(input);
  assert.equal(result.state, 'qualified-inputs');
  assert.deepEqual(result.order, ['baseline', 'current', 'current', 'baseline']);
  assert.equal(result.applicationCachePolicy, 'fresh-node-process-per-arm-per-sample');
  assert.match(result.osCachePolicy, /uncontrolled/u);
  assert.equal(result.baseline.samples.length, 2); assert.equal(result.current.samples.length, 2);
  for (const arm of ['baseline', 'current']) for (const sample of result[arm].samples) {
    assert.equal(sample.completedColdOperations, 1); assert.equal(sample.completedWarmOperations, 1);
    assert.equal(sample.coldStats.cache.index.hits, 0); assert.equal(sample.coldStats.cache.index.builds, 1);
    assert.equal(sample.warmStats.cache.index.hits, 1); assert.equal(sample.warmStats.cache.index.builds, 1);
    assert.equal(sample.witness.occurrences, 1); assert.ok(sample.artifactBytes.symbol_edges > 0);
    assert.ok(Number.isSafeInteger(sample.pid));
    if (arm === 'current') assert.deepEqual(sample.artifactsUsed, ['symbol_edges']);
    else assert.deepEqual(sample.artifactsUsed, ['call_sites', 'graph_relations', 'symbol_edges']);
    assert.deepEqual(sample.witness, result.baseline.samples[0].witness);
  }
  const controlled = arm => structuredClone(result[arm].samples[0]);
  const noOmission = await runGraphStoreBench({ ...input, iterations: 1 }, { sample: async ({ arm }) => {
    const sample = controlled(arm); if (arm === 'baseline') sample.omittedGraphNodes = 0; return sample;
  } });
  assert.equal(noOmission.state, 'unavailable'); assert.equal(noOmission.reason, 'no-meaningful-omitted-relation-work');
  assert.equal(Object.hasOwn(noOmission, 'baseline'), false, 'unqualified workload cannot publish a comparative throughput summary');
  for (const defect of ['source', 'manifest', 'task', 'warm-cold', 'unrelated-artifact']) {
    await assert.rejects(runGraphStoreBench({ ...input, iterations: 1 }, { sample: async ({ arm }) => {
      const sample = controlled(arm);
      if (arm === 'current') {
        if (defect === 'source') sample.indexSignature = 'changed-source';
        if (defect === 'manifest') sample.manifestIdentity = 'a'.repeat(64);
        if (defect === 'task') sample.witness.sha256 = 'changed-task';
        if (defect === 'warm-cold') sample.coldStats.cache.index.hits = 1;
        if (defect === 'unrelated-artifact') sample.artifactsUsed.push('graph_relations');
      }
      return sample;
    } }), /Graph-store samples? (changed|lacks)/u);
  }
  const unavailable = await runGraphStoreBench(input, { sample: async ({ arm }) => ({ state: 'unavailable', reason: 'symbol-task-empty', arm }) });
  assert.equal(unavailable.state, 'unavailable');
  await assert.rejects(runGraphStoreBench({ ...input, iterations: 1.5 }), RangeError);
  await assert.rejects(runGraphStoreBench({ ...input, iterations: 0 }), RangeError);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Graph lazy-load benchmarks isolate cold/warm phases and require distinct artifact admission with identical symbol-task evidence.');
