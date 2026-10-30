import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAP_MODEL_VERSION } from '../../../src/map/model-version.js';
import { runMapSerializationExperiment } from '../../../tools/bench/map/experiment.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('map-pub');
try {
  const sentinel = path.join(dir, 'baseline-1.json'); await fs.writeFile(sentinel, 'caller-owned original');
  const nodes = [{ id: 'a', path: 'src/a.js', name: 'a.js', type: 'file', members: [{ id: 'm0', name: 'one', kind: 'function' }] },
    { id: 'b', path: 'src/b.js', name: 'b.js', type: 'file', members: [{ id: 'm1', name: 'two', kind: 'function' }] }];
  const edges = [{ type: 'call', from: { file: 'src/a.js', member: 'm0' }, to: { file: 'src/b.js', member: 'm1' } }];
  const model = { version: MAP_MODEL_VERSION, generatedAt: '2026-10-26T00:00:00.000Z', root: { path: dir, id: null },
    legend: {}, nodes, edges, summary: { counts: { files: 2, members: 2, edges: 1 }, inventory: { status: 'complete', files: 3 },
      dropped: { files: 1, members: 0, edges: 0 }, truncated: true, limits: { maxFiles: 2, maxMembersPerFile: 60, maxEdges: 3000 } },
    options: { limits: { maxFiles: 2, maxMembersPerFile: 60, maxEdges: 3000 } }, warnings: [] };
  const report = await runMapSerializationExperiment({ model, outputParent: dir, runs: 2, source: { kind: 'explicit-tiny-map-fixture' } });
  assert.equal(report.schemaVersion, 2); assert.equal(report.fixtureCleanup, 'completed');
  assert.equal(report.scope, 'streaming-serialization-of-an-already-materialized-map');
  assert.equal(report.preflight.publication, 'shared-map-atomic-stream-owner');
  assert.deepEqual(report.order.map(value => value.arm), ['baseline', 'streaming', 'streaming', 'baseline']);
  assert.deepEqual(report.workload.counts, { files: 2, members: 2, edges: 1 });
  assert.equal(report.workload.truncated, true); assert.equal(report.workload.dropped.files, 1);
  assert.ok(report.inputIdentity.bytes > 0); assert.match(report.inputIdentity.hash, /^[a-f0-9]{64}$/u);
  for (const arm of ['baseline', 'streaming']) {
    assert.equal(report[arm].completedOperations, 2); assert.equal(report[arm].rawSampleDurationsMs.length, 2);
    for (const sample of report[arm].samples) {
      assert.equal(sample.completedOperations, 1); assert.equal(sample.warmupOperations, 1);
      assert.equal(sample.publication, 'shared-map-atomic-stream-owner'); assert.equal(sample.consumerParity, 'parsed-content-identical');
      assert.equal(sample.inputHash, report.inputIdentity.hash); assert.ok(sample.outputBytes > 0);
      assert.notEqual(sample.pid, process.pid);
      assert.equal(sample.memory.boundaryPolicy, 'before-and-after-only;transients-unobserved');
      assert.equal(sample.memory.processLifetimeRss.state, 'observed', 'actual native high-water availability is required for this platform qualification');
      assert.ok(sample.memory.processLifetimeRss.bytes > 0); assert.equal(sample.memory.processLifetimeRss.outputUnit, 'bytes');
      assert.equal(Object.hasOwn(sample, 'peakHeap'), false); assert.equal(Object.hasOwn(sample, 'peakRss'), false);
    }
  }
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'caller-owned original');
  assert.deepEqual(await fs.readdir(dir), ['baseline-1.json']);
  await assert.rejects(fs.stat(report.fixtureRoot), { code: 'ENOENT' });
  await assert.rejects(runMapSerializationExperiment({ model: { ...model, summary: { counts: { files: 99, members: 2, edges: 1 } } }, outputParent: dir, runs: 1 }), /summary differs/u);
  await assert.rejects(runMapSerializationExperiment({ model, outputParent: dir, runs: 1.5 }), RangeError);
  const originalFailure = Object.assign(new Error('original map encoding failure'), { code: 'ERR_FIXTURE_MAP_ENCODING' });
  const contains = (error, target, seen = new Set()) => {
    if (error === target) return true;
    if (!error || typeof error !== 'object' || seen.has(error)) return false;
    seen.add(error);
    return contains(error.cause, target, seen) || (Array.isArray(error.errors) && error.errors.some(item => contains(item, target, seen)));
  };
  const failingNodes = [{ ...nodes[0], toJSON() { throw originalFailure; } }, nodes[1]];
  await assert.rejects(runMapSerializationExperiment({ model: { ...model, nodes: failingNodes }, outputParent: dir, runs: 1 }),
    error => contains(error, originalFailure), 'the actual atomic writer retains its original encoding failure');
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'caller-owned original');
  assert.deepEqual(await fs.readdir(dir), ['baseline-1.json'], 'confirmed failed writer cleanup removes only the unique experiment root');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Map writer experiments use equivalent atomic publication in fresh processes, disclose scoped workload/memory and preserve caller files.');
