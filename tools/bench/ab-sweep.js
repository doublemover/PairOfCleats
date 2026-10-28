#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { resolveBenchRunnerWorkload, attachBenchmarkExperiment, benchmarkFingerprint, BENCH_EXPERIMENT_VERSION, BENCH_REPORT_MAX_BYTES } from './runner-workload.js';
import { AB_SWEEP_REPORT_VERSION, qualifySweepRuns } from './ab-sweep-admission.js';
import { createSweepArtifacts, readSweepVariantReport, AB_SWEEP_MAX_ARTIFACT_BYTES } from './ab-sweep-artifacts.js';
import { captureSweepSource } from './ab-sweep-source.js';

const ROOT = process.cwd();
const BENCH_RUNNER = fileURLToPath(new URL('./bench-runner.js', import.meta.url));
export const AB_SWEEP_MAX_VARIANTS = 256;
export { AB_SWEEP_MAX_ARTIFACT_BYTES };

const parseArgs = () => {
  const out = {
    suite: null,
    scripts: null,
    json: null,
    timeoutMs: 0,
    repoRoot: null,
    indexDir: null,
    help: false,
    knobs: {
      writeConcurrency: [],
      cpuTokens: [],
      ioTokens: [],
      memTokens: [],
      bundleThreads: [],
      bundleSize: [],
      workerCounts: []
    }
  };
  const argv = process.argv.slice(2);
  const parseNumberList = (value) => String(value || '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--suite') {
      out.suite = next || null;
      i += 1;
      continue;
    }
    if (arg === '--scripts') {
      out.scripts = next || null;
      i += 1;
      continue;
    }
    if (arg === '--json') {
      out.json = next || null;
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      out.timeoutMs = Math.max(0, Math.floor(Number(next || 0)));
      i += 1;
      continue;
    }
    if (arg === '--repo-root') {
      out.repoRoot = next || null;
      i += 1;
      continue;
    }
    if (arg === '--index-dir') {
      out.indexDir = next || null;
      i += 1;
      continue;
    }
    if (arg === '--write-concurrency') {
      out.knobs.writeConcurrency = parseNumberList(next);
      i += 1;
      continue;
    }
    if (arg === '--cpu-tokens') {
      out.knobs.cpuTokens = parseNumberList(next);
      i += 1;
      continue;
    }
    if (arg === '--io-tokens') {
      out.knobs.ioTokens = parseNumberList(next);
      i += 1;
      continue;
    }
    if (arg === '--mem-tokens') {
      out.knobs.memTokens = parseNumberList(next);
      i += 1;
      continue;
    }
    if (arg === '--bundle-threads') {
      out.knobs.bundleThreads = parseNumberList(next);
      i += 1;
      continue;
    }
    if (arg === '--bundle-size') {
      out.knobs.bundleSize = parseNumberList(next);
      i += 1;
      continue;
    }
    if (arg === '--worker-counts') {
      out.knobs.workerCounts = parseNumberList(next);
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
  }
  return out;
};

/**
 * Build a cartesian product of knob values. Empty knobs are treated as [null]
 * so partial sweeps only touch explicitly requested dimensions.
 */
export const buildSweepMatrix = (knobs) => {
  const keys = Object.keys(knobs || {});
  const vectors = keys.map((key) => {
    const values = Array.isArray(knobs[key]) && knobs[key].length ? [...new Set(knobs[key])] : [null];
    return { key, values };
  });
  const count = vectors.reduce((total, vector) => total * vector.values.length, 1);
  if (count > AB_SWEEP_MAX_VARIANTS) throw Object.assign(new Error('A/B sweep exceeds the fixed 256-variant bound.'), { code: 'ERR_AB_SWEEP_MATRIX_LIMIT' });
  let combos = [{}];
  for (const vector of vectors) {
    const next = [];
    for (const base of combos) {
      for (const value of vector.values) {
        next.push({ ...base, [vector.key]: value });
      }
    }
    combos = next;
  }
  return combos;
};

const buildTestConfig = (config) => {
  const root = {};
  if (Number.isFinite(config?.writeConcurrency)) {
    root.indexing = root.indexing || {};
    root.indexing.artifacts = root.indexing.artifacts || {};
    root.indexing.artifacts.writeConcurrency = Math.max(1, Math.floor(config.writeConcurrency));
  }
  if (Number.isFinite(config?.bundleSize)) {
    root.indexing = root.indexing || {};
    root.indexing.typeInferenceCrossFile = root.indexing.typeInferenceCrossFile || {};
    root.indexing.typeInferenceCrossFile.bundleSize = Math.max(1, Math.floor(config.bundleSize));
  }
  return root;
};

const hasKeys = (value) => value && typeof value === 'object' && Object.keys(value).length > 0;

const runVariant = async ({ argv, variant, runIndex, artifacts, workload, maxReportBytes, signal, root, afterChild }) => {
  const runId = `run-${String(runIndex + 1).padStart(3, '0')}`;
  const outPath = artifacts.registerReport(`${runId}.json`);
  const variantId = `variant-${String(runIndex + 1).padStart(6, '0')}`;
  const experiment = { version: BENCH_EXPERIMENT_VERSION, experimentId: artifacts.experimentId, variantId,
    workloadFingerprint: workload.fingerprint, maxReportBytes,
    requestFingerprint: benchmarkFingerprint({ experimentId: artifacts.experimentId, variantId, variant, workloadFingerprint: workload.fingerprint }) };
  const args = [BENCH_RUNNER];
  if (argv.suite) args.push('--suite', argv.suite);
  if (argv.scripts) args.push('--scripts', argv.scripts);
  if (argv.repoRoot) args.push('--repo-root', path.resolve(argv.repoRoot));
  if (argv.indexDir) args.push('--index-dir', path.resolve(argv.indexDir));
  if (argv.timeoutMs > 0) args.push('--timeout-ms', String(argv.timeoutMs));
  args.push('--json', outPath, '--quiet');
  const env = {
    ...process.env
  };
  if (Number.isFinite(variant.cpuTokens)) env.PAIROFCLEATS_SCHEDULER_CPU = String(Math.floor(variant.cpuTokens));
  if (Number.isFinite(variant.ioTokens)) env.PAIROFCLEATS_SCHEDULER_IO = String(Math.floor(variant.ioTokens));
  if (Number.isFinite(variant.memTokens)) env.PAIROFCLEATS_SCHEDULER_MEM = String(Math.floor(variant.memTokens));
  if (Number.isFinite(variant.bundleThreads)) env.PAIROFCLEATS_BUNDLE_THREADS = String(Math.floor(variant.bundleThreads));
  if (Number.isFinite(variant.workerCounts)) {
    env.PAIROFCLEATS_WORKER_POOL_MAX_WORKERS = String(Math.floor(variant.workerCounts));
  }
  const testConfig = buildTestConfig(variant);
  if (hasKeys(testConfig)) {
    env.PAIROFCLEATS_TESTING = '1';
    env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify(testConfig);
  }
  const startedAt = Date.now();
  let result, processFailure = null;
  try {
    result = await artifacts.trackExternal(() => spawnSubprocess(process.execPath, args, {
      cwd: root, env: attachBenchmarkExperiment(env, experiment), signal,
      maxOutputBytes: 32 * 1024, captureStdout: true, captureStderr: true,
      outputMode: 'string', rejectOnNonZeroExit: false, killTree: true,
      detached: process.platform !== 'win32'
    }), { reportFailure: false });
  } catch (error) {
    observeStorageResource(error, { phase: 'ab-sweep-child-settlement' }).requireSettled();
    processFailure = typeof error?.code === 'string' ? error.code : 'SUBPROCESS_EXECUTION_FAILED';
    result = error?.result || { exitCode: null, signal: null, stderr: String(error?.message || error) };
  }
  // Private barrier permits deterministic independent interleaving fixtures.
  // Normal execution has no alternate report source or stdout fallback.
  await afterChild?.({ outPath, experiment });
  const read = readSweepVariantReport(artifacts.runDir, outPath, maxReportBytes);
  if (read.reportReceipt) artifacts.expectReport(`${runId}.json`, {
    sha256: read.reportReceipt.sha256.slice(7), bytes: read.reportReceipt.bytes
  });
  return { runId, variant, experiment, durationMs: Date.now() - startedAt,
    status: Number.isInteger(result.exitCode) ? result.exitCode : null,
    signal: typeof result.signal === 'string' ? result.signal : null, processFailure,
    childDiagnostics: { stdoutTail: (result.stdout || '').slice(-512), stderrTail: (result.stderr || '').slice(-2048), outputCapture: result.outputCapture || null },
    reportPath: outPath, ...read };
};

export const runAbSweep = async ({ argv, root = ROOT, signal, afterChild } = {}) => {
  const matrix = buildSweepMatrix(argv.knobs);
  const workload = resolveBenchRunnerWorkload({ argv, root }).receipt;
  if (!workload.entries.length) throw new Error('ab-sweep: no scripts selected.');
  const sourceBefore = captureSweepSource(root);
  const artifacts = await createSweepArtifacts(root, { workloadFingerprint: workload.fingerprint,
    matrixFingerprint: benchmarkFingerprint(matrix) }, { signal: signal?.aborted ? null : signal });
  let result, primary, failed = false;
  try {
    const runs = [];
    let retainedBytes = 0, stopped = null;
    for (const [index, variant] of matrix.entries()) {
      const remainingBytes = AB_SWEEP_MAX_ARTIFACT_BYTES - retainedBytes;
      if (signal?.aborted) stopped ||= 'cancelled';
      if (remainingBytes < 64 * 1024) stopped ||= 'artifact-budget-exhausted';
      if (stopped) {
        runs.push({ runId: `run-${String(index + 1).padStart(3, '0')}`, variant, status: null,
          experiment: { experimentId: artifacts.experimentId, variantId: `variant-${String(index + 1).padStart(6, '0')}` },
          notRunReason: stopped, reportError: 'not-run', report: null, reportPath: null, reportReceipt: null });
        continue;
      }
      const run = await runVariant({ argv, variant, runIndex: index, artifacts, workload,
        maxReportBytes: Math.min(BENCH_REPORT_MAX_BYTES, remainingBytes), signal, root, afterChild });
      retainedBytes += run.reportReceipt?.bytes || 0;
      runs.push(run);
      if (run.signal || signal?.aborted) stopped = 'cancelled';
      if (run.reportError === 'unreadable-or-oversized-report') stopped = 'report-storage-failure';
    }
    const sourceAfter = captureSweepSource(root);
    const qualification = qualifySweepRuns({ runs, workload, sourceBefore, sourceAfter });
    const output = {
      schemaVersion: AB_SWEEP_REPORT_VERSION, generatedAt: new Date().toISOString(),
      experimentId: artifacts.experimentId, finalReceiptPath: artifacts.finalPath,
      source: { before: sourceBefore, after: sourceAfter, scope: 'git-boundaries-and-entry-bytes' },
      workload, objective: qualification.objective, exclusions: qualification.exclusions,
      coverage: qualification.coverage, outcome: signal?.aborted ? 'cancelled' : qualification.outcome,
      matrix: { runCount: runs.length, knobs: argv.knobs },
      artifactBudget: { maxBytes: AB_SWEEP_MAX_ARTIFACT_BYTES, retainedBytes, maxReportBytes: BENCH_REPORT_MAX_BYTES },
      tuple: { repoRoot: argv.repoRoot ? path.resolve(root, argv.repoRoot) : root, platform: os.platform(), arch: os.arch(),
        cpuModel: os.cpus()[0]?.model || null, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
      runs: qualification.runs.map(({ report, variant, ...run }) => ({ ...run, config: variant,
        summary: report?.summary || null, results: report?.results || null })),
      recommendation: signal?.aborted ? null : qualification.recommendation
    };
    await artifacts.finish(output);
    if (argv.json) await atomicWriteText(path.resolve(root, argv.json), JSON.stringify(output, null, 2) + '\n');
    result = { report: output, exitCode: output.recommendation ? 0 : 1 };
  } catch (error) { primary = error; failed = true; }
  try { await artifacts.close(failed ? primary : result, { failed }); }
  catch (error) { primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error; failed = true; }
  if (failed) throw primary;
  return result;
};

const main = async () => {
  const argv = parseArgs();
  if (argv.help) {
    console.log([
      'ab-sweep',
      '',
      'Usage:',
      '  node tools/bench/ab-sweep.js --suite <id>|--scripts <paths> [knob flags] [--json <out.json>]',
      '',
      'Knobs:',
      '  --write-concurrency 4,8,12',
      '  --cpu-tokens 8,12,16 --io-tokens 8,12,16 --mem-tokens 8,12',
      '  --bundle-threads 2,4 --bundle-size 64,96 --worker-counts 4,8,12'
    ].join('\n'));
    return;
  }
  if (!argv.suite && !argv.scripts) {
    console.error('ab-sweep: pass --suite or --scripts.');
    process.exit(2);
  }
  const abort = new AbortController();
  const cancel = () => abort.abort(new Error('A/B sweep cancelled.'));
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const { report, exitCode } = await runAbSweep({ argv, signal: abort.signal });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = exitCode;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
};

if (isDirectExecution(import.meta.url)) main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
