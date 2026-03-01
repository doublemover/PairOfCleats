#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exitLikeCommandResult } from '../shared/cli-utils.js';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';

const ROOT = process.cwd();
const BENCH_RUNNER = path.join(ROOT, 'tools', 'bench', 'bench-runner.js');

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

const parseJson = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  const match = raw.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

/**
 * Build a cartesian product of knob values. Empty knobs are treated as [null]
 * so partial sweeps only touch explicitly requested dimensions.
 */
const buildMatrix = (knobs) => {
  const keys = Object.keys(knobs || {});
  const vectors = keys.map((key) => {
    const values = Array.isArray(knobs[key]) && knobs[key].length ? knobs[key] : [null];
    return { key, values };
  });
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

const scoreRun = (report) => {
  const summary = report?.summary || {};
  const errorCount = Number(summary.error) || 0;
  const timeoutCount = Number(summary.timeout) || 0;
  const totalDurationMs = Array.isArray(report?.results)
    ? report.results.reduce((acc, entry) => acc + (Number(entry?.durationMs) || 0), 0)
    : 0;
  const stallP95 = Number(summary?.artifactStallDurationMs?.p95) || 0;
  const utilAvg = Number(summary?.perCoreUtilization?.avgPct) || 0;
  const utilizationPenalty = Math.max(0, 70 - utilAvg) * 200;
  const failurePenalty = ((errorCount + timeoutCount) * 1_000_000);
  return totalDurationMs + stallP95 + utilizationPenalty + failurePenalty;
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

const runVariant = ({ argv, variant, runIndex, runRoot }) => {
  const runId = `run-${String(runIndex + 1).padStart(3, '0')}`;
  const outPath = path.join(runRoot, `${runId}.json`);
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
  const result = spawnSubprocessSync(process.execPath, args, {
    cwd: ROOT,
    env,
    outputEncoding: 'utf8',
    captureStdout: true,
    captureStderr: true,
    outputMode: 'string',
    rejectOnNonZeroExit: false,
    killTree: true,
    detached: process.platform !== 'win32'
  });
  const durationMs = Date.now() - startedAt;
  const exitCode = Number.isInteger(result.exitCode) ? Number(result.exitCode) : null;
  const signal = typeof result.signal === 'string' && result.signal.trim().length > 0
    ? result.signal.trim()
    : null;
  const report = parseJson(result.stdout)
    || ((exitCode === 0 && !signal) ? null : { summary: { error: 1, timeout: 0 }, results: [] });
  return {
    runId,
    variant,
    outPath,
    durationMs,
    status: exitCode,
    signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    report
  };
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
  const matrix = buildMatrix(argv.knobs);
  const runRoot = path.join(ROOT, '.testLogs', 'bench-ab-sweep');
  await fs.mkdir(runRoot, { recursive: true });
  const runs = [];
  for (let index = 0; index < matrix.length; index += 1) {
    const variant = matrix[index];
    const run = runVariant({ argv, variant, runIndex: index, runRoot });
    if (run.signal) {
      console.error(`[ab-sweep] ${run.runId} interrupted by signal ${run.signal}`);
      exitLikeCommandResult({ status: null, signal: run.signal });
    }
    const report = run.report || JSON.parse(await fs.readFile(run.outPath, 'utf8'));
    const score = scoreRun(report);
    runs.push({
      runId: run.runId,
      config: variant,
      status: run.status,
      durationMs: run.durationMs,
      score,
      summary: report?.summary || null,
      reportPath: run.outPath
    });
  }
  const ranked = runs.slice().sort((a, b) => a.score - b.score);
  const best = ranked[0] || null;
  const tuple = {
    repoRoot: argv.repoRoot ? path.resolve(argv.repoRoot) : ROOT,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: (os.cpus()[0] && os.cpus()[0].model) || null,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem()
  };
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    matrix: {
      runCount: runs.length,
      knobs: argv.knobs
    },
    tuple,
    runs,
    recommendation: best
      ? {
        bestRunId: best.runId,
        bestConfig: best.config,
        score: best.score,
        rationale: 'lowest composite score from total duration, stall p95, failures, and utilization floor penalty'
      }
      : null
  };
  if (argv.json) {
    const outPath = path.isAbsolute(argv.json) ? argv.json : path.join(ROOT, argv.json);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
};

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
