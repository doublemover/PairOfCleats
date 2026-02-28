#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { coerceNumberAtLeast } from '../../src/shared/number-coerce.js';
import {
  aggregateImportResolutionGraphPayloads,
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS,
  DEFAULT_REPLAY_MAX_REPORTS,
  discoverImportResolutionGraphReports,
  loadImportResolutionGraphReports,
  resolveResolverPipelineStageHighlights
} from '../../src/index/build/import-resolution.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';
import { emitGateResult } from '../shared/tooling-gate-utils.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats import-resolution-slo-gate',
  options: {
    mode: { type: 'string', default: 'ci', choices: ['ci', 'nightly'] },
    repo: { type: 'string', default: '' },
    report: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    'baseline-json': { type: 'string', default: '' },
    'actionable-unresolved-rate-max': { type: 'number', default: 0.6 },
    'min-unresolved-samples': { type: 'number', default: 1 },
    'parser-artifact-rate-warn-max': { type: 'number', default: 0.35 },
    'resolver-gap-rate-warn-max': { type: 'number', default: 0.35 },
    'parser-artifact-rate-drift-warn-max': { type: 'number', default: 0.08 },
    'resolver-gap-rate-drift-warn-max': { type: 'number', default: 0.08 }
  }
})
  .strictOptions()
  .parse();

const toResolvedPath = (value) => path.resolve(String(value || ''));

const toRatio = (numerator, denominator) => (
  denominator > 0 ? numerator / denominator : 0
);

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const loadBaselineMetrics = async (baselinePath) => {
  if (typeof baselinePath !== 'string' || !baselinePath.trim()) {
    return {
      path: null,
      metrics: null,
      generatedAt: null,
      loadError: null
    };
  }
  const resolvedPath = toResolvedPath(baselinePath);
  try {
    const payload = JSON.parse(await fs.readFile(resolvedPath, 'utf8'));
    return {
      path: resolvedPath,
      metrics: payload?.metrics && typeof payload.metrics === 'object' ? payload.metrics : null,
      generatedAt: typeof payload?.generatedAt === 'string' ? payload.generatedAt : null,
      loadError: null
    };
  } catch (error) {
    return {
      path: resolvedPath,
      metrics: null,
      generatedAt: null,
      loadError: error?.message || String(error)
    };
  }
};

const main = async () => {
  const argv = parseArgs();
  const { repoRoot } = resolveRepoConfig(argv.repo || null);
  const explicitReport = typeof argv.report === 'string' && argv.report.trim()
    ? toResolvedPath(argv.report)
    : '';
  const graphPaths = explicitReport
    ? [explicitReport]
    : await discoverImportResolutionGraphReports({
      rootDir: repoRoot,
      maxReports: DEFAULT_REPLAY_MAX_REPORTS
    });
  const actionableRateMax = coerceNumberAtLeast(argv['actionable-unresolved-rate-max'], 0) ?? 0.6;
  const minUnresolvedSamples = Math.max(0, Math.floor(coerceNumberAtLeast(argv['min-unresolved-samples'], 0) ?? 1));
  const parserArtifactRateWarnMax = coerceNumberAtLeast(argv['parser-artifact-rate-warn-max'], 0) ?? 0.35;
  const resolverGapRateWarnMax = coerceNumberAtLeast(argv['resolver-gap-rate-warn-max'], 0) ?? 0.35;
  const parserArtifactRateDriftWarnMax = coerceNumberAtLeast(argv['parser-artifact-rate-drift-warn-max'], 0) ?? 0.08;
  const resolverGapRateDriftWarnMax = coerceNumberAtLeast(argv['resolver-gap-rate-drift-warn-max'], 0) ?? 0.08;
  const baseline = await loadBaselineMetrics(argv['baseline-json']);

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

  const graphReports = await loadImportResolutionGraphReports(graphPaths);
  const {
    totals,
    reasonCodeCounts,
    actionableByRepo,
    actionableByLanguage,
    resolverStages,
    resolverPipelineStages,
    resolverBudgetPolicyProfiles,
    actionableHotspots,
    invalidReports
  } = aggregateImportResolutionGraphPayloads(graphReports, {
    excludedImporterSegments: DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS
  });

  const unresolved = totals.unresolved;
  const actionable = totals.actionable;
  const actionableRate = toRatio(actionable, unresolved);
  const parserArtifactRate = toRatio(totals.parserArtifact, unresolved);
  const resolverGapRate = toRatio(totals.resolverGap, unresolved);
  const resolverBudgetExhaustedRate = toRatio(totals.resolverBudgetExhausted, unresolved);
  const baselineActionableRate = Number(baseline.metrics?.actionableRate);
  const baselineParserArtifactRate = Number(baseline.metrics?.parserArtifactRate);
  const baselineResolverGapRate = Number(baseline.metrics?.resolverGapRate);
  const actionableRateDelta = Number.isFinite(baselineActionableRate)
    ? actionableRate - baselineActionableRate
    : null;
  const parserArtifactRateDelta = Number.isFinite(baselineParserArtifactRate)
    ? parserArtifactRate - baselineParserArtifactRate
    : null;
  const resolverGapRateDelta = Number.isFinite(baselineResolverGapRate)
    ? resolverGapRate - baselineResolverGapRate
    : null;

  const topReasonCode = Object.entries(reasonCodeCounts || {})
    .map(([reasonCode, count]) => ({ reasonCode, count: Math.floor(Number(count) || 0) }))
    .filter((entry) => entry.reasonCode && entry.count > 0)
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.reasonCode, b.reasonCode)
    ))[0] || null;
  const topHotspot = Array.isArray(actionableHotspots) && actionableHotspots.length > 0
    ? actionableHotspots[0]
    : null;
  const topRepoHotspot = Object.entries(actionableByRepo || {})
    .map(([repo, count]) => ({
      repo,
      count: Math.floor(Number(count) || 0)
    }))
    .filter((entry) => entry.repo && entry.count > 0)
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.repo, b.repo)
    ))[0] || null;
  const topLanguageHotspot = Object.entries(actionableByLanguage || {})
    .map(([language, count]) => ({
      language,
      count: Math.floor(Number(count) || 0)
    }))
    .filter((entry) => entry.language && entry.count > 0)
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.language, b.language)
    ))[0] || null;
  const stageHighlights = resolveResolverPipelineStageHighlights(resolverPipelineStages);
  const topStageByElapsed = stageHighlights.topByElapsed;
  const topStageByBudgetExhausted = stageHighlights.topByBudgetExhausted;
  const topStageByDegraded = stageHighlights.topByDegraded;
  const topBudgetProfile = Object.entries(resolverBudgetPolicyProfiles || {})
    .map(([profile, count]) => ({
      profile,
      count: Math.floor(Number(count) || 0)
    }))
    .filter((entry) => entry.profile && entry.count > 0)
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.profile, b.profile)
    ))[0] || null;

  const failures = [];
  const advisories = [];
  if (invalidReports.length > 0) {
    failures.push(`invalid graph payloads: ${invalidReports.length}`);
  }
  if (unresolved >= minUnresolvedSamples && actionableRate > actionableRateMax) {
    failures.push(
      `actionable unresolved rate ${actionableRate.toFixed(4)} exceeded max ${actionableRateMax.toFixed(4)} ` +
      `(actionable=${actionable}, unresolved=${unresolved})`
    );
  }
  if (unresolved >= minUnresolvedSamples && parserArtifactRate > parserArtifactRateWarnMax) {
    advisories.push(
      `parser artifact rate ${parserArtifactRate.toFixed(4)} exceeded advisory max ` +
      `${parserArtifactRateWarnMax.toFixed(4)} (parser_artifact=${totals.parserArtifact}, unresolved=${unresolved})`
    );
  }
  if (unresolved >= minUnresolvedSamples && resolverGapRate > resolverGapRateWarnMax) {
    advisories.push(
      `resolver gap rate ${resolverGapRate.toFixed(4)} exceeded advisory max ` +
      `${resolverGapRateWarnMax.toFixed(4)} (resolver_gap=${totals.resolverGap}, unresolved=${unresolved})`
    );
  }
  if (Number.isFinite(parserArtifactRateDelta) && parserArtifactRateDelta > parserArtifactRateDriftWarnMax) {
    advisories.push(
      `parser artifact rate drift ${parserArtifactRateDelta.toFixed(4)} exceeded advisory max ` +
      `${parserArtifactRateDriftWarnMax.toFixed(4)} (baseline=${baselineParserArtifactRate.toFixed(4)}, ` +
      `current=${parserArtifactRate.toFixed(4)})`
    );
  }
  if (Number.isFinite(resolverGapRateDelta) && resolverGapRateDelta > resolverGapRateDriftWarnMax) {
    advisories.push(
      `resolver gap rate drift ${resolverGapRateDelta.toFixed(4)} exceeded advisory max ` +
      `${resolverGapRateDriftWarnMax.toFixed(4)} (baseline=${baselineResolverGapRate.toFixed(4)}, ` +
      `current=${resolverGapRate.toFixed(4)})`
    );
  }
  if (baseline.path && baseline.loadError) {
    advisories.push(`baseline metrics unavailable (${baseline.path}): ${baseline.loadError}`);
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
      minUnresolvedSamples,
      parserArtifactRateWarnMax,
      resolverGapRateWarnMax,
      parserArtifactRateDriftWarnMax,
      resolverGapRateDriftWarnMax
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
      resolverGapRate,
      resolverBudgetExhausted: totals.resolverBudgetExhausted,
      resolverBudgetExhaustedRate,
      resolverBudgetAdaptiveReports: totals.resolverBudgetAdaptiveReports
    },
    drift: {
      baselineJsonPath: baseline.path,
      baselineGeneratedAt: baseline.generatedAt,
      actionableRateDelta,
      parserArtifactRateDelta,
      resolverGapRateDelta
    },
    reasonCodes: reasonCodeCounts,
    actionableByRepo,
    actionableByLanguage,
    resolverStages,
    resolverPipelineStages,
    resolverBudgetPolicyProfiles,
    stageHighlights,
    actionableHotspots,
    advisories,
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
      `- resolverGapRate: ${resolverGapRate.toFixed(4)}`,
      `- parserArtifactRateDelta: ${Number.isFinite(parserArtifactRateDelta) ? parserArtifactRateDelta.toFixed(4) : 'n/a'}`,
      `- resolverGapRateDelta: ${Number.isFinite(resolverGapRateDelta) ? resolverGapRateDelta.toFixed(4) : 'n/a'}`,
      `- resolverBudgetExhaustedRate: ${resolverBudgetExhaustedRate.toFixed(4)}`,
      `- resolverBudgetAdaptiveReports: ${totals.resolverBudgetAdaptiveReports}`,
      `- resolverBudgetProfiles: ${Object.keys(resolverBudgetPolicyProfiles || {}).length}`,
      `- resolverPipelineStages: ${Object.keys(resolverPipelineStages || {}).length}`,
      `- actionableHotspots: ${actionableHotspots.length}`,
      `- actionableRepoHotspots: ${Object.keys(actionableByRepo || {}).length}`,
      `- actionableLanguageHotspots: ${Object.keys(actionableByLanguage || {}).length}`,
      `- topHotspot: ${topHotspot ? `${topHotspot.importer}=${topHotspot.count}` : 'none'}`,
      `- topRepoHotspot: ${topRepoHotspot ? `${topRepoHotspot.repo}=${topRepoHotspot.count}` : 'none'}`,
      `- topLanguageHotspot: ${topLanguageHotspot ? `${topLanguageHotspot.language}=${topLanguageHotspot.count}` : 'none'}`,
      `- topReasonCode: ${topReasonCode ? `${topReasonCode.reasonCode}=${topReasonCode.count}` : 'none'}`,
      `- topResolverBudgetProfile: ${topBudgetProfile ? `${topBudgetProfile.profile}=${topBudgetProfile.count}` : 'none'}`,
      `- topResolverStageByElapsed: ${topStageByElapsed ? `${topStageByElapsed.stage}=${topStageByElapsed.elapsedMs.toFixed(3)}ms` : 'none'}`,
      `- topResolverStageByBudgetExhausted: ${topStageByBudgetExhausted ? `${topStageByBudgetExhausted.stage}=${topStageByBudgetExhausted.budgetExhausted}` : 'none'}`,
      `- topResolverStageByDegraded: ${topStageByDegraded ? `${topStageByDegraded.stage}=${topStageByDegraded.degraded}` : 'none'}`,
      `- advisories: ${advisories.length}`
    ],
    failures
  });
};

main().catch((error) => {
  console.error(`import resolution slo gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
