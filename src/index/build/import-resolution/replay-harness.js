import fs from 'node:fs/promises';
import path from 'node:path';
import { enrichUnresolvedImportSamples } from '../imports.js';
import {
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS,
  filterGateEligibleImportWarnings
} from './gate-eligibility.js';
import {
  isActionableImportWarning,
  summarizeImportWarningDispositions
} from './disposition.js';
import { resolveLanguageLabelFromImporter, resolveRepoLabelFromReportPath } from './labels.js';
import { isKnownReasonCode, isKnownResolverStage } from './reason-codes.js';
import { summarizeResolverPipelineStageElapsedPercentiles } from './stage-pipeline-metrics.js';

export const DEFAULT_REPLAY_SCAN_ROOTS = Object.freeze(['.testCache', '.benchCache']);
export const DEFAULT_REPLAY_MAX_REPORTS = 256;

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const toNonNegativeIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
};

const toNonNegativeMs = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Number(numeric.toFixed(3));
};

const clampActionableCount = ({ unresolved, actionable }) => {
  const normalizedUnresolved = Math.max(0, Math.floor(Number(unresolved) || 0));
  const normalizedActionable = Math.max(0, Math.floor(Number(actionable) || 0));
  return {
    unresolved: normalizedUnresolved,
    actionable: Math.min(normalizedUnresolved, normalizedActionable)
  };
};

const bumpCount = (target, key, amount = 1) => {
  if (!key) return;
  const current = Number(target[key]) || 0;
  target[key] = current + Math.max(0, Math.floor(Number(amount) || 0));
};

const toSortedObject = (counts) => Object.fromEntries(
  Object.entries(counts || {})
    .filter(([key, value]) => key && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]))
    .map(([key, value]) => [key, Math.floor(Number(value))])
);

const toSortedHotspots = (counts, { maxEntries = 20 } = {}) => (
  Object.entries(counts || {})
    .filter(([importer, value]) => importer && Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([importer, value]) => ({
      importer,
      count: Math.floor(Number(value))
    }))
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.importer, b.importer)
    ))
    .slice(0, Math.max(0, Math.floor(Number(maxEntries) || 0)))
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

const toHotspotCounts = (value) => {
  if (!Array.isArray(value)) return null;
  const output = Object.create(null);
  for (const entry of value) {
    const importer = typeof entry?.importer === 'string' ? entry.importer.trim() : '';
    const count = toNonNegativeIntOrNull(entry?.count);
    if (!importer || count == null || count <= 0) continue;
    bumpCount(output, importer, count);
  }
  return output;
};

const toResolverStageCounts = (value) => {
  const counts = toCountMap(value);
  if (!counts) return null;
  const output = Object.create(null);
  for (const [stage, count] of Object.entries(counts)) {
    if (!isKnownResolverStage(stage)) continue;
    output[stage] = count;
  }
  return Object.keys(output).length > 0 ? output : null;
};

const toReasonCodeCounts = (value) => {
  const counts = toCountMap(value);
  if (!counts) return null;
  const output = Object.create(null);
  for (const [reasonCode, count] of Object.entries(counts)) {
    if (!isKnownReasonCode(reasonCode)) continue;
    output[reasonCode] = count;
  }
  return Object.keys(output).length > 0 ? output : null;
};

const toBudgetPolicy = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = typeof value.adaptiveProfile === 'string' && value.adaptiveProfile.trim()
    ? value.adaptiveProfile.trim()
    : 'normal';
  const adaptiveEnabled = value.adaptiveEnabled === true;
  return {
    adaptiveEnabled,
    adaptiveProfile: profile
  };
};

const toStagePipelineMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output = Object.create(null);
  for (const [stage, entry] of Object.entries(value)) {
    if (typeof stage !== 'string' || !stage) continue;
    if (!isKnownResolverStage(stage)) continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const attempts = toNonNegativeIntOrNull(entry.attempts) ?? 0;
    const hits = toNonNegativeIntOrNull(entry.hits) ?? 0;
    const misses = toNonNegativeIntOrNull(entry.misses) ?? 0;
    const elapsedMs = toNonNegativeMs(entry.elapsedMs) ?? 0;
    const budgetExhausted = toNonNegativeIntOrNull(entry.budgetExhausted) ?? 0;
    const degraded = toNonNegativeIntOrNull(entry.degraded) ?? 0;
    const reasonCodes = toReasonCodeCounts(entry.reasonCodes) || Object.create(null);
    output[stage] = { attempts, hits, misses, elapsedMs, budgetExhausted, degraded, reasonCodes };
  }
  return Object.keys(output).length > 0 ? output : null;
};

const mergeStagePipelineMaps = (target, source) => {
  if (!target || !source) return;
  for (const [stage, entry] of Object.entries(source)) {
    if (!target[stage]) {
      target[stage] = {
        attempts: 0,
        hits: 0,
        misses: 0,
        elapsedMs: 0,
        budgetExhausted: 0,
        degraded: 0,
        reasonCodes: Object.create(null)
      };
    }
    target[stage].attempts += Math.max(0, Number(entry?.attempts) || 0);
    target[stage].hits += Math.max(0, Number(entry?.hits) || 0);
    target[stage].misses += Math.max(0, Number(entry?.misses) || 0);
    target[stage].elapsedMs += Math.max(0, Number(entry?.elapsedMs) || 0);
    target[stage].budgetExhausted += Math.max(0, Number(entry?.budgetExhausted) || 0);
    target[stage].degraded += Math.max(0, Number(entry?.degraded) || 0);
    const reasonCodes = toReasonCodeCounts(entry?.reasonCodes) || Object.create(null);
    for (const [reasonCode, count] of Object.entries(reasonCodes)) {
      bumpCount(target[stage].reasonCodes, reasonCode, count);
    }
  }
};

const collectStageElapsedSamples = (target, source) => {
  if (!target || !source) return;
  for (const [stage, entry] of Object.entries(source)) {
    if (!isKnownResolverStage(stage)) continue;
    const elapsedMs = toNonNegativeMs(entry?.elapsedMs);
    if (elapsedMs == null) continue;
    if (!Array.isArray(target[stage])) target[stage] = [];
    target[stage].push(elapsedMs);
  }
};

const toSortedStagePipeline = (stages) => {
  const entries = Object.entries(stages || {})
    .filter(([stage, entry]) => stage && entry && typeof entry === 'object')
    .sort((a, b) => sortStrings(a[0], b[0]));
  const output = Object.create(null);
  for (const [stage, entry] of entries) {
    output[stage] = {
      attempts: Math.floor(Math.max(0, Number(entry?.attempts) || 0)),
      hits: Math.floor(Math.max(0, Number(entry?.hits) || 0)),
      misses: Math.floor(Math.max(0, Number(entry?.misses) || 0)),
      elapsedMs: Number(Math.max(0, Number(entry?.elapsedMs) || 0).toFixed(3)),
      budgetExhausted: Math.floor(Math.max(0, Number(entry?.budgetExhausted) || 0)),
      degraded: Math.floor(Math.max(0, Number(entry?.degraded) || 0)),
      reasonCodes: toSortedObject(toReasonCodeCounts(entry?.reasonCodes) || Object.create(null))
    };
  }
  return output;
};

const safeReadJson = async (targetPath, readFile) => {
  try {
    const raw = await readFile(targetPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const discoverImportResolutionGraphReports = async ({
  rootDir,
  maxReports = DEFAULT_REPLAY_MAX_REPORTS,
  scanRoots = DEFAULT_REPLAY_SCAN_ROOTS,
  readdir = fs.readdir
} = {}) => {
  const limit = Math.max(0, Math.floor(Number(maxReports) || 0));
  if (!rootDir || limit <= 0) return [];
  const roots = (Array.isArray(scanRoots) ? scanRoots : DEFAULT_REPLAY_SCAN_ROOTS)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => path.join(rootDir, entry));
  const discovered = [];
  for (const scanRoot of roots) {
    let dirEntries;
    try {
      dirEntries = await readdir(scanRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const stack = dirEntries.map((entry) => ({ dir: scanRoot, entry }));
    while (stack.length > 0 && discovered.length < limit) {
      const { dir, entry } = stack.pop();
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        let children = [];
        try {
          children = await readdir(fullPath, { withFileTypes: true });
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
  discovered.sort(sortStrings);
  return discovered;
};

export const loadImportResolutionGraphReports = async (
  reportPaths,
  { readFile = fs.readFile } = {}
) => {
  const reports = [];
  for (const reportPath of Array.isArray(reportPaths) ? reportPaths : []) {
    reports.push({
      reportPath,
      payload: await safeReadJson(reportPath, readFile)
    });
  }
  return reports;
};

const createAggregateState = () => ({
  totals: {
    reportCount: 0,
    observedUnresolved: 0,
    observedActionable: 0,
    unresolved: 0,
    actionable: 0,
    gateEligibleUnresolved: 0,
    gateEligibleActionable: 0,
    parserArtifact: 0,
    resolverGap: 0,
    resolverBudgetExhausted: 0,
    resolverBudgetAdaptiveReports: 0,
    actionableHotspotCounts: Object.create(null),
    actionableRepoCounts: Object.create(null),
    actionableLanguageCounts: Object.create(null),
    resolverStageCounts: Object.create(null),
    resolverPipelineStages: Object.create(null),
    resolverPipelineStageElapsedSamples: Object.create(null),
    resolverBudgetPolicyProfiles: Object.create(null)
  },
  reasonCodeCounts: Object.create(null),
  invalidReports: []
});

const accumulateGraphReport = (
  state,
  report,
  { excludedImporterSegments = DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS } = {}
) => {
  const reportPath = typeof report?.reportPath === 'string' ? report.reportPath : '<unknown>';
  const payload = report?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    state.invalidReports.push(reportPath);
    return;
  }
  const stats = payload?.stats && typeof payload.stats === 'object' ? payload.stats : {};
  const rawWarnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const warnings = enrichUnresolvedImportSamples(rawWarnings);

  const warningReasonCodes = Object.create(null);
  for (const warning of warnings) {
    if (typeof warning?.reasonCode !== 'string' || !warning.reasonCode) continue;
    bumpCount(warningReasonCodes, warning.reasonCode);
  }

  const eligibleWarnings = filterGateEligibleImportWarnings(warnings, { excludedImporterSegments });
  const eligibleUnresolved = eligibleWarnings.length;
  const {
    actionable: eligibleActionable,
    parserArtifact: eligibleParserArtifact,
    resolverGap: eligibleResolverGap
  } = summarizeImportWarningDispositions(eligibleWarnings);

  const statsUnresolved = toNonNegativeIntOrNull(stats.unresolved);
  const statsActionable = toNonNegativeIntOrNull(
    stats.unresolvedActionable
    ?? stats?.unresolvedByDisposition?.actionable
  );
  const statsGateEligibleUnresolved = toNonNegativeIntOrNull(
    stats.unresolvedGateEligible
    ?? stats.unresolvedEligible
  );
  const statsGateEligibleActionable = toNonNegativeIntOrNull(
    stats.unresolvedActionableGateEligible
    ?? stats.unresolvedGateEligibleActionable
    ?? stats.unresolvedActionableEligible
    ?? stats.unresolvedEligibleActionable
  );
  const hasStatsGateEligibleTotals = (
    statsGateEligibleUnresolved != null
    && statsGateEligibleActionable != null
  );
  const hasStatsGateTotals = statsUnresolved != null && statsActionable != null;
  const unresolvedRaw = hasStatsGateEligibleTotals
    ? statsGateEligibleUnresolved
    : (hasStatsGateTotals ? statsUnresolved : eligibleUnresolved);
  const actionableRaw = hasStatsGateEligibleTotals
    ? statsGateEligibleActionable
    : (hasStatsGateTotals ? statsActionable : eligibleActionable);
  const gateEligibleUnresolvedRaw = hasStatsGateEligibleTotals
    ? statsGateEligibleUnresolved
    : eligibleUnresolved;
  const gateEligibleActionableRaw = hasStatsGateEligibleTotals
    ? statsGateEligibleActionable
    : eligibleActionable;
  const { unresolved, actionable } = clampActionableCount({
    unresolved: unresolvedRaw,
    actionable: actionableRaw
  });
  const {
    unresolved: gateEligibleUnresolved,
    actionable: gateEligibleActionable
  } = clampActionableCount({
    unresolved: gateEligibleUnresolvedRaw,
    actionable: gateEligibleActionableRaw
  });

  const observedUnresolved = statsUnresolved ?? warnings.length;
  const statsObservedUnresolved = toNonNegativeIntOrNull(
    stats.unresolvedObserved
    ?? stats.unresolvedObservedTotal
  );
  const observedActionable = toNonNegativeIntOrNull(
    stats.unresolvedObservedActionable
    ?? stats.unresolvedObservedActionableTotal
  ) ?? statsActionable
    ?? warnings.filter((entry) => isActionableImportWarning(entry)).length;
  const effectiveObservedUnresolved = statsObservedUnresolved ?? observedUnresolved;

  const statsFailureCauseCounts = toCountMap(stats.unresolvedByFailureCause);
  const statsGateFailureCauseCounts = toCountMap(
    stats.unresolvedGateEligibleByFailureCause
    ?? stats.unresolvedByFailureCauseGateEligible
    ?? stats.unresolvedFailureCauseGateEligible
  );
  const parserArtifactSource = hasStatsGateEligibleTotals
    ? statsGateFailureCauseCounts
    : statsFailureCauseCounts;
  const parserArtifact = (
    toNonNegativeIntOrNull(parserArtifactSource?.parser_artifact)
    ?? eligibleParserArtifact
  );
  const resolverGapSource = hasStatsGateEligibleTotals
    ? statsGateFailureCauseCounts
    : statsFailureCauseCounts;
  const resolverGap = (
    toNonNegativeIntOrNull(resolverGapSource?.resolver_gap)
    ?? eligibleResolverGap
  );

  const statsReasonCodes = toCountMap(stats.unresolvedByReasonCode);
  const effectiveReasonCodes = statsReasonCodes || warningReasonCodes;
  const resolverBudgetExhausted = (
    toNonNegativeIntOrNull(stats.unresolvedBudgetExhausted)
    ?? toNonNegativeIntOrNull(effectiveReasonCodes?.IMP_U_RESOLVER_BUDGET_EXHAUSTED)
    ?? 0
  );

  const statsResolverStages = toResolverStageCounts(stats.unresolvedByResolverStage);
  const statsResolverPipelineStages = toStagePipelineMap(stats.resolverPipelineStages);
  const statsBudgetPolicy = toBudgetPolicy(stats.resolverBudgetPolicy);
  const statsActionableByLanguage = toCountMap(stats.unresolvedActionableByLanguage);

  const warningResolverStages = Object.create(null);
  for (const warning of warnings) {
    const stage = typeof warning?.resolverStage === 'string' ? warning.resolverStage.trim() : '';
    if (!isKnownResolverStage(stage)) continue;
    if (!stage) continue;
    bumpCount(warningResolverStages, stage);
  }
  const effectiveResolverStages = statsResolverStages || warningResolverStages;

  const statsHotspots = toHotspotCounts(stats.unresolvedActionableHotspots);
  const effectiveHotspotCounts = statsHotspots || Object.create(null);
  const repoLabel = resolveRepoLabelFromReportPath(reportPath);
  bumpCount(state.totals.actionableRepoCounts, repoLabel, actionable);
  if (statsActionableByLanguage) {
    for (const [language, count] of Object.entries(statsActionableByLanguage)) {
      bumpCount(state.totals.actionableLanguageCounts, language, count);
    }
  } else {
    for (const entry of eligibleWarnings) {
      if (!isActionableImportWarning(entry)) continue;
      const importer = typeof entry?.importer === 'string' ? entry.importer.trim() : '';
      if (!importer) continue;
      bumpCount(state.totals.actionableLanguageCounts, resolveLanguageLabelFromImporter(importer), 1);
    }
  }
  if (!statsHotspots) {
    for (const entry of eligibleWarnings) {
      if (!isActionableImportWarning(entry)) continue;
      const importer = typeof entry?.importer === 'string' ? entry.importer.trim() : '';
      if (!importer) continue;
      bumpCount(effectiveHotspotCounts, importer);
    }
  }

  state.totals.reportCount += 1;
  state.totals.observedUnresolved += effectiveObservedUnresolved;
  state.totals.observedActionable += observedActionable;
  state.totals.unresolved += unresolved;
  state.totals.actionable += actionable;
  state.totals.gateEligibleUnresolved += gateEligibleUnresolved;
  state.totals.gateEligibleActionable += gateEligibleActionable;
  state.totals.parserArtifact += parserArtifact;
  state.totals.resolverGap += resolverGap;
  state.totals.resolverBudgetExhausted += resolverBudgetExhausted;
  if (statsBudgetPolicy?.adaptiveEnabled === true) {
    state.totals.resolverBudgetAdaptiveReports += 1;
  }
  bumpCount(state.totals.resolverBudgetPolicyProfiles, statsBudgetPolicy?.adaptiveProfile || 'normal', 1);
  for (const [importer, count] of Object.entries(effectiveHotspotCounts)) {
    bumpCount(state.totals.actionableHotspotCounts, importer, count);
  }
  for (const [reasonCode, count] of Object.entries(effectiveReasonCodes)) {
    bumpCount(state.reasonCodeCounts, reasonCode, count);
  }
  for (const [resolverStage, count] of Object.entries(effectiveResolverStages)) {
    bumpCount(state.totals.resolverStageCounts, resolverStage, count);
  }
  mergeStagePipelineMaps(state.totals.resolverPipelineStages, statsResolverPipelineStages);
  collectStageElapsedSamples(state.totals.resolverPipelineStageElapsedSamples, statsResolverPipelineStages);
};

const finalizeAggregateState = (state) => ({
  totals: state.totals,
  reasonCodeCounts: toSortedObject(state.reasonCodeCounts),
  actionableByRepo: toSortedObject(state.totals.actionableRepoCounts),
  actionableByLanguage: toSortedObject(state.totals.actionableLanguageCounts),
  resolverStages: toSortedObject(state.totals.resolverStageCounts),
  resolverPipelineStages: toSortedStagePipeline(state.totals.resolverPipelineStages),
  resolverPipelineStagePercentiles: summarizeResolverPipelineStageElapsedPercentiles(
    state.totals.resolverPipelineStageElapsedSamples
  ),
  resolverBudgetPolicyProfiles: toSortedObject(state.totals.resolverBudgetPolicyProfiles),
  actionableHotspots: toSortedHotspots(state.totals.actionableHotspotCounts),
  invalidReports: state.invalidReports
});

export const aggregateImportResolutionGraphReportPaths = async (
  reportPaths,
  {
    excludedImporterSegments = DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS,
    readFile = fs.readFile
  } = {}
) => {
  const state = createAggregateState();
  for (const reportPath of Array.isArray(reportPaths) ? reportPaths : []) {
    const payload = await safeReadJson(reportPath, readFile);
    accumulateGraphReport(state, { reportPath, payload }, { excludedImporterSegments });
  }
  return finalizeAggregateState(state);
};

/**
 * Replay and aggregate unresolved-import diagnostics from import resolution graph payloads.
 *
 * @param {Array<{reportPath?:string,payload?:object|null}>} graphReports
 * @param {{excludedImporterSegments?:string[]}} [options]
 * @returns {{
 *   totals: object,
 *   reasonCodeCounts: object,
 *   resolverStages: object,
 *   resolverPipelineStages: object,
 *   resolverPipelineStagePercentiles: object,
 *   resolverBudgetPolicyProfiles: object,
 *   actionableHotspots: Array<{importer:string,count:number}>,
 *   invalidReports: string[]
 * }}
 */
export const aggregateImportResolutionGraphPayloads = (
  graphReports,
  { excludedImporterSegments = DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS } = {}
) => {
  const state = createAggregateState();
  for (const report of Array.isArray(graphReports) ? graphReports : []) {
    accumulateGraphReport(state, report, { excludedImporterSegments });
  }
  return finalizeAggregateState(state);
};
