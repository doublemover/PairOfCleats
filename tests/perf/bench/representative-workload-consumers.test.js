import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runRenderSortBench } from '../../../tools/bench/graph/render-sort.js';
import { runGraphStoreBench } from '../../../tools/bench/graph/store-lazy-load.js';
import { runMapSerializationExperiment } from '../../../tools/bench/map/experiment.js';
import { runVfsColdStartBench } from '../../../tools/bench/vfs/cold-start-cache.js';
import { buildVfsColdStartPlan } from '../../../tools/bench/vfs/cold-start-sample.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { MAP_MODEL_VERSION } from '../../../src/map/model-version.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { runNode } from '../../helpers/run-node.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/bench/representative-workload-consumers/')[1];
assert.ok(['render', 'graph-skewed', 'graph-skewed-independent', 'map-large', 'memory-transient', 'vfs-ascii', 'vfs-many-persisted-1', 'vfs-many-persisted-2', 'vfs-many-persisted-3', 'vfs-many-hot-1', 'vfs-many-hot-2', 'vfs-many-hot-3', 'vfs-budget', 'sqlite-wide-a', 'sqlite-wide-b', 'sqlite-wide-c1', 'sqlite-wide-c2'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`bench-representative-${selected}`);
let evidence, cleanupAllowed = true;
try {
  if (selected.startsWith('sqlite-wide-')) {
    // Four separately bounded capsules retain six alternating paired trials.
    // The threshold is crossed by real retained metadata, never a byte override.
    const split = /^sqlite-wide-c[12]$/u.test(selected), trialOffset = selected === 'sqlite-wide-c2' ? 1 : 0;
    const trials = split ? 1 : 2;
    const args = split ? ['tests/fixtures/benchmarks/sqlite-artifact-trial-worker.js', JSON.stringify({ trialOffset })]
      : ['tools/bench/sqlite/build-from-artifacts.js', '--chunks', '32768', '--profile', 'wide', '--trials', '2', '--mode', 'compare'];
    const result = runNode(args, selected, process.cwd(), process.env,
      { stdio: 'pipe', allowFailure: true, timeoutMs: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const matched = result.stdout.match(/artifact-build receipt (.+); descriptive paired timings/u);
    assert.ok(matched, result.stdout);
    evidence = JSON.parse(await fs.readFile(matched[1], 'utf8'));
    assert.equal(evidence.status, 'completed'); assert.equal(evidence.workload.chunks, 32768);
    assert.ok(evidence.inputBytes > 128 * 1024 * 1024);
    assert.equal(evidence.threshold.minimumInputBytes, 128 * 1024 * 1024);
    assert.equal(evidence.threshold.defaultOptimizationEligible, true);
    assert.equal(evidence.generatedWork.state, 'completed');
    assert.ok(evidence.generatedWork.bytesReclaimed > evidence.inputBytes);
    await assert.rejects(fs.stat(evidence.generatedWork.workRoot), { code: 'ENOENT' });
    assert.equal(evidence.workload.trialOffset, trialOffset);
    assert.equal(evidence.samples.length, trials * 2); assert.equal(evidence.paired.length, trials);
    assert.deepEqual(evidence.samples.map(row => row.label), split
      ? trialOffset ? ['current', 'baseline'] : ['baseline', 'current'] : ['baseline', 'current', 'current', 'baseline']);
    assert.deepEqual(evidence.paired.map(row => row.trial), Array.from({ length: trials }, (_, index) => trialOffset + index + 1));
    assert.equal(new Set(evidence.samples.map(row => row.observation.contentSha256)).size, 1);
    for (const sample of evidence.samples) {
      assert.equal(sample.observation.chunks, 32768); assert.equal(sample.observation.postings, 65536);
      assert.ok(sample.stats.prepare.total > 0);
      assert.ok(Number.isSafeInteger(sample.stats.batchSize) && sample.stats.batchSize > 0);
      assert.equal(sample.stats.inputBytes, evidence.inputBytes);
      assert.ok(sample.stats.transaction.begin > 0 && sample.stats.transaction.commit > 0);
      assert.equal(sample.stats.transaction.rollback, 0);
      assert.equal(Boolean(sample.stats.pragmas), sample.label === 'current', 'actual native pragma execution crosses the unchanged default threshold');
    }
  } else if (selected === 'render') {
    evidence = [];
    for (const size of [1000, 12000]) {
      const report = await runRenderSortBench({ size, iterations: 12, mode: 'compare' });
      assert.equal(report.parity.state, 'byte-identical'); assert.equal(report.workload.nodes, size);
      assert.equal(report.workload.inputOrder, 'canonical-identical-in-both-arms');
      assert.equal(report.preparation.includedInRenderTiming, false);
      for (const arm of ['baseline', 'current']) {
        assert.equal(report[arm].completedOperations, 12); assert.equal(report[arm].rawSampleDurationsMs.length, 12);
        assert.ok(report[arm].rawSampleDurationsMs.every(value => Number.isFinite(value) && value >= 0));
      }
      evidence.push(report);
    }
    assert.notEqual(evidence[0].parity.sha256, evidence[1].parity.sha256);
  } else if (selected.startsWith('graph-skewed')) {
    evidence = [];
    const shapes = selected === 'graph-skewed' ? [[512, 4096, 128], [12000, 128, 3000]] : [[512, 128, 128], [512, 128, 3000]];
    for (const [nodes, symbols, calls] of shapes) {
      const indexDir = path.join(dir, `graph-${nodes}-${symbols}-${calls}`), repoRoot = path.join(dir, 'repo');
      await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true }); await fs.mkdir(repoRoot, { recursive: true });
      const graph = { nodeCount: nodes, edgeCount: nodes - 1, nodes: Array.from({ length: nodes }, (_, i) => ({
        id: `chunk-${i}`, out: i + 1 < nodes ? [`chunk-${i + 1}`] : [], in: i ? [`chunk-${i - 1}`] : [] })) };
      const empty = { nodeCount: 0, edgeCount: 0, nodes: [] };
      const symbolEdges = Array.from({ length: symbols }, (_, i) => ({ from: { chunkUid: `chunk-${i}` }, type: 'reference',
        to: { v: 1, status: 'resolved', resolved: { symbolId: `symbol-${i}` }, candidates: [{ symbolId: `symbol-${i}` }] } }));
      const callSites = Array.from({ length: calls }, (_, i) => ({ callerChunkUid: `chunk-${i % nodes}`,
        targetChunkUid: `chunk-${(i + 1) % nodes}`, callSiteId: `call-${i}` }));
      const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [] };
      for (const [name, value] of [['graph_relations', { version: 1, callGraph: graph, usageGraph: empty, importGraph: empty }],
        ['symbol_edges', symbolEdges], ['call_sites', callSites]]) {
        const relative = `pieces/${name}.json`; await fs.writeFile(path.join(indexDir, relative), JSON.stringify(value));
        manifest.pieces.push({ name, path: relative, format: 'json' });
      }
      await fs.writeFile(path.join(indexDir, 'pieces/manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        buildId: `graph-shape-${nodes}-${symbols}`, mode: 'code', compatibilityKey: 'graph-shape' }));
      const report = await runGraphStoreBench({ indexDir, repoRoot, iterations: 6, mode: 'compare' });
      assert.equal(report.state, 'qualified-inputs'); assert.equal(report.order.length, 12);
      assert.equal(new Set([...report.baseline.samples, ...report.current.samples].map(row => row.pid)).size, 12);
      for (const arm of ['baseline', 'current']) for (const sample of report[arm].samples) {
        assert.equal(sample.witness.occurrences, symbols);
        assert.equal(sample.indexBuildsObserved, 1); assert.equal(sample.warmStats.cache.index.hits, 1);
        assert.deepEqual(sample.witness, report.baseline.samples[0].witness);
        assert.equal(sample.byteScope, 'observed-on-disk-used-artifact-source-bytes;not-physical-IO');
      }
      assert.ok(report.baseline.samples.every(row => row.omittedGraphNodes === nodes));
      assert.ok(report.baseline.samples.every(row => row.artifactBytes.call_sites === Buffer.byteLength(JSON.stringify(callSites))));
      evidence.push(report);
    }
    assert.ok(evidence[1].baseline.samples[0].artifactBytes.call_sites > evidence[0].baseline.samples[0].artifactBytes.call_sites);
    if (selected === 'graph-skewed') {
      assert.ok(evidence[1].baseline.samples[0].artifactBytes.graph_relations > evidence[0].baseline.samples[0].artifactBytes.graph_relations);
      assert.ok(evidence[0].current.samples[0].artifactBytes.symbol_edges > evidence[1].current.samples[0].artifactBytes.symbol_edges);
    } else {
      assert.equal(evidence[1].baseline.samples[0].artifactBytes.graph_relations, evidence[0].baseline.samples[0].artifactBytes.graph_relations);
      assert.equal(evidence[1].current.samples[0].artifactBytes.symbol_edges, evidence[0].current.samples[0].artifactBytes.symbol_edges);
    }
  } else if (selected === 'map-large') {
    const files = 2400, membersPerFile = 12;
    const nodes = Array.from({ length: files }, (_, i) => ({ id: `file-${i}`, path: `src/file-${i}.js`, name: `file-${i}.js`, type: 'file',
      members: Array.from({ length: membersPerFile }, (_, j) => ({ id: `member-${i}-${j}`, name: `function-${i}-${j}`, kind: 'function' })) }));
    const edges = Array.from({ length: files * 4 }, (_, i) => ({ type: 'call',
      from: { file: `src/file-${i % files}.js`, member: `member-${i % files}-${i % membersPerFile}` },
      to: { file: `src/file-${(i + 1) % files}.js`, member: `member-${(i + 1) % files}-${(i + 1) % membersPerFile}` } }));
    const model = { version: MAP_MODEL_VERSION, generatedAt: '2026-10-29T00:00:00Z', root: { path: dir, id: null },
      legend: {}, nodes, edges, summary: { counts: { files, members: files * membersPerFile, edges: edges.length }, truncated: false,
        inventory: { status: 'complete', files }, dropped: { files: 0, members: 0, edges: 0 } }, options: {}, warnings: [] };
    evidence = await runMapSerializationExperiment({ model, outputParent: dir, runs: 6, source: { kind: 'explicit-large-map-fixture' } });
    assert.equal(evidence.fixtureCleanup, 'completed'); assert.ok(evidence.inputIdentity.bytes > 1024 * 1024);
    assert.equal(evidence.workload.counts.members, 28800); assert.equal(evidence.workload.truncated, false);
    for (const arm of ['baseline', 'streaming']) {
      assert.equal(evidence[arm].completedOperations, 6);
      for (const sample of evidence[arm].samples) {
        assert.equal(sample.inputHash, evidence.inputIdentity.hash);
        assert.equal(sample.consumerParity, 'parsed-content-identical');
        assert.equal(sample.memory.processLifetimeRss.state, 'observed');
        assert.equal(sample.memory.boundaryPolicy, 'before-and-after-only;transients-unobserved');
      }
    }
  } else if (selected === 'memory-transient') {
    const result = await spawnSubprocess(process.execPath, ['--expose-gc', 'tests/fixtures/benchmarks/transient-memory.js'], {
      timeoutMs: 30000, maxOutputBytes: 65536, outputMode: 'string', captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true });
    assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
    evidence = JSON.parse(result.stdout);
    assert.equal(evidence.checksum, 2);
    assert.ok(evidence.during.rss > evidence.before.rss + 64 * 1024 * 1024);
    assert.ok(evidence.after.rss < evidence.during.rss - 32 * 1024 * 1024, 'control must actually release a transient allocation');
    assert.equal(evidence.observation.processLifetimeRss.state, 'observed');
    assert.ok(evidence.observation.processLifetimeRss.bytes + 1023 >= evidence.during.rss);
    assert.ok(evidence.observation.processLifetimeRss.bytes > evidence.observation.observedBoundaryMax.rss + 32 * 1024 * 1024);
  } else if (selected.startsWith('vfs-many-')) {
    const work = { docs: 256, docBytes: 8191, content: 'utf8' }, persisted = selected.startsWith('vfs-many-persisted-');
    const rootDir = path.join(dir, 'phase-fixture'); await fs.mkdir(rootDir);
    const observations = [];
    for (const mode of persisted ? ['cold', 'warm'] : ['hot']) {
      let child;
      try {
        child = await spawnSubprocess(process.execPath, ['tests/fixtures/benchmarks/vfs-phase-worker.js',
          JSON.stringify({ ...work, rootDir, mode })], {
          timeoutMs: 30000, maxOutputBytes: 256 * 1024, outputMode: 'string', captureStdout: true,
          captureStderr: true, rejectOnNonZeroExit: true, killTree: true });
      } catch (error) {
        try { observeStorageResource(error, { phase: 'representative-vfs-child-cleanup' }).requireSettled(); }
        catch (resourceError) {
          cleanupAllowed = false;
          throw addStorageFailureContext(error, { fixtureRoot: dir }, resourceError, { secondaryPresent: true });
        }
        throw error;
      }
      assert.equal(child.stderr, ''); assert.equal(child.outputCapture.stdout.truncated, false);
      const sample = JSON.parse(child.stdout);
      assert.equal(sample.mode, mode); assert.equal(sample.state, 'qualified-phase');
      assert.equal(sample.counts.documents, work.docs); assert.notEqual(sample.pid, process.pid);
      assert.equal(sample.workload.generator, 'fixed-byte-utf8-documents-v3');
      assert.equal(sample.workload.actualUtf8Bytes, work.docs * work.docBytes);
      assert.equal(sample.workload.uniqueContentHashes, work.docs);
      assert.equal(sample.consumerParity.state, 'byte-identical');
      assert.equal(sample.consumerParity.bytes, work.docs * work.docBytes);
      assert.equal(sample.consumerParity.includedInTiming, false);
      assert.ok(sample.documentPlanMs >= 0);
      for (const value of Object.values(sample.phases)) assert.ok(Number.isFinite(value) && value >= 0);
      assert.equal(sample.phases.totalMs, sample.phases.cacheLoadMs + sample.phases.documentAccessMs + sample.phases.flushMs);
      if (mode === 'cold') {
        assert.equal(sample.counts.created, work.docs); assert.equal(sample.initialCache.loadedEntries, 0);
        assert.equal(sample.counts.bytesWritten, work.docs * work.docBytes);
      } else if (mode === 'warm') {
        assert.equal(sample.counts.persistedHits, work.docs); assert.equal(sample.counts.created, 0);
        assert.equal(sample.initialCache.loadedEntries, work.docs); assert.ok(sample.initialCache.loadedInputBytes > 0);
      } else {
        assert.equal(sample.warmup.documents, work.docs); assert.equal(sample.warmup.created, work.docs);
        assert.equal(sample.warmup.bytesWritten, work.docs * work.docBytes);
        assert.equal(sample.counts.memoryHits, work.docs); assert.equal(sample.counts.created, 0);
        assert.equal(sample.initialCache, null); assert.equal(sample.finalCache, null);
        assert.equal(sample.phases.cacheLoadMs, 0); assert.equal(sample.phases.flushMs, 0);
        assert.ok(sample.phases.warmupMs > 0);
        assert.equal(sample.totalScope, 'verified-in-process-access-only;warmup-excluded');
      }
      if (mode !== 'hot') assert.equal(sample.finalCache.flushes - sample.initialCache.flushes, 1);
      observations.push({ ...sample, childWallMs: child.durationMs });
    }
    if (persisted) {
      assert.notEqual(observations[0].pid, observations[1].pid);
      assert.deepEqual(observations[0].workload, observations[1].workload);
      assert.equal(observations[0].consumerParity.sha256, observations[1].consumerParity.sha256);
    }
    evidence = { work, phaseBoundary: persisted ? 'fresh-cold-and-persisted-warm-children-share-one-owned-root'
      : 'fresh-owned-root-materialization-primes-hot-state-outside-hot-timing', observations,
    fullThreeModeScheduleQualified: false, endToEndLatencyClaim: false };
  } else if (selected === 'vfs-ascii') {
    evidence = [];
    const profile = { docs: 32, docBytes: 257, content: 'ascii' };
    const samples = 3;
    for (const work of [profile]) {
      const report = await runVfsColdStartBench({ ...work, samples });
      assert.equal(report.state, 'qualified-phases'); assert.equal(report.fixtureCleanup, 'completed');
      assert.deepEqual(report.order, [
        { sample: 1, mode: 'cold' }, { sample: 1, mode: 'warm' }, { sample: 1, mode: 'hot' },
        { sample: 2, mode: 'cold' }, { sample: 2, mode: 'hot' }, { sample: 2, mode: 'warm' },
        { sample: 3, mode: 'cold' }, { sample: 3, mode: 'warm' }, { sample: 3, mode: 'hot' }
      ]);
      for (const mode of ['cold', 'warm', 'hot']) {
        assert.equal(report[mode].completedDocuments, work.docs * samples);
        assert.equal(report[mode].samples.length, samples);
        for (const sample of report[mode].samples) assert.equal(sample.consumerParity.bytes, work.docs * work.docBytes);
      }
      evidence.push(report);
    }
  } else {
    const plan = await buildVfsColdStartPlan({ docs: 64, docBytes: 513, content: 'utf8' });
    assert.ok(plan.documents.every(row => Buffer.byteLength(row.text) === 513 && row.text.includes('😀')));
    evidence = [];
    for (const maxBytes of [0, 2052, 64 * 513]) {
      const rootDir = path.join(dir, `budget-${maxBytes}`); await fs.mkdir(rootDir);
      const run = async mode => {
        const child = await spawnSubprocess(process.execPath, ['tests/fixtures/benchmarks/vfs-budget-worker.js',
          JSON.stringify({ rootDir, mode, maxBytes, docs: 64, docBytes: 513 })], {
          timeoutMs: 30000, maxOutputBytes: 256 * 1024, outputMode: 'string', captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true });
        assert.equal(child.stderr, ''); assert.equal(child.outputCapture.stdout.truncated, false);
        return JSON.parse(child.stdout);
      };
      const cold = await run('cold'), warm = await run('warm');
      assert.notEqual(cold.pid, warm.pid); assert.notEqual(cold.pid, process.pid); assert.notEqual(warm.pid, process.pid);
      assert.equal(cold.counts.created, 64); assert.equal(cold.consumerParity.bytes, 64 * 513);
      assert.equal(warm.consumerParity.sha256, cold.consumerParity.sha256);
      if (maxBytes < 64 * 513) {
        assert.equal(warm.state, 'unqualified-phase');
        assert.ok(warm.counts.persistedHits < 64, 'miss/churn cannot be reported as a fully warm observation');
      } else { assert.equal(warm.state, 'qualified-phase'); assert.equal(warm.counts.persistedHits, 64); }
      evidence.push({ maxBytes, cold, warm });
    }
  }
  const receipt = { historicalAuthorWorkspace: true, source: captureSweepSource(process.cwd()), selected,
    ...(selected.startsWith('sqlite-wide-c') ? { partition: { series: 'wide32768-six-paired-trials',
      requiredCapsules: ['sqlite-wide-a', 'sqlite-wide-b', 'sqlite-wide-c1', 'sqlite-wide-c2'],
      changedBoundary: 'third two-trial process split into two fresh processes; original alternating arm order retained', latencyGainClaim: false } } : {}),
    ...(selected.startsWith('vfs-many-') ? { partition: { series: 'utf8-256-documents-8191-bytes', repetition: Number(selected.at(-1)),
      requiredRepetitions: 3, requiredPhases: ['persisted', 'hot'],
      changedBoundary: 'independent persisted-pair and fresh-root hot-access capsules; full alternating three-mode schedule remains unqualified', latencyGainClaim: false } } : {}),
    scope: 'synthetic-workload-specific-observations;not-application-wide-speedup', evidence };
  const bytes = JSON.stringify(receipt, null, 2), output = path.resolve('.testLogs', `bench35-${selected}-${Date.now()}.json`);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes, { flag: 'wx' });
  console.log(JSON.stringify({ receipt: output, sha256: createHash('sha256').update(bytes).digest('hex') }));
} finally {
  if (cleanupAllowed) await fs.rm(dir, { recursive: true, force: true });
  else console.error(`Retained unconfirmed VFS fixture: ${dir}`);
}
