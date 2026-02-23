import {
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
  mean,
  collect,
  meanThroughput
} from './aggregate.js';
import {
  createAstGraphTotals,
  createAstGraphObserved,
  mergeAstGraphTotals,
  mergeAstGraphObserved,
  hasAstGraphValues,
  applyRunThroughputLedgerDiffs,
  collectRunLedgerRegressions
} from './analysis.js';

const createTotalThroughput = () => ({
  code: createRateTotals(),
  prose: createRateTotals(),
  extractedProse: createRateTotals(),
  records: createRateTotals(),
  lmdb: {
    code: createRateTotals(),
    prose: createRateTotals()
  }
});

const createAstGraphAggregate = () => ({
  repos: 0,
  totals: createAstGraphTotals(),
  observed: createAstGraphObserved()
});

/**
 * Indexing totals must be merged once per repo identity. Benchmark folders often
 * contain historical runs for the same repo; without dedupe, line/file totals are
 * inflated and lines/s rates are biased downward.
 */
const mergeRunIndexingMetrics = ({
  run,
  modeTotalsFolder,
  modeTotalsGlobal,
  languageTotals,
  folderReposWithMetrics,
  reposWithMetrics
}) => {
  const repoMetricsKey = run.repoMetricsKey;
  if (!repoMetricsKey) return;
  if (isValidIndexingSummary(run.indexingSummary)) {
    if (!folderReposWithMetrics.has(repoMetricsKey)) {
      mergeModeTotalsFromIndexingSummary(run.indexingSummary, modeTotalsFolder);
      folderReposWithMetrics.add(repoMetricsKey);
    }
    if (!reposWithMetrics.has(repoMetricsKey)) {
      mergeModeTotalsFromIndexingSummary(run.indexingSummary, modeTotalsGlobal);
      collectLanguageLinesFromSummary(run.indexingSummary, languageTotals);
      reposWithMetrics.add(repoMetricsKey);
    }
    return;
  }

  if (!folderReposWithMetrics.has(repoMetricsKey) && run.featureMetrics) {
    mergeModeTotalsFromFeatureMetrics(run.featureMetrics, modeTotalsFolder);
    folderReposWithMetrics.add(repoMetricsKey);
  }

  if (!reposWithMetrics.has(repoMetricsKey)) {
    if (run.featureMetrics) {
      collectLanguageLines(run.featureMetrics, languageTotals);
      mergeModeTotalsFromFeatureMetrics(run.featureMetrics, modeTotalsGlobal);
    }
    reposWithMetrics.add(repoMetricsKey);
  }
};

const sortRunsChronologically = (runs) => [...runs].sort((left, right) => {
  const leftTime = Number(left.generatedAtMs);
  const rightTime = Number(right.generatedAtMs);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left.file).localeCompare(String(right.file));
});

/**
 * Mode totals only carry duration for buckets that have line counts. Summing the
 * map is therefore safe for lines/s and avoids counting fallback throughput-only
 * durations that cannot produce line rates.
 */
export const summarizeIndexedTotals = (modeTotalsMap) => Array.from(modeTotalsMap.values()).reduce(
  (acc, entry) => {
    acc.lines += Number.isFinite(entry.lines) ? entry.lines : 0;
    acc.files += Number.isFinite(entry.files) ? entry.files : 0;
    acc.bytes += Number.isFinite(entry.bytes) ? entry.bytes : 0;
    acc.durationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
    return acc;
  },
  { lines: 0, files: 0, bytes: 0, durationMs: 0 }
);

const buildFolderLatencySummary = (summaries) => {
  const backendLatency = {};
  for (const summary of summaries) {
    const latency = summary.latencyMs || {};
    for (const [backend, stats] of Object.entries(latency)) {
      if (!backendLatency[backend]) backendLatency[backend] = { mean: [], p95: [] };
      if (Number.isFinite(stats?.mean)) backendLatency[backend].mean.push(stats.mean);
      if (Number.isFinite(stats?.p95)) backendLatency[backend].p95.push(stats.p95);
    }
  }
  return {
    memoryMean: mean(backendLatency.memory?.mean || []),
    memoryP95: mean(backendLatency.memory?.p95 || []),
    sqliteMean: mean(backendLatency.sqlite?.mean || []),
    sqliteP95: mean(backendLatency.sqlite?.p95 || [])
  };
};

const buildFolderAverages = (runs) => {
  const throughputs = runs.map((run) => run.throughput);
  const summaries = runs.map((run) => run.summary).filter(Boolean);
  const latency = buildFolderLatencySummary(summaries);
  return {
    avgCode: meanThroughput(throughputs, (throughput) => throughput?.code || null),
    avgProse: meanThroughput(throughputs, (throughput) => throughput?.prose || null),
    avgXProse: meanThroughput(throughputs, (throughput) => throughput?.extractedProse || null),
    avgRecords: meanThroughput(throughputs, (throughput) => throughput?.records || null),
    buildIndexMs: summaries.length ? mean(collect(summaries, (summary) => summary.buildMs?.index)) : null,
    buildSqliteMs: summaries.length ? mean(collect(summaries, (summary) => summary.buildMs?.sqlite)) : null,
    wallPerQuery: summaries.length ? mean(collect(summaries, (summary) => summary.queryWallMsPerQuery)) : null,
    wallPerSearch: summaries.length ? mean(collect(summaries, (summary) => summary.queryWallMsPerSearch)) : null,
    ...latency
  };
};

const buildModeRows = ({ totalThroughput, modeTotalsGlobal }) => MODE_THROUGHPUT_TOTALS.map(({
  label,
  pick,
  modeKey
}) => {
  const entry = pick(totalThroughput);
  const bytesRate = rateFromTotals(entry, 'bytes');
  const linesBucket = modeTotalsGlobal.get(modeKey);
  const linesPerSec = (
    Number.isFinite(linesBucket?.durationMs)
    && linesBucket.durationMs > 0
    && Number.isFinite(linesBucket?.lines)
  )
    ? (linesBucket.lines / (linesBucket.durationMs / 1000))
    : null;
  return {
    label,
    chunksRate: rateFromTotals(entry, 'chunks'),
    tokensRate: rateFromTotals(entry, 'tokens'),
    bytesMbRate: Number.isFinite(bytesRate) ? (bytesRate / (1024 * 1024)) : null,
    filesRate: rateFromTotals(entry, 'files'),
    linesPerSec
  };
});

const buildGlobalRates = (totalThroughput) => ({
  totalFilesPerSec: sumRates(
    rateFromTotals(totalThroughput.code, 'files'),
    rateFromTotals(totalThroughput.prose, 'files'),
    rateFromTotals(totalThroughput.extractedProse, 'files'),
    rateFromTotals(totalThroughput.records, 'files')
  ),
  totalChunksPerSec: sumRates(
    rateFromTotals(totalThroughput.code, 'chunks'),
    rateFromTotals(totalThroughput.prose, 'chunks'),
    rateFromTotals(totalThroughput.extractedProse, 'chunks'),
    rateFromTotals(totalThroughput.records, 'chunks')
  ),
  totalTokensPerSec: sumRates(
    rateFromTotals(totalThroughput.code, 'tokens'),
    rateFromTotals(totalThroughput.prose, 'tokens'),
    rateFromTotals(totalThroughput.extractedProse, 'tokens'),
    rateFromTotals(totalThroughput.records, 'tokens')
  ),
  totalBytesPerSec: sumRates(
    rateFromTotals(totalThroughput.code, 'bytes'),
    rateFromTotals(totalThroughput.prose, 'bytes'),
    rateFromTotals(totalThroughput.extractedProse, 'bytes'),
    rateFromTotals(totalThroughput.records, 'bytes')
  )
});

/**
 * @param {Array<{name:string,runs:Array<object>}>} folders
 * @returns {{
 *   folders:Array<object>,
 *   global:{
 *     totalThroughput:object,
 *     modeTotals:Map<string, object>,
 *     modeRows:Array<object>,
 *     totalsRates:object,
 *     totalLinesPerSec:number|null,
 *     languageTotals:Map<string, number>,
 *     astGraphTotals:object,
 *     ledgerRegressions:Array<object>
 *   }
 * }}
 */
export const aggregateThroughputReport = (folders) => {
  const totalThroughput = createTotalThroughput();
  const modeTotalsGlobal = createModeTotalsMap();
  /** @type {Map<string, number>} */
  const languageTotals = new Map();
  const reposWithMetrics = new Set();
  const astGraphTotalsGlobal = createAstGraphAggregate();
  const ledgerRegressionsGlobal = [];
  const folderReports = [];

  for (const folder of folders) {
    const modeTotalsFolder = createModeTotalsMap();
    const folderReposWithMetrics = new Set();
    const astGraphTotalsFolder = createAstGraphAggregate();
    const runs = sortRunsChronologically(folder.runs || []);

    for (const run of runs) {
      mergeTotals(totalThroughput.code, run.throughput?.code);
      mergeTotals(totalThroughput.prose, run.throughput?.prose);
      mergeTotals(totalThroughput.extractedProse, run.throughput?.extractedProse);
      mergeTotals(totalThroughput.records, run.throughput?.records);
      mergeTotals(totalThroughput.lmdb.code, run.throughput?.lmdb?.code);
      mergeTotals(totalThroughput.lmdb.prose, run.throughput?.lmdb?.prose);
      mergeRunIndexingMetrics({
        run,
        modeTotalsFolder,
        modeTotalsGlobal,
        languageTotals,
        folderReposWithMetrics,
        reposWithMetrics
      });
      if (run.analysis && hasAstGraphValues(run.analysis.totals)) {
        astGraphTotalsFolder.repos += 1;
        astGraphTotalsGlobal.repos += 1;
        mergeAstGraphTotals(astGraphTotalsFolder.totals, run.analysis.totals);
        mergeAstGraphTotals(astGraphTotalsGlobal.totals, run.analysis.totals);
        mergeAstGraphObserved(astGraphTotalsFolder.observed, run.analysis);
        mergeAstGraphObserved(astGraphTotalsGlobal.observed, run.analysis);
      }
    }

    // Ledger regression diffs must be computed against chronological run order.
    applyRunThroughputLedgerDiffs(runs);
    const folderLedgerRegressions = collectRunLedgerRegressions(runs);
    if (folderLedgerRegressions.length) {
      ledgerRegressionsGlobal.push(
        ...folderLedgerRegressions.map((entry) => ({ ...entry, folder: folder.name }))
      );
    }

    folderReports.push({
      name: folder.name,
      runs,
      averages: buildFolderAverages(runs),
      modeTotals: modeTotalsFolder,
      indexedTotals: summarizeIndexedTotals(modeTotalsFolder),
      astGraphTotals: astGraphTotalsFolder,
      ledgerRegressions: folderLedgerRegressions
    });
  }

  const aggregateModeTotalsGlobal = summarizeIndexedTotals(modeTotalsGlobal);
  const totalLinesPerSec = aggregateModeTotalsGlobal.durationMs > 0
    ? (aggregateModeTotalsGlobal.lines / (aggregateModeTotalsGlobal.durationMs / 1000))
    : null;

  return {
    folders: folderReports,
    global: {
      totalThroughput,
      modeTotals: modeTotalsGlobal,
      modeRows: buildModeRows({ totalThroughput, modeTotalsGlobal }),
      totalsRates: buildGlobalRates(totalThroughput),
      totalLinesPerSec,
      languageTotals,
      astGraphTotals: astGraphTotalsGlobal,
      ledgerRegressions: ledgerRegressionsGlobal
    }
  };
};
