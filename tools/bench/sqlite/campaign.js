import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { captureSweepSource } from '../ab-sweep-source.js';
import { resolveCompareMode } from '../shared.js';
import { createSqliteBenchWorkspace } from './shared.js';
import { performance } from 'node:perf_hooks';
import { resolveSqliteBenchmarkPlan, createSqliteBenchmarkWorkload } from './workload.js';
import { createSqliteBenchInputCache } from './validate.js';
import { runSqliteBenchmarkArm } from './campaign-arm.js';

const failureSummary = error => {
  const data = key => { try { return error && Object.getOwnPropertyDescriptor(error, key)?.value; } catch { return undefined; } };
  return { code: typeof data('code') === 'string' ? data('code') : null,
    message: typeof data('message') === 'string' ? data('message') : 'Benchmark threw an unclassified value.', thrownType: error === null ? 'null' : typeof error };
};

export const sqliteTrialArmOrder = (mode, trial) => mode === 'compare'
  ? trial % 2 ? ['current', 'baseline'] : ['baseline', 'current'] : [mode];
export const summarizeSqliteSamples = values => {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new TypeError('Invalid SQLite timing samples.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { count: values.length, min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)], max: sorted.at(-1), total: values.reduce((a, b) => a + b, 0) };
};

/** Serial independent databases, immutable input snapshots, alternated arm
 * order and mutation rounds. Validation/setup never enter operation timings. */
export const runSqliteBenchmarkCampaign = async ({ Database, args, operation }) => {
  const plan = resolveSqliteBenchmarkPlan(args, operation), mode = resolveCompareMode(args.mode);
  const sqliteMode = operation === 'update' ? 'code' : args['sqlite-mode'] === undefined ? 'code' : String(args['sqlite-mode']).toLowerCase();
  if (!['code', 'prose', 'extracted-prose', 'records'].includes(sqliteMode)) throw new TypeError('Unsupported SQLite benchmark mode.');
  const workspace = await createSqliteBenchWorkspace({ name: operation === 'build' ? 'sqlite-build-from-bundles' : 'sqlite-incremental-update', sqliteMode });
  const receiptPath = path.join(workspace.tempRoot, 'final.json'), checkpointPath = path.join(workspace.tempRoot, 'checkpoint.json');
  const report = { schemaVersion: 2, kind: `sqlite-${operation}`, status: 'running', startedAt: new Date().toISOString(),
    source: captureSweepSource(process.cwd()), runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch },
    plan, mode, sqliteMode, receiptPath, samples: [], setups: [], paired: [], summaries: [], armWork: [],
    cacheConditions: { fixture: 'one immutable workload reused serially; filesystem cache uncontrolled',
      build: 'new database per trial/arm; no OS-cache flush', update: 'independent identically prepared database per trial/arm; prior validation warms reads',
      repeatedUpdates: 'same owned database within one arm; rounds explicitly identified' },
    lanes: plan.lanes, qualification: 'candidate workload and descriptive timings; no hardware/latency qualification implied' };
  await atomicWriteJson(path.join(workspace.tempRoot, 'owner.json'), { schemaVersion: 1, kind: report.kind,
    source: report.source, runtime: report.runtime, plan, startedAt: report.startedAt, receiptPath }, { createOnly: true });
  let primary, failed = false;
  try {
    const setupStart = performance.now();
    const workload = await createSqliteBenchmarkWorkload({ bundleDir: workspace.bundleDir, plan, sqliteMode });
    report.fixtureMs = performance.now() - setupStart;
    report.workload = { initial: { rows: workload.initial.rows, manifestSha256: workload.initial.manifestSha256 },
      rounds: workload.rounds.map(({ manifest: _manifest, ...round }) => round) };
    await atomicWriteJson(checkpointPath, report);
    const inputCache = createSqliteBenchInputCache();
    for (let trial = 0; trial < plan.trials; trial++) {
      const order = sqliteTrialArmOrder(mode, trial);
      for (const label of order) {
        const arm = await workspace.createArmWorkspace();
        report.activeGeneratedWork = { workRoot: arm.workRoot, receiptRoot: arm.tempRoot, runIdentity: arm.workOwner.runIdentity };
        const outPath = path.join(arm.workRoot, `trial-${trial + 1}-${label}.db`);
        const priorSamples = report.samples.slice(), priorSetups = report.setups.slice();
        await runSqliteBenchmarkArm({ Database, operation, label, trial: trial + 1, order, sqliteMode,
          bundleDir: workspace.bundleDir, outPath, workload, inputCache,
          async onProgress({ samples, setups, activeAttempt }) {
            report.samples = [...priorSamples, ...samples]; report.setups = [...priorSetups, ...setups]; report.activeAttempt = activeAttempt;
            await atomicWriteJson(checkpointPath, report);
          } });
        await atomicWriteJson(path.join(arm.tempRoot, 'final.json'), { schemaVersion: 2, status: 'completed', source: report.source,
          trial: trial + 1, label, samples: report.samples.slice(priorSamples.length), setups: report.setups.slice(priorSetups.length) }, { createOnly: true });
        const reclaimed = await arm.workOwner.reclaim();
        report.armWork.push(reclaimed); report.activeGeneratedWork = null;
        await atomicWriteJson(path.join(arm.tempRoot, 'cleanup.json'), reclaimed, { createOnly: true });
        for (const sample of report.samples.slice(priorSamples.length)) {
          console.log(`[bench] ${operation === 'build' ? 'build-from-bundles' : 'incremental-update'} ${label} scope=${plan.scope} trial=${trial + 1} round=${sample.round} mode=${sqliteMode} files=${sample.observation.files} `
            + `${operation === 'update' ? `changedFiles=${sample.mutations.changedFiles} chunks=${sample.mutations.insertedChunks}` : `chunks=${sample.observation.chunks}`} ms=${sample.durationMs.toFixed(1)}`);
          console.log(`[bench] ${label} observed-work ${JSON.stringify(sample.observation)}`);
          if (sample.stats.tables) console.log(`[bench] ${label} tables ${JSON.stringify(sample.stats.tables)}`);
        }
      }
      if (mode === 'compare') for (const round of operation === 'build' ? [0] : workload.rounds.map(row => row.ordinal)) {
        const baseline = report.samples.find(row => row.trial === trial + 1 && row.label === 'baseline' && row.round === round);
        const current = report.samples.find(row => row.trial === trial + 1 && row.label === 'current' && row.round === round);
        assert.deepEqual(current.observation, baseline.observation, 'Only equivalent successful workloads may be compared');
        assert.equal(current.manifestSha256, baseline.manifestSha256);
        report.paired.push({ trial: trial + 1, round, deltaMs: current.durationMs - baseline.durationMs,
          deltaPct: baseline.durationMs > 0 ? (current.durationMs / baseline.durationMs - 1) * 100 : null });
      }
    }
    for (const label of mode === 'compare' ? ['baseline', 'current'] : [mode]) {
      for (const round of operation === 'build' ? [0] : workload.rounds.map(row => row.ordinal)) {
        report.summaries.push({ label, round, operationMs: summarizeSqliteSamples(report.samples.filter(row => row.label === label && row.round === round).map(row => row.durationMs)) });
      }
    }
    report.sourceAfter = captureSweepSource(process.cwd());
    assert.deepEqual(report.sourceAfter, report.source, 'Source identity changed during the serial benchmark');
    report.comparisonEligibility = { repeatedIndependentTrials: plan.repeated, cleanSource: report.source.state === 'clean-revision',
      scope: plan.scope, result: plan.scope === 'lexical-candidate' && plan.repeated && report.source.state === 'clean-revision' ? 'descriptive-lexical-comparison' : 'unqualified-smoke-or-custom-workload',
      limitations: ['OS cache uncontrolled', 'synthetic lexical data', 'no retrieval latency/dense/phrase/chargram claim', 'minimum sustained duration not automatically qualified'] };
    report.status = 'completed';
    if (mode === 'compare') console.log(`[bench] ${plan.scope === 'smoke' ? 'smoke delta' : 'paired descriptive deltas'} ${JSON.stringify(report.paired)}; sustained performance unqualified`);
  } catch (error) { failed = true; primary = error; report.status = 'failed'; report.failure = failureSummary(error); }
  report.generatedWork = { state: failed ? 'retained-after-failure' : 'awaiting-reclamation', workRoot: workspace.workRoot, runIdentity: workspace.workOwner.runIdentity };
  if (!failed) {
    try { await atomicWriteJson(checkpointPath, report); report.generatedWork = await workspace.workOwner.reclaim(); }
    catch (error) { failed = true; primary = error; report.status = 'failed'; report.failure = failureSummary(error);
      report.generatedWork.state = 'retained-after-reclamation-failure'; }
  }
  report.endedAt = new Date().toISOString();
  report.rawSamplesSha256 = createHash('sha256').update(JSON.stringify(report.samples)).digest('hex');
  try { await atomicWriteJson(receiptPath, report, { createOnly: true }); }
  catch (publication) { if (failed) throw addStorageFailureContext(primary, {}, publication, { secondaryPresent: true }); throw publication; }
  console.log(`[bench] receipt ${receiptPath}`);
  if (failed) throw primary;
  return report;
};
