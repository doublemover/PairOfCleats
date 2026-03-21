#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { color } from '../../src/retrieval/cli/ansi.js';
import {
  THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
  THROUGHPUT_LEDGER_SCHEMA_VERSION
} from '../bench/language/metrics.js';
import {
  THROUGHPUT_GROUPS,
  MODE_THROUGHPUT_TOTALS,
  createRateTotals,
  createModeTotalsMap,
  mergeTotals,
  mergeModeTotalsFromFeatureMetrics,
  mergeModeTotalsFromIndexingSummary,
  collectLanguageLines,
  collectLanguageLinesFromSummary,
  isValidIndexingSummary,
  rateFromTotals,
  sumRates,
  collect,
  summarizeNumericDistribution,
  summarizeThroughputDistribution
} from './show-throughput/aggregate.js';
import {
  listResultFolders,
  loadJson,
  loadFeatureMetricsForPayload
} from './show-throughput/load.js';
import {
  resolveShowThroughputOptions,
  validateResultsRoot
} from './show-throughput/options.js';
import {
  createAstGraphTotals,
  createAstGraphObserved,
  mergeAstGraphTotals,
  mergeAstGraphObserved,
  hasAstGraphValues,
  resolveIndexingSummary,
  resolveBenchAnalysis,
  resolveRepoIdentity,
  resolveRepoHistoryKey,
  resolveThroughputLedger,
  applyRunThroughputLedgerDiffs,
  collectRunLedgerRegressions
} from './show-throughput/analysis.js';
import {
  formatNumber,
  formatCount,
  formatMs,
  formatBytes,
  formatBytesPerSec,
  formatPct,
  buildIndexedTotalsRows,
  formatThroughputTotalsCell,
  formatAstField,
  printTextTable
} from './show-throughput/render.js';

/**
 * Aggregate benchmark throughput JSON results into folder-level and global
 * throughput/latency/indexing summaries for quick regression triage.
 */

/**
 * @typedef {object} ThroughputRunRecord
 * @property {string} file
 * @property {object|null} summary
 * @property {object} throughput
 * @property {object|null} analysis
 * @property {object|null} indexingSummary
 * @property {object|null} throughputLedger
 * @property {string} repoIdentity
 * @property {string} repoHistoryKey
 * @property {number|null} generatedAtMs
 */

/**
 * @typedef {object} AstGraphAggregate
 * @property {number} repos
 * @property {object} totals
 * @property {object} observed
 */

const {
  resultsRoot,
  compareRoot,
  refreshJson,
  deepAnalysis,
  verboseOutput,
  includeUsrGuardrails,
  folderFilter,
  repoFilter,
  modeFilter,
  latestCount,
  sortMetric,
  topN,
  profile,
  jsonOutput,
  csvOutput
} = resolveShowThroughputOptions({
  argv: process.argv,
  cwd: process.cwd()
});

if (!validateResultsRoot(resultsRoot)) {
  console.error(`No benchmark results found at ${resultsRoot}`);
  process.exit(1);
}

if (refreshJson) {
  console.error('`show-throughput` is now read-only.');
  console.error('Use `node tools/reports/materialize-throughput.js` to backfill legacy benchmark JSON.');
  process.exit(2);
}

const folderNameFilter = String(folderFilter || '').trim().toLowerCase();
const folders = listResultFolders(resultsRoot, { includeUsrGuardrails })
  .filter((dir) => (
    !folderNameFilter || String(dir.name || '').toLowerCase().includes(folderNameFilter)
  ));
if (!folders.length) {
  console.error('No benchmark results folders found.');
  process.exit(0);
}

/**
 * Cross-run throughput totals grouped by modality; each bucket stores raw
 * numerator/denominator values so final rates are weighted by elapsed time.
 */
const totalThroughput = {
  code: createRateTotals(),
  prose: createRateTotals(),
  extractedProse: createRateTotals(),
  records: createRateTotals(),
  lmdb: {
    code: createRateTotals(),
    prose: createRateTotals()
  }
};
const throughputRunsGlobal = [];
const summariesGlobal = [];
const folderReports = [];
/** @type {Map<string, number>} */
const languageTotals = new Map();
const modeTotalsGlobal = createModeTotalsMap();
const reposWithMetrics = new Set();
/** @type {AstGraphAggregate} */
const astGraphTotalsGlobal = { repos: 0, totals: createAstGraphTotals(), observed: createAstGraphObserved() };
const ledgerRegressionsGlobal = [];
const variabilityRowsGlobal = [];
const createSectionProvenanceTotals = () => ({
  indexing: new Map(),
  analysis: new Map(),
  throughputLedger: new Map()
});
const provenanceTotalsGlobal = createSectionProvenanceTotals();

const recordSectionProvenance = (totals, section, provenance) => {
  const key = provenance?.source || 'missing';
  const bucket = totals?.[section];
  if (!(bucket instanceof Map)) return;
  bucket.set(key, (bucket.get(key) || 0) + 1);
};

const formatSectionProvenance = (totals, section) => {
  const bucket = totals?.[section];
  if (!(bucket instanceof Map) || !bucket.size) return 'none';
  return Array.from(bucket.entries())
    .sort((left, right) => Number(right[1]) - Number(left[1]) || String(left[0]).localeCompare(String(right[0])))
    .map(([source, count]) => `${source} ${count}`)
    .join(' | ');
};

const createRssAggregate = () => ({
  count: 0,
  meanSum: 0,
  maxP95: 0
});

const createOutcomeAggregate = () => ({
  coverage: { candidates: 0, scanned: 0, skipped: 0 },
  skipReasons: new Map(),
  confidence: new Map(),
  diagnostics: new Map(),
  cache: { hits: 0, misses: 0 },
  lowYield: { triggered: 0, skippedFiles: 0 },
  filterIndexReused: 0,
  queueDelay: { count: 0, totalMs: 0, maxMs: 0 },
  artifactWrite: { bytes: 0, writeMs: 0, totalMs: 0 },
  rss: {
    memory: createRssAggregate(),
    sqlite: createRssAggregate()
  }
});

const createOutcomeRollup = () => ({
  runs: createOutcomeAggregate(),
  repos: createOutcomeAggregate()
});
const outcomeTotalsGlobal = createOutcomeRollup();
const outcomeRepoKeysGlobal = new Set();
const riskScanTotalsGlobal = createRiskScanAggregate();
const shouldRenderTextOverview = profile === 'overview' && !jsonOutput && !csvOutput;

const incrementCountMap = (map, key, amount = 1) => {
  if (!(map instanceof Map)) return;
  const label = key || 'unknown';
  map.set(label, (map.get(label) || 0) + amount);
};

const addRssStats = (aggregate, stats) => {
  const meanValue = Number(stats?.mean);
  const p95Value = Number(stats?.p95);
  if (Number.isFinite(meanValue) && meanValue > 0) {
    aggregate.count += 1;
    aggregate.meanSum += meanValue;
  }
  if (Number.isFinite(p95Value) && p95Value > aggregate.maxP95) {
    aggregate.maxP95 = p95Value;
  }
};

const resolveCoverageConfidence = ({ scanProfile, indexingProvenance }) => {
  if (indexingProvenance?.category === 'fallback') return 'fallback-driven';
  const extracted = scanProfile?.modes?.['extracted-prose'];
  if (extracted?.quality?.lowYieldBailout?.triggered) return 'partial';
  if (scanProfile) return 'native';
  return 'missing';
};

const addOutcomeAggregate = (aggregate, {
  scanProfile,
  summary,
  indexingProvenance,
  diagnostics
}) => {
  incrementCountMap(aggregate.confidence, resolveCoverageConfidence({ scanProfile, indexingProvenance }));
  const diagnosticCounts = diagnostics?.process?.countsByType || diagnostics?.countsByType || {};
  for (const [type, countValue] of Object.entries(diagnosticCounts)) {
    const count = Number(countValue);
    if (!Number.isFinite(count) || count <= 0) continue;
    incrementCountMap(aggregate.diagnostics, type, count);
  }
  if (scanProfile && typeof scanProfile === 'object') {
    for (const modeProfile of Object.values(scanProfile.modes || {})) {
      const candidates = Number(modeProfile?.files?.candidates);
      const scanned = Number(modeProfile?.files?.scanned);
      const skipped = Number(modeProfile?.files?.skipped);
      if (Number.isFinite(candidates)) aggregate.coverage.candidates += candidates;
      if (Number.isFinite(scanned)) aggregate.coverage.scanned += scanned;
      if (Number.isFinite(skipped)) aggregate.coverage.skipped += skipped;

      for (const [reason, countValue] of Object.entries(modeProfile?.files?.skippedByReason || {})) {
        const count = Number(countValue);
        if (!Number.isFinite(count) || count <= 0) continue;
        incrementCountMap(aggregate.skipReasons, reason, count);
      }

      const cacheHits = Number(modeProfile?.cache?.hits);
      const cacheMisses = Number(modeProfile?.cache?.misses);
      if (Number.isFinite(cacheHits)) aggregate.cache.hits += cacheHits;
      if (Number.isFinite(cacheMisses)) aggregate.cache.misses += cacheMisses;

      const lowYield = modeProfile?.quality?.lowYieldBailout || null;
      if (lowYield?.triggered) {
        aggregate.lowYield.triggered += 1;
        const skippedFiles = Number(lowYield?.skippedFiles);
        if (Number.isFinite(skippedFiles)) aggregate.lowYield.skippedFiles += skippedFiles;
      }

      if (modeProfile?.artifacts?.filterIndex?.reused === true) {
        aggregate.filterIndexReused += 1;
      }

      const queueSummary = modeProfile?.timings?.watchdog?.queueDelayMs?.summary;
      const queueCount = Number(queueSummary?.count);
      const queueTotalMs = Number(queueSummary?.totalMs);
      const queueMaxMs = Number(queueSummary?.maxMs);
      if (Number.isFinite(queueCount) && queueCount > 0) aggregate.queueDelay.count += queueCount;
      if (Number.isFinite(queueTotalMs) && queueTotalMs > 0) aggregate.queueDelay.totalMs += queueTotalMs;
      if (Number.isFinite(queueMaxMs) && queueMaxMs > aggregate.queueDelay.maxMs) {
        aggregate.queueDelay.maxMs = queueMaxMs;
      }

      const artifactBytes = Number(modeProfile?.bytes?.artifact);
      const writeMs = Number(modeProfile?.throughput?.writeMs);
      const totalMs = Number(modeProfile?.throughput?.totalMs);
      if (Number.isFinite(artifactBytes) && artifactBytes > 0) aggregate.artifactWrite.bytes += artifactBytes;
      if (Number.isFinite(writeMs) && writeMs > 0) aggregate.artifactWrite.writeMs += writeMs;
      if (Number.isFinite(totalMs) && totalMs > 0) aggregate.artifactWrite.totalMs += totalMs;
    }
  }

  addRssStats(aggregate.rss.memory, summary?.memoryRss?.memory);
  addRssStats(aggregate.rss.sqlite, summary?.memoryRss?.sqlite);
};

const formatCountMapSummary = (map, limit = 4) => {
  if (!(map instanceof Map) || !map.size) return 'none';
  return Array.from(map.entries())
    .sort((left, right) => Number(right[1]) - Number(left[1]) || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([label, count]) => `${label} ${formatCount(count)}`)
    .join(' | ');
};

const formatCoverageSummary = (aggregate) => (
  `cand ${formatCount(aggregate.coverage.candidates)} | ` +
  `scanned ${formatCount(aggregate.coverage.scanned)} | ` +
  `skipped ${formatCount(aggregate.coverage.skipped)}`
);

const formatCacheSummary = (aggregate) => {
  const attempts = aggregate.cache.hits + aggregate.cache.misses;
  const hitRate = attempts > 0 ? aggregate.cache.hits / attempts : null;
  return (
    `hits ${formatCount(aggregate.cache.hits)} | ` +
    `misses ${formatCount(aggregate.cache.misses)} | ` +
    `hit ${formatPct(hitRate)}`
  );
};

const formatResourceSummary = (aggregate) => {
  const avgQueueDelayMs = aggregate.queueDelay.count > 0
    ? (aggregate.queueDelay.totalMs / aggregate.queueDelay.count)
    : null;
  const avgMemoryRss = aggregate.rss.memory.count > 0
    ? (aggregate.rss.memory.meanSum / aggregate.rss.memory.count)
    : null;
  const avgSqliteRss = aggregate.rss.sqlite.count > 0
    ? (aggregate.rss.sqlite.meanSum / aggregate.rss.sqlite.count)
    : null;
  const writeShare = aggregate.artifactWrite.totalMs > 0
    ? (aggregate.artifactWrite.writeMs / aggregate.artifactWrite.totalMs)
    : null;
  return (
    `rss mem/sql ${formatBytes(avgMemoryRss)}/${formatBytes(avgSqliteRss)} | ` +
    `queue avg/max ${formatMs(avgQueueDelayMs)}/${formatMs(aggregate.queueDelay.maxMs)} | ` +
    `write ${formatBytes(aggregate.artifactWrite.bytes)} @ ${formatPct(writeShare)}`
  );
};

const formatDistributionPair = (summary, formatter = (value) => formatNumber(value)) => (
  !summary || !Number.isFinite(summary.count) || summary.count <= 0
    ? 'n/a'
    : `${formatter(summary.median)}/${formatter(summary.p95)}`
);

const formatDistributionValue = (summary, key, formatter = (value) => formatNumber(value)) => (
  !summary || !Number.isFinite(summary.count) || summary.count <= 0 || !Number.isFinite(summary?.[key])
    ? 'n/a'
    : formatter(summary[key])
);

const formatDistributionMinMax = (summary, formatter = (value) => formatNumber(value)) => (
  !summary || !Number.isFinite(summary.count) || summary.count <= 0
    ? 'n/a'
    : `${formatter(summary.min)}/${formatter(summary.max)}`
);

const buildDistributionStatsRow = ({
  category = '',
  metric,
  summary,
  formatter = (value) => formatNumber(value)
}) => ({
  category,
  metric,
  count: Number.isFinite(summary?.count) && summary.count > 0 ? formatCount(summary.count) : 'n/a',
  p50: formatDistributionValue(summary, 'median', formatter),
  p95: formatDistributionValue(summary, 'p95', formatter),
  p99: formatDistributionValue(summary, 'p99', formatter),
  minMax: formatDistributionMinMax(summary, formatter),
  cv: Number.isFinite(summary?.count) && summary.count > 0 ? formatPct(summary.coefficientOfVariation) : 'n/a'
});

const printNamedSection = (title) => {
  console.log(`  ${color.bold(title)}`);
};

function createRiskScanAggregate() {
  return {
    observedRuns: 0,
    summaryOnlyRuns: 0,
    statuses: new Map(),
    caps: new Map(),
    summariesEmitted: 0,
    flowsEmitted: 0,
    partialFlowsEmitted: 0,
    uniqueCallSitesReferenced: 0
  };
}

const resolveRiskScanSummary = (analysis) => {
  const buildRoot = typeof analysis?.buildRoot === 'string' ? analysis.buildRoot : null;
  if (!buildRoot) return null;
  const riskStatsPath = path.join(buildRoot, 'index-code', 'risk_interprocedural_stats.json');
  const payload = loadJson(riskStatsPath);
  const stats = payload?.fields && typeof payload.fields === 'object' ? payload.fields : payload;
  if (!stats || typeof stats !== 'object') return null;
  return {
    status: typeof stats?.status === 'string' && stats.status.trim() ? stats.status.trim() : 'unknown',
    summaryOnly: stats?.effectiveConfig?.summaryOnly === true,
    summariesEmitted: Number.isFinite(stats?.counts?.summariesEmitted) ? Number(stats.counts.summariesEmitted) : 0,
    flowsEmitted: Number.isFinite(stats?.counts?.flowsEmitted) ? Number(stats.counts.flowsEmitted) : 0,
    partialFlowsEmitted: Number.isFinite(stats?.counts?.partialFlowsEmitted) ? Number(stats.counts.partialFlowsEmitted) : 0,
    uniqueCallSitesReferenced: Number.isFinite(stats?.counts?.uniqueCallSitesReferenced)
      ? Number(stats.counts.uniqueCallSitesReferenced)
      : 0,
    capsHit: Array.isArray(stats?.capsHit) ? stats.capsHit.filter(Boolean) : []
  };
};

const addRiskScanAggregate = (aggregate, riskScanSummary) => {
  if (!aggregate || !riskScanSummary) return;
  aggregate.observedRuns += 1;
  if (riskScanSummary.summaryOnly) aggregate.summaryOnlyRuns += 1;
  incrementCountMap(aggregate.statuses, riskScanSummary.status);
  aggregate.summariesEmitted += Number(riskScanSummary.summariesEmitted) || 0;
  aggregate.flowsEmitted += Number(riskScanSummary.flowsEmitted) || 0;
  aggregate.partialFlowsEmitted += Number(riskScanSummary.partialFlowsEmitted) || 0;
  aggregate.uniqueCallSitesReferenced += Number(riskScanSummary.uniqueCallSitesReferenced) || 0;
  for (const cap of riskScanSummary.capsHit) {
    incrementCountMap(aggregate.caps, cap);
  }
};

const buildAstDerivedRows = ({ astGraphAggregate, indexedFiles }) => {
  const symbols = Number(astGraphAggregate?.totals?.symbols) || 0;
  const functions = Number(astGraphAggregate?.totals?.functions) || 0;
  const imports = Number(astGraphAggregate?.totals?.imports) || 0;
  const graphLinks = Number(astGraphAggregate?.totals?.graphLinks) || 0;
  const fileLinks = Number(astGraphAggregate?.totals?.fileLinks) || 0;
  const files = Number(indexedFiles) || 0;
  return [
    {
      metric: 'Symbols / file',
      value: files > 0 && symbols > 0 ? formatNumber(symbols / files, 1) : 'n/a'
    },
    {
      metric: 'Functions / symbol',
      value: symbols > 0 && functions > 0 ? formatPct(functions / symbols) : 'n/a'
    },
    {
      metric: 'Imports / file',
      value: files > 0 && imports > 0 ? formatNumber(imports / files, 1) : 'n/a'
    },
    {
      metric: 'Graph links / symbol',
      value: symbols > 0 && graphLinks > 0 ? formatNumber(graphLinks / symbols, 2) : 'n/a'
    },
    {
      metric: 'Graph links / file link',
      value: fileLinks > 0 && graphLinks > 0 ? formatNumber(graphLinks / fileLinks, 2) : 'n/a'
    }
  ];
};

const summarizeSummaryMetric = (summaries, selector) => summarizeNumericDistribution(collect(summaries, selector));

const summarizeLatencyDistributions = (summaries) => {
  const latencyByBackend = {};
  for (const summary of summaries) {
    const latency = summary?.latencyMs || {};
    for (const [backend, stats] of Object.entries(latency)) {
      if (!latencyByBackend[backend]) latencyByBackend[backend] = { mean: [], p95: [] };
      if (Number.isFinite(stats?.mean)) latencyByBackend[backend].mean.push(stats.mean);
      if (Number.isFinite(stats?.p95)) latencyByBackend[backend].p95.push(stats.p95);
    }
  }
  return Object.fromEntries(
    Object.entries(latencyByBackend).map(([backend, values]) => [
      backend,
      {
        mean: summarizeNumericDistribution(values.mean),
        p95: summarizeNumericDistribution(values.p95)
      }
    ])
  );
};

const flattenRegressionMetrics = (entries, {
  includeImprovements = false
} = {}) => {
  const rows = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const metricSummaries = entry?.throughputLedgerDiff?.metrics || {};
    for (const [metricKey, summary] of Object.entries(metricSummaries)) {
      const regressions = includeImprovements
        ? (summary?.improvements || [])
        : (summary?.regressions || []);
      for (const regression of regressions) {
        rows.push({
          folder: entry.folder || null,
          repoIdentity: entry.repoIdentity,
          metric: metricKey,
          metricKind: regression.metricKind,
          metricLabel: regression.metricLabel,
          modality: regression.modality,
          stage: regression.stage,
          deltaPct: regression.deltaPct,
          deltaRate: regression.deltaRate,
          currentRate: regression.currentRate,
          baselineRate: regression.baselineRate,
          baselineSamples: regression.baselineSamples,
          baselineConfidence: regression.baselineConfidence
        });
      }
    }
  }
  rows.sort((left, right) => (
    left.metricKind === 'duration'
      ? (Number(right.deltaPct) - Number(left.deltaPct))
      : (Number(left.deltaPct) - Number(right.deltaPct))
  ) || String(left.repoIdentity || '').localeCompare(String(right.repoIdentity || '')));
  return rows;
};

const formatRegressionDelta = (entry) => (
  entry?.metricKind === 'duration'
    ? `${formatMs(entry.currentRate)} vs ${formatMs(entry.baselineRate)}`
    : `${formatNumber(entry.currentRate)} vs ${formatNumber(entry.baselineRate)} ${entry.metricLabel}`
);

const createVariabilityEntry = (folder, label, summary) => ({
  folder,
  label,
  count: summary?.count ?? 0,
  coefficientOfVariation: summary?.coefficientOfVariation ?? null,
  median: summary?.median ?? null,
  p95: summary?.p95 ?? null
});

const normalizeTextKey = (value) => String(value || '').trim().toLowerCase();

const matchesRepoFilter = (run, repoFilterValue) => {
  const filter = normalizeTextKey(repoFilterValue);
  if (!filter) return true;
  const candidates = [
    run?.repoIdentity,
    run?.repoHistoryKey,
    run?.file
  ]
    .map((value) => normalizeTextKey(value))
    .filter(Boolean);
  return candidates.some((candidate) => candidate.includes(filter));
};

const pickModeDistribution = (report, modeKey) => {
  const distributions = {
    code: report?.codeDistribution,
    prose: report?.proseDistribution,
    'extracted-prose': report?.extractedProseDistribution,
    records: report?.recordsDistribution
  };
  return modeKey ? distributions[modeKey] || null : null;
};

const getSortValue = (row, metric) => {
  switch (metric) {
    case 'name':
      return String(row?.label || row?.folder || row?.repoIdentity || '');
    case 'chunks':
      return Number(row?.chunksMedian ?? row?.chunkMedian ?? row?.codeDistribution?.chunksPerSec?.median ?? 0);
    case 'files':
      return Number(row?.filesMedian ?? row?.codeDistribution?.filesPerSec?.median ?? 0);
    case 'lines':
      return Number(row?.linesPerSec ?? 0);
    case 'build':
      return Number(row?.buildIndexMedian ?? 0);
    case 'query':
      return Number(row?.queryMedian ?? 0);
    case 'search':
      return Number(row?.searchMedian ?? 0);
    case 'variability':
      return Number(row?.variability ?? row?.codeDistribution?.chunksPerSec?.coefficientOfVariation ?? 0);
    case 'regressions':
    default:
      return Number(row?.regressionSeverity ?? 0);
  }
};

const sortRows = (rows, metric) => rows.slice().sort((left, right) => {
  const leftValue = getSortValue(left, metric);
  const rightValue = getSortValue(right, metric);
  if (metric === 'name') {
    return String(leftValue).localeCompare(String(rightValue));
  }
  return Number(rightValue) - Number(leftValue)
    || String(left?.label || left?.repoIdentity || left?.folder || '').localeCompare(
      String(right?.label || right?.repoIdentity || right?.folder || '')
    );
});

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const printCsv = (rows) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  console.log(headers.join(','));
  for (const row of rows) {
    console.log(headers.map((header) => csvEscape(row[header])).join(','));
  }
};

if (shouldRenderTextOverview) {
  console.log(color.bold(color.cyan('Benchmark Performance Overview')));
  console.log(color.gray(`Root: ${resultsRoot}`));
}
if (refreshJson && shouldRenderTextOverview) {
  const depthLabel = deepAnalysis ? 'deep analysis enabled' : 'deep analysis disabled';
  console.log(color.gray(`Refresh mode: writing benchmark JSON summaries (${depthLabel}).`));
}

for (const dir of folders) {
  const folderPath = path.join(resultsRoot, dir.name);
  const files = fs.readdirSync(folderPath)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
  /** @type {ThroughputRunRecord[]} */
  const runs = [];
  const throughputs = [];
  const modeTotalsFolder = createModeTotalsMap();
  const folderReposWithMetrics = new Set();
  const astGraphTotalsFolder = { repos: 0, totals: createAstGraphTotals(), observed: createAstGraphObserved() };
  const provenanceTotalsFolder = createSectionProvenanceTotals();
  const outcomeTotalsFolder = createOutcomeRollup();
  const outcomeRepoKeysFolder = new Set();
  const riskScanTotalsFolder = createRiskScanAggregate();

  for (const file of files) {
    const resultPath = path.join(folderPath, file);
    const payload = loadJson(resultPath);
    if (!payload) continue;
    const summary = payload.summary || payload.runs?.[0] || null;
    const throughput = payload.artifacts?.throughput || {};
    const featureMetrics = loadFeatureMetricsForPayload(payload);
    const {
      indexingSummary,
      featureMetrics: resolvedFeatureMetrics,
      provenance: indexingProvenance
    } = resolveIndexingSummary({
      payload,
      featureMetrics
    });
    const { analysis, provenance: analysisProvenance } = resolveBenchAnalysis({
      payload,
      featureMetrics: resolvedFeatureMetrics,
      indexingSummary,
      deepAnalysis
    });
    const { throughputLedger, provenance: throughputLedgerProvenance } = resolveThroughputLedger({
      payload,
      indexingSummary
    });
    const repoIdentityForMetrics = payload.repo?.root
      || payload?.artifacts?.repo?.root
      || payload?.artifacts?.repo?.cacheRoot
      || null;
    const repoIdentity = resolveRepoIdentity({ payload, file });
    const repoHistoryKey = resolveRepoHistoryKey({ payload, file });
    const generatedAtMs = Date.parse(payload?.generatedAt || payload?.summary?.generatedAt || '');
    const riskScanSummary = resolveRiskScanSummary(analysis);
    runs.push({
      file,
      summary,
      throughput,
      analysis,
      indexingSummary,
      scanProfile: payload?.artifacts?.scanProfile || null,
      throughputLedger,
      indexingProvenance,
      analysisProvenance,
      throughputLedgerProvenance,
      repoIdentity,
      repoHistoryKey,
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : null,
      riskScanSummary
    });
    addRiskScanAggregate(riskScanTotalsFolder, riskScanSummary);
    addRiskScanAggregate(riskScanTotalsGlobal, riskScanSummary);
    recordSectionProvenance(provenanceTotalsFolder, 'indexing', indexingProvenance);
    recordSectionProvenance(provenanceTotalsGlobal, 'indexing', indexingProvenance);
    recordSectionProvenance(provenanceTotalsFolder, 'analysis', analysisProvenance);
    recordSectionProvenance(provenanceTotalsGlobal, 'analysis', analysisProvenance);
    recordSectionProvenance(provenanceTotalsFolder, 'throughputLedger', throughputLedgerProvenance);
    recordSectionProvenance(provenanceTotalsGlobal, 'throughputLedger', throughputLedgerProvenance);
    addOutcomeAggregate(outcomeTotalsFolder.runs, {
      scanProfile: payload?.artifacts?.scanProfile || null,
      summary,
      indexingProvenance,
      diagnostics: payload?.diagnostics || null
    });
    addOutcomeAggregate(outcomeTotalsGlobal.runs, {
      scanProfile: payload?.artifacts?.scanProfile || null,
      summary,
      indexingProvenance,
      diagnostics: payload?.diagnostics || null
    });
    const outcomeRepoKey = repoIdentityForMetrics || repoHistoryKey || file;
    if (!outcomeRepoKeysFolder.has(outcomeRepoKey)) {
      addOutcomeAggregate(outcomeTotalsFolder.repos, {
        scanProfile: payload?.artifacts?.scanProfile || null,
        summary,
        indexingProvenance,
        diagnostics: payload?.diagnostics || null
      });
      outcomeRepoKeysFolder.add(outcomeRepoKey);
    }
    if (!outcomeRepoKeysGlobal.has(outcomeRepoKey)) {
      addOutcomeAggregate(outcomeTotalsGlobal.repos, {
        scanProfile: payload?.artifacts?.scanProfile || null,
        summary,
        indexingProvenance,
        diagnostics: payload?.diagnostics || null
      });
      outcomeRepoKeysGlobal.add(outcomeRepoKey);
    }
    throughputs.push(throughput);
    throughputRunsGlobal.push(throughput);
    if (summary) summariesGlobal.push(summary);
    mergeTotals(totalThroughput.code, throughput.code);
    mergeTotals(totalThroughput.prose, throughput.prose);
    mergeTotals(totalThroughput.extractedProse, throughput.extractedProse);
    mergeTotals(totalThroughput.records, throughput.records);
    mergeTotals(totalThroughput.lmdb.code, throughput?.lmdb?.code);
    mergeTotals(totalThroughput.lmdb.prose, throughput?.lmdb?.prose);
    if (isValidIndexingSummary(indexingSummary)) {
      if (repoIdentityForMetrics && !folderReposWithMetrics.has(repoIdentityForMetrics)) {
        mergeModeTotalsFromIndexingSummary(indexingSummary, modeTotalsFolder);
        folderReposWithMetrics.add(repoIdentityForMetrics);
      }
      if (repoIdentityForMetrics && !reposWithMetrics.has(repoIdentityForMetrics)) {
        mergeModeTotalsFromIndexingSummary(indexingSummary, modeTotalsGlobal);
        collectLanguageLinesFromSummary(indexingSummary, languageTotals);
        reposWithMetrics.add(repoIdentityForMetrics);
      }
    } else if (repoIdentityForMetrics && !folderReposWithMetrics.has(repoIdentityForMetrics)) {
      const metrics = resolvedFeatureMetrics || loadFeatureMetricsForPayload(payload);
      if (metrics) {
        mergeModeTotalsFromFeatureMetrics(metrics, modeTotalsFolder);
        folderReposWithMetrics.add(repoIdentityForMetrics);
      }
    }
    if (repoIdentityForMetrics && !reposWithMetrics.has(repoIdentityForMetrics) && !isValidIndexingSummary(indexingSummary)) {
      const metrics = resolvedFeatureMetrics || loadFeatureMetricsForPayload(payload);
      if (metrics) {
        collectLanguageLines(metrics, languageTotals);
        mergeModeTotalsFromFeatureMetrics(metrics, modeTotalsGlobal);
      }
      reposWithMetrics.add(repoIdentityForMetrics);
    }
    if (analysis && hasAstGraphValues(analysis.totals)) {
      astGraphTotalsFolder.repos += 1;
      astGraphTotalsGlobal.repos += 1;
      mergeAstGraphTotals(astGraphTotalsFolder.totals, analysis.totals);
      mergeAstGraphTotals(astGraphTotalsGlobal.totals, analysis.totals);
      mergeAstGraphObserved(astGraphTotalsFolder.observed, analysis);
      mergeAstGraphObserved(astGraphTotalsGlobal.observed, analysis);
    }
  }

  const header = `${dir.name}`;
  if (shouldRenderTextOverview) {
    console.log('');
    console.log(color.bold(color.blue(header)));
  }

  if (!runs.length) {
    if (shouldRenderTextOverview) {
      console.log(color.gray('  No benchmark JSON files found.'));
    }
    continue;
  }

  runs.sort((left, right) => {
    const leftTime = Number(left.generatedAtMs);
    const rightTime = Number(right.generatedAtMs);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.file).localeCompare(String(right.file));
  });
  // Diffs are order-sensitive; always compute against chronological run order.
  applyRunThroughputLedgerDiffs(runs);
  const folderLedgerRegressions = collectRunLedgerRegressions(runs);
  if (folderLedgerRegressions.length) {
    ledgerRegressionsGlobal.push(...folderLedgerRegressions.map((entry) => ({ ...entry, folder: dir.name })));
  }

  const codeDistribution = summarizeThroughputDistribution(throughputs, (throughput) => throughput?.code || null);
  const proseDistribution = summarizeThroughputDistribution(throughputs, (throughput) => throughput?.prose || null);
  const extractedProseDistribution = summarizeThroughputDistribution(throughputs, (throughput) => throughput?.extractedProse || null);
  const recordsDistribution = summarizeThroughputDistribution(throughputs, (throughput) => throughput?.records || null);

  const summaries = runs.map((r) => r.summary).filter(Boolean);
  const buildIndexMs = summarizeSummaryMetric(summaries, (s) => s.buildMs?.index);
  const buildSqliteMs = summarizeSummaryMetric(summaries, (s) => s.buildMs?.sqlite);
  const wallPerQuery = summarizeSummaryMetric(summaries, (s) => s.queryWallMsPerQuery);
  const wallPerSearch = summarizeSummaryMetric(summaries, (s) => s.queryWallMsPerSearch);
  const backendLatency = summarizeLatencyDistributions(summaries);
  const memoryMean = backendLatency.memory?.mean || null;
  const memoryP95 = backendLatency.memory?.p95 || null;
  const sqliteMean = backendLatency.sqlite?.mean || null;
  const sqliteP95 = backendLatency.sqlite?.p95 || null;

  variabilityRowsGlobal.push(
    createVariabilityEntry(dir.name, 'code chunks/s', codeDistribution?.chunksPerSec),
    createVariabilityEntry(dir.name, 'prose chunks/s', proseDistribution?.chunksPerSec),
    createVariabilityEntry(dir.name, 'xprose chunks/s', extractedProseDistribution?.chunksPerSec),
    createVariabilityEntry(dir.name, 'records chunks/s', recordsDistribution?.chunksPerSec),
    createVariabilityEntry(dir.name, 'build index', buildIndexMs),
    createVariabilityEntry(dir.name, 'query/search', wallPerSearch)
  );

  const aggregateIndexed = Array.from(modeTotalsFolder.values()).reduce(
    (acc, entry) => {
      acc.lines += Number.isFinite(entry.lines) ? entry.lines : 0;
      acc.files += Number.isFinite(entry.files) ? entry.files : 0;
      acc.bytes += Number.isFinite(entry.bytes) ? entry.bytes : 0;
      acc.durationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
      return acc;
    },
    { lines: 0, files: 0, bytes: 0, durationMs: 0 }
  );
  const aggregateLinesPerSec = aggregateIndexed.durationMs > 0
    ? (aggregateIndexed.lines / (aggregateIndexed.durationMs / 1000))
    : null;
  const folderRegressionCount = folderLedgerRegressions.length;
  const folderRegressionSeverity = folderLedgerRegressions.length
    ? Math.max(...folderLedgerRegressions.map((entry) => Math.abs(Number(entry?.deltaPct) || 0)))
    : 0;
  folderReports.push({
    folder: dir.name,
    label: dir.name,
    runCount: runs.length,
    codeDistribution,
    proseDistribution,
    extractedProseDistribution,
    recordsDistribution,
    buildIndexMs,
    buildSqliteMs,
    wallPerQuery,
    wallPerSearch,
    backendLatency,
    aggregateIndexed,
    aggregateLinesPerSec,
    folderLedgerRegressions,
    regressionCount: folderRegressionCount,
    regressionSeverity: folderRegressionSeverity,
    outcomeRuns: outcomeTotalsFolder.runs,
    outcomeRepos: outcomeTotalsFolder.repos,
    provenance: {
      indexing: formatSectionProvenance(provenanceTotalsFolder, 'indexing'),
      analysis: formatSectionProvenance(provenanceTotalsFolder, 'analysis'),
      throughputLedger: formatSectionProvenance(provenanceTotalsFolder, 'throughputLedger')
    },
    runs
  });

  if (!shouldRenderTextOverview) {
    continue;
  }

  printNamedSection('Throughput');
  printTextTable(
    [
      { key: 'mode', label: 'Mode' },
      { key: 'chunks', label: 'Chunks p50/p95', align: 'right' },
      { key: 'tokens', label: 'Tokens p50/p95', align: 'right' },
      { key: 'bytes', label: 'MB/s p50/p95', align: 'right' },
      { key: 'files', label: 'Files/s p50/p95', align: 'right' }
    ],
    [
      ['Code', codeDistribution],
      ['Prose', proseDistribution],
      ['XProse', extractedProseDistribution],
      ['Records', recordsDistribution]
    ].map(([label, distribution]) => {
      const bytesMedian = Number.isFinite(distribution?.bytesPerSec?.median)
        ? (distribution.bytesPerSec.median / (1024 * 1024))
        : null;
      const bytesP95 = Number.isFinite(distribution?.bytesPerSec?.p95)
        ? (distribution.bytesPerSec.p95 / (1024 * 1024))
        : null;
      return {
        mode: label,
        chunks: formatDistributionPair(distribution?.chunksPerSec),
        tokens: formatDistributionPair(distribution?.tokensPerSec),
        bytes: formatDistributionPair(
          Number.isFinite(bytesMedian) || Number.isFinite(bytesP95)
            ? { count: distribution?.bytesPerSec?.count, median: bytesMedian, p95: bytesP95 }
            : null
        ),
        files: formatDistributionPair(distribution?.filesPerSec)
      };
    }),
    { indent: '    ' }
  );

  if (aggregateIndexed.lines > 0 || aggregateIndexed.files > 0) {
    printNamedSection('Indexed');
    printTextTable(
      [
        { key: 'scope', label: 'Scope' },
        { key: 'lines', label: 'Lines', align: 'right' },
        { key: 'files', label: 'Files', align: 'right' },
        { key: 'bytes', label: 'Bytes', align: 'right' },
        { key: 'rate', label: 'Lines/s', align: 'right' },
        { key: 'msPerLine', label: 'ms/line', align: 'right' }
      ],
      [
        ...buildIndexedTotalsRows(modeTotalsFolder).map((row) => ({
          scope: row.label,
          lines: row.linesText,
          files: row.filesText,
          bytes: row.bytesText,
          rate: row.linesPerSecText,
          msPerLine: row.msPerLineText
        })),
        {
          scope: 'Aggregate',
          lines: `${formatCount(aggregateIndexed.lines)} lines`,
          files: `${formatCount(aggregateIndexed.files)} files`,
          bytes: formatBytes(aggregateIndexed.bytes),
          rate: `${formatNumber(aggregateLinesPerSec)} lines/s`,
          msPerLine: `${formatNumber(
            (aggregateIndexed.durationMs > 0 && aggregateIndexed.lines > 0)
              ? (aggregateIndexed.durationMs / aggregateIndexed.lines)
              : null,
            3
          )} ms/line`
        }
      ],
      { indent: '    ' }
    );
  }

  if (summaries.length) {
    printNamedSection('Timing');
    printTextTable(
      [
        { key: 'metric', label: 'Metric' },
        { key: 'count', label: 'n', align: 'right' },
        { key: 'p50', label: 'p50', align: 'right' },
        { key: 'p95', label: 'p95', align: 'right' },
        { key: 'p99', label: 'p99', align: 'right' },
        { key: 'minMax', label: 'min/max', align: 'right' },
        { key: 'cv', label: 'cv', align: 'right' }
      ],
      [
        buildDistributionStatsRow({ metric: 'Build index', summary: buildIndexMs, formatter: formatMs }),
        buildDistributionStatsRow({ metric: 'Build sqlite', summary: buildSqliteMs, formatter: formatMs }),
        buildDistributionStatsRow({ metric: 'Query/search', summary: wallPerQuery, formatter: formatMs }),
        buildDistributionStatsRow({ metric: 'Search only', summary: wallPerSearch, formatter: formatMs }),
        buildDistributionStatsRow({ metric: 'Mem mean', summary: memoryMean, formatter: formatMs }),
        buildDistributionStatsRow({ metric: 'Mem run-p95', summary: memoryP95, formatter: formatMs }),
        buildDistributionStatsRow({ metric: 'Sqlite mean', summary: sqliteMean, formatter: formatMs }),
        buildDistributionStatsRow({ metric: 'Sqlite run-p95', summary: sqliteP95, formatter: formatMs })
      ],
      { indent: '    ' }
    );
  }

  printNamedSection('Coverage');
  printTextTable(
    [
      { key: 'scope', label: 'Scope' },
      { key: 'candidates', label: 'Candidates', align: 'right' },
      { key: 'scanned', label: 'Scanned', align: 'right' },
      { key: 'skipped', label: 'Skipped', align: 'right' }
    ],
    [
      {
        scope: 'Repos',
        candidates: formatCount(outcomeTotalsFolder.repos.coverage.candidates),
        scanned: formatCount(outcomeTotalsFolder.repos.coverage.scanned),
        skipped: formatCount(outcomeTotalsFolder.repos.coverage.skipped)
      },
      {
        scope: 'Runs',
        candidates: formatCount(outcomeTotalsFolder.runs.coverage.candidates),
        scanned: formatCount(outcomeTotalsFolder.runs.coverage.scanned),
        skipped: formatCount(outcomeTotalsFolder.runs.coverage.skipped)
      }
    ],
    { indent: '    ' }
  );

  printNamedSection('Quality');
  printTextTable(
    [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' }
    ],
    [
      { metric: 'Skip reasons', value: formatCountMapSummary(outcomeTotalsFolder.repos.skipReasons) },
      { metric: 'Cache', value: formatCacheSummary(outcomeTotalsFolder.repos) },
      {
        metric: 'Quality',
        value:
          `${formatCountMapSummary(outcomeTotalsFolder.runs.confidence)} | ` +
          `low-yield ${formatCount(outcomeTotalsFolder.runs.lowYield.triggered)} ` +
          `(${formatCount(outcomeTotalsFolder.runs.lowYield.skippedFiles)} skipped) | ` +
          `filter-index reused ${formatCount(outcomeTotalsFolder.runs.filterIndexReused)}`
      },
      { metric: 'Diagnostics', value: formatCountMapSummary(outcomeTotalsFolder.runs.diagnostics, 4) },
      { metric: 'Pressure', value: formatResourceSummary(outcomeTotalsFolder.runs) }
    ],
    { indent: '    ' }
  );

  if (hasAstGraphValues(astGraphTotalsFolder.totals)) {
    const coverage = runs.length ? `${astGraphTotalsFolder.repos}/${runs.length}` : `${astGraphTotalsFolder.repos}/0`;
    printNamedSection(`AST / Graph (${coverage} runs)`);
    printTextTable(
      [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value', align: 'right' }
      ],
      [
        { metric: 'Symbols', value: formatAstField(astGraphTotalsFolder, 'symbols') },
        { metric: 'Classes', value: formatAstField(astGraphTotalsFolder, 'classes') },
        { metric: 'Functions', value: formatAstField(astGraphTotalsFolder, 'functions') },
        { metric: 'Imports', value: formatAstField(astGraphTotalsFolder, 'imports') },
        { metric: 'File links', value: formatAstField(astGraphTotalsFolder, 'fileLinks') },
        { metric: 'Graph links', value: formatAstField(astGraphTotalsFolder, 'graphLinks') },
        ...buildAstDerivedRows({
          astGraphAggregate: astGraphTotalsFolder,
          indexedFiles: aggregateIndexed.files
        })
      ],
      { indent: '    ' }
    );
  }

  if (riskScanTotalsFolder.observedRuns > 0) {
    printNamedSection('Risk / Context');
    printTextTable(
      [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value' }
      ],
      [
        { metric: 'Observed runs', value: formatCount(riskScanTotalsFolder.observedRuns) },
        { metric: 'Statuses', value: formatCountMapSummary(riskScanTotalsFolder.statuses, 4) },
        { metric: 'Summary-only runs', value: formatCount(riskScanTotalsFolder.summaryOnlyRuns) },
        { metric: 'Risk summaries', value: formatCount(riskScanTotalsFolder.summariesEmitted) },
        { metric: 'Risk flows', value: formatCount(riskScanTotalsFolder.flowsEmitted) },
        { metric: 'Partial flows', value: formatCount(riskScanTotalsFolder.partialFlowsEmitted) },
        { metric: 'Unique call sites', value: formatCount(riskScanTotalsFolder.uniqueCallSitesReferenced) },
        { metric: 'Caps hit', value: formatCountMapSummary(riskScanTotalsFolder.caps, 6) }
      ],
      { indent: '    ' }
    );
  }

  if (folderLedgerRegressions.length) {
    printNamedSection('Top Throughput Regressions');
    printTextTable(
      [
        { key: 'repo', label: 'Repo' },
        { key: 'metric', label: 'Metric' },
        { key: 'delta', label: 'Delta', align: 'right' },
        { key: 'detail', label: 'Detail' }
      ],
      folderLedgerRegressions.slice(0, verboseOutput ? 5 : 3).map((regression) => ({
        repo: regression.repoIdentity,
        metric: `${regression.modality}/${regression.stage} ${regression.metricLabel}`,
        delta: formatPct(regression.deltaPct),
        detail: `${formatRegressionDelta(regression)} | ${regression.baselineConfidence} conf`
      })),
      { indent: '    ' }
    );
  }

  printNamedSection('Provenance');
  printTextTable(
    [
      { key: 'section', label: 'Section' },
      { key: 'source', label: 'Source' }
    ],
    [
      { section: 'Indexing', source: formatSectionProvenance(provenanceTotalsFolder, 'indexing') },
      { section: 'Analysis', source: formatSectionProvenance(provenanceTotalsFolder, 'analysis') },
      { section: 'Ledger', source: formatSectionProvenance(provenanceTotalsFolder, 'throughputLedger') }
    ],
    { indent: '    ' }
  );

  if (!verboseOutput) {
    continue;
  }

  const runRows = runs.map((run) => {
    const repoLabel = run.file.replace(/\.json$/, '').replace(/__/g, '/');
    const codeText = `${formatNumber(run.throughput?.code?.chunksPerSec)} ch/s`;
    const proseText = `${formatNumber(run.throughput?.prose?.chunksPerSec)} ch/s`;
    const xproseText = `${formatNumber(run.throughput?.extractedProse?.chunksPerSec)} ch/s`;
    const recordsText = `${formatNumber(run.throughput?.records?.chunksPerSec)} ch/s`;
    const queryText = formatMs(run.summary?.queryWallMsPerQuery);
    return {
      repoLabel,
      codeText,
      proseText,
      xproseText,
      recordsText,
      queryText
    };
  });
  const repoWidth = Math.max('repo'.length, ...runRows.map((row) => row.repoLabel.length));
  const codeWidth = Math.max('code'.length, ...runRows.map((row) => row.codeText.length));
  const proseWidth = Math.max('prose'.length, ...runRows.map((row) => row.proseText.length));
  const xproseWidth = Math.max('xprose'.length, ...runRows.map((row) => row.xproseText.length));
  const recordsWidth = Math.max('records'.length, ...runRows.map((row) => row.recordsText.length));
  const queryWidth = Math.max('query'.length, ...runRows.map((row) => row.queryText.length));

  console.log('');
  console.log(color.gray(
    `${`(${runs.length} run${runs.length === 1 ? '' : 's'})`.padStart(repoWidth)}` +
    ` | ${'code'.padStart(codeWidth)}` +
    ` | ${'prose'.padStart(proseWidth)}` +
    ` | ${'xprose'.padStart(xproseWidth)}` +
    ` | ${'records'.padStart(recordsWidth)}` +
    ` | ${'query'.padStart(queryWidth)}`
  ));
  for (const row of runRows) {
    console.log(
      `${row.repoLabel.padEnd(repoWidth)} | ` +
      `${row.codeText.padStart(codeWidth)} | ` +
      `${row.proseText.padStart(proseWidth)} | ` +
      `${row.xproseText.padStart(xproseWidth)} | ` +
      `${row.recordsText.padStart(recordsWidth)} | ` +
      `${row.queryText.padStart(queryWidth)}`
    );
  }
}

const totalFilesPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'files'),
  rateFromTotals(totalThroughput.prose, 'files'),
  rateFromTotals(totalThroughput.extractedProse, 'files'),
  rateFromTotals(totalThroughput.records, 'files')
);
const totalChunksPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'chunks'),
  rateFromTotals(totalThroughput.prose, 'chunks'),
  rateFromTotals(totalThroughput.extractedProse, 'chunks'),
  rateFromTotals(totalThroughput.records, 'chunks')
);
const totalTokensPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'tokens'),
  rateFromTotals(totalThroughput.prose, 'tokens'),
  rateFromTotals(totalThroughput.extractedProse, 'tokens'),
  rateFromTotals(totalThroughput.records, 'tokens')
);
const totalBytesPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'bytes'),
  rateFromTotals(totalThroughput.prose, 'bytes'),
  rateFromTotals(totalThroughput.extractedProse, 'bytes'),
  rateFromTotals(totalThroughput.records, 'bytes')
);

const aggregateModeTotalsGlobal = Array.from(modeTotalsGlobal.values()).reduce(
  (acc, entry) => {
    acc.lines += Number.isFinite(entry.lines) ? entry.lines : 0;
    acc.files += Number.isFinite(entry.files) ? entry.files : 0;
    acc.durationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
    return acc;
  },
  { lines: 0, files: 0, durationMs: 0 }
);
const totalLinesPerSec = (aggregateModeTotalsGlobal.durationMs > 0)
  ? (aggregateModeTotalsGlobal.lines / (aggregateModeTotalsGlobal.durationMs / 1000))
  : null;

/**
 * Pre-rendered per-mode totals row used by both compact and verbose output.
 * Lines/s is merged from indexing summaries because throughput payloads do not
 * directly carry line counts.
 */
const modeRows = MODE_THROUGHPUT_TOTALS.map(({ label, pick, modeKey }) => {
  const entry = pick(totalThroughput);
  const chunksRate = rateFromTotals(entry, 'chunks');
  const tokensRate = rateFromTotals(entry, 'tokens');
  const bytesRate = rateFromTotals(entry, 'bytes');
  const filesRate = rateFromTotals(entry, 'files');
  const bytesMbRate = Number.isFinite(bytesRate) ? (bytesRate / (1024 * 1024)) : null;
  const linesBucket = modeTotalsGlobal.get(modeKey);
  const linesPerSec = (Number.isFinite(linesBucket?.durationMs) && linesBucket.durationMs > 0 && Number.isFinite(linesBucket?.lines))
    ? (linesBucket.lines / (linesBucket.durationMs / 1000))
    : null;
  return {
    label,
    chunksCell: formatThroughputTotalsCell(chunksRate, 'chunks/s', 4),
    tokensCell: formatThroughputTotalsCell(tokensRate, 'tokens/s', 7),
    bytesCell: formatThroughputTotalsCell(bytesMbRate, 'MB/s', 3),
    filesCell: formatThroughputTotalsCell(filesRate, 'files/s', 4),
    linesCell: Number.isFinite(linesPerSec)
      ? formatThroughputTotalsCell(linesPerSec, 'lines/s', 6)
      : '',
    linesPerSec
  };
});

if (shouldRenderTextOverview) {
  console.log('');
  console.log(color.bold(color.green('Throughput Totals')));
  printTextTable(
    [
      { key: 'metric', label: 'Metric' },
      { key: 'rate', label: 'Rate', align: 'right' }
    ],
    [
      { metric: 'Files', rate: `${formatNumber(totalFilesPerSec)} files/s` },
      { metric: 'Chunks', rate: `${formatNumber(totalChunksPerSec)} chunks/s` },
      { metric: 'Tokens', rate: `${formatNumber(totalTokensPerSec)} tokens/s` },
      { metric: 'Bytes', rate: formatBytesPerSec(totalBytesPerSec) },
      ...(Number.isFinite(totalLinesPerSec)
        ? [{ metric: 'Lines', rate: `${formatNumber(totalLinesPerSec)} lines/s` }]
        : [])
    ],
    { indent: '  ' }
  );
  console.log('');
  console.log('  By Mode');
  printTextTable(
    [
      { key: 'mode', label: 'Mode' },
      { key: 'chunks', label: 'Chunks/s', align: 'right' },
      { key: 'tokens', label: 'Tokens/s', align: 'right' },
      { key: 'bytes', label: 'MB/s', align: 'right' },
      { key: 'files', label: 'Files/s', align: 'right' },
      { key: 'lines', label: 'Lines/s', align: 'right' }
    ],
    modeRows.map((row) => ({
      mode: row.label,
      chunks: row.chunksCell,
      tokens: row.tokensCell,
      bytes: row.bytesCell,
      files: row.filesCell,
      lines: row.linesCell || 'n/a'
    })),
    { indent: '    ' }
  );
  const additionalTotalsRows = THROUGHPUT_GROUPS
    .filter(({ label }) => !['Code throughput', 'Prose throughput', 'Extracted prose throughput', 'Records throughput']
      .some((entry) => entry.toLowerCase() === label.toLowerCase()))
    .map(({ label, pick }) => {
      const entry = pick(totalThroughput);
      const chunksPerSec = rateFromTotals(entry, 'chunks');
      const tokensPerSec = rateFromTotals(entry, 'tokens');
      const bytesPerSec = rateFromTotals(entry, 'bytes');
      const filesPerSec = rateFromTotals(entry, 'files');
      if (!Number.isFinite(chunksPerSec)
        && !Number.isFinite(tokensPerSec)
        && !Number.isFinite(bytesPerSec)
        && !Number.isFinite(filesPerSec)) {
        return null;
      }
      return {
        mode: label,
        chunks: `${formatNumber(chunksPerSec)} chunks/s`,
        tokens: `${formatNumber(tokensPerSec)} tokens/s`,
        bytes: formatBytesPerSec(bytesPerSec),
        files: `${formatNumber(filesPerSec)} files/s`
      };
    })
    .filter(Boolean);
  if (additionalTotalsRows.length) {
    console.log('');
    console.log('  Additional Groups');
    printTextTable(
      [
        { key: 'mode', label: 'Group' },
        { key: 'chunks', label: 'Chunks/s', align: 'right' },
        { key: 'tokens', label: 'Tokens/s', align: 'right' },
        { key: 'bytes', label: 'Bytes/s', align: 'right' },
        { key: 'files', label: 'Files/s', align: 'right' }
      ],
      additionalTotalsRows,
      { indent: '    ' }
    );
  }
}
const globalCodeDistribution = summarizeThroughputDistribution(throughputRunsGlobal, (throughput) => throughput?.code || null);
const globalProseDistribution = summarizeThroughputDistribution(throughputRunsGlobal, (throughput) => throughput?.prose || null);
const globalExtractedProseDistribution = summarizeThroughputDistribution(throughputRunsGlobal, (throughput) => throughput?.extractedProse || null);
const globalRecordsDistribution = summarizeThroughputDistribution(throughputRunsGlobal, (throughput) => throughput?.records || null);
const globalBuildIndexDistribution = summarizeSummaryMetric(summariesGlobal, (summary) => summary?.buildMs?.index);
const globalBuildSqliteDistribution = summarizeSummaryMetric(summariesGlobal, (summary) => summary?.buildMs?.sqlite);
const globalQueryDistribution = summarizeSummaryMetric(summariesGlobal, (summary) => summary?.queryWallMsPerQuery);
const globalSearchDistribution = summarizeSummaryMetric(summariesGlobal, (summary) => summary?.queryWallMsPerSearch);
const globalLatency = summarizeLatencyDistributions(summariesGlobal);
if (shouldRenderTextOverview) {
  console.log(color.bold('Run Distributions'));
  printTextTable(
    [
      { key: 'category', label: 'Category' },
      { key: 'metric', label: 'Metric' },
      { key: 'count', label: 'n', align: 'right' },
      { key: 'p50', label: 'p50', align: 'right' },
      { key: 'p95', label: 'p95', align: 'right' },
      { key: 'p99', label: 'p99', align: 'right' },
      { key: 'minMax', label: 'min/max', align: 'right' },
      { key: 'cv', label: 'cv', align: 'right' }
    ],
    [
      buildDistributionStatsRow({ category: 'Code', metric: 'Chunks/s', summary: globalCodeDistribution?.chunksPerSec }),
      buildDistributionStatsRow({ category: 'Code', metric: 'Files/s', summary: globalCodeDistribution?.filesPerSec }),
      buildDistributionStatsRow({ category: 'Prose', metric: 'Chunks/s', summary: globalProseDistribution?.chunksPerSec }),
      buildDistributionStatsRow({ category: 'Prose', metric: 'Files/s', summary: globalProseDistribution?.filesPerSec }),
      buildDistributionStatsRow({ category: 'XProse', metric: 'Chunks/s', summary: globalExtractedProseDistribution?.chunksPerSec }),
      buildDistributionStatsRow({ category: 'XProse', metric: 'Files/s', summary: globalExtractedProseDistribution?.filesPerSec }),
      buildDistributionStatsRow({ category: 'Records', metric: 'Chunks/s', summary: globalRecordsDistribution?.chunksPerSec }),
      buildDistributionStatsRow({ category: 'Records', metric: 'Files/s', summary: globalRecordsDistribution?.filesPerSec }),
      buildDistributionStatsRow({ category: 'Build', metric: 'Index', summary: globalBuildIndexDistribution, formatter: formatMs }),
      buildDistributionStatsRow({ category: 'Build', metric: 'Sqlite', summary: globalBuildSqliteDistribution, formatter: formatMs }),
      buildDistributionStatsRow({ category: 'Query', metric: 'Per-query', summary: globalQueryDistribution, formatter: formatMs }),
      buildDistributionStatsRow({ category: 'Query', metric: 'Per-search', summary: globalSearchDistribution, formatter: formatMs }),
      buildDistributionStatsRow({ category: 'Latency', metric: 'Mem mean', summary: globalLatency.memory?.mean, formatter: formatMs }),
      buildDistributionStatsRow({ category: 'Latency', metric: 'Mem run-p95', summary: globalLatency.memory?.p95, formatter: formatMs }),
      buildDistributionStatsRow({ category: 'Latency', metric: 'Sqlite mean', summary: globalLatency.sqlite?.mean, formatter: formatMs }),
      buildDistributionStatsRow({ category: 'Latency', metric: 'Sqlite run-p95', summary: globalLatency.sqlite?.p95, formatter: formatMs })
    ],
    { indent: '  ' }
  );
}
if (shouldRenderTextOverview && ledgerRegressionsGlobal.length) {
  ledgerRegressionsGlobal.sort((left, right) => (
    left.metricKind === 'duration'
      ? (Number(right.deltaPct) - Number(left.deltaPct))
      : (Number(left.deltaPct) - Number(right.deltaPct))
  ) || String(left.repoIdentity || '').localeCompare(String(right.repoIdentity || '')));
  console.log(color.bold(
    `Top Throughput Regressions (schema v${THROUGHPUT_LEDGER_SCHEMA_VERSION}/diff v${THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION})`
  ));
  for (const entry of ledgerRegressionsGlobal.slice(0, 8)) {
    console.log(
      `  ${entry.folder}/${entry.repoIdentity} ${entry.modality}/${entry.stage} ${entry.metricLabel}: ` +
      `${formatPct(entry.deltaPct)} | ${formatRegressionDelta(entry)} | ` +
      `${entry.baselineConfidence} conf`
    );
  }
}
const variabilityRows = variabilityRowsGlobal
  .filter((entry) => Number.isFinite(entry?.coefficientOfVariation))
  .sort((left, right) => (
    Number(right.coefficientOfVariation) - Number(left.coefficientOfVariation)
  ) || String(left.folder || '').localeCompare(String(right.folder || '')));
if (shouldRenderTextOverview && variabilityRows.length) {
  console.log(color.bold('Top Variability'));
  printTextTable(
    [
      { key: 'family', label: 'Family' },
      { key: 'metric', label: 'Metric' },
      { key: 'cv', label: 'CV', align: 'right' },
      { key: 'p50p95', label: 'p50/p95', align: 'right' },
      { key: 'count', label: 'n', align: 'right' }
    ],
    variabilityRows.slice(0, 8).map((entry) => ({
      family: entry.folder,
      metric: entry.label,
      cv: formatPct(entry.coefficientOfVariation),
      p50p95: `${formatNumber(entry.median)}/${formatNumber(entry.p95)}`,
      count: formatCount(entry.count)
    })),
    { indent: '  ' }
  );
}
if (shouldRenderTextOverview && hasAstGraphValues(astGraphTotalsGlobal.totals)) {
  console.log(color.bold('AST/Graph Totals'));
  printTextTable(
    [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value', align: 'right' }
    ],
    [
      { metric: 'Symbols', value: formatAstField(astGraphTotalsGlobal, 'symbols') },
      { metric: 'Classes', value: formatAstField(astGraphTotalsGlobal, 'classes') },
      { metric: 'Functions', value: formatAstField(astGraphTotalsGlobal, 'functions') },
      { metric: 'Imports', value: formatAstField(astGraphTotalsGlobal, 'imports') },
      { metric: 'File links', value: formatAstField(astGraphTotalsGlobal, 'fileLinks') },
      { metric: 'Graph links', value: formatAstField(astGraphTotalsGlobal, 'graphLinks') },
      ...buildAstDerivedRows({
        astGraphAggregate: astGraphTotalsGlobal,
        indexedFiles: aggregateModeTotalsGlobal.files
      })
    ],
    { indent: '  ' }
  );
}
if (shouldRenderTextOverview && riskScanTotalsGlobal.observedRuns > 0) {
  console.log(color.bold('Risk / Context Totals'));
  printTextTable(
    [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' }
    ],
    [
      { metric: 'Observed runs', value: formatCount(riskScanTotalsGlobal.observedRuns) },
      { metric: 'Statuses', value: formatCountMapSummary(riskScanTotalsGlobal.statuses, 4) },
      { metric: 'Summary-only runs', value: formatCount(riskScanTotalsGlobal.summaryOnlyRuns) },
      { metric: 'Risk summaries', value: formatCount(riskScanTotalsGlobal.summariesEmitted) },
      { metric: 'Risk flows', value: formatCount(riskScanTotalsGlobal.flowsEmitted) },
      { metric: 'Partial flows', value: formatCount(riskScanTotalsGlobal.partialFlowsEmitted) },
      { metric: 'Unique call sites', value: formatCount(riskScanTotalsGlobal.uniqueCallSitesReferenced) },
      { metric: 'Caps hit', value: formatCountMapSummary(riskScanTotalsGlobal.caps, 8) }
    ],
    { indent: '  ' }
  );
}

const totalsByModeRows = [
  { modeKey: 'code', label: 'Code' },
  { modeKey: 'prose', label: 'Prose' },
  { modeKey: 'extracted-prose', label: 'XProse' },
  { modeKey: 'records', label: 'Records' }
].map(({ modeKey, label }) => {
  const totals = modeTotalsGlobal.get(modeKey);
  if (!Number.isFinite(totals?.lines) || totals.lines <= 0) return null;
  const linesText = `${formatCount(totals.lines)} lines`;
  const filesText = `${formatCount(totals.files)} files`;
  const bytesText = formatBytes(totals.bytes);
  const linesPerSec = (Number.isFinite(totals.durationMs) && totals.durationMs > 0)
    ? (totals.lines / (totals.durationMs / 1000))
    : null;
  const lineRateText = `${formatNumber(linesPerSec)} lines/s`;
  const msPerLine = (Number.isFinite(totals.durationMs) && totals.durationMs > 0 && totals.lines > 0)
    ? (totals.durationMs / totals.lines)
    : null;
  const msPerLineText = `${formatNumber(msPerLine, 3)} ms/line`;
  return {
    label,
    linesText,
    filesText,
    bytesText,
    lineRateText,
    msPerLineText
  };
}).filter(Boolean);

if (shouldRenderTextOverview && totalsByModeRows.length) {
  console.log('');
  console.log('Totals by Mode');
  printTextTable(
    [
      { key: 'mode', label: 'Mode' },
      { key: 'lines', label: 'Lines', align: 'right' },
      { key: 'files', label: 'Files', align: 'right' },
      { key: 'bytes', label: 'Bytes', align: 'right' },
      { key: 'rate', label: 'Lines/s', align: 'right' },
      { key: 'msPerLine', label: 'ms/line', align: 'right' }
    ],
    totalsByModeRows.map((row) => ({
      mode: row.label,
      lines: row.linesText,
      files: row.filesText,
      bytes: row.bytesText,
      rate: row.lineRateText,
      msPerLine: row.msPerLineText
    })),
    { indent: '  ' }
  );
}
if (shouldRenderTextOverview && languageTotals.size) {
  const sortedLanguages = Array.from(languageTotals.entries())
    .sort((a, b) => b[1] - a[1]);
  const languageDisplayLimit = verboseOutput ? sortedLanguages.length : 12;
  const displayed = sortedLanguages.slice(0, languageDisplayLimit);
  const omitted = sortedLanguages.slice(languageDisplayLimit);
  const omittedLines = omitted.reduce((sum, [, lines]) => sum + (Number(lines) || 0), 0);
  console.log('');
  console.log(`Lines by Language${verboseOutput ? '' : ` (top ${displayed.length})`}`);
  printTextTable(
    [
      { key: 'language', label: 'Language' },
      { key: 'lines', label: 'Lines', align: 'right' }
    ],
    displayed.map(([language, lines]) => ({
      language,
      lines: formatCount(lines)
    })),
    { indent: '  ' }
  );
  if (omitted.length) {
    console.log(`  Other languages: ${formatCount(omittedLines)} lines across ${formatCount(omitted.length)} entries`);
  }
}
if (shouldRenderTextOverview) {
  console.log('');
  console.log(color.bold('Scan Outcome Totals'));
  printTextTable(
    [
      { key: 'scope', label: 'Scope' },
      { key: 'candidates', label: 'Candidates', align: 'right' },
      { key: 'scanned', label: 'Scanned', align: 'right' },
      { key: 'skipped', label: 'Skipped', align: 'right' }
    ],
    [
      {
        scope: 'Repos',
        candidates: formatCount(outcomeTotalsGlobal.repos.coverage.candidates),
        scanned: formatCount(outcomeTotalsGlobal.repos.coverage.scanned),
        skipped: formatCount(outcomeTotalsGlobal.repos.coverage.skipped)
      },
      {
        scope: 'Runs',
        candidates: formatCount(outcomeTotalsGlobal.runs.coverage.candidates),
        scanned: formatCount(outcomeTotalsGlobal.runs.coverage.scanned),
        skipped: formatCount(outcomeTotalsGlobal.runs.coverage.skipped)
      }
    ],
    { indent: '  ' }
  );
  console.log('');
  console.log('  Quality / Cache / Pressure');
  printTextTable(
    [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' }
    ],
    [
      { metric: 'Skip reasons', value: formatCountMapSummary(outcomeTotalsGlobal.repos.skipReasons, 8) },
      { metric: 'Cache', value: formatCacheSummary(outcomeTotalsGlobal.repos) },
      {
        metric: 'Quality',
        value:
          `${formatCountMapSummary(outcomeTotalsGlobal.runs.confidence)} | ` +
          `low-yield ${formatCount(outcomeTotalsGlobal.runs.lowYield.triggered)} ` +
          `(${formatCount(outcomeTotalsGlobal.runs.lowYield.skippedFiles)} skipped files) | ` +
          `filter-index reused ${formatCount(outcomeTotalsGlobal.runs.filterIndexReused)}`
      },
      { metric: 'Diagnostics', value: formatCountMapSummary(outcomeTotalsGlobal.runs.diagnostics, 6) },
      { metric: 'Pressure', value: formatResourceSummary(outcomeTotalsGlobal.runs) }
    ],
    { indent: '    ' }
  );
  console.log('');
  console.log(color.bold('Overview Provenance'));
  printTextTable(
    [
      { key: 'section', label: 'Section' },
      { key: 'source', label: 'Source' }
    ],
    [
      { section: 'Indexing', source: formatSectionProvenance(provenanceTotalsGlobal, 'indexing') },
      { section: 'Analysis', source: formatSectionProvenance(provenanceTotalsGlobal, 'analysis') },
      { section: 'Throughput ledger', source: formatSectionProvenance(provenanceTotalsGlobal, 'throughputLedger') }
    ],
    { indent: '  ' }
  );
}

const outputSummary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  profile,
  root: resultsRoot,
  compareRoot,
  filters: {
    folder: folderFilter || null,
    repo: repoFilter || null,
    mode: modeFilter || null,
    latest: latestCount,
    sort: sortMetric,
    top: topN
  },
  totals: {
    filesPerSec: totalFilesPerSec,
    chunksPerSec: totalChunksPerSec,
    tokensPerSec: totalTokensPerSec,
    bytesPerSec: totalBytesPerSec,
    linesPerSec: totalLinesPerSec
  },
  distributions: {
    code: globalCodeDistribution,
    prose: globalProseDistribution,
    extractedProse: globalExtractedProseDistribution,
    records: globalRecordsDistribution,
    buildIndexMs: globalBuildIndexDistribution,
    buildSqliteMs: globalBuildSqliteDistribution,
    queryWallMsPerQuery: globalQueryDistribution,
    queryWallMsPerSearch: globalSearchDistribution,
    latencyMs: globalLatency
  },
  outcomes: {
    repos: outcomeTotalsGlobal.repos,
    runs: outcomeTotalsGlobal.runs
  },
  provenance: {
    indexing: formatSectionProvenance(provenanceTotalsGlobal, 'indexing'),
    analysis: formatSectionProvenance(provenanceTotalsGlobal, 'analysis'),
    throughputLedger: formatSectionProvenance(provenanceTotalsGlobal, 'throughputLedger')
  },
  topRegressions: ledgerRegressionsGlobal.slice(0, topN),
  topVariability: variabilityRows.slice(0, topN),
  ciSummary: {
    folderCount: folderReports.length,
    regressionCount: ledgerRegressionsGlobal.length,
    highestRegressionPct: ledgerRegressionsGlobal.length
      ? Math.max(...ledgerRegressionsGlobal.map((entry) => Math.abs(Number(entry?.deltaPct) || 0)))
      : null,
    highestVariabilityPct: variabilityRows.length
      ? Math.max(...variabilityRows.map((entry) => Number(entry?.coefficientOfVariation) || 0))
      : null
  },
  folders: folderReports.map((report) => ({
    folder: report.folder,
    runCount: report.runCount,
    codeChunksMedian: report.codeDistribution?.chunksPerSec?.median ?? null,
    codeChunksP95: report.codeDistribution?.chunksPerSec?.p95 ?? null,
    codeFilesMedian: report.codeDistribution?.filesPerSec?.median ?? null,
    linesPerSec: report.aggregateLinesPerSec,
    buildIndexMedian: report.buildIndexMs?.median ?? null,
    queryMedian: report.wallPerQuery?.median ?? null,
    searchMedian: report.wallPerSearch?.median ?? null,
    regressionCount: report.regressionCount,
    regressionSeverity: report.regressionSeverity,
    variability: report.codeDistribution?.chunksPerSec?.coefficientOfVariation ?? null,
    coverageCandidates: report.outcomeRepos.coverage.candidates,
    coverageScanned: report.outcomeRepos.coverage.scanned,
    coverageSkipped: report.outcomeRepos.coverage.skipped,
    provenance: report.provenance
  }))
};

const buildFamilyRows = () => sortRows(folderReports.map((report) => ({
  folder: report.folder,
  label: report.folder,
  runs: report.runCount,
  chunkMedian: report.codeDistribution?.chunksPerSec?.median ?? null,
  chunkP95: report.codeDistribution?.chunksPerSec?.p95 ?? null,
  filesMedian: report.codeDistribution?.filesPerSec?.median ?? null,
  linesPerSec: report.aggregateLinesPerSec,
  buildIndexMedian: report.buildIndexMs?.median ?? null,
  searchMedian: report.wallPerSearch?.median ?? null,
  regressions: report.regressionCount,
  regressionSeverity: report.regressionSeverity,
  variability: report.codeDistribution?.chunksPerSec?.coefficientOfVariation ?? null,
  coverageCandidates: report.outcomeRepos.coverage.candidates,
  coverageScanned: report.outcomeRepos.coverage.scanned,
  coverageSkipped: report.outcomeRepos.coverage.skipped
})), sortMetric).slice(0, topN);

const buildRepoRows = () => {
  const rows = [];
  for (const report of folderReports) {
    for (const run of report.runs) {
      if (!matchesRepoFilter(run, repoFilter)) continue;
      const modeDistribution = modeFilter
        ? (run.throughput?.[modeFilter === 'extracted-prose' ? 'extractedProse' : modeFilter] || null)
        : (run.throughput?.code || null);
      rows.push({
        folder: report.folder,
        label: run.repoIdentity || run.file,
        repoIdentity: run.repoIdentity,
        file: run.file,
        chunksMedian: Number(modeDistribution?.chunksPerSec),
        filesMedian: Number(modeDistribution?.filesPerSec),
        buildIndexMedian: Number(run.summary?.buildMs?.index),
        queryMedian: Number(run.summary?.queryWallMsPerQuery),
        searchMedian: Number(run.summary?.queryWallMsPerSearch),
        regressionSeverity: Math.max(...Object.values(run.throughputLedgerDiff?.metrics || {})
          .flatMap((metricSummary) => (metricSummary?.regressions || []).map((entry) => Math.abs(Number(entry?.deltaPct) || 0))), 0),
        variability: null
      });
    }
  }
  return sortRows(rows, sortMetric).slice(0, topN);
};

const printFamilyText = (rows) => {
  console.log('Family Overview');
  for (const row of rows) {
    console.log(
      `${row.folder}: runs ${formatCount(row.runs)} | ` +
      `chunks p50/p95 ${formatNumber(row.chunkMedian)}/${formatNumber(row.chunkP95)} | ` +
      `build ${formatMs(row.buildIndexMedian)} | search ${formatMs(row.searchMedian)} | ` +
      `reg ${formatCount(row.regressions)} | cv ${formatPct(row.variability)}`
    );
  }
};

const printRepoText = (rows) => {
  console.log('Repo Overview');
  for (const row of rows) {
    console.log(
      `${row.folder}/${row.repoIdentity}: chunks ${formatNumber(row.chunksMedian)} | ` +
      `build ${formatMs(row.buildIndexMedian)} | query ${formatMs(row.queryMedian)} | ` +
      `search ${formatMs(row.searchMedian)} | reg ${formatPct(row.regressionSeverity)}`
    );
  }
};

const printCompareText = () => {
  if (!compareRoot) {
    throw new Error('--compare is required when --profile compare is used');
  }
  const compareResult = spawnSync(
    process.execPath,
    [
      process.argv[1],
      '--root', compareRoot,
      '--profile', 'raw',
      '--json',
      '--top', String(topN),
      ...(folderFilter ? ['--folder', folderFilter] : []),
      ...(repoFilter ? ['--repo', repoFilter] : []),
      ...(modeFilter ? ['--mode', modeFilter] : []),
      ...(latestCount ? ['--latest', String(latestCount)] : [])
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env
    }
  );
  if (compareResult.status !== 0) {
    throw new Error(compareResult.stderr || compareResult.stdout || 'compare profile failed');
  }
  const baseline = JSON.parse(String(compareResult.stdout || '{}'));
  const currentFolders = new Map(outputSummary.folders.map((entry) => [entry.folder, entry]));
  const baselineFolders = new Map((baseline.folders || []).map((entry) => [entry.folder, entry]));
  const rows = [];
  for (const folder of new Set([...currentFolders.keys(), ...baselineFolders.keys()])) {
    const current = currentFolders.get(folder) || {};
    const prior = baselineFolders.get(folder) || {};
    rows.push({
      folder,
      currentChunks: current.codeChunksMedian ?? null,
      baselineChunks: prior.codeChunksMedian ?? null,
      deltaChunksPct: Number.isFinite(current.codeChunksMedian) && Number.isFinite(prior.codeChunksMedian) && prior.codeChunksMedian > 0
        ? ((current.codeChunksMedian - prior.codeChunksMedian) / prior.codeChunksMedian)
        : null,
      currentBuild: current.buildIndexMedian ?? null,
      baselineBuild: prior.buildIndexMedian ?? null,
      deltaBuildPct: Number.isFinite(current.buildIndexMedian) && Number.isFinite(prior.buildIndexMedian) && prior.buildIndexMedian > 0
        ? ((current.buildIndexMedian - prior.buildIndexMedian) / prior.buildIndexMedian)
        : null
    });
  }
  console.log('Compare Overview');
  for (const row of sortRows(rows.map((entry) => ({
    ...entry,
    label: entry.folder,
    regressionSeverity: Math.abs(Number(entry.deltaBuildPct) || 0) + Math.abs(Number(entry.deltaChunksPct) || 0)
  })), sortMetric).slice(0, topN)) {
    console.log(
      `${row.folder}: chunks ${formatNumber(row.currentChunks)} vs ${formatNumber(row.baselineChunks)} ` +
      `(${formatPct(row.deltaChunksPct)}) | build ${formatMs(row.currentBuild)} vs ${formatMs(row.baselineBuild)} ` +
      `(${formatPct(row.deltaBuildPct)})`
    );
  }
};

if (!shouldRenderTextOverview) {
  if (jsonOutput || profile === 'raw') {
    console.log(JSON.stringify(outputSummary, null, 2));
  } else if (csvOutput) {
    const rows = profile === 'repo' ? buildRepoRows() : buildFamilyRows();
    printCsv(rows);
  } else if (profile === 'family') {
    printFamilyText(buildFamilyRows());
  } else if (profile === 'repo') {
    printRepoText(buildRepoRows());
  } else if (profile === 'compare') {
    printCompareText();
  } else {
    console.log(JSON.stringify(outputSummary, null, 2));
  }
}

