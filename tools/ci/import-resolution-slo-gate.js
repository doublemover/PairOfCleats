#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { coerceNumberAtLeast } from '../../src/shared/number-coerce.js';
import {
  aggregateImportResolutionGraphPayloads,
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS,
  DEFAULT_REPLAY_MAX_REPORTS,
  discoverImportResolutionGraphReports,
  loadImportResolutionGraphReports
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

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

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
  const topStageByElapsed = Object.entries(resolverPipelineStages || {})
    .map(([stage, entry]) => ({
      stage,
      elapsedMs: Number(entry?.elapsedMs) || 0
    }))
    .filter((entry) => entry.stage && entry.elapsedMs > 0)
    .sort((a, b) => (
      b.elapsedMs !== a.elapsedMs
        ? b.elapsedMs - a.elapsedMs
        : sortStrings(a.stage, b.stage)
    ))[0] || null;
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
      resolverGapRate,
      resolverBudgetExhausted: totals.resolverBudgetExhausted,
      resolverBudgetExhaustedRate,
      resolverBudgetAdaptiveReports: totals.resolverBudgetAdaptiveReports
    },
    reasonCodes: reasonCodeCounts,
    actionableByRepo,
    actionableByLanguage,
    resolverStages,
    resolverPipelineStages,
    resolverBudgetPolicyProfiles,
    actionableHotspots,
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
      `- topResolverStageByElapsed: ${topStageByElapsed ? `${topStageByElapsed.stage}=${topStageByElapsed.elapsedMs.toFixed(3)}ms` : 'none'}`
    ],
    failures
  });
};

main().catch((error) => {
  console.error(`import resolution slo gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
