import { color } from '../../../src/retrieval/cli/ansi.js';
import {
  THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
  THROUGHPUT_LEDGER_SCHEMA_VERSION
} from '../../bench/language/metrics.js';
import { THROUGHPUT_GROUPS, rateFromTotals } from './aggregate.js';
import { hasAstGraphValues } from './analysis.js';
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
} from './render.js';

const renderFolderHeader = (folderName) => {
  console.error('');
  console.error(color.bold(color.blue(folderName)));
};

const renderCompactFolder = (folder) => {
  const compactModeLine = [
    formatModeChunkRate('code', folder.averages.avgCode),
    formatModeChunkRate('prose', folder.averages.avgProse),
    formatModeChunkRate('xprose', folder.averages.avgXProse),
    formatModeChunkRate('records', folder.averages.avgRecords)
  ].join(' | ');
  console.error(`  ch/s ${compactModeLine}`);

  if (folder.indexedTotals.lines > 0 || folder.indexedTotals.files > 0) {
    const aggregateLinesPerSec = folder.indexedTotals.durationMs > 0
      ? (folder.indexedTotals.lines / (folder.indexedTotals.durationMs / 1000))
      : null;
    console.error(
      `  indexed ${formatCount(folder.indexedTotals.lines)} lines | ` +
      `${formatCount(folder.indexedTotals.files)} files | ${formatBytes(folder.indexedTotals.bytes)} | ` +
      `${formatNumber(aggregateLinesPerSec)} lines/s`
    );
  }

  const hasSummaries = folder.runs.some((run) => Boolean(run.summary));
  if (hasSummaries) {
    console.error(
      `  perf build ${formatMs(folder.averages.buildIndexMs)} + sqlite ${formatMs(folder.averages.buildSqliteMs)} | ` +
      `query ${formatMs(folder.averages.wallPerQuery)} | search ${formatMs(folder.averages.wallPerSearch)} | ` +
      `lat mem/sql ${formatNumber(folder.averages.memoryMean)}ms/${formatNumber(folder.averages.sqliteMean)}ms`
    );
  }

  if (hasAstGraphValues(folder.astGraphTotals.totals)) {
    const coverage = folder.runs.length
      ? `${folder.astGraphTotals.repos}/${folder.runs.length}`
      : `${folder.astGraphTotals.repos}/0`;
    console.error(
      `  ast (${coverage}) symbols ${formatAstField(folder.astGraphTotals, 'symbols')} | ` +
      `classes ${formatAstField(folder.astGraphTotals, 'classes')} | ` +
      `functions ${formatAstField(folder.astGraphTotals, 'functions')} | ` +
      `imports ${formatAstField(folder.astGraphTotals, 'imports')}`
    );
  }

  if (folder.ledgerRegressions.length) {
    const top = folder.ledgerRegressions[0];
    console.error(
      `  ledger regression ${top.repoIdentity} ${top.modality}/${top.stage} ` +
      `${formatPct(top.deltaPct)} (${formatNumber(top.deltaRate)} ch/s vs ${formatNumber(top.baselineRate)})`
    );
  }
};

const renderVerboseFolder = (folder) => {
  console.error(`  ${formatModeThroughputLine({ label: 'Code', entry: folder.averages.avgCode })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Prose', entry: folder.averages.avgProse })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'XProse', entry: folder.averages.avgXProse })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Records', entry: folder.averages.avgRecords })}`);

  const indexedRows = buildIndexedTotalsRows(folder.modeTotals);
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

    const aggregateLinesPerSec = folder.indexedTotals.durationMs > 0
      ? (folder.indexedTotals.lines / (folder.indexedTotals.durationMs / 1000))
      : null;
    const aggregateMsPerLine = (folder.indexedTotals.durationMs > 0 && folder.indexedTotals.lines > 0)
      ? (folder.indexedTotals.durationMs / folder.indexedTotals.lines)
      : null;
    const aggregateLinesText = `${formatCount(folder.indexedTotals.lines)} lines`;
    const aggregateFilesText = `${formatCount(folder.indexedTotals.files)} files`;
    const aggregateBytesText = formatBytes(folder.indexedTotals.bytes);
    const aggregateRateText = `${formatNumber(aggregateLinesPerSec)} lines/s`;
    const aggregateMsPerLineText = `${formatNumber(aggregateMsPerLine, 3)} ms/line`;
    console.error(
      '     Aggregate: ' +
      `${aggregateLinesText.padStart(lineWidth)} | ` +
      `${aggregateFilesText.padStart(fileWidth)} | ` +
      `${aggregateBytesText.padStart(bytesWidth)} | ` +
      `${aggregateRateText.padStart(rateWidth)} | ` +
      `${aggregateMsPerLineText}`
    );
  }

  const hasSummaries = folder.runs.some((run) => Boolean(run.summary));
  if (hasSummaries) {
    console.error(
      formatSectionMetaLine({
        label: 'Build',
        left: `index ${formatMs(folder.averages.buildIndexMs)}`,
        right: `sqlite ${formatMs(folder.averages.buildSqliteMs)}`
      })
    );
    console.error(
      formatSectionMetaLine({
        label: 'Query',
        left: `avg/q ${formatMs(folder.averages.wallPerQuery)}`,
        right: `avg/search ${formatMs(folder.averages.wallPerSearch)}`
      })
    );
    console.error('  Latency');
    console.error(
      `      mem: ${formatNumber(folder.averages.memoryMean)}ms` +
      ` | sqlite: ${formatNumber(folder.averages.sqliteMean)}ms`
    );
    console.error(
      `      (p95 ${formatNumber(folder.averages.memoryP95)}ms)` +
      ` | (p95 ${formatNumber(folder.averages.sqliteP95)}ms)`
    );
  }

  if (hasAstGraphValues(folder.astGraphTotals.totals)) {
    const coverage = folder.runs.length
      ? `${folder.astGraphTotals.repos}/${folder.runs.length}`
      : `${folder.astGraphTotals.repos}/0`;
    console.error(
      `  ${color.bold(`AST/Graph (${coverage} runs)`)}: ` +
      `symbols ${formatAstField(folder.astGraphTotals, 'symbols')} | ` +
      `classes ${formatAstField(folder.astGraphTotals, 'classes')} | ` +
      `functions ${formatAstField(folder.astGraphTotals, 'functions')} | ` +
      `imports ${formatAstField(folder.astGraphTotals, 'imports')} | ` +
      `file links ${formatAstField(folder.astGraphTotals, 'fileLinks')} | ` +
      `graph links ${formatAstField(folder.astGraphTotals, 'graphLinks')}`
    );
  }

  if (folder.ledgerRegressions.length) {
    console.error(`  ${color.bold('Top Throughput Regressions')}:`);
    for (const regression of folder.ledgerRegressions.slice(0, 5)) {
      console.error(
        `    ${regression.repoIdentity} | ${regression.modality}/${regression.stage} | ` +
        `${formatPct(regression.deltaPct)} | ` +
        `${formatNumber(regression.currentRate)} vs ${formatNumber(regression.baselineRate)} ch/s`
      );
    }
  }

  const runRows = folder.runs.map((run) => ({
    repoLabel: run.file.replace(/\.json$/, '').replace(/__/g, '/'),
    codeText: `${formatNumber(run.throughput?.code?.chunksPerSec)} ch/s`,
    proseText: `${formatNumber(run.throughput?.prose?.chunksPerSec)} ch/s`,
    xproseText: `${formatNumber(run.throughput?.extractedProse?.chunksPerSec)} ch/s`,
    recordsText: `${formatNumber(run.throughput?.records?.chunksPerSec)} ch/s`,
    queryText: formatMs(run.summary?.queryWallMsPerQuery)
  }));
  const repoWidth = Math.max('repo'.length, ...runRows.map((row) => row.repoLabel.length));
  const codeWidth = Math.max('code'.length, ...runRows.map((row) => row.codeText.length));
  const proseWidth = Math.max('prose'.length, ...runRows.map((row) => row.proseText.length));
  const xproseWidth = Math.max('xprose'.length, ...runRows.map((row) => row.xproseText.length));
  const recordsWidth = Math.max('records'.length, ...runRows.map((row) => row.recordsText.length));
  const queryWidth = Math.max('query'.length, ...runRows.map((row) => row.queryText.length));

  console.error('');
  console.error(color.gray(
    `${`(${folder.runs.length} run${folder.runs.length === 1 ? '' : 's'})`.padStart(repoWidth)}` +
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
};

const renderFolder = (folder, { verboseOutput = false } = {}) => {
  renderFolderHeader(folder.name);
  if (!folder.runs.length) {
    console.error(color.gray('  No benchmark JSON files found.'));
    return;
  }
  if (!verboseOutput) {
    renderCompactFolder(folder);
    return;
  }
  renderVerboseFolder(folder);
};

const renderModeTotalsRows = (globalReport) => {
  const modeRows = globalReport.modeRows.map((row) => ({
    ...row,
    chunksCell: formatThroughputTotalsCell(row.chunksRate, 'chunks/s', 4),
    tokensCell: formatThroughputTotalsCell(row.tokensRate, 'tokens/s', 7),
    bytesCell: formatThroughputTotalsCell(row.bytesMbRate, 'MB/s', 3),
    filesCell: formatThroughputTotalsCell(row.filesRate, 'files/s', 4),
    linesCell: Number.isFinite(row.linesPerSec)
      ? formatThroughputTotalsCell(row.linesPerSec, 'lines/s', 6)
      : ''
  }));
  const chunksWidth = Math.max(...modeRows.map((row) => row.chunksCell.length));
  const tokensWidth = Math.max(...modeRows.map((row) => row.tokensCell.length));
  const bytesWidth = Math.max(...modeRows.map((row) => row.bytesCell.length));
  const filesWidth = Math.max(...modeRows.map((row) => row.filesCell.length));
  const linesWidth = Math.max(0, ...modeRows.map((row) => row.linesCell.length));
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
};

const renderGlobalTotals = (globalReport) => {
  console.error('');
  console.error(color.bold(color.green('Throughput Totals')));
  printAlignedTotalLine('Files', `${formatNumber(globalReport.totalsRates.totalFilesPerSec)} files/s`);
  printAlignedTotalLine('Chunks', `${formatNumber(globalReport.totalsRates.totalChunksPerSec)} chunks/s`);
  printAlignedTotalLine('Tokens', `${formatNumber(globalReport.totalsRates.totalTokensPerSec)} tokens/s`);
  printAlignedTotalLine('Bytes', formatBytesPerSec(globalReport.totalsRates.totalBytesPerSec));
  if (Number.isFinite(globalReport.totalLinesPerSec)) {
    printAlignedTotalLine('Lines', `${formatNumber(globalReport.totalLinesPerSec)} lines/s`);
  }
  renderModeTotalsRows(globalReport);

  for (const { label, pick } of THROUGHPUT_GROUPS) {
    if (['Code throughput', 'Prose throughput', 'Extracted prose throughput', 'Records throughput']
      .some((entry) => entry.toLowerCase() === label.toLowerCase())) {
      continue;
    }
    const entry = pick(globalReport.totalThroughput);
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
};

const renderGlobalRegressions = (globalReport) => {
  if (!globalReport.ledgerRegressions.length) return;
  const sortedRegressions = [...globalReport.ledgerRegressions].sort((left, right) => (
    Number(left.deltaPct) - Number(right.deltaPct)
  ) || String(left.repoIdentity || '').localeCompare(String(right.repoIdentity || '')));
  console.error(color.bold(
    `Top Throughput Regressions (schema v${THROUGHPUT_LEDGER_SCHEMA_VERSION}/diff v${THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION})`
  ));
  for (const entry of sortedRegressions.slice(0, 8)) {
    console.error(
      `  ${entry.folder}/${entry.repoIdentity} ${entry.modality}/${entry.stage}: ` +
      `${formatPct(entry.deltaPct)} | ` +
      `${formatNumber(entry.currentRate)} vs ${formatNumber(entry.baselineRate)} ch/s`
    );
  }
};

const renderAstGraphTotals = (globalReport) => {
  if (!hasAstGraphValues(globalReport.astGraphTotals.totals)) return;
  const astPairs = [
    ['Symbols', formatAstField(globalReport.astGraphTotals, 'symbols'), 'Classes', formatAstField(globalReport.astGraphTotals, 'classes')],
    ['Functions', formatAstField(globalReport.astGraphTotals, 'functions'), 'Imports', formatAstField(globalReport.astGraphTotals, 'imports')],
    ['File links', formatAstField(globalReport.astGraphTotals, 'fileLinks'), 'Graph links', formatAstField(globalReport.astGraphTotals, 'graphLinks')]
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
};

const renderTotalsByMode = (globalReport) => {
  const totalsByModeRows = [
    { modeKey: 'code', label: 'Code' },
    { modeKey: 'prose', label: 'Prose' },
    { modeKey: 'extracted-prose', label: 'XProse' },
    { modeKey: 'records', label: 'Records' }
  ].map(({ modeKey, label }) => {
    const totals = globalReport.modeTotals.get(modeKey);
    if (!Number.isFinite(totals?.lines) || totals.lines <= 0) return null;
    const linesPerSec = (Number.isFinite(totals.durationMs) && totals.durationMs > 0)
      ? (totals.lines / (totals.durationMs / 1000))
      : null;
    const msPerLine = (Number.isFinite(totals.durationMs) && totals.durationMs > 0 && totals.lines > 0)
      ? (totals.durationMs / totals.lines)
      : null;
    return {
      label,
      linesText: `${formatCount(totals.lines)} lines`,
      filesText: `${formatCount(totals.files)} files`,
      bytesText: formatBytes(totals.bytes),
      lineRateText: `${formatNumber(linesPerSec)} lines/s`,
      msPerLineText: `${formatNumber(msPerLine, 3)} ms/line`
    };
  }).filter(Boolean);

  if (!totalsByModeRows.length) return;
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
};

const renderLanguageTotals = (globalReport, { verboseOutput = false } = {}) => {
  if (!globalReport.languageTotals.size) return;
  const sortedLanguages = Array.from(globalReport.languageTotals.entries())
    .sort((left, right) => right[1] - left[1]);
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
    return;
  }

  const languageWidth = Math.max(...displayed.map(([language]) => language.length));
  const countWidth = Math.max(...displayed.map(([, lines]) => formatCount(lines).length));
  console.error('Lines by Language:');
  for (const [language, lines] of displayed) {
    console.error(`  ${language.padStart(languageWidth)}: ${formatCount(lines).padStart(countWidth)} `);
  }
};

/**
 * @param {{
 *   report:{folders:Array<object>,global:object},
 *   options:{
 *     resultsRoot:string,
 *     refreshJson:boolean,
 *     deepAnalysis:boolean,
 *     verboseOutput:boolean
 *   }
 * }} input
 */
export const renderThroughputReport = ({
  report,
  options
}) => {
  console.error(color.bold(color.cyan('Benchmark Performance Overview')));
  console.error(color.gray(`Root: ${options.resultsRoot}`));
  if (options.refreshJson) {
    const depthLabel = options.deepAnalysis ? 'deep analysis enabled' : 'deep analysis disabled';
    console.error(color.gray(`Refresh mode: writing benchmark JSON summaries (${depthLabel}).`));
  }

  for (const folder of report.folders) {
    renderFolder(folder, { verboseOutput: options.verboseOutput });
  }

  renderGlobalTotals(report.global);
  renderGlobalRegressions(report.global);
  renderAstGraphTotals(report.global);
  renderTotalsByMode(report.global);
  renderLanguageTotals(report.global, { verboseOutput: options.verboseOutput });
};
