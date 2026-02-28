#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { coerceNumberAtLeast } from '../../src/shared/number-coerce.js';
import { enrichUnresolvedImportSamples } from '../../src/index/build/imports.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';
import { emitGateResult } from '../shared/tooling-gate-utils.js';

const MAX_REPORTS = 256;
const GATE_EXCLUDED_IMPORTER_SEGMENTS = [
  '/test/',
  '/tests/',
  '/__tests__/',
  '/fixture/',
  '/fixtures/',
  '/__fixtures__/',
  '/spec/',
  '/specs/'
];

const parseArgs = () => createCli({
  scriptName: 'pairofcleats import-resolution-slo-gate',
  options: {
    mode: { type: 'string', default: 'ci', choices: ['ci', 'nightly'] },
    repo: { type: 'string', default: '' },
    report: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    'actionable-unresolved-rate-max': { type: 'number', default: 0.6 },
    'min-unresolved-samples': { type: 'number', default: 1 }
  }
})
  .strictOptions()
  .parse();

const toResolvedPath = (value) => path.resolve(String(value || ''));

const toRatio = (numerator, denominator) => (
  denominator > 0 ? numerator / denominator : 0
);

const toNonNegativeIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
};

const bumpCount = (target, key, amount = 1) => {
  if (!key) return;
  const current = Number(target[key]) || 0;
  target[key] = current + Math.max(0, Math.floor(Number(amount) || 0));
};

const toSortedObject = (counts) => Object.fromEntries(
  Object.entries(counts || {})
    .filter(([key, value]) => key && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => [key, Math.floor(Number(value))])
);

const toCountMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output = Object.create(null);
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string' || !key) continue;
    const count = toNonNegativeIntOrNull(raw);
    if (count == null || count <= 0) continue;
    output[key] = count;
  }
  return output;
};

const safeReadJson = async (targetPath) => {
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const discoverImportGraphs = async (rootDir) => {
  const roots = ['.testCache', '.benchCache']
    .map((entry) => path.join(rootDir, entry));
  const discovered = [];
  for (const scanRoot of roots) {
    let dirEntries;
    try {
      dirEntries = await fs.readdir(scanRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const stack = dirEntries.map((entry) => ({ dir: scanRoot, entry }));
    while (stack.length > 0 && discovered.length < MAX_REPORTS) {
      const { dir, entry } = stack.pop();
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        let children = [];
        try {
          children = await fs.readdir(fullPath, { withFileTypes: true });
        } catch {
          children = [];
        }
        for (const child of children) {
          stack.push({ dir: fullPath, entry: child });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name !== 'import_resolution_graph.json') continue;
      discovered.push(fullPath);
    }
  }
  discovered.sort((a, b) => a.localeCompare(b));
  return discovered;
};

const aggregateFromGraphs = async (graphPaths) => {
  const totals = {
    reportCount: 0,
    observedUnresolved: 0,
    observedActionable: 0,
    unresolved: 0,
    actionable: 0,
    gateEligibleUnresolved: 0,
    gateEligibleActionable: 0,
    parserArtifact: 0,
    resolverGap: 0
  };
  const reasonCodeCounts = Object.create(null);
  const invalidReports = [];

  const isGateEligibleWarning = (entry) => {
    const importer = String(entry?.importer || '').toLowerCase();
    if (!importer) return true;
    return !GATE_EXCLUDED_IMPORTER_SEGMENTS.some((segment) => importer.includes(segment));
  };

  for (const graphPath of graphPaths) {
    const payload = await safeReadJson(graphPath);
    if (!payload || typeof payload !== 'object') {
      invalidReports.push(graphPath);
      continue;
    }
    const stats = payload?.stats && typeof payload.stats === 'object' ? payload.stats : {};
    const rawWarnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const warnings = enrichUnresolvedImportSamples(rawWarnings);
    const warningReasonCodes = Object.create(null);
    for (const warning of warnings) {
      if (typeof warning?.reasonCode !== 'string' || !warning.reasonCode) continue;
      bumpCount(warningReasonCodes, warning.reasonCode);
    }
    const eligibleWarnings = warnings.filter((entry) => isGateEligibleWarning(entry));
    const eligibleUnresolved = eligibleWarnings.length;
    const eligibleActionable = eligibleWarnings.filter((entry) => entry?.disposition === 'actionable').length;
    const eligibleParserArtifact = eligibleWarnings.filter((entry) => (
      entry?.failureCause === 'parser_artifact'
      || entry?.category === 'parser_artifact'
    )).length;
    const eligibleResolverGap = eligibleWarnings.filter((entry) => (
      entry?.failureCause === 'resolver_gap'
      || entry?.category === 'resolver_gap'
    )).length;

    const statsUnresolved = toNonNegativeIntOrNull(stats.unresolved);
    const statsActionable = toNonNegativeIntOrNull(
      stats.unresolvedActionable
      ?? stats?.unresolvedByDisposition?.actionable
    );
    const hasStatsGateTotals = statsUnresolved != null && statsActionable != null;
    const unresolved = hasStatsGateTotals ? statsUnresolved : eligibleUnresolved;
    const actionable = hasStatsGateTotals ? statsActionable : eligibleActionable;

    const observedUnresolved = statsUnresolved ?? warnings.length;
    const observedActionable = statsActionable
      ?? warnings.filter((entry) => entry?.disposition === 'actionable').length;
    const statsFailureCauseCounts = toCountMap(stats.unresolvedByFailureCause);
    const statsCategoryCounts = toCountMap(stats.unresolvedByCategory);
    const parserArtifact = (
      toNonNegativeIntOrNull(statsFailureCauseCounts?.parser_artifact)
      ?? toNonNegativeIntOrNull(statsCategoryCounts?.parser_artifact)
      ?? eligibleParserArtifact
    );
    const resolverGap = (
      toNonNegativeIntOrNull(statsFailureCauseCounts?.resolver_gap)
      ?? toNonNegativeIntOrNull(statsCategoryCounts?.resolver_gap)
      ?? eligibleResolverGap
    );
    const statsReasonCodes = toCountMap(stats.unresolvedByReasonCode);
    const effectiveReasonCodes = statsReasonCodes || warningReasonCodes;

    totals.reportCount += 1;
    totals.observedUnresolved += observedUnresolved;
    totals.observedActionable += observedActionable;
    totals.unresolved += unresolved;
    totals.actionable += actionable;
    totals.gateEligibleUnresolved += eligibleUnresolved;
    totals.gateEligibleActionable += eligibleActionable;
    totals.parserArtifact += parserArtifact;
    totals.resolverGap += resolverGap;

    for (const [reasonCode, count] of Object.entries(effectiveReasonCodes)) {
      bumpCount(reasonCodeCounts, reasonCode, count);
    }
  }

  return {
    totals,
    reasonCodeCounts: toSortedObject(reasonCodeCounts),
    invalidReports
  };
};

const main = async () => {
  const argv = parseArgs();
  const { repoRoot } = resolveRepoConfig(argv.repo || null);
  const explicitReport = typeof argv.report === 'string' && argv.report.trim()
    ? toResolvedPath(argv.report)
    : '';
  const graphPaths = explicitReport
    ? [explicitReport]
    : await discoverImportGraphs(repoRoot);
  const actionableRateMax = coerceNumberAtLeast(argv['actionable-unresolved-rate-max'], 0) ?? 0.6;
  const minUnresolvedSamples = Math.max(0, Math.floor(coerceNumberAtLeast(argv['min-unresolved-samples'], 0) ?? 1));

  if (graphPaths.length === 0) {
    const payload = {
      schemaVersion: 1,
      mode: argv.mode,
      generatedAt: new Date().toISOString(),
      status: 'skip',
      reason: 'no import-resolution graph reports discovered',
      reportCount: 0,
      reportPaths: []
    };
    await emitGateResult({
      jsonPath: argv.json,
      payload,
      heading: `Import resolution SLO gate (${argv.mode})`,
      summaryLines: [
        '- status: skip',
        '- reports: 0',
        '- reason: no import-resolution graph reports discovered'
      ],
      failures: []
    });
    return;
  }

  const { totals, reasonCodeCounts, invalidReports } = await aggregateFromGraphs(graphPaths);
  const unresolved = totals.unresolved;
  const actionable = totals.actionable;
  const actionableRate = toRatio(actionable, unresolved);
  const parserArtifactRate = toRatio(totals.parserArtifact, unresolved);
  const resolverGapRate = toRatio(totals.resolverGap, unresolved);
  const failures = [];

  if (invalidReports.length > 0) {
    failures.push(`invalid graph payloads: ${invalidReports.length}`);
  }
  if (unresolved >= minUnresolvedSamples && actionableRate > actionableRateMax) {
    failures.push(
      `actionable unresolved rate ${actionableRate.toFixed(4)} exceeded max ${actionableRateMax.toFixed(4)} ` +
      `(actionable=${actionable}, unresolved=${unresolved})`
    );
  }

  const payload = {
    schemaVersion: 1,
    mode: argv.mode,
    generatedAt: new Date().toISOString(),
    status: failures.length ? 'error' : 'ok',
    reportCount: totals.reportCount,
    reportPaths: graphPaths,
    invalidReports,
    thresholds: {
      actionableUnresolvedRateMax: actionableRateMax,
      minUnresolvedSamples
    },
    metrics: {
      unresolved,
      actionable,
      observedUnresolved: totals.observedUnresolved,
      observedActionable: totals.observedActionable,
      gateEligibleUnresolved: totals.gateEligibleUnresolved,
      gateEligibleActionable: totals.gateEligibleActionable,
      actionableRate,
      parserArtifact: totals.parserArtifact,
      parserArtifactRate,
      resolverGap: totals.resolverGap,
      resolverGapRate
    },
    reasonCodes: reasonCodeCounts,
    failures
  };

  await emitGateResult({
    jsonPath: argv.json,
    payload,
    heading: `Import resolution SLO gate (${argv.mode})`,
    summaryLines: [
      `- status: ${payload.status}`,
      `- reports: ${totals.reportCount}`,
      `- unresolved: ${unresolved}`,
      `- actionable: ${actionable}`,
      `- actionableRate: ${actionableRate.toFixed(4)} (max ${actionableRateMax.toFixed(4)})`,
      `- parserArtifactRate: ${parserArtifactRate.toFixed(4)}`,
      `- resolverGapRate: ${resolverGapRate.toFixed(4)}`
    ],
    failures
  });
};

main().catch((error) => {
  console.error(`import resolution slo gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
