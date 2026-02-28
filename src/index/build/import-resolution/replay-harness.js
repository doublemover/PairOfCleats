import fs from 'node:fs/promises';
import path from 'node:path';
import { enrichUnresolvedImportSamples } from '../imports.js';
import { resolveLanguageLabelFromImporter, resolveRepoLabelFromReportPath } from './labels.js';

export const DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS = Object.freeze([
  '/test/',
  '/tests/',
  '/__tests__/',
  '/fixture/',
  '/fixtures/',
  '/__fixtures__/',
  '/spec/',
  '/specs/'
]);
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
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const attempts = toNonNegativeIntOrNull(entry.attempts) ?? 0;
    const hits = toNonNegativeIntOrNull(entry.hits) ?? 0;
    const misses = toNonNegativeIntOrNull(entry.misses) ?? 0;
    const elapsedMs = toNonNegativeMs(entry.elapsedMs) ?? 0;
    const budgetExhausted = toNonNegativeIntOrNull(entry.budgetExhausted) ?? 0;
    const degraded = toNonNegativeIntOrNull(entry.degraded) ?? 0;
    output[stage] = { attempts, hits, misses, elapsedMs, budgetExhausted, degraded };
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
        degraded: 0
      };
    }
    target[stage].attempts += Math.max(0, Number(entry?.attempts) || 0);
    target[stage].hits += Math.max(0, Number(entry?.hits) || 0);
    target[stage].misses += Math.max(0, Number(entry?.misses) || 0);
    target[stage].elapsedMs += Math.max(0, Number(entry?.elapsedMs) || 0);
    target[stage].budgetExhausted += Math.max(0, Number(entry?.budgetExhausted) || 0);
    target[stage].degraded += Math.max(0, Number(entry?.degraded) || 0);
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
      degraded: Math.floor(Math.max(0, Number(entry?.degraded) || 0))
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

const normalizeExcludedImporterSegment = (segment) => {
  const normalized = String(segment || '').trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized) return '';
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

const normalizeImporterForSegmentChecks = (importer) => {
  const normalized = String(importer || '').trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized) return '';
  const trimmedLeading = normalized.replace(/^\/+/, '');
  const trimmed = trimmedLeading.replace(/\/+$/, '');
  return trimmed ? `/${trimmed}/` : '/';
};

const isGateEligibleWarning = (entry, normalizedExcludedImporterSegments) => {
  const importer = normalizeImporterForSegmentChecks(entry?.importer);
  if (!importer) return true;
  return !normalizedExcludedImporterSegments.some((segment) => importer.includes(segment));
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
 *   resolverBudgetPolicyProfiles: object,
 *   actionableHotspots: Array<{importer:string,count:number}>,
 *   invalidReports: string[]
 * }}
 */
export const aggregateImportResolutionGraphPayloads = (
  graphReports,
  { excludedImporterSegments = DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS } = {}
) => {
  const normalizedExcludedImporterSegments = Array.isArray(excludedImporterSegments)
    ? excludedImporterSegments
      .map((segment) => normalizeExcludedImporterSegment(segment))
      .filter(Boolean)
    : [];
  const totals = {
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
    resolverBudgetPolicyProfiles: Object.create(null)
  };
  const reasonCodeCounts = Object.create(null);
  const invalidReports = [];

  for (const report of Array.isArray(graphReports) ? graphReports : []) {
    const reportPath = typeof report?.reportPath === 'string' ? report.reportPath : '<unknown>';
    const payload = report?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      invalidReports.push(reportPath);
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

    const eligibleWarnings = warnings.filter((entry) => (
      isGateEligibleWarning(entry, normalizedExcludedImporterSegments)
    ));
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
    const resolverBudgetExhausted = (
      toNonNegativeIntOrNull(stats.unresolvedBudgetExhausted)
      ?? toNonNegativeIntOrNull(effectiveReasonCodes?.IMP_U_RESOLVER_BUDGET_EXHAUSTED)
      ?? 0
    );

    const statsResolverStages = toCountMap(stats.unresolvedByResolverStage);
    const statsResolverPipelineStages = toStagePipelineMap(stats.resolverPipelineStages);
    const statsBudgetPolicy = toBudgetPolicy(stats.resolverBudgetPolicy);
    const statsActionableByLanguage = toCountMap(stats.unresolvedActionableByLanguage);

    const warningResolverStages = Object.create(null);
    for (const warning of warnings) {
      const stage = typeof warning?.resolverStage === 'string' ? warning.resolverStage.trim() : '';
      if (!stage) continue;
      bumpCount(warningResolverStages, stage);
    }
    const effectiveResolverStages = statsResolverStages || warningResolverStages;

    const statsHotspots = toHotspotCounts(stats.unresolvedActionableHotspots);
    const effectiveHotspotCounts = statsHotspots || Object.create(null);
    const repoLabel = resolveRepoLabelFromReportPath(reportPath);
    bumpCount(totals.actionableRepoCounts, repoLabel, actionable);
    if (statsActionableByLanguage) {
      for (const [language, count] of Object.entries(statsActionableByLanguage)) {
        bumpCount(totals.actionableLanguageCounts, language, count);
      }
    } else {
      for (const entry of eligibleWarnings) {
        if (entry?.disposition !== 'actionable') continue;
        const importer = typeof entry?.importer === 'string' ? entry.importer.trim() : '';
        if (!importer) continue;
        bumpCount(totals.actionableLanguageCounts, resolveLanguageLabelFromImporter(importer), 1);
      }
    }
    if (!statsHotspots) {
      for (const entry of eligibleWarnings) {
        if (entry?.disposition !== 'actionable') continue;
        const importer = typeof entry?.importer === 'string' ? entry.importer.trim() : '';
        if (!importer) continue;
        bumpCount(effectiveHotspotCounts, importer);
      }
    }

    totals.reportCount += 1;
    totals.observedUnresolved += observedUnresolved;
    totals.observedActionable += observedActionable;
    totals.unresolved += unresolved;
    totals.actionable += actionable;
    totals.gateEligibleUnresolved += eligibleUnresolved;
    totals.gateEligibleActionable += eligibleActionable;
    totals.parserArtifact += parserArtifact;
    totals.resolverGap += resolverGap;
    totals.resolverBudgetExhausted += resolverBudgetExhausted;
    if (statsBudgetPolicy?.adaptiveEnabled === true) {
      totals.resolverBudgetAdaptiveReports += 1;
    }
    bumpCount(totals.resolverBudgetPolicyProfiles, statsBudgetPolicy?.adaptiveProfile || 'normal', 1);
    for (const [importer, count] of Object.entries(effectiveHotspotCounts)) {
      bumpCount(totals.actionableHotspotCounts, importer, count);
    }
    for (const [reasonCode, count] of Object.entries(effectiveReasonCodes)) {
      bumpCount(reasonCodeCounts, reasonCode, count);
    }
    for (const [resolverStage, count] of Object.entries(effectiveResolverStages)) {
      bumpCount(totals.resolverStageCounts, resolverStage, count);
    }
    mergeStagePipelineMaps(totals.resolverPipelineStages, statsResolverPipelineStages);
  }

  return {
    totals,
    reasonCodeCounts: toSortedObject(reasonCodeCounts),
    actionableByRepo: toSortedObject(totals.actionableRepoCounts),
    actionableByLanguage: toSortedObject(totals.actionableLanguageCounts),
    resolverStages: toSortedObject(totals.resolverStageCounts),
    resolverPipelineStages: toSortedStagePipeline(totals.resolverPipelineStages),
    resolverBudgetPolicyProfiles: toSortedObject(totals.resolverBudgetPolicyProfiles),
    actionableHotspots: toSortedHotspots(totals.actionableHotspotCounts),
    invalidReports
  };
};
