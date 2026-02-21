#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const parseArgs = () => {
  const out = {
    report: null,
    json: false,
    maxStageDurationMs: null,
    maxArtifactStallP95Ms: null,
    minUtilizationPct: null,
    minStageOverlapPct: null,
    help: false
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--report') {
      out.report = next || null;
      i += 1;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--max-stage-duration-ms') {
      out.maxStageDurationMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--max-artifact-stall-p95-ms') {
      out.maxArtifactStallP95Ms = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--min-utilization-pct') {
      out.minUtilizationPct = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--min-stage-overlap-pct') {
      out.minStageOverlapPct = Number(next);
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

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const main = async () => {
  const argv = parseArgs();
  if (argv.help) {
    console.log([
      'check-guardrails',
      '',
      'Usage:',
      '  node tools/bench/check-guardrails.js --report <bench-report.json> [threshold flags]',
      '',
      'Threshold flags:',
      '  --max-stage-duration-ms 120000',
      '  --max-artifact-stall-p95-ms 30000',
      '  --min-utilization-pct 75',
      '  --min-stage-overlap-pct 5'
    ].join('\n'));
    return;
  }
  if (!argv.report) {
    console.error('check-guardrails: missing --report');
    process.exit(2);
  }
  const reportPath = path.resolve(argv.report);
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const summary = report?.summary || {};
  const maxStageDurationMs = toNumber(argv.maxStageDurationMs);
  const maxArtifactStallP95Ms = toNumber(argv.maxArtifactStallP95Ms);
  const minUtilizationPct = toNumber(argv.minUtilizationPct);
  const minStageOverlapPct = toNumber(argv.minStageOverlapPct);

  const checks = [];
  const addCheck = (name, observed, expected, ok, comparator) => {
    checks.push({ name, observed, expected, comparator, ok: ok === true });
  };

  const topStageDurationMs = toNumber(summary?.criticalPath?.scripts?.[0]?.durationMs) || 0;
  if (Number.isFinite(maxStageDurationMs)) {
    addCheck(
      'stage-duration-max',
      topStageDurationMs,
      maxStageDurationMs,
      topStageDurationMs <= maxStageDurationMs,
      '<='
    );
  }

  const stallP95Ms = toNumber(summary?.artifactStallDurationMs?.p95) || 0;
  if (Number.isFinite(maxArtifactStallP95Ms)) {
    addCheck(
      'artifact-stall-p95-max',
      stallP95Ms,
      maxArtifactStallP95Ms,
      stallP95Ms <= maxArtifactStallP95Ms,
      '<='
    );
  }

  const avgUtilizationPct = toNumber(summary?.perCoreUtilization?.avgPct) || 0;
  if (Number.isFinite(minUtilizationPct)) {
    addCheck(
      'utilization-avg-min',
      avgUtilizationPct,
      minUtilizationPct,
      avgUtilizationPct >= minUtilizationPct,
      '>='
    );
  }

  const stageOverlapPct = toNumber(summary?.stageOverlap?.avgPct) || 0;
  if (Number.isFinite(minStageOverlapPct)) {
    addCheck(
      'stage-overlap-avg-min',
      stageOverlapPct,
      minStageOverlapPct,
      stageOverlapPct >= minStageOverlapPct,
      '>='
    );
  }

  const failedChecks = checks.filter((entry) => entry.ok !== true);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reportPath,
    ok: failedChecks.length === 0,
    checks,
    failedChecks
  };

  if (argv.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    for (const entry of checks) {
      const symbol = entry.ok ? 'PASS' : 'FAIL';
      console.log(`[guardrail] ${symbol} ${entry.name}: observed=${entry.observed} ${entry.comparator} expected=${entry.expected}`);
    }
  }

  process.exit(failedChecks.length ? 1 : 0);
};

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
