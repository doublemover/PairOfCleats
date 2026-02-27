#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import {
  coerceClampedFraction,
  coerceNonNegativeInt
} from '../../../src/shared/number-coerce.js';
import { writeJsonFileResolved } from '../../shared/json-utils.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats bench-language-tooling-lsp-guardrail',
  options: {
    report: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    'min-summary-coverage': { type: 'number', default: 0.9 },
    'max-crash-retention': { type: 'number', default: 25 },
    'max-top-regressions': { type: 'number', default: 20 }
  }
})
  .strictOptions()
  .parse();

const extractGuardrailMetrics = (report) => {
  if (Array.isArray(report?.tasks)) {
    const tasks = report.tasks;
    const tasksWithSummary = tasks.filter((entry) => entry?.summary && typeof entry.summary === 'object');
    const summaryCoverage = tasks.length > 0 ? (tasksWithSummary.length / tasks.length) : 0;
    const crashRetentionCount = Number(report?.diagnostics?.crashRetention?.retainedCount || 0);
    const topRegressionCount = Array.isArray(report?.throughputLedger?.topRegressions)
      ? report.throughputLedger.topRegressions.length
      : 0;
    return {
      sourceType: 'bench-language',
      totalTasks: tasks.length,
      tasksWithSummary: tasksWithSummary.length,
      summaryCoverage,
      crashRetentionCount,
      topRegressionCount
    };
  }

  const metricPayload = report?.metrics && typeof report.metrics === 'object' ? report.metrics : null;
  const requestCount = coerceNonNegativeInt(report?.sampleCount) ?? coerceNonNegativeInt(metricPayload?.requests) ?? 0;
  const coverage = coerceClampedFraction(metricPayload?.enrichmentCoverage, {
    min: 0,
    max: 1,
    allowZero: true
  }) ?? 0;
  return {
    sourceType: metricPayload ? 'slo-gate' : 'unknown',
    totalTasks: requestCount,
    tasksWithSummary: Math.floor(requestCount * coverage),
    summaryCoverage: coverage,
    crashRetentionCount: coerceNonNegativeInt(metricPayload?.fatalFailures) ?? 0,
    topRegressionCount: coerceNonNegativeInt(metricPayload?.timedOut) ?? 0
  };
};

const main = async () => {
  const argv = parseArgs();
  if (!argv.report) {
    throw new Error('--report is required');
  }
  const reportPath = path.resolve(argv.report);
  const raw = await fsPromises.readFile(reportPath, 'utf8');
  const report = JSON.parse(raw);
  const reportMetrics = extractGuardrailMetrics(report);
  const summaryCoverage = reportMetrics.summaryCoverage;
  const crashRetentionCount = reportMetrics.crashRetentionCount;
  const topRegressionCount = reportMetrics.topRegressionCount;

  const thresholds = {
    minSummaryCoverage: coerceClampedFraction(argv['min-summary-coverage'], {
      min: 0,
      max: 1,
      allowZero: true
    }) ?? 0.9,
    maxCrashRetention: coerceNonNegativeInt(argv['max-crash-retention']) ?? 25,
    maxTopRegressions: coerceNonNegativeInt(argv['max-top-regressions']) ?? 20
  };

  const failures = [];
  if (summaryCoverage < thresholds.minSummaryCoverage) {
    failures.push(
      `summary coverage ${summaryCoverage.toFixed(4)} below min ${thresholds.minSummaryCoverage.toFixed(4)}`
    );
  }
  if (crashRetentionCount > thresholds.maxCrashRetention) {
    failures.push(`crash retention count ${crashRetentionCount} exceeded max ${thresholds.maxCrashRetention}`);
  }
  if (topRegressionCount > thresholds.maxTopRegressions) {
    failures.push(`top regression count ${topRegressionCount} exceeded max ${thresholds.maxTopRegressions}`);
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failures.length ? 'error' : 'ok',
    reportPath,
    sourceType: reportMetrics.sourceType,
    thresholds,
    metrics: {
      totalTasks: reportMetrics.totalTasks,
      tasksWithSummary: reportMetrics.tasksWithSummary,
      summaryCoverage,
      crashRetentionCount,
      topRegressionCount
    },
    failures
  };

  await writeJsonFileResolved(argv.json, payload, { trailingNewline: true });
  console.error('bench-language tooling LSP guardrail');
  console.error(`- status: ${payload.status}`);
  console.error(`- summaryCoverage: ${summaryCoverage.toFixed(4)} (min ${thresholds.minSummaryCoverage.toFixed(4)})`);
  console.error(`- crashRetentionCount: ${crashRetentionCount} (max ${thresholds.maxCrashRetention})`);
  console.error(`- topRegressionCount: ${topRegressionCount} (max ${thresholds.maxTopRegressions})`);
  if (failures.length) {
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(3);
  }
};

main().catch((error) => {
  console.error(`bench-language tooling guardrail failed: ${error?.message || String(error)}`);
  process.exit(1);
});
