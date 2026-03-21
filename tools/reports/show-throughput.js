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
  printAlignedTotalLine,
  formatModeThroughputLine,
  formatModeChunkRate,
  formatSectionMetaLine,
  buildIndexedTotalsRows,
  formatThroughputTotalsCell,
  formatAstField,
  formatDistributionSummary,
  formatDistributionCell
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

const formatDistributionMsSummary = (summary) => formatDistributionSummary(summary, {
  digits: 1,
  formatter: (value) => formatMs(value)
});

const formatDistributionRateSummary = (summary, unitLabel) => {
  if (!summary) return `${unitLabel} n/a`;
  return `${unitLabel} ${formatDistributionSummary(summary)}`;
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
  console.error(color.bold(color.cyan('Benchmark Performance Overview')));
  console.error(color.gray(`Root: ${resultsRoot}`));
}
if (refreshJson && shouldRenderTextOverview) {
  const depthLabel = deepAnalysis ? 'deep analysis enabled' : 'deep analysis disabled';
  console.error(color.gray(`Refresh mode: writing benchmark JSON summaries (${depthLabel}).`));
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
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : null
    });
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
    console.error('');
    console.error(color.bold(color.blue(header)));
  }

  if (!runs.length) {
    if (shouldRenderTextOverview) {
      console.error(color.gray('  No benchmark JSON files found.'));
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
  const compactModeLine = [
    formatModeChunkRate('code', codeDistribution),
    formatModeChunkRate('prose', proseDistribution),
    formatModeChunkRate('xprose', extractedProseDistribution),
    formatModeChunkRate('records', recordsDistribution)
  ].join(' | ');
  console.error(`  ch/s p50/p95 ${compactModeLine}`);

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

  if (!verboseOutput) {
    if (aggregateIndexed.lines > 0 || aggregateIndexed.files > 0) {
      console.error(
        `  indexed ${formatCount(aggregateIndexed.lines)} lines | ` +
        `${formatCount(aggregateIndexed.files)} files | ${formatBytes(aggregateIndexed.bytes)} | ` +
        `${formatNumber(aggregateLinesPerSec)} lines/s`
      );
    }
    if (summaries.length) {
      console.error(
        `  perf build ${formatDistributionCell(buildIndexMs)} / ${formatDistributionCell(buildSqliteMs)} ms | ` +
        `query ${formatDistributionCell(wallPerQuery)} ms | search ${formatDistributionCell(wallPerSearch)} ms`
      );
      console.error(
        `  lat mean mem/sql ${formatDistributionCell(memoryMean)} / ${formatDistributionCell(sqliteMean)} ms | ` +
        `run-p95 ${formatDistributionCell(memoryP95)} / ${formatDistributionCell(sqliteP95)} ms`
      );
    }
    console.error(
      `  coverage repo ${formatCoverageSummary(outcomeTotalsFolder.repos)} | ` +
      `runs ${formatCoverageSummary(outcomeTotalsFolder.runs)}`
    );
    console.error(
      `  skip/cache ${formatCountMapSummary(outcomeTotalsFolder.repos.skipReasons)} | ` +
      `${formatCacheSummary(outcomeTotalsFolder.repos)}`
    );
    console.error(
      `  quality ${formatCountMapSummary(outcomeTotalsFolder.runs.confidence)} | ` +
      `low-yield ${formatCount(outcomeTotalsFolder.runs.lowYield.triggered)} ` +
      `(${formatCount(outcomeTotalsFolder.runs.lowYield.skippedFiles)} skipped) | ` +
      `filter-index reused ${formatCount(outcomeTotalsFolder.runs.filterIndexReused)} | ` +
      `diagnostics ${formatCountMapSummary(outcomeTotalsFolder.runs.diagnostics, 3)}`
    );
    console.error(`  pressure ${formatResourceSummary(outcomeTotalsFolder.runs)}`);
    if (hasAstGraphValues(astGraphTotalsFolder.totals)) {
      const coverage = runs.length ? `${astGraphTotalsFolder.repos}/${runs.length}` : `${astGraphTotalsFolder.repos}/0`;
      console.error(
        `  ast (${coverage}) symbols ${formatAstField(astGraphTotalsFolder, 'symbols')} | ` +
        `classes ${formatAstField(astGraphTotalsFolder, 'classes')} | ` +
        `functions ${formatAstField(astGraphTotalsFolder, 'functions')} | ` +
        `imports ${formatAstField(astGraphTotalsFolder, 'imports')}`
      );
    }
    if (folderLedgerRegressions.length) {
      const top = folderLedgerRegressions[0];
      console.error(
        `  ledger regression ${top.repoIdentity} ${top.modality}/${top.stage} ` +
        `${formatPct(top.deltaPct)} ${top.metricLabel} ` +
        `(${formatRegressionDelta(top)} | ${top.baselineConfidence} conf)`
      );
    }
    console.error(
      `  provenance idx ${formatSectionProvenance(provenanceTotalsFolder, 'indexing')} | ` +
      `analysis ${formatSectionProvenance(provenanceTotalsFolder, 'analysis')} | ` +
      `ledger ${formatSectionProvenance(provenanceTotalsFolder, 'throughputLedger')}`
    );
    continue;
  }

  console.error(`  ${formatModeThroughputLine({ label: 'Code', entry: codeDistribution })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Prose', entry: proseDistribution })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'XProse', entry: extractedProseDistribution })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Records', entry: recordsDistribution })}`);

  const indexedRows = buildIndexedTotalsRows(modeTotalsFolder);
  if (indexedRows.length) {
    const lineWidth = Math.max(...indexedRows.map((row) => row.linesText.length));
    const fileWidth = Math.max(...indexedRows.map((row) => row.filesText.length));
    const bytesWidth = Math.max(...indexedRows.map((row) => row.bytesText.length));
    const rateWidth = Math.max(...indexedRows.map((row) => row.linesPerSecText.length));
    console.error(`  ${color.bold('Indexed totals')}:`);
    for (const row of indexedRows) {
      console.error(
        `    ${row.label.padStart(8)}: ${row.linesText.padStart(lineWidth)} | ` +
        `${row.filesText.padStart(fileWidth)} | ` +
        `${row.bytesText.padStart(bytesWidth)} | ` +
        `${row.linesPerSecText.padStart(rateWidth)} | ` +
        `${row.msPerLineText}`
      );
    }

    const aggregate = Array.from(modeTotalsFolder.values()).reduce(
      (acc, entry) => {
        acc.lines += Number.isFinite(entry.lines) ? entry.lines : 0;
        acc.files += Number.isFinite(entry.files) ? entry.files : 0;
        acc.bytes += Number.isFinite(entry.bytes) ? entry.bytes : 0;
        acc.durationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
        return acc;
      },
      { lines: 0, files: 0, bytes: 0, durationMs: 0 }
    );
    const aggregateLinesPerSec = aggregate.durationMs > 0 ? (aggregate.lines / (aggregate.durationMs / 1000)) : null;
    const aggregateMsPerLine = (aggregate.durationMs > 0 && aggregate.lines > 0)
      ? (aggregate.durationMs / aggregate.lines)
      : null;
    const aggregateLinesText = `${formatCount(aggregate.lines)} lines`;
    const aggregateFilesText = `${formatCount(aggregate.files)} files`;
    const aggregateBytesText = formatBytes(aggregate.bytes);
    const aggregateRateText = `${formatNumber(aggregateLinesPerSec)} lines/s`;
    const aggregateMsPerLineText = `${formatNumber(aggregateMsPerLine, 3)} ms/line`;
    console.error(
      `     Aggregate: ` +
      `${aggregateLinesText.padStart(lineWidth)} | ` +
      `${aggregateFilesText.padStart(fileWidth)} | ` +
      `${aggregateBytesText.padStart(bytesWidth)} | ` +
      `${aggregateRateText.padStart(rateWidth)} | ` +
      `${aggregateMsPerLineText}`
    );
  }

  if (summaries.length) {
    console.error(
      formatSectionMetaLine({
        label: 'Build',
        left: `index ${formatDistributionCell(buildIndexMs)} ms`,
        right: `sqlite ${formatDistributionCell(buildSqliteMs)} ms`
      })
    );

    console.error(
      formatSectionMetaLine({
        label: 'Query',
        left: `avg/q ${formatDistributionCell(wallPerQuery)} ms`,
        right: `avg/search ${formatDistributionCell(wallPerSearch)} ms`
      })
    );
    console.error('  Latency');
    console.error(
      `      mean mem: ${formatDistributionSummary(memoryMean, { formatter: (value) => `${formatNumber(value)}ms` })}` +
      ` | sqlite: ${formatDistributionSummary(sqliteMean, { formatter: (value) => `${formatNumber(value)}ms` })}`
    );
    console.error(
      `      run-p95 mem: ${formatDistributionSummary(memoryP95, { formatter: (value) => `${formatNumber(value)}ms` })}` +
      ` | sqlite: ${formatDistributionSummary(sqliteP95, { formatter: (value) => `${formatNumber(value)}ms` })}`
    );
  }

  if (hasAstGraphValues(astGraphTotalsFolder.totals)) {
    const coverage = runs.length ? `${astGraphTotalsFolder.repos}/${runs.length}` : `${astGraphTotalsFolder.repos}/0`;
    console.error(
      `  ${color.bold(`AST/Graph (${coverage} runs)`)}: ` +
      `symbols ${formatAstField(astGraphTotalsFolder, 'symbols')} | ` +
      `classes ${formatAstField(astGraphTotalsFolder, 'classes')} | ` +
      `functions ${formatAstField(astGraphTotalsFolder, 'functions')} | ` +
      `imports ${formatAstField(astGraphTotalsFolder, 'imports')} | ` +
      `file links ${formatAstField(astGraphTotalsFolder, 'fileLinks')} | ` +
      `graph links ${formatAstField(astGraphTotalsFolder, 'graphLinks')}`
    );
  }
  if (folderLedgerRegressions.length) {
    console.error(`  ${color.bold('Top Throughput Regressions')}:`);
    for (const regression of folderLedgerRegressions.slice(0, 5)) {
      console.error(
        `    ${regression.repoIdentity} | ${regression.modality}/${regression.stage} | ` +
        `${regression.metricLabel} | ${formatPct(regression.deltaPct)} | ` +
        `${formatRegressionDelta(regression)} | ${regression.baselineConfidence} conf`
      );
    }
  }
  console.error(`  ${color.bold('Scan Outcomes')}:`);
  console.error(
    `    coverage repo ${formatCoverageSummary(outcomeTotalsFolder.repos)} | ` +
    `runs ${formatCoverageSummary(outcomeTotalsFolder.runs)}`
  );
  console.error(`    skip reasons ${formatCountMapSummary(outcomeTotalsFolder.repos.skipReasons, 6)}`);
  console.error(
    `    cache ${formatCacheSummary(outcomeTotalsFolder.repos)} | ` +
    `filter-index reused ${formatCount(outcomeTotalsFolder.runs.filterIndexReused)}`
  );
  console.error(
    `    quality ${formatCountMapSummary(outcomeTotalsFolder.runs.confidence)} | ` +
    `low-yield triggers ${formatCount(outcomeTotalsFolder.runs.lowYield.triggered)} ` +
    `(${formatCount(outcomeTotalsFolder.runs.lowYield.skippedFiles)} skipped files) | ` +
    `diagnostics ${formatCountMapSummary(outcomeTotalsFolder.runs.diagnostics, 4)}`
  );
  console.error(`    pressure ${formatResourceSummary(outcomeTotalsFolder.runs)}`);
  console.error(
    `  ${color.bold('Provenance')}: ` +
    `indexing ${formatSectionProvenance(provenanceTotalsFolder, 'indexing')} | ` +
    `analysis ${formatSectionProvenance(provenanceTotalsFolder, 'analysis')} | ` +
    `ledger ${formatSectionProvenance(provenanceTotalsFolder, 'throughputLedger')}`
  );

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

  console.error('');
  console.error(color.gray(
    `${`(${runs.length} run${runs.length === 1 ? '' : 's'})`.padStart(repoWidth)}` +
    ` | ${'code'.padStart(codeWidth)}` +
    ` | ${'prose'.padStart(proseWidth)}` +
    ` | ${'xprose'.padStart(xproseWidth)}` +
    ` | ${'records'.padStart(recordsWidth)}` +
    ` | ${'query'.padStart(queryWidth)}`
  ));
  for (const row of runRows) {
    console.error(
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
    acc.durationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
    return acc;
  },
  { lines: 0, durationMs: 0 }
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

const chunksWidth = Math.max(...modeRows.map((row) => row.chunksCell.length));
const tokensWidth = Math.max(...modeRows.map((row) => row.tokensCell.length));
const bytesWidth = Math.max(...modeRows.map((row) => row.bytesCell.length));
const filesWidth = Math.max(...modeRows.map((row) => row.filesCell.length));
const linesWidth = Math.max(0, ...modeRows.map((row) => row.linesCell.length));

if (shouldRenderTextOverview) {
  console.error('');
  console.error(color.bold(color.green('Throughput Totals')));
  printAlignedTotalLine('Files', `${formatNumber(totalFilesPerSec)} files/s`);
  printAlignedTotalLine('Chunks', `${formatNumber(totalChunksPerSec)} chunks/s`);
  printAlignedTotalLine('Tokens', `${formatNumber(totalTokensPerSec)} tokens/s`);
  printAlignedTotalLine('Bytes', formatBytesPerSec(totalBytesPerSec));
  if (Number.isFinite(totalLinesPerSec)) {
    printAlignedTotalLine('Lines', `${formatNumber(totalLinesPerSec)} lines/s`);
  }
  for (const row of modeRows) {
    const linesText = row.linesCell ? row.linesCell.padStart(linesWidth) : '';
    printAlignedTotalLine(
      row.label,
      `${row.chunksCell.padStart(chunksWidth)} | ` +
      `${row.tokensCell.padStart(tokensWidth)} | ` +
      `${row.bytesCell.padStart(bytesWidth)} | ` +
      `${row.filesCell.padStart(filesWidth)} | ` +
      `${linesText}`
    );
  }
  for (const { label, pick } of THROUGHPUT_GROUPS) {
    if (['Code throughput', 'Prose throughput', 'Extracted prose throughput', 'Records throughput']
      .some((entry) => entry.toLowerCase() === label.toLowerCase())) {
      continue;
    }
    const entry = pick(totalThroughput);
    const chunksPerSec = rateFromTotals(entry, 'chunks');
    const tokensPerSec = rateFromTotals(entry, 'tokens');
    const bytesPerSec = rateFromTotals(entry, 'bytes');
    const filesPerSec = rateFromTotals(entry, 'files');
    if (!Number.isFinite(chunksPerSec)
      && !Number.isFinite(tokensPerSec)
      && !Number.isFinite(bytesPerSec)
      && !Number.isFinite(filesPerSec)) {
      continue;
    }
    printAlignedTotalLine(
      label,
      `${formatNumber(chunksPerSec)} chunks/s | ` +
      `${formatNumber(tokensPerSec)} tokens/s | ` +
      `${formatBytesPerSec(bytesPerSec)} | ` +
      `${formatNumber(filesPerSec)} files/s`
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
console.error(color.bold('Run Distributions'));
for (const [label, distribution] of [
  ['Code', globalCodeDistribution],
  ['Prose', globalProseDistribution],
  ['XProse', globalExtractedProseDistribution],
  ['Records', globalRecordsDistribution]
]) {
  console.error(
    `  ${label.padStart(8)}: ` +
    `${formatDistributionRateSummary(distribution?.chunksPerSec, 'chunks/s')} | ` +
    `${formatDistributionRateSummary(distribution?.filesPerSec, 'files/s')}`
  );
}
console.error(
  `  ${'Build'.padStart(8)}: index ${formatDistributionMsSummary(globalBuildIndexDistribution)} | ` +
  `sqlite ${formatDistributionMsSummary(globalBuildSqliteDistribution)}`
);
console.error(
  `  ${'Query'.padStart(8)}: per-query ${formatDistributionMsSummary(globalQueryDistribution)} | ` +
  `per-search ${formatDistributionMsSummary(globalSearchDistribution)}`
);
console.error(
  `  ${'Latency'.padStart(8)}: mem mean ${formatDistributionMsSummary(globalLatency.memory?.mean)} | ` +
  `mem run-p95 ${formatDistributionMsSummary(globalLatency.memory?.p95)}`
);
console.error(
  `  ${''.padStart(8)}  sqlite mean ${formatDistributionMsSummary(globalLatency.sqlite?.mean)} | ` +
  `sqlite run-p95 ${formatDistributionMsSummary(globalLatency.sqlite?.p95)}`
);
if (shouldRenderTextOverview && ledgerRegressionsGlobal.length) {
  ledgerRegressionsGlobal.sort((left, right) => (
    left.metricKind === 'duration'
      ? (Number(right.deltaPct) - Number(left.deltaPct))
      : (Number(left.deltaPct) - Number(right.deltaPct))
  ) || String(left.repoIdentity || '').localeCompare(String(right.repoIdentity || '')));
  console.error(color.bold(
    `Top Throughput Regressions (schema v${THROUGHPUT_LEDGER_SCHEMA_VERSION}/diff v${THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION})`
  ));
  for (const entry of ledgerRegressionsGlobal.slice(0, 8)) {
    console.error(
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
  console.error(color.bold('Top Variability'));
  for (const entry of variabilityRows.slice(0, 8)) {
    console.error(
      `  ${entry.folder} ${entry.label}: cv ${formatPct(entry.coefficientOfVariation)} | ` +
      `p50/p95 ${formatNumber(entry.median)}/${formatNumber(entry.p95)} | n ${formatCount(entry.count)}`
    );
  }
}
if (shouldRenderTextOverview && hasAstGraphValues(astGraphTotalsGlobal.totals)) {
  const astPairs = [
    ['Symbols', formatAstField(astGraphTotalsGlobal, 'symbols'), 'Classes', formatAstField(astGraphTotalsGlobal, 'classes')],
    ['Functions', formatAstField(astGraphTotalsGlobal, 'functions'), 'Imports', formatAstField(astGraphTotalsGlobal, 'imports')],
    ['File links', formatAstField(astGraphTotalsGlobal, 'fileLinks'), 'Graph links', formatAstField(astGraphTotalsGlobal, 'graphLinks')]
  ];
  const astLabelWidth = Math.max(...astPairs.flatMap(([leftLabel, , rightLabel]) => [leftLabel.length, rightLabel.length]));
  const astValueWidth = Math.max(...astPairs.flatMap(([, leftValue, , rightValue]) => [String(leftValue).length, String(rightValue).length]));
  console.error(color.bold('AST/Graph Totals'));
  for (const [leftLabel, leftValue, rightLabel, rightValue] of astPairs) {
    console.error(
      `  ${leftLabel.padStart(astLabelWidth)}: ${String(leftValue).padStart(astValueWidth)} | ` +
      `${rightLabel.padStart(astLabelWidth)}: ${String(rightValue).padStart(astValueWidth)}`
    );
  }
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
  const lineWidth = Math.max(...totalsByModeRows.map((row) => row.linesText.length));
  const fileWidth = Math.max(...totalsByModeRows.map((row) => row.filesText.length));
  const bytesWidth = Math.max(...totalsByModeRows.map((row) => row.bytesText.length));
  const rateWidth = Math.max(...totalsByModeRows.map((row) => row.lineRateText.length));
  console.error('');
  console.error('  Totals by Mode:');
  for (const row of totalsByModeRows) {
    console.error(
      `  ${row.label.padStart(8)}: ${row.linesText.padStart(lineWidth)} | ` +
      `${row.filesText.padStart(fileWidth)} | ` +
      `${row.bytesText.padStart(bytesWidth)} | ` +
      `${row.lineRateText.padStart(rateWidth)} | ` +
      `${row.msPerLineText}`
    );
  }
}
if (shouldRenderTextOverview && languageTotals.size) {
  const sortedLanguages = Array.from(languageTotals.entries())
    .sort((a, b) => b[1] - a[1]);
  const languageDisplayLimit = verboseOutput ? sortedLanguages.length : 12;
  const displayed = sortedLanguages.slice(0, languageDisplayLimit);
  const omitted = sortedLanguages.slice(languageDisplayLimit);
  const omittedLines = omitted.reduce((sum, [, lines]) => sum + (Number(lines) || 0), 0);
  console.error('');
  if (!verboseOutput) {
    const summary = displayed
      .map(([language, lines]) => `${language} ${formatCount(lines)}`)
      .join(' | ');
    const omittedLabel = omitted.length
      ? ` | other ${formatCount(omittedLines)} (${omitted.length})`
      : '';
    console.error(`Lines by Language (top ${displayed.length}): ${summary}${omittedLabel}`);
  } else {
    const languageWidth = Math.max(...displayed.map(([language]) => language.length));
    const countWidth = Math.max(...displayed.map(([, lines]) => formatCount(lines).length));
    console.error('Lines by Language:');
    for (const [language, lines] of displayed) {
      console.error(`  ${language.padStart(languageWidth)}: ${formatCount(lines).padStart(countWidth)} `);
    }
  }
}
if (shouldRenderTextOverview) {
  console.error('');
  console.error(color.bold('Scan Outcome Totals'));
  console.error(`  coverage repos: ${formatCoverageSummary(outcomeTotalsGlobal.repos)}`);
  console.error(`  coverage runs: ${formatCoverageSummary(outcomeTotalsGlobal.runs)}`);
  console.error(`  skip reasons: ${formatCountMapSummary(outcomeTotalsGlobal.repos.skipReasons, 8)}`);
  console.error(`  cache: ${formatCacheSummary(outcomeTotalsGlobal.repos)}`);
  console.error(
    `  quality: ${formatCountMapSummary(outcomeTotalsGlobal.runs.confidence)} | ` +
    `low-yield ${formatCount(outcomeTotalsGlobal.runs.lowYield.triggered)} ` +
    `(${formatCount(outcomeTotalsGlobal.runs.lowYield.skippedFiles)} skipped files) | ` +
    `filter-index reused ${formatCount(outcomeTotalsGlobal.runs.filterIndexReused)} | ` +
    `diagnostics ${formatCountMapSummary(outcomeTotalsGlobal.runs.diagnostics, 6)}`
  );
  console.error(`  pressure: ${formatResourceSummary(outcomeTotalsGlobal.runs)}`);
  console.error('');
  console.error(color.bold('Overview Provenance'));
  console.error(`  indexing: ${formatSectionProvenance(provenanceTotalsGlobal, 'indexing')}`);
  console.error(`  analysis: ${formatSectionProvenance(provenanceTotalsGlobal, 'analysis')}`);
  console.error(`  throughput ledger: ${formatSectionProvenance(provenanceTotalsGlobal, 'throughputLedger')}`);
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
