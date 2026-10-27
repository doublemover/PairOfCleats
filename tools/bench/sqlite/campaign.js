import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { resolveSqliteIngestPlan } from '../../../src/storage/sqlite/utils.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { captureSweepSource } from '../ab-sweep-source.js';
import { resolveCompareMode } from '../shared.js';
import { createSqliteBenchWorkspace, requireSqliteDb } from './shared.js';
import { resolveSqliteBenchmarkPlan, createSqliteBenchmarkWorkload } from './workload.js';
import { validateSqliteBenchDatabase } from './validate.js';

export const sqliteTrialArmOrder = (mode, trial) => mode === 'compare'
  ? trial % 2 ? ['current', 'baseline'] : ['baseline', 'current'] : [mode];
export const summarizeSqliteSamples = values => {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new TypeError('Invalid SQLite timing samples.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { count: values.length, min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)], max: sorted.at(-1), total: values.reduce((a, b) => a + b, 0) };
};

const probeRuntime = (Database, dbPath) => {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let primary, result;
  try {
    const pageSize = Number(db.pragma('page_size', { simple: true }));
    const journalMode = db.pragma('journal_mode', { simple: true });
    assert.ok(Number.isSafeInteger(pageSize) && pageSize >= 512);
    assert.equal(typeof journalMode, 'string');
    result = { pageSize, journalMode: journalMode.toLowerCase() };
  } catch (error) { primary = error; }
  try { db.close(); } catch (cleanup) {
    if (primary) throw addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true });
    throw cleanup;
  }
  if (primary) throw primary;
  return result;
};
const fileBytes = async file => {
  try { return (await fs.stat(file)).size; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
};
const common = { envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 }, emitOutput: false,
  validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null } };

/** Serial independent databases, immutable input snapshots, alternated arm
 * order and mutation rounds. Validation/setup never enter operation timings. */
export const runSqliteBenchmarkCampaign = async ({ Database, args, operation }) => {
  const plan = resolveSqliteBenchmarkPlan(args, operation), mode = resolveCompareMode(args.mode);
  const sqliteMode = operation === 'update' ? 'code' : args['sqlite-mode'] === undefined ? 'code' : String(args['sqlite-mode']).toLowerCase();
  if (!['code', 'prose', 'extracted-prose', 'records'].includes(sqliteMode)) throw new TypeError('Unsupported SQLite benchmark mode.');
  const workspace = await createSqliteBenchWorkspace({ name: operation === 'build' ? 'sqlite-build-from-bundles' : 'sqlite-incremental-update', sqliteMode });
  const receiptPath = path.join(workspace.tempRoot, 'final.json'), checkpointPath = path.join(workspace.tempRoot, 'checkpoint.json');
  const report = { schemaVersion: 1, kind: `sqlite-${operation}`, status: 'running', startedAt: new Date().toISOString(),
    source: captureSweepSource(process.cwd()), runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch },
    plan, mode, sqliteMode, receiptPath, samples: [], setups: [], paired: [], summaries: [],
    cacheConditions: { fixture: 'one immutable workload reused serially; filesystem cache uncontrolled',
      build: 'new database per trial/arm; no OS-cache flush', update: 'independent identically prepared database per trial/arm; prior validation warms reads',
      repeatedUpdates: 'same owned database within one arm; rounds explicitly identified' },
    lanes: plan.lanes, qualification: 'candidate workload and descriptive timings; no hardware/latency qualification implied' };
  await atomicWriteJson(path.join(workspace.tempRoot, 'owner.json'), { schemaVersion: 1, kind: report.kind,
    source: report.source, runtime: report.runtime, plan, startedAt: report.startedAt, receiptPath }, { createOnly: true });
  let primary;
  try {
    const setupStart = performance.now();
    const workload = await createSqliteBenchmarkWorkload({ bundleDir: workspace.bundleDir, plan, sqliteMode });
    report.fixtureMs = performance.now() - setupStart;
    report.workload = { initial: { rows: workload.initial.rows, manifestSha256: workload.initial.manifestSha256 },
      rounds: workload.rounds.map(({ manifest: _manifest, ...round }) => round) };
    await atomicWriteJson(checkpointPath, report);
    for (let trial = 0; trial < plan.trials; trial++) {
      const order = sqliteTrialArmOrder(mode, trial);
      for (const label of order) {
        const outPath = path.join(workspace.tempRoot, `trial-${trial + 1}-${label}.db`);
        const baseOptions = { Database, outPath, mode: sqliteMode, ...common,
          incrementalData: { manifest: workload.initial.manifest, bundleDir: workspace.bundleDir } };
        if (operation === 'update') {
          report.activeAttempt = { trial: trial + 1, label, phase: 'initial-build', dbPath: outPath,
            manifestSha256: workload.initial.manifestSha256, expectedRows: workload.initial.rows };
          await atomicWriteJson(checkpointPath, report);
          const setupBegan = performance.now();
          const built = await buildDatabaseFromBundles({ ...baseOptions, buildPragmas: true, optimize: true });
          assert.equal(built.count, workload.initial.rows);
          const buildMs = performance.now() - setupBegan;
          report.activeAttempt.phase = 'initial-validation';
          report.activeAttempt.buildMs = buildMs;
          await atomicWriteJson(checkpointPath, report);
          const validateStart = performance.now();
          const initial = await validateSqliteBenchDatabase({ Database, dbPath: outPath, bundleDir: workspace.bundleDir,
            manifest: workload.initial.manifest, mode: sqliteMode, expectedRows: workload.initial.rows });
          report.setups.push({ trial: trial + 1, label, buildMs, validationMs: performance.now() - validateStart, observation: initial });
          report.activeAttempt = null;
        }
        const steps = operation === 'build' ? [workload.initial] : workload.rounds;
        for (const [index, step] of steps.entries()) {
          const stats = {}, round = operation === 'build' ? 0 : index + 1;
          let adaptive = null, value;
          if (operation === 'update') {
            requireSqliteDb(outPath);
            const runtime = probeRuntime(Database, outPath), dbBytes = (await fs.stat(outPath)).size, walBytes = await fileBytes(`${outPath}-wal`);
            const config = { ...runtime, walEnabled: runtime.journalMode === 'wal', walBytes,
              rowCount: step.insertedChunks, fileCount: step.changedFiles, inputBytes: dbBytes, repoBytes: dbBytes };
            adaptive = { config, plan: resolveSqliteIngestPlan({ batchSize: config }) };
          }
          report.activeAttempt = { trial: trial + 1, label, round, phase: operation, dbPath: outPath,
            manifestSha256: step.manifestSha256, expectedRows: step.rows, stats,
            expectedMutations: operation === 'update' ? { changedFiles: step.changedFiles, deletedFiles: step.deletedFiles, insertedChunks: step.insertedChunks } : null };
          await atomicWriteJson(checkpointPath, report);
          const began = performance.now();
          if (operation === 'build') {
            value = await buildDatabaseFromBundles({ ...baseOptions, buildPragmas: label === 'current', optimize: label === 'current', stats });
          } else {
            value = await incrementalUpdateDatabase({ ...baseOptions,
              incrementalData: { manifest: step.manifest, bundleDir: workspace.bundleDir },
              inputBytes: adaptive.plan.repoBytes, batchSize: adaptive.config, buildPragmas: label === 'current', stats });
          }
          const durationMs = performance.now() - began;
          report.activeAttempt.operationMs = durationMs;
          report.activeAttempt.phase = 'validation';
          if (operation === 'build') assert.equal(value.count, step.rows, 'Build must insert the complete requested fixture');
          else {
            assert.equal(value.used, true, `Incremental update skipped: ${value.reason || 'unknown reason'}`);
            assert.equal(value.changedFiles, step.changedFiles); assert.equal(value.deletedFiles, step.deletedFiles);
            assert.equal(value.insertedChunks, step.insertedChunks);
          }
          requireSqliteDb(outPath);
          await atomicWriteJson(checkpointPath, report);
          const validationStart = performance.now();
          const observation = await validateSqliteBenchDatabase({ Database, dbPath: outPath, bundleDir: workspace.bundleDir,
            manifest: step.manifest, mode: sqliteMode, expectedRows: step.rows });
          assert.equal(stats.tables?.chunks?.rows, operation === 'build' ? step.rows : step.insertedChunks,
            'Realized chunk writes must equal the requested operation, independently of printed ingest plans');
          const sample = { trial: trial + 1, order, label, round, dbPath: outPath, durationMs, validationMs: performance.now() - validationStart,
            manifestSha256: step.manifestSha256, observation, stats, ...(adaptive ? { adaptive } : {}),
            mutations: operation === 'update' ? { changedFiles: value.changedFiles, deletedFiles: value.deletedFiles, insertedChunks: value.insertedChunks } : null };
          report.samples.push(sample);
          report.activeAttempt = null;
          console.log(`[bench] ${operation === 'build' ? 'build-from-bundles' : 'incremental-update'} ${label} scope=${plan.scope} trial=${trial + 1} round=${round} mode=${sqliteMode} files=${observation.files} `
            + `${operation === 'update' ? `changedFiles=${value.changedFiles} chunks=${value.insertedChunks}` : `chunks=${value.count}`} ms=${durationMs.toFixed(1)}`);
          console.log(`[bench] ${label} observed-work ${JSON.stringify(observation)}`);
          if (stats.tables) console.log(`[bench] ${label} tables ${JSON.stringify(stats.tables)}`);
          await atomicWriteJson(checkpointPath, report);
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
  } catch (error) { primary = error; report.status = 'failed'; report.failure = { message: error.message, code: error.code || null }; }
  report.endedAt = new Date().toISOString();
  report.rawSamplesSha256 = createHash('sha256').update(JSON.stringify(report.samples)).digest('hex');
  try { await atomicWriteJson(receiptPath, report, { createOnly: true }); }
  catch (publication) { if (primary) throw addStorageFailureContext(primary, {}, publication, { secondaryPresent: true }); throw publication; }
  console.log(`[bench] receipt ${receiptPath}`);
  if (primary) throw primary;
  return report;
};
