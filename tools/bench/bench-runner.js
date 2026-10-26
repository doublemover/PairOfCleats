#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { resolveBenchRunnerWorkload, reobserveBenchSources, substituteBenchTokens, readBenchmarkExperiment, BENCH_REPORT_MAX_BYTES } from './runner-workload.js';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { BENCH_RUNNER_REPORT_VERSION } from './runner-contract.js';
import { classifyBenchOutcome, summarizeBenchOutcomes } from './runner-outcome.js';
import { collectUtilizationSamples, summarizeUtilization } from './runner-utilization.js';

const { getEnvConfig } = await import('../../src/shared/env/runtime.js');
const { spawnSubprocessSync } = await import('../../src/shared/subprocess/runner.js');
const { parseTrailingJson } = await import('./output.js');
const { resolveBenchSuite } = await import('./suites/sweet16.js');

const MAX_UTILIZATION_SAMPLES = 2048;

/**
 * Parse CLI flags for bench-runner.
 *
 * @returns {{
 *   suite:string|null,
 *   scripts:string[],
 *   json:string|null,
 *   timeoutMs:number,
 *   quiet:boolean,
 *   repoRoot:string|null,
 *   indexDir:string|null,
 *   help:boolean
 * }}
 */
const parseArgs = () => {
  const out = {
    suite: null,
    scripts: [],
    json: null,
    timeoutMs: 0,
    quiet: false,
    repoRoot: null,
    indexDir: null,
    help: false
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--suite') {
      out.suite = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--scripts') {
      const value = argv[i + 1] || '';
      const next = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      out.scripts.push(...next);
      i += 1;
      continue;
    }
    if (arg === '--json') {
      out.json = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      out.timeoutMs = Math.max(0, Math.floor(Number(argv[i + 1] || 0)));
      i += 1;
      continue;
    }
    if (arg === '--quiet') {
      out.quiet = true;
      continue;
    }
    if (arg === '--repo-root') {
      out.repoRoot = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--index-dir') {
      out.indexDir = argv[i + 1] || null;
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
 * Expand `${token}` placeholders inside script argument templates.
 *
 * @param {string} value
 * @param {Record<string, string>} tokens
 * @returns {string}
 */
const substituteTokens = substituteBenchTokens;

/**
 * Parse `key=value` metric pairs from a bench output line.
 *
 * @param {string} line
 * @returns {Record<string, number|string>}
 */
const parseKeyValueMetrics = (line) => {
  const metrics = {};
  if (typeof line !== 'string') return metrics;
  const re = /([A-Za-z][A-Za-z0-9_]*)=([^\s]+)/g;
  let match = re.exec(line);
  while (match) {
    const key = match[1];
    const raw = match[2];
    const cleaned = raw.replace(/[),;]+$/g, '');
    const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:%|ms|s|sec|secs|seconds|b|kb|mb|gb|kib|mib|gib|\/s)?$/i
      .test(cleaned)
      ? Number(cleaned.replace(/[^0-9.+-]/g, ''))
      : null;
    metrics[key] = Number.isFinite(numeric) ? numeric : raw;
    match = re.exec(line);
  }
  return metrics;
};

/**
 * Extract canonical baseline/current/delta bench lines from mixed output.
 *
 * Supports prefixed forms (e.g. `[bench] run-a baseline ...`) used by some
 * scripts while preserving deterministic output shape.
 *
 * @param {string} output
 * @returns {{
 *   baseline:{line:string,metrics:Record<string,number|string>}|null,
 *   current:{line:string,metrics:Record<string,number|string>}|null,
 *   delta:{line:string,metrics:Record<string,number|string>}|null
 * }}
 */
const parseBenchOutput = (output) => {
  const lines = String(output || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const benchLines = lines.filter((line) => line.startsWith('[bench]'));
  const resolveLabel = (line) => {
    const body = line.replace(/^\[bench\]\s+/i, '');
    for (const token of body.split(/\s+/g)) {
      const normalized = token.replace(/[:;,]+$/g, '').toLowerCase();
      if (normalized === 'baseline' || normalized === 'current' || normalized === 'delta') {
        return normalized;
      }
      if (token.includes('=') || token === '|' || token.startsWith('{') || token.startsWith('[')) {
        return null;
      }
    }
    return null;
  };
  const records = benchLines.map((line) => ({ line, label: resolveLabel(line) }));
  const findLabel = (label) => records.find((entry) => entry.label === label)?.line || null;
  const baselineLine = findLabel('baseline');
  const currentLine = findLabel('current');
  const deltaLine = findLabel('delta');
  return {
    baseline: baselineLine
      ? { line: baselineLine, metrics: parseKeyValueMetrics(baselineLine) }
      : null,
    current: currentLine
      ? { line: currentLine, metrics: parseKeyValueMetrics(currentLine) }
      : null,
    delta: deltaLine
      ? { line: deltaLine, metrics: parseKeyValueMetrics(deltaLine) }
      : null
  };
};

const detectStorageTier = (value) => {
  const target = String(value || '');
  if (!target) return 'unknown';
  const normalized = target.toLowerCase();
  if (normalized.includes('ramdisk') || normalized.includes('tmpfs') || normalized.includes('\\temp\\ram')) {
    return 'ram';
  }
  return 'disk';
};

/**
 * Compute an inclusive percentile from numeric samples.
 *
 * @param {Array<number|string>} values
 * @param {number} ratio
 * @returns {number}
 */
const resolvePercentile = (values, ratio) => {
  if (!Array.isArray(values) || !values.length) return 0;
  const sorted = values
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * clamped) - 1));
  return sorted[index];
};

const toFiniteNumber = (value) => {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const resolveDeltaDurationMs = (entry) => {
  const metrics = entry?.parsed?.delta?.metrics;
  if (!metrics || typeof metrics !== 'object') return null;
  for (const key of ['ms', 'durationMs', 'totalMs', 'parseMs', 'loadMs']) {
    const value = toFiniteNumber(metrics[key]);
    if (Number.isFinite(value)) return value;
  }
  const duration = toFiniteNumber(metrics.duration);
  return Number.isFinite(duration) ? duration : null;
};

/**
 * Resolve scheduler trace entries from variant JSON payload shapes.
 *
 * @param {any} json
 * @returns {any[]}
 */
const resolveTraceEntries = (json) => {
  const candidates = [
    json?.timings?.scheduler?.trace,
    json?.timings?.schedulerTrace,
    json?.schedulerTrace,
    json?.scheduler?.trace,
    json?.telemetry?.scheduler?.trace
  ];
  for (const entry of candidates) {
    if (Array.isArray(entry) && entry.length) return entry;
  }
  return [];
};

/**
 * Append entries while preserving a rolling upper bound.
 *
 * @param {any[]} target
 * @param {any[]} entries
 * @param {number} maxEntries
 * @returns {void}
 */
const appendBoundedEntries = (target, entries, maxEntries) => {
  if (!Array.isArray(target) || !Array.isArray(entries) || !entries.length) return;
  target.push(...entries);
  const cap = Math.max(0, Math.floor(Number(maxEntries) || 0));
  if (cap <= 0 || target.length <= cap) return;
  target.splice(0, target.length - cap);
};

const resolveStageDurations = (json) => {
  const stages = json?.timings?.stages;
  const fromObject = (source) => ({
    parseMs: toFiniteNumber(source?.parse?.durationMs ?? source?.parseMs),
    inferMs: toFiniteNumber(source?.infer?.durationMs ?? source?.inferMs),
    writeMs: toFiniteNumber(source?.write?.durationMs ?? source?.writeMs)
  });
  if (stages && typeof stages === 'object' && !Array.isArray(stages)) {
    return fromObject(stages);
  }
  if (Array.isArray(stages) && stages.length) {
    const out = { parseMs: null, inferMs: null, writeMs: null };
    for (const stage of stages) {
      const name = String(stage?.name || stage?.stage || '').toLowerCase();
      const durationMs = toFiniteNumber(stage?.durationMs ?? stage?.ms);
      if (!Number.isFinite(durationMs) || !name) continue;
      if (!Number.isFinite(out.parseMs) && name.includes('parse')) out.parseMs = durationMs;
      if (!Number.isFinite(out.inferMs) && name.includes('infer')) out.inferMs = durationMs;
      if (!Number.isFinite(out.writeMs) && name.includes('write')) out.writeMs = durationMs;
    }
    return out;
  }
  return fromObject(json?.stageTelemetry || {});
};

/**
 * Build stage-overlap diagnostics row from parsed bench JSON payload.
 *
 * @param {{json:any,script:string,durationMs:number}} input
 * @returns {{script:string,totalMs:number,parseMs:number|null,inferMs:number|null,writeMs:number|null,overlapMs:number,overlapPct:number}|null}
 */
const resolveStageOverlapRow = ({ json, script, durationMs }) => {
  const totalMs = toFiniteNumber(json?.timings?.totalMs ?? json?.timings?.durationMs ?? durationMs);
  const durations = resolveStageDurations(json);
  const parseMs = toFiniteNumber(durations.parseMs);
  const inferMs = toFiniteNumber(durations.inferMs);
  const writeMs = toFiniteNumber(durations.writeMs);
  const stageSumMs = [parseMs, inferMs, writeMs]
    .filter((value) => Number.isFinite(value))
    .reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(totalMs) || stageSumMs <= 0) return null;
  const overlapMs = Math.max(0, stageSumMs - totalMs);
  return {
    script,
    totalMs,
    parseMs,
    inferMs,
    writeMs,
    overlapMs,
    overlapPct: (overlapMs / Math.max(1, stageSumMs)) * 100
  };
};

/**
 * Execute a bench script and return parsed output + timing metadata.
 *
 * @param {{script:string,args?:string[],timeoutMs?:number,tokens?:Record<string,string>}} input
 * @returns {{
 *   script:string,
 *   absScript:string,
 *   startedAtMs:number,
 *   endedAtMs:number,
 *   durationMs:number,
 *   exitCode:number|null,
 *   timedOut:boolean,
 *   ok:boolean,
 *   stdout:string,
 *   stderr:string,
 *   parsed:object,
 *   json:any
 * }}
 */
const runOne = ({ script, args, timeoutMs, tokens }) => {
  const absScript = path.isAbsolute(script) ? script : path.join(process.cwd(), script);
  const start = Date.now();
  let result = null;
  let timedOut = false, processFailure = null;
  try {
    result = spawnSubprocessSync(
      process.execPath,
      [absScript, ...(args || []).map((value) => substituteTokens(value, tokens))],
      {
        outputEncoding: 'utf8',
        timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
        captureStdout: true,
        captureStderr: true,
        outputMode: 'string',
        rejectOnNonZeroExit: false,
        killTree: true,
        detached: process.platform !== 'win32'
      }
    );
  } catch (error) {
    observeStorageResource(error, { phase: 'bench-child-settlement' }).requireSettled();
    processFailure = typeof error?.code === 'string' ? error.code : 'SUBPROCESS_EXECUTION_FAILED';
    timedOut = error?.name === 'SubprocessTimeoutError'
      || error?.code === 'SUBPROCESS_TIMEOUT'
      || String(error?.result?.errorCode || '').toUpperCase() === 'ETIMEDOUT';
    result = error?.result || {
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: error?.message || String(error || '')
    };
  }
  const durationMs = Date.now() - start;
  const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
  const combined = `${stdout}\n${stderr}`;
  const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : null;
  const parsed = parseBenchOutput(combined);
  const json = parseTrailingJson(stdout);
  return {
    script,
    absScript,
    startedAtMs: start,
    endedAtMs: start + durationMs,
    durationMs,
    exitCode,
    timedOut,
    signal: typeof result?.signal === 'string' ? result.signal : null,
    processFailure,
    outputCapture: result?.outputCapture || null,
    ok: exitCode === 0 && !timedOut && !result?.signal && !processFailure,
    stdout,
    stderr,
    parsed,
    json
  };
};

/**
 * Run selected benchmark suite/scripts and emit summary report artifact.
 *
 * @returns {Promise<{report:object|null,exitCode:number}>}
 */
export const runBenchRunner = async ({ argv = parseArgs(), resolveSuite = resolveBenchSuite, run = runOne } = {}) => {
  const envConfig = getEnvConfig(process.env);
  if (argv.help) {
    const lines = [
      'bench-runner',
      '',
      'Usage:',
      '  node tools/bench/bench-runner.js --scripts <path[,path...]> [--json <out.json>] [--timeout-ms N]',
      '  node tools/bench/bench-runner.js --suite sweet16 [--json <out.json>] [--timeout-ms N] [--repo-root <path>] [--index-dir <path>]',
      '',
      'Notes:',
      '- Suite entries include their own args; --scripts runs with no implicit args.',
      '- Use --repo-root/--index-dir to populate suite placeholders.'
    ];
    console.log(lines.join('\n'));
    return { report: null, exitCode: 0 };
  }

  const prepared = resolveBenchRunnerWorkload({ argv, resolveSuite });
  const { entries, tokens, suiteMode } = prepared;
  const experiment = readBenchmarkExperiment();
  if (experiment && experiment.workloadFingerprint !== prepared.receipt.fingerprint) throw new Error('Benchmark invocation resolved a different workload than its parent.');
  if (!entries.length) {
    console.error('bench-runner: no scripts selected (use --scripts or --suite).');
    return { report: null, exitCode: 2 };
  }

  const results = [];
  for (const entry of entries) {
    if (!argv.quiet) {
      process.stderr.write(`[bench-runner] ${entry.script}\n`);
    }
    const result = run({
      script: entry.script,
      args: entry.args,
      timeoutMs: argv.timeoutMs,
      tokens
    });
    result.id = entry.id || path.basename(entry.script);
    result.args = Array.isArray(entry.args)
      ? entry.args.map((value) => substituteTokens(value, tokens))
      : [];
    result.required = entry.allowSkip !== true;
    result.expect = entry.expect && typeof entry.expect === 'object'
      ? { ...entry.expect }
      : null;

    Object.assign(result, classifyBenchOutcome({ result, id: result.id,
      expect: result.expect, allowSkip: entry.allowSkip === true, suiteMode }));
    results.push(result);
  }

  const summary = summarizeBenchOutcomes(results);
  const artifactDurations = [];
  const stageOverlapRows = [];
  const utilizationSamples = [];
  let utilizationObserved = 0, utilizationValid = 0, utilizationUnavailable = 0;
  for (const entry of results) {
    const stageOverlapRow = resolveStageOverlapRow({
      json: entry?.json,
      script: entry.script,
      durationMs: entry.durationMs
    });
    if (stageOverlapRow) stageOverlapRows.push(stageOverlapRow);
    const utilization = collectUtilizationSamples({ trace: resolveTraceEntries(entry?.json), script: entry.script });
    appendBoundedEntries(utilizationSamples, utilization.samples, MAX_UTILIZATION_SAMPLES);
    utilizationObserved += utilization.observedCount;
    utilizationValid += utilization.validCount;
    utilizationUnavailable += utilization.unavailableCount;
    const artifacts = Array.isArray(entry?.json?.timings?.artifacts)
      ? entry.json.timings.artifacts
      : [];
    for (const artifact of artifacts) {
      const durationMs = Number(artifact?.durationMs);
      if (!Number.isFinite(durationMs) || durationMs < 0) continue;
      const stallMs = toFiniteNumber(artifact?.stallMs ?? artifact?.queueDelayMs ?? artifact?.waitMs ?? durationMs);
      const startedAtMs = toFiniteNumber(artifact?.startedAtMs ?? artifact?.startAtMs);
      const endedAtMs = toFiniteNumber(artifact?.endedAtMs ?? artifact?.endAtMs)
        ?? (Number.isFinite(startedAtMs) ? startedAtMs + durationMs : null);
      artifactDurations.push({
        script: entry.script,
        path: typeof artifact?.path === 'string' ? artifact.path : null,
        durationMs,
        stallMs: Number.isFinite(stallMs) ? stallMs : durationMs,
        startedAtMs,
        endedAtMs
      });
    }
  }
  const artifactDurationValues = artifactDurations.map((entry) => entry.stallMs);
  const artifactStallDurationMs = artifactDurationValues.length
    ? {
      count: artifactDurationValues.length,
      p95: resolvePercentile(artifactDurationValues, 0.95),
      p99: resolvePercentile(artifactDurationValues, 0.99),
      max: Math.max(...artifactDurationValues)
    }
    : null;
  const criticalPathScripts = results
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((entry) => ({
      script: entry.script,
      durationMs: entry.durationMs,
      ok: entry.ok
    }));
  const criticalPathArtifacts = artifactDurations
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);
  const criticalPathSequence = [
    ...results.map((entry) => ({
      type: 'script',
      script: entry.script,
      path: null,
      startedAtMs: entry.startedAtMs,
      endedAtMs: entry.endedAtMs,
      durationMs: entry.durationMs
    })),
    ...artifactDurations
      .filter((entry) => Number.isFinite(entry.endedAtMs))
      .map((entry) => ({
        type: 'artifact',
        script: entry.script,
        path: entry.path,
        startedAtMs: entry.startedAtMs,
        endedAtMs: entry.endedAtMs,
        durationMs: entry.durationMs
      }))
  ]
    .filter((entry) => Number.isFinite(entry.endedAtMs))
    .sort((a, b) => a.endedAtMs - b.endedAtMs)
    .slice(-20);
  const overlapValues = stageOverlapRows.map((entry) => entry.overlapPct);
  const stageOverlap = {
    count: stageOverlapRows.length,
    avgPct: overlapValues.length
      ? overlapValues.reduce((acc, value) => acc + value, 0) / overlapValues.length
      : 0,
    p50Pct: overlapValues.length ? resolvePercentile(overlapValues, 0.5) : 0,
    p95Pct: overlapValues.length ? resolvePercentile(overlapValues, 0.95) : 0,
    maxPct: overlapValues.length ? Math.max(...overlapValues) : 0,
    rows: stageOverlapRows
  };
  const perCoreUtilization = summarizeUtilization({ samples: utilizationSamples, observedCount: utilizationObserved,
    validCount: utilizationValid, unavailableCount: utilizationUnavailable, percentile: resolvePercentile });
  const triageHints = [];
  if ((summary.error || 0) > 0 || (summary.timeout || 0) > 0) {
    triageHints.push('One or more bench scripts failed or timed out; inspect stderr for first failing script.');
  }
  if (artifactStallDurationMs && artifactStallDurationMs.p95 >= 30000) {
    triageHints.push('Artifact write tails are high (p95 >= 30s); inspect shard sizing, write queue pressure, and IO caps.');
  }
  const regressionSignals = [];
  for (const entry of results) {
    const deltaDuration = resolveDeltaDurationMs(entry);
    if (Number.isFinite(deltaDuration) && deltaDuration > 0) {
      regressionSignals.push({
        id: entry.id || null,
        script: entry.script,
        metric: 'durationMs',
        deltaMs: deltaDuration
      });
      triageHints.push(`Regression signal in ${entry.script}: positive delta duration=${deltaDuration}ms.`);
    }
  }
  summary.regressionSignals = regressionSignals;
  summary.artifactStallDurationMs = artifactStallDurationMs;
  summary.stageOverlap = stageOverlap;
  summary.perCoreUtilization = perCoreUtilization;
  summary.criticalPath = {
    scripts: criticalPathScripts,
    artifacts: criticalPathArtifacts,
    reconstructedTail: criticalPathSequence
  };
  summary.triageHints = triageHints;

  let report = {
    schemaVersion: BENCH_RUNNER_REPORT_VERSION,
    experiment,
    workload: prepared.receipt,
    sourceValidation: reobserveBenchSources(prepared.receipt),
    reportAdmission: { state: 'complete', maxBytes: experiment?.maxReportBytes || BENCH_REPORT_MAX_BYTES },
    generatedAt: new Date().toISOString(),
    runner: {
      cwd: process.cwd(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version,
      args: process.argv.slice(2),
      cpuModel: Array.isArray(os.cpus()) && os.cpus().length ? os.cpus()[0].model : null,
      logicalCpuCount: Array.isArray(os.cpus()) ? os.cpus().length : null,
      totalMemoryBytes: Number(os.totalmem()) || null,
      storageTier: detectStorageTier(tokens.indexDir || tokens.repoRoot || process.cwd()),
      storagePath: tokens.indexDir || tokens.repoRoot || process.cwd(),
      storageRoot: path.parse(tokens.indexDir || tokens.repoRoot || process.cwd()).root || null,
      antivirusState: envConfig.benchAntivirusState || 'unknown',
      cpuGovernor: envConfig.benchCpuGovernor || 'unknown',
      configHash: createHash('sha1').update(JSON.stringify({
        suite: argv.suite || null,
        scripts: entries.map((entry) => ({
          id: entry.id || null,
          script: entry.script,
          args: Array.isArray(entry.args) ? entry.args : []
        })),
        timeoutMs: argv.timeoutMs || 0,
        repoRoot: tokens.repoRoot || null,
        indexDir: tokens.indexDir || null
      })).digest('hex')
    },
    summary,
    results: results.map((entry) => ({
      id: entry.id || null,
      script: entry.script,
      absScript: entry.absScript,
      args: entry.args || [],
      expect: entry.expect || null,
      required: entry.required,
      outputCapture: entry.outputCapture || null,
      ok: entry.ok,
      status: entry.status,
      processOk: entry.processOk,
      signal: entry.signal,
      processFailure: entry.processFailure,
      skipped: entry.skipped === true,
      skipReason: entry.skipReason || null,
      parsedOk: entry.parsedOk === true,
      errors: Array.isArray(entry.errors) ? entry.errors : [],
      timedOut: entry.timedOut,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      parsed: entry.parsed,
      json: entry.json,
      stdout: entry.stdout,
      stderr: entry.stderr
    }))
  };

  const maxReportBytes = experiment?.maxReportBytes || BENCH_REPORT_MAX_BYTES;
  let reportText = JSON.stringify(report, null, 2) + '\n';
  if (Buffer.byteLength(reportText) > maxReportBytes) {
    // Preserve actual per-script outcomes instead of substituting empty success
    // or losing the failing report when diagnostic retention exceeds its bound.
    report = { ...report, reportAdmission: { state: 'report-too-large', maxBytes: maxReportBytes,
      observedBytes: Buffer.byteLength(reportText), omittedRawDiagnostics: true },
    results: report.results.map(({ stdout, stderr, json, parsed, ...entry }) => ({ ...entry,
      stdout: '', stderr: '', json: null, parsed: { baseline: null, current: null, delta: null },
      stderrTail: typeof stderr === 'string' ? stderr.slice(-1024) : '',
      stdoutTail: typeof stdout === 'string' ? stdout.slice(-512) : '' })) };
    reportText = JSON.stringify(report, null, 2) + '\n';
  }
  if (Buffer.byteLength(reportText) > maxReportBytes) throw Object.assign(new Error('Benchmark terminal report exceeds its bounded allowance.'), { code: 'ERR_BENCH_REPORT_LIMIT' });
  if (argv.json) {
    const outPath = path.isAbsolute(argv.json) ? argv.json : path.join(process.cwd(), argv.json);
    await atomicWriteText(outPath, reportText, { createOnly: Boolean(experiment) });
  }

  if (!argv.quiet) {
    process.stdout.write(reportText);
  }

  const hasFailures = (summary.error || 0) > 0 || (summary.timeout || 0) > 0 || report.reportAdmission.state !== 'complete';
  return { report, exitCode: hasFailures ? 1 : 0 };
};

if (isDirectExecution(import.meta.url)) {
  runBenchRunner().then(({ exitCode }) => { process.exitCode = exitCode; }).catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  });
}
