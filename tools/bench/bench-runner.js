#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { resolveBenchSuite } from './suites/sweet16.js';

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

const substituteTokens = (value, tokens) => {
  if (!tokens || typeof tokens !== 'object') return value;
  let out = String(value);
  for (const [key, replacement] of Object.entries(tokens)) {
    out = out.split(`\${${key}}`).join(String(replacement ?? ''));
  }
  return out;
};

const parseKeyValueMetrics = (line) => {
  const metrics = {};
  if (typeof line !== 'string') return metrics;
  const re = /([A-Za-z][A-Za-z0-9_]*)=([^\s]+)/g;
  let match = re.exec(line);
  while (match) {
    const key = match[1];
    const raw = match[2];
    const numeric = Number(raw.replace(/[^0-9.+-]/g, ''));
    metrics[key] = Number.isFinite(numeric) ? numeric : raw;
    match = re.exec(line);
  }
  return metrics;
};

const parseBenchOutput = (output) => {
  const lines = String(output || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const benchLines = lines.filter((line) => line.startsWith('[bench]'));
  const classify = (label) => (
    benchLines.find((line) => (
      /^\[bench\]\s+(?:[^\s]+\s+)*?(baseline|current|delta)\b/i.test(line)
      && line.toLowerCase().includes(` ${label}`)
    )) || null
  );
  const baselineLine = benchLines.find((line) => /^\[bench\]\s+baseline\b/i.test(line))
    || classify('baseline');
  const currentLine = benchLines.find((line) => /^\[bench\]\s+current\b/i.test(line))
    || classify('current');
  const deltaLine = benchLines.find((line) => /^\[bench\]\s+delta\b/i.test(line))
    || classify('delta');
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

const parseTrailingJson = (text) => {
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

const detectStorageTier = (value) => {
  const target = String(value || '');
  if (!target) return 'unknown';
  const normalized = target.toLowerCase();
  if (normalized.includes('ramdisk') || normalized.includes('tmpfs') || normalized.includes('\\temp\\ram')) {
    return 'ram';
  }
  return 'disk';
};

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
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toPercent = (value, scale = 100) => {
  const num = toFiniteNumber(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num * scale));
};

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

const resolveUtilizationPct = (sample) => {
  const direct = [
    sample?.utilizationPct,
    sample?.overallPct,
    sample?.utilization?.overallPct,
    sample?.utilization?.overall
  ];
  for (const value of direct) {
    const asPercent = toPercent(value, Number(value) > 1 ? 1 : 100);
    if (Number.isFinite(asPercent)) return asPercent;
  }
  const cpuUsed = toFiniteNumber(sample?.cpuUsed ?? sample?.tokensUsed?.cpu ?? sample?.used?.cpu);
  const cpuTotal = toFiniteNumber(sample?.cpuTotal ?? sample?.tokensTotal?.cpu ?? sample?.limits?.cpu);
  if (Number.isFinite(cpuUsed) && Number.isFinite(cpuTotal) && cpuTotal > 0) {
    return Math.max(0, Math.min(100, (cpuUsed / cpuTotal) * 100));
  }
  return null;
};

const collectUtilizationSamples = ({ json, script }) => {
  const trace = resolveTraceEntries(json);
  if (!trace.length) return [];
  const out = [];
  for (let index = 0; index < trace.length; index += 1) {
    const sample = trace[index];
    const utilizationPct = resolveUtilizationPct(sample);
    if (!Number.isFinite(utilizationPct)) continue;
    out.push({
      script,
      sample: index,
      atMs: toFiniteNumber(sample?.atMs ?? sample?.timeMs ?? sample?.elapsedMs),
      utilizationPct
    });
  }
  return out;
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

const runOne = ({ script, args, timeoutMs, tokens }) => {
  const absScript = path.isAbsolute(script) ? script : path.join(process.cwd(), script);
  const start = Date.now();
  const result = spawnSync(
    process.execPath,
    [absScript, ...(args || []).map((value) => substituteTokens(value, tokens))],
    { encoding: 'utf8', timeout: timeoutMs > 0 ? timeoutMs : undefined }
  );
  const durationMs = Date.now() - start;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = `${stdout}\n${stderr}`;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const exitCode = typeof result.status === 'number' ? result.status : null;
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
    ok: exitCode === 0 && !timedOut,
    stdout,
    stderr,
    parsed,
    json
  };
};

const main = async () => {
  const argv = parseArgs();
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
    return;
  }

  const suiteEntries = argv.suite ? resolveBenchSuite(argv.suite) : null;
  const tokens = {
    repoRoot: argv.repoRoot ? path.resolve(argv.repoRoot) : '',
    indexDir: argv.indexDir ? path.resolve(argv.indexDir) : ''
  };
  const entries = argv.scripts.length
    ? argv.scripts.map((script) => ({ id: path.basename(script), script, args: [] }))
    : (suiteEntries || []);
  if (!entries.length) {
    console.error('bench-runner: no scripts selected (use --scripts or --suite).');
    process.exit(2);
  }

  const results = [];
  const suiteMode = Boolean(suiteEntries);
  for (const entry of entries) {
    if (!argv.quiet) {
      process.stderr.write(`[bench-runner] ${entry.script}\n`);
    }
    const result = runOne({
      script: entry.script,
      args: entry.args,
      timeoutMs: argv.timeoutMs,
      tokens
    });

    const errors = [];
    const expect = entry.expect && typeof entry.expect === 'object' ? entry.expect : null;
    if (expect) {
      if (expect.json === true && !result.json) {
        errors.push('missing json output');
      }
      if (expect.baseline === true && !result.parsed?.baseline) {
        errors.push('missing baseline bench line');
      }
      if (expect.current === true && !result.parsed?.current) {
        errors.push('missing current bench line');
      }
      if (expect.delta === true && !result.parsed?.delta) {
        errors.push('missing delta bench line');
      }
    }

    const parsedOk = errors.length === 0;
    if (suiteMode && expect && !parsedOk) {
      const allowSkip = entry.allowSkip === true;
      const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
      const looksSkipped = combined.includes('skipping') || combined.includes('skipped');
      if (allowSkip && looksSkipped) {
        result.skipped = true;
      } else {
        result.ok = false;
      }
    }
    result.parsedOk = parsedOk;
    if (errors.length) result.errors = errors;
    results.push(result);
  }

  const summary = results.reduce((acc, entry) => {
    const status = entry.timedOut ? 'timeout' : (entry.ok ? 'ok' : 'error');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { ok: 0, error: 0, timeout: 0 });
  const artifactDurations = [];
  const stageOverlapRows = [];
  const utilizationSamples = [];
  for (const entry of results) {
    const stageOverlapRow = resolveStageOverlapRow({
      json: entry?.json,
      script: entry.script,
      durationMs: entry.durationMs
    });
    if (stageOverlapRow) stageOverlapRows.push(stageOverlapRow);
    utilizationSamples.push(...collectUtilizationSamples({ json: entry?.json, script: entry.script }));
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
  const utilizationValues = utilizationSamples.map((entry) => entry.utilizationPct);
  const perCoreUtilization = {
    sampleCount: utilizationSamples.length,
    avgPct: utilizationValues.length
      ? utilizationValues.reduce((acc, value) => acc + value, 0) / utilizationValues.length
      : 0,
    minPct: utilizationValues.length ? Math.min(...utilizationValues) : 0,
    maxPct: utilizationValues.length ? Math.max(...utilizationValues) : 0,
    p50Pct: utilizationValues.length ? resolvePercentile(utilizationValues, 0.5) : 0,
    p95Pct: utilizationValues.length ? resolvePercentile(utilizationValues, 0.95) : 0,
    timeline: utilizationSamples.slice(-512)
  };
  const triageHints = [];
  if ((summary.error || 0) > 0 || (summary.timeout || 0) > 0) {
    triageHints.push('One or more bench scripts failed or timed out; inspect stderr for first failing script.');
  }
  if (artifactStallDurationMs && artifactStallDurationMs.p95 >= 30000) {
    triageHints.push('Artifact write tails are high (p95 >= 30s); inspect shard sizing, write queue pressure, and IO caps.');
  }
  for (const entry of results) {
    const deltaDuration = Number(entry?.parsed?.delta?.metrics?.duration);
    if (Number.isFinite(deltaDuration) && deltaDuration > 0) {
      triageHints.push(`Regression signal in ${entry.script}: positive delta duration=${deltaDuration}.`);
    }
  }
  summary.artifactStallDurationMs = artifactStallDurationMs;
  summary.stageOverlap = stageOverlap;
  summary.perCoreUtilization = perCoreUtilization;
  summary.criticalPath = {
    scripts: criticalPathScripts,
    artifacts: criticalPathArtifacts,
    reconstructedTail: criticalPathSequence
  };
  summary.triageHints = triageHints;

  const report = {
    schemaVersion: 1,
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
      antivirusState: process.env.PAIROFCLEATS_BENCH_ANTIVIRUS_STATE || 'unknown',
      cpuGovernor: process.env.PAIROFCLEATS_BENCH_CPU_GOVERNOR || 'unknown',
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
      script: entry.script,
      absScript: entry.absScript,
      ok: entry.ok,
      timedOut: entry.timedOut,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      parsed: entry.parsed,
      json: entry.json,
      stdout: entry.stdout,
      stderr: entry.stderr
    }))
  };

  if (argv.json) {
    const outPath = path.isAbsolute(argv.json) ? argv.json : path.join(process.cwd(), argv.json);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (!argv.quiet) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  const hasFailures = (summary.error || 0) > 0 || (summary.timeout || 0) > 0;
  process.exit(hasFailures ? 1 : 0);
};

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
