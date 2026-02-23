#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
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
  mean,
  collect,
  meanThroughput
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
  loadOrComputeIndexingSummary,
  loadOrComputeBenchAnalysis,
  resolveRepoIdentity,
  loadOrComputeThroughputLedger,
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
  formatAstField
} from './show-throughput/render.js';

const {
  resultsRoot,
  refreshJson,
  deepAnalysis,
  verboseOutput,
  includeUsrGuardrails
} = resolveShowThroughputOptions({
  argv: process.argv.slice(2),
  cwd: process.cwd()
});

if (!validateResultsRoot(resultsRoot)) {
  console.error(`No benchmark results found at ${resultsRoot}`);
  process.exit(1);
}

const folders = listResultFolders(resultsRoot, { includeUsrGuardrails });
if (!folders.length) {
  console.error('No benchmark results folders found.');
  process.exit(0);
}

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
const languageTotals = new Map();
const modeTotalsGlobal = createModeTotalsMap();
const reposWithMetrics = new Set();
const astGraphTotalsGlobal = { repos: 0, totals: createAstGraphTotals(), observed: createAstGraphObserved() };
const ledgerRegressionsGlobal = [];

console.error(color.bold(color.cyan('Benchmark Performance Overview')));
console.error(color.gray(`Root: ${resultsRoot}`));
if (refreshJson) {
  const depthLabel = deepAnalysis ? 'deep analysis enabled' : 'deep analysis disabled';
  console.error(color.gray(`Refresh mode: writing benchmark JSON summaries (${depthLabel}).`));
}

for (const dir of folders) {
  const folderPath = path.join(resultsRoot, dir.name);
  const files = fs.readdirSync(folderPath)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
  const runs = [];
  const throughputs = [];
  const modeTotalsFolder = createModeTotalsMap();
  const folderReposWithMetrics = new Set();
  const astGraphTotalsFolder = { repos: 0, totals: createAstGraphTotals(), observed: createAstGraphObserved() };

  for (const file of files) {
    const resultPath = path.join(folderPath, file);
    const payload = loadJson(resultPath);
    if (!payload) continue;
    const summary = payload.summary || payload.runs?.[0] || null;
    const throughput = payload.artifacts?.throughput || {};
    let dirty = false;
    const featureMetrics = loadFeatureMetricsForPayload(payload);
    const {
      indexingSummary,
      changed: indexingChanged,
      featureMetrics: resolvedFeatureMetrics
    } = loadOrComputeIndexingSummary({
      payload,
      featureMetrics,
      refreshJson
    });
    if (indexingChanged) dirty = true;
    const { analysis, changed: analysisChanged } = loadOrComputeBenchAnalysis({
      payload,
      featureMetrics: resolvedFeatureMetrics,
      indexingSummary,
      refreshJson,
      deepAnalysis
    });
    if (analysisChanged) dirty = true;
    const { throughputLedger, changed: throughputLedgerChanged } = loadOrComputeThroughputLedger({
      payload,
      indexingSummary
    });
    if (throughputLedgerChanged && refreshJson) dirty = true;
    if (dirty && refreshJson) {
      try {
        fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2));
      } catch {}
    }
    const repoIdentity = resolveRepoIdentity({ payload, file });
    const generatedAtMs = Date.parse(payload?.generatedAt || payload?.summary?.generatedAt || '');
    runs.push({
      file,
      summary,
      throughput,
      analysis,
      indexingSummary,
      throughputLedger,
      repoIdentity,
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : null
    });
    throughputs.push(throughput);
    mergeTotals(totalThroughput.code, throughput.code);
    mergeTotals(totalThroughput.prose, throughput.prose);
    mergeTotals(totalThroughput.extractedProse, throughput.extractedProse);
    mergeTotals(totalThroughput.records, throughput.records);
    mergeTotals(totalThroughput.lmdb.code, throughput?.lmdb?.code);
    mergeTotals(totalThroughput.lmdb.prose, throughput?.lmdb?.prose);
    const repoIdentityForMetrics = payload.repo?.root
      || payload?.artifacts?.repo?.root
      || payload?.artifacts?.repo?.cacheRoot
      || null;
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
  console.error('');
  console.error(color.bold(color.blue(header)));

  if (!runs.length) {
    console.error(color.gray('  No benchmark JSON files found.'));
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
  applyRunThroughputLedgerDiffs(runs);
  const folderLedgerRegressions = collectRunLedgerRegressions(runs);
  if (folderLedgerRegressions.length) {
    ledgerRegressionsGlobal.push(...folderLedgerRegressions.map((entry) => ({ ...entry, folder: dir.name })));
  }

  const avgCode = meanThroughput(throughputs, (throughput) => throughput?.code || null);
  const avgProse = meanThroughput(throughputs, (throughput) => throughput?.prose || null);
  const avgXProse = meanThroughput(throughputs, (throughput) => throughput?.extractedProse || null);
  const avgRecords = meanThroughput(throughputs, (throughput) => throughput?.records || null);
  const compactModeLine = [
    formatModeChunkRate('code', avgCode),
    formatModeChunkRate('prose', avgProse),
    formatModeChunkRate('xprose', avgXProse),
    formatModeChunkRate('records', avgRecords)
  ].join(' | ');
  console.error(`  ch/s ${compactModeLine}`);

  const summaries = runs.map((r) => r.summary).filter(Boolean);
  const buildIndexMs = summaries.length ? mean(collect(summaries, (s) => s.buildMs?.index)) : null;
  const buildSqliteMs = summaries.length ? mean(collect(summaries, (s) => s.buildMs?.sqlite)) : null;
  const wallPerQuery = summaries.length ? mean(collect(summaries, (s) => s.queryWallMsPerQuery)) : null;
  const wallPerSearch = summaries.length ? mean(collect(summaries, (s) => s.queryWallMsPerSearch)) : null;
  const backendLatency = {};
  if (summaries.length) {
    for (const summary of summaries) {
      const latency = summary.latencyMs || {};
      for (const [backend, stats] of Object.entries(latency)) {
        if (!backendLatency[backend]) backendLatency[backend] = { mean: [], p95: [] };
        if (Number.isFinite(stats?.mean)) backendLatency[backend].mean.push(stats.mean);
        if (Number.isFinite(stats?.p95)) backendLatency[backend].p95.push(stats.p95);
      }
    }
  }
  const memoryMean = mean(backendLatency.memory?.mean || []);
  const memoryP95 = mean(backendLatency.memory?.p95 || []);
  const sqliteMean = mean(backendLatency.sqlite?.mean || []);
  const sqliteP95 = mean(backendLatency.sqlite?.p95 || []);

  if (!verboseOutput) {
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
    if (aggregateIndexed.lines > 0 || aggregateIndexed.files > 0) {
      const aggregateLinesPerSec = aggregateIndexed.durationMs > 0
        ? (aggregateIndexed.lines / (aggregateIndexed.durationMs / 1000))
        : null;
      console.error(
        `  indexed ${formatCount(aggregateIndexed.lines)} lines | ` +
        `${formatCount(aggregateIndexed.files)} files | ${formatBytes(aggregateIndexed.bytes)} | ` +
        `${formatNumber(aggregateLinesPerSec)} lines/s`
      );
    }
    if (summaries.length) {
      console.error(
        `  perf build ${formatMs(buildIndexMs)} + sqlite ${formatMs(buildSqliteMs)} | ` +
        `query ${formatMs(wallPerQuery)} | search ${formatMs(wallPerSearch)} | ` +
        `lat mem/sql ${formatNumber(memoryMean)}ms/${formatNumber(sqliteMean)}ms`
      );
    }
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
        `${formatPct(top.deltaPct)} (${formatNumber(top.deltaRate)} ch/s vs ${formatNumber(top.baselineRate)})`
      );
    }
    continue;
  }

  console.error(`  ${formatModeThroughputLine({ label: 'Code', entry: avgCode })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Prose', entry: avgProse })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'XProse', entry: avgXProse })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Records', entry: avgRecords })}`);

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
        left: `index ${formatMs(buildIndexMs)}`,
        right: `sqlite ${formatMs(buildSqliteMs)}`
      })
    );

    console.error(
      formatSectionMetaLine({
        label: 'Query',
        left: `avg/q ${formatMs(wallPerQuery)}`,
        right: `avg/search ${formatMs(wallPerSearch)}`
      })
    );
    console.error('  Latency');
    console.error(
      `      mem: ${formatNumber(memoryMean)}ms` +
      ` | sqlite: ${formatNumber(sqliteMean)}ms`
    );
    console.error(
      `      (p95 ${formatNumber(memoryP95)}ms)` +
      ` | (p95 ${formatNumber(sqliteP95)}ms)`
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
        `${formatPct(regression.deltaPct)} | ` +
        `${formatNumber(regression.currentRate)} vs ${formatNumber(regression.baselineRate)} ch/s`
      );
    }
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
if (ledgerRegressionsGlobal.length) {
  ledgerRegressionsGlobal.sort((left, right) => (
    Number(left.deltaPct) - Number(right.deltaPct)
  ) || String(left.repoIdentity || '').localeCompare(String(right.repoIdentity || '')));
  console.error(color.bold(
    `Top Throughput Regressions (schema v${THROUGHPUT_LEDGER_SCHEMA_VERSION}/diff v${THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION})`
  ));
  for (const entry of ledgerRegressionsGlobal.slice(0, 8)) {
    console.error(
      `  ${entry.folder}/${entry.repoIdentity} ${entry.modality}/${entry.stage}: ` +
      `${formatPct(entry.deltaPct)} | ` +
      `${formatNumber(entry.currentRate)} vs ${formatNumber(entry.baselineRate)} ch/s`
    );
  }
}
if (hasAstGraphValues(astGraphTotalsGlobal.totals)) {
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

if (totalsByModeRows.length) {
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
if (languageTotals.size) {
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
