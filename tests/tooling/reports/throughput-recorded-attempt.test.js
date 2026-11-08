import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { resolveRecordedMeasurementInputs, BENCH_MEASUREMENT_SNAPSHOT_VERSION } from '../../../tools/bench/language/metrics/recorded-evidence.js';
import { buildStageTimingProfileForTask } from '../../../tools/bench/language/metrics/stage-ledger.js';
import { resolveThroughputLedger, materializeThroughputLedger, materializeIndexingSummary } from '../../../tools/reports/show-throughput/analysis.js';
import { loadFeatureMetricsForPayload } from '../../../tools/reports/show-throughput/load.js';
import { getMetricsDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareTestCacheDir('throughput-recorded-attempt');
const repoPath = path.join(dir, 'repo'), cacheRoot = path.join(dir, 'cache'), outFile = path.join(dir, 'saved-a.json');
await fs.mkdir(repoPath); await fs.writeFile(path.join(repoPath, '.pairofcleats.json'), JSON.stringify({ cache: { root: cacheRoot } }));
const metricsDir = getMetricsDir(repoPath, loadUserConfig(repoPath)); await fs.mkdir(metricsDir, { recursive: true });
const liveMetrics = path.join(metricsDir, 'index-code.json'), liveFeatures = path.join(metricsDir, 'feature-metrics-run.json');
await fs.writeFile(liveMetrics, JSON.stringify({ chunks: { total: 900 }, timings: { totalMs: 10000, discoverMs: 9876 } }));
await fs.writeFile(liveFeatures, JSON.stringify({ modes: { code: { totals: { count: 90, lines: 9000, durationMs: 10000 } } } }));
const saved = { generatedAt: '2026-10-25T12:00:00.000Z', repo: { root: repoPath },
  run: { attemptId: 'attempt-a' }, summary: { buildMs: { index: 1000, sqlite: 9 }, backends: ['memory'] },
  artifacts: { repo: { root: repoPath, cacheRoot }, throughput: { code: { files: 2, chunks: 100, tokens: 1000, bytes: 10000, totalMs: 1000 } } } };
const rate = ledger => ledger?.modalities?.code?.stages?.total?.chunksPerSec;
const render = async (payload, entrySummary = payload.summary) => {
  await fs.writeFile(outFile, JSON.stringify(payload));
  return buildReportOutput({ configPath: path.join(dir, 'repos.json'), cacheRoot, resultsRoot: dir,
    config: { javascript: { label: 'JavaScript' } }, results: [{ language: 'javascript', tier: 'tiny', repo: 'owner/repo', repoPath,
      outFile, summary: entrySummary }] });
};
let liveReads = 0;
const read = fsSync.readFileSync;
fsSync.readFileSync = function (target, ...args) {
  if (typeof target === 'string' && [liveMetrics, liveFeatures].includes(path.resolve(target))) liveReads++;
  return read.call(this, target, ...args);
};
try {
  const first = await render(saved), direct = resolveThroughputLedger({ payload: saved });
  assert.equal(rate(first.tasks[0].throughputLedger), 100);
  assert.equal(rate(direct.throughputLedger), 100);
  assert.equal(direct.provenance.category, 'fallback');
  assert.equal(first.tasks[0].stageTimingProfile.stages.sqliteBuild, 9);
  assert.ok(first.tasks[0].stageTimingProfile.derivation.unavailableStages.includes('discovery'));
  assert.equal(loadFeatureMetricsForPayload(saved), null, 'live features cannot fill historical facts');
  await fs.writeFile(liveMetrics, JSON.stringify({ chunks: { total: 9000 }, timings: { totalMs: 999999, discoverMs: 88888 } }));
  await fs.unlink(liveFeatures); await fs.writeFile(path.join(repoPath, '.pairofcleats.json'), '{bad current config');
  const second = await render(saved);
  assert.deepEqual(second.tasks[0].throughputLedger, first.tasks[0].throughputLedger);
  assert.deepEqual(second.tasks[0].stageTimingProfile, first.tasks[0].stageTimingProfile);
  assert.equal(liveReads, 0);
  assert.equal((await render(saved, { buildMs: { index: 99999, sqlite: 9999 } })).tasks[0].summary.buildMs.sqlite, 9,
    'saved summary remains paired with its recorded artifacts');

  const absent = structuredClone(saved); absent.artifacts.throughput.code.totalMs = null;
  assert.equal(rate(resolveThroughputLedger({ payload: absent }).throughputLedger), null, 'unknown elapsed time is not zero or current elapsed time');
  assert.equal(buildStageTimingProfileForTask({ repoPath, summary: {} }), null);

  const snapshot = { schemaVersion: BENCH_MEASUREMENT_SNAPSHOT_VERSION, attemptId: 'attempt-a', metricsByMode: { code: {
    files: { candidates: 2 }, chunks: { total: 200 }, tokens: { total: 400 },
    timings: { totalMs: 4000, discoverMs: 40, writeMs: 200 } } },
  featureMetrics: { modes: { code: { totals: { count: 2, lines: 80, bytes: 800, durationMs: 4000 } } } } };
  const embedded = structuredClone(saved);
  embedded.artifacts.scanProfile = { schemaVersion: 1, modes: snapshot.metricsByMode };
  assert.equal(rate((await render(embedded)).tasks[0].throughputLedger), 50,
    'embedded mode measurements retain their own complete counter/clock pair');
  const snapshotPath = path.join(dir, 'measurements.json');
  const writeSnapshot = async value => {
    const bytes = Buffer.from(JSON.stringify(value)); await fs.writeFile(snapshotPath, bytes);
    return { schemaVersion: BENCH_MEASUREMENT_SNAPSHOT_VERSION, attemptId: 'attempt-a', path: 'measurements.json', bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  };
  absent.artifacts.measurementSnapshot = await writeSnapshot(snapshot);
  const evidence = resolveRecordedMeasurementInputs({ payload: absent, sourceRoot: dir });
  assert.equal(evidence.receipt.external.state, 'qualified-attempt-snapshot');
  assert.equal(loadFeatureMetricsForPayload(absent, { sourceRoot: dir }).modes.code.totals.lines, 80);
  const qualified = await render(absent);
  assert.equal(rate(qualified.tasks[0].throughputLedger), 50, 'both 200 chunks and 4000ms come from A, not saved 100 chunks over a different clock');
  assert.equal(qualified.tasks[0].stageTimingProfile.stages.discovery, 40);
  assert.equal(qualified.tasks[0].throughputLedger.derivation.measurementReceipt.external.attemptId, 'attempt-a');
  for (const invalid of [{ path: '../outside.json' }, { path: snapshotPath }, { bytes: 8 * 1024 * 1024 + 1 }, { sha256: 'unknown' }]) {
    const unsafe = structuredClone(absent); Object.assign(unsafe.artifacts.measurementSnapshot, invalid);
    assert.equal(resolveRecordedMeasurementInputs({ payload: unsafe, sourceRoot: dir }).receipt.external.state, 'unavailable');
  }

  const differentAttempt = structuredClone(absent); differentAttempt.run.attemptId = 'attempt-b';
  const mismatched = resolveRecordedMeasurementInputs({ payload: differentAttempt, sourceRoot: dir });
  assert.equal(mismatched.receipt.external.state, 'unavailable');
  assert.equal(rate(resolveThroughputLedger({ payload: differentAttempt, measurementEvidence: mismatched }).throughputLedger), null);
  const differentBody = structuredClone(snapshot); differentBody.attemptId = 'attempt-b';
  absent.artifacts.measurementSnapshot = await writeSnapshot(differentBody);
  assert.equal(resolveRecordedMeasurementInputs({ payload: absent, sourceRoot: dir }).receipt.external.state, 'unavailable');
  absent.artifacts.measurementSnapshot = await writeSnapshot(snapshot);
  await fs.writeFile(snapshotPath, 'changed');
  assert.equal(resolveRecordedMeasurementInputs({ payload: absent, sourceRoot: dir }).receipt.external.state, 'unavailable');
  await fs.unlink(snapshotPath);
  assert.equal(resolveRecordedMeasurementInputs({ payload: absent, sourceRoot: dir }).receipt.external.state, 'unavailable');
  assert.equal(rate((await render(absent)).tasks[0].throughputLedger), null);

  const materialized = structuredClone(saved);
  const indexing = materializeIndexingSummary({ payload: materialized });
  assert.equal(indexing.changed, true);
  const firstMaterialization = materializeThroughputLedger({ payload: materialized, indexingSummary: indexing.indexingSummary });
  const persisted = JSON.parse(JSON.stringify(materialized));
  const restored = resolveThroughputLedger({ payload: persisted });
  assert.equal(restored.provenance.source, 'fallback-throughput-derived');
  assert.deepEqual(restored.throughputLedger.derivation, firstMaterialization.throughputLedger.derivation);
  assert.equal(materializeIndexingSummary({ payload: persisted }).changed, false);
  assert.equal(materializeThroughputLedger({ payload: persisted }).changed, false);

  // Prior unqualified materialization is recomputed from original saved facts,
  // never promoted to native merely because it occupies the ledger slot.
  const legacy = structuredClone(saved);
  legacy.artifacts.throughputLedger = structuredClone(direct.throughputLedger);
  delete legacy.artifacts.throughputLedger.derivation;
  legacy.artifacts.throughputLedger.modalities.code.stages.total.chunksPerSec = 10;
  legacy.artifacts.materialization = { schemaVersion: 1, sections: { throughputLedger: {
    source: 'fallback-throughput-derived', category: 'fallback' } } };
  assert.equal(rate(resolveThroughputLedger({ payload: legacy }).throughputLedger), 100);
  assert.equal(rate((await render(legacy)).tasks[0].throughputLedger), 100);
  const native = structuredClone(saved); native.artifacts.throughputLedger = structuredClone(direct.throughputLedger);
  delete native.artifacts.throughputLedger.derivation;
  native.artifacts.throughputLedger.modalities.code.stages.total.chunksPerSec = 123;
  assert.equal(resolveThroughputLedger({ payload: native }).throughputLedger, native.artifacts.throughputLedger);
  assert.equal(materializeThroughputLedger({ payload: native }).changed, false);
  assert.equal(rate((await render(native)).tasks[0].throughputLedger), 123);
  assert.equal(liveReads, 0, 'actual historical report and materializer callers do not inspect mutable metric files');
} finally { fsSync.readFileSync = read; }
console.log('Historical throughput and timing stay bound to recorded observations and qualified attempt snapshots.');
