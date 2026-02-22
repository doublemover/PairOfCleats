#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { summarizeResults } from './language/report.js';

const NON_REPO_RESULTS_FOLDERS = new Set(['logs', 'usr']);

const formatMs = (value) => (Number.isFinite(value) ? `${Math.round(value)}ms` : 'n/a');

const toFiniteOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mean = (values) => {
  const numeric = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

const sanitizeRepoName = (fileName) => (
  String(fileName || '')
    .replace(/\.json$/i, '')
    .replace(/__/g, '/')
);

const buildEntryKey = (language, repo) => `${language}:${repo}`;

const loadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const countArraysByKey = (value, targetKey, seen = new Set()) => {
  if (!value || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + countArraysByKey(entry, targetKey, seen), 0);
  }
  let total = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (key === targetKey && Array.isArray(entry)) total += entry.length;
    total += countArraysByKey(entry, targetKey, seen);
  }
  return total;
};

const countStringMatches = (value, regex, seen = new Set()) => {
  if (typeof value === 'string') return regex.test(value) ? 1 : 0;
  if (!value || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + countStringMatches(entry, regex, seen), 0);
  }
  let total = 0;
  for (const entry of Object.values(value)) {
    total += countStringMatches(entry, regex, seen);
  }
  return total;
};

const deriveSignals = (payload) => ({
  warnings: countArraysByKey(payload, 'warnings'),
  fallbacks: countStringMatches(payload, /\bfallback(_used)?\b/i)
});

const collectResultEntries = ({ resultsRoot, includeUsr }) => {
  if (!fs.existsSync(resultsRoot)) return [];
  const dirs = fs.readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      if (name === 'usr') return includeUsr;
      return !NON_REPO_RESULTS_FOLDERS.has(name);
    });
  const entries = [];
  for (const language of dirs) {
    const languageDir = path.join(resultsRoot, language);
    const files = fs.readdirSync(languageDir)
      .filter((name) => name.endsWith('.json'));
    for (const fileName of files) {
      const filePath = path.join(languageDir, fileName);
      const payload = loadJson(filePath);
      if (!payload) continue;
      const summary = payload.summary || payload?.runs?.[0] || null;
      const repo = sanitizeRepoName(fileName);
      const key = buildEntryKey(language, repo);
      const signals = deriveSignals(payload);
      entries.push({
        key,
        language,
        repo,
        summary,
        payload,
        filePath,
        warnings: signals.warnings,
        fallbacks: signals.fallbacks
      });
    }
  }
  return entries;
};

const rowFromEntry = (entry, {
  status = 'passed',
  failureReason = null,
  failureCode = null
} = {}) => {
  const summary = entry?.summary && typeof entry.summary === 'object' ? entry.summary : null;
  return {
    key: entry.key,
    language: entry.language,
    repo: entry.repo,
    status,
    failureReason,
    failureCode: Number.isFinite(Number(failureCode)) ? Number(failureCode) : null,
    buildIndexMs: toFiniteOrNull(summary?.buildMs?.index),
    buildSqliteMs: toFiniteOrNull(summary?.buildMs?.sqlite),
    queryWallMsPerQuery: toFiniteOrNull(summary?.queryWallMsPerQuery),
    queryWallMsPerSearch: toFiniteOrNull(summary?.queryWallMsPerSearch),
    hitRateMemory: toFiniteOrNull(summary?.hitRate?.memory),
    hitRateSqlite: toFiniteOrNull(summary?.hitRate?.sqlite),
    warnings: Number.isFinite(entry?.warnings) ? entry.warnings : 0,
    fallbacks: Number.isFinite(entry?.fallbacks) ? entry.fallbacks : 0,
    sourceFile: entry?.filePath || null,
    _summarySource: summary
  };
};

const mergeWithRunReport = ({ fileEntries, runReportPath }) => {
  const fileMap = new Map(fileEntries.map((entry) => [entry.key, entry]));
  const rowMap = new Map(fileEntries.map((entry) => [entry.key, rowFromEntry(entry)]));
  if (!runReportPath || !fs.existsSync(runReportPath)) {
    return { rows: Array.from(rowMap.values()), runReport: null };
  }
  const runReport = loadJson(runReportPath);
  const tasks = Array.isArray(runReport?.tasks) ? runReport.tasks : [];
  for (const task of tasks) {
    const language = String(task?.language || '').trim();
    const repo = String(task?.repo || '').trim();
    if (!language || !repo) continue;
    const key = buildEntryKey(language, repo);
    const fileEntry = fileMap.get(key);
    const baseEntry = fileEntry || {
      key,
      language,
      repo,
      summary: task?.summary || null,
      payload: null,
      filePath: null,
      warnings: 0,
      fallbacks: 0
    };
    let status = 'passed';
    if (task?.failed === true) status = 'failed';
    else if (task?.skipped === true) status = 'skipped';
    else if (!baseEntry.summary && !task?.summary) status = 'unknown';
    const mergedEntry = {
      ...baseEntry,
      summary: task?.summary || baseEntry.summary || null
    };
    rowMap.set(key, rowFromEntry(mergedEntry, {
      status,
      failureReason: task?.failureReason || null,
      failureCode: task?.failureCode || null
    }));
  }
  return { rows: Array.from(rowMap.values()), runReport };
};

const buildBottleneckTop = (rows, metric, topN) => rows
  .filter((row) => row.status === 'passed' && Number.isFinite(row[metric]))
  .sort((left, right) => right[metric] - left[metric])
  .slice(0, topN)
  .map((row) => ({
    language: row.language,
    repo: row.repo,
    value: row[metric]
  }));

const buildAggregate = (rows) => {
  const passedRows = rows.filter((row) => row.status === 'passed');
  const summary = summarizeResults(
    passedRows
      .map((row) => row._summarySource)
      .filter(Boolean)
      .map((summarySource) => ({ summary: summarySource }))
  );
  return {
    totals: {
      repos: rows.length,
      passed: rows.filter((row) => row.status === 'passed').length,
      failed: rows.filter((row) => row.status === 'failed').length,
      skipped: rows.filter((row) => row.status === 'skipped').length,
      unknown: rows.filter((row) => row.status === 'unknown').length
    },
    signals: {
      warnings: rows.reduce((sum, row) => sum + (Number.isFinite(row.warnings) ? row.warnings : 0), 0),
      fallbacks: rows.reduce((sum, row) => sum + (Number.isFinite(row.fallbacks) ? row.fallbacks : 0), 0)
    },
    averages: {
      buildIndexMs: mean(passedRows.map((row) => row.buildIndexMs)),
      buildSqliteMs: mean(passedRows.map((row) => row.buildSqliteMs)),
      queryWallMsPerSearch: mean(passedRows.map((row) => row.queryWallMsPerSearch)),
      queryWallMsPerQuery: mean(passedRows.map((row) => row.queryWallMsPerQuery)),
      hitRateMemory: mean(passedRows.map((row) => row.hitRateMemory)),
      hitRateSqlite: mean(passedRows.map((row) => row.hitRateSqlite))
    },
    summary
  };
};

const metricDelta = (current, baseline) => {
  const c = toFiniteOrNull(current);
  const b = toFiniteOrNull(baseline);
  if (!Number.isFinite(c) || !Number.isFinite(b)) {
    return {
      current: c,
      baseline: b,
      delta: null,
      deltaPct: null
    };
  }
  const delta = c - b;
  const deltaPct = b === 0 ? null : (delta / b) * 100;
  return {
    current: c,
    baseline: b,
    delta,
    deltaPct
  };
};

const compareWithBaseline = ({ currentRows, baselineRows, topN }) => {
  const currentAggregate = buildAggregate(currentRows);
  const baselineAggregate = buildAggregate(baselineRows);
  const baselineByKey = new Map(baselineRows.map((row) => [row.key, row]));
  const regressions = [];
  for (const row of currentRows) {
    if (row.status !== 'passed') continue;
    const baseline = baselineByKey.get(row.key);
    if (!baseline || baseline.status !== 'passed') continue;
    const queryDelta = metricDelta(row.queryWallMsPerSearch, baseline.queryWallMsPerSearch);
    const buildDelta = metricDelta(row.buildIndexMs, baseline.buildIndexMs);
    const sqliteDelta = metricDelta(row.buildSqliteMs, baseline.buildSqliteMs);
    const candidates = [
      { metric: 'queryWallMsPerSearch', deltaPct: queryDelta.deltaPct, delta: queryDelta.delta },
      { metric: 'buildIndexMs', deltaPct: buildDelta.deltaPct, delta: buildDelta.delta },
      { metric: 'buildSqliteMs', deltaPct: sqliteDelta.deltaPct, delta: sqliteDelta.delta }
    ]
      .filter((entry) => Number.isFinite(entry.deltaPct))
      .sort((left, right) => right.deltaPct - left.deltaPct);
    const worst = candidates[0];
    if (!worst || worst.deltaPct <= 10) continue;
    regressions.push({
      language: row.language,
      repo: row.repo,
      metric: worst.metric,
      delta: worst.delta,
      deltaPct: worst.deltaPct
    });
  }
  regressions.sort((left, right) => right.deltaPct - left.deltaPct);
  return {
    baselineCompared: true,
    totalsDelta: {
      repos: currentAggregate.totals.repos - baselineAggregate.totals.repos,
      passed: currentAggregate.totals.passed - baselineAggregate.totals.passed,
      failed: currentAggregate.totals.failed - baselineAggregate.totals.failed,
      skipped: currentAggregate.totals.skipped - baselineAggregate.totals.skipped
    },
    signalsDelta: {
      warnings: currentAggregate.signals.warnings - baselineAggregate.signals.warnings,
      fallbacks: currentAggregate.signals.fallbacks - baselineAggregate.signals.fallbacks
    },
    metricDeltas: {
      buildIndexMs: metricDelta(
        currentAggregate.averages.buildIndexMs,
        baselineAggregate.averages.buildIndexMs
      ),
      buildSqliteMs: metricDelta(
        currentAggregate.averages.buildSqliteMs,
        baselineAggregate.averages.buildSqliteMs
      ),
      queryWallMsPerSearch: metricDelta(
        currentAggregate.averages.queryWallMsPerSearch,
        baselineAggregate.averages.queryWallMsPerSearch
      ),
      hitRateMemory: metricDelta(
        currentAggregate.averages.hitRateMemory,
        baselineAggregate.averages.hitRateMemory
      ),
      hitRateSqlite: metricDelta(
        currentAggregate.averages.hitRateSqlite,
        baselineAggregate.averages.hitRateSqlite
      )
    },
    regressions: regressions.slice(0, topN)
  };
};

const renderMarkdown = ({ summary }) => {
  const lines = [];
  lines.push('# Bench Language Summary');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Results root: \`${summary.resultsRoot}\``);
  if (summary.baselineRoot) lines.push(`Baseline root: \`${summary.baselineRoot}\``);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push(`- Repos: ${summary.aggregate.totals.repos}`);
  lines.push(`- Passed: ${summary.aggregate.totals.passed}`);
  lines.push(`- Failed: ${summary.aggregate.totals.failed}`);
  lines.push(`- Skipped: ${summary.aggregate.totals.skipped}`);
  lines.push(`- Unknown: ${summary.aggregate.totals.unknown}`);
  lines.push(`- Warning signals: ${summary.aggregate.signals.warnings}`);
  lines.push(`- Fallback signals: ${summary.aggregate.signals.fallbacks}`);
  lines.push('');
  lines.push('## Pass/Fail Matrix');
  lines.push('');
  lines.push('| Language | Repo | Status | Build Index | Build SQLite | Query/Search | Warnings | Fallbacks |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of summary.matrix) {
    lines.push(
      `| ${row.language} | ${row.repo} | ${row.status} | ${formatMs(row.buildIndexMs)} | ${formatMs(row.buildSqliteMs)} | ${formatMs(row.queryWallMsPerSearch)} | ${row.warnings} | ${row.fallbacks} |`
    );
  }
  lines.push('');
  lines.push('## Top Bottlenecks');
  lines.push('');
  lines.push('### Build Index');
  for (const entry of summary.bottlenecks.buildIndex) {
    lines.push(`- ${entry.language}/${entry.repo}: ${formatMs(entry.value)}`);
  }
  lines.push('');
  lines.push('### Build SQLite');
  for (const entry of summary.bottlenecks.buildSqlite) {
    lines.push(`- ${entry.language}/${entry.repo}: ${formatMs(entry.value)}`);
  }
  lines.push('');
  lines.push('### Query/Search');
  for (const entry of summary.bottlenecks.querySearch) {
    lines.push(`- ${entry.language}/${entry.repo}: ${formatMs(entry.value)}`);
  }
  lines.push('');
  if (summary.baselineDiff?.baselineCompared) {
    lines.push('## Baseline Diff');
    lines.push('');
    const metric = summary.baselineDiff.metricDeltas || {};
    lines.push(`- Build Index delta: ${formatMs(metric.buildIndexMs?.delta)} (${Number.isFinite(metric.buildIndexMs?.deltaPct) ? `${metric.buildIndexMs.deltaPct.toFixed(2)}%` : 'n/a'})`);
    lines.push(`- Build SQLite delta: ${formatMs(metric.buildSqliteMs?.delta)} (${Number.isFinite(metric.buildSqliteMs?.deltaPct) ? `${metric.buildSqliteMs.deltaPct.toFixed(2)}%` : 'n/a'})`);
    lines.push(`- Query/Search delta: ${formatMs(metric.queryWallMsPerSearch?.delta)} (${Number.isFinite(metric.queryWallMsPerSearch?.deltaPct) ? `${metric.queryWallMsPerSearch.deltaPct.toFixed(2)}%` : 'n/a'})`);
    lines.push('');
    if (Array.isArray(summary.baselineDiff.regressions) && summary.baselineDiff.regressions.length) {
      lines.push('### Regressions');
      for (const regression of summary.baselineDiff.regressions) {
        const pct = Number.isFinite(regression.deltaPct) ? regression.deltaPct.toFixed(2) : 'n/a';
        lines.push(`- ${regression.language}/${regression.repo} ${regression.metric}: +${formatMs(regression.delta)} (${pct}%)`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
};

const printUsage = () => {
  console.error('Usage: node tools/bench/language-summarize.js [options]');
  console.error('');
  console.error('Options:');
  console.error('  --results <path>      Results root (default: ./benchmarks/results)');
  console.error('  --baseline <path>     Optional baseline results root for diff');
  console.error('  --run-report <path>   Optional bench-language --out report JSON');
  console.error('  --out-json <path>     JSON output path');
  console.error('  --out-md <path>       Markdown output path');
  console.error('  --top <n>             Top bottlenecks/regressions count (default: 5)');
  console.error('  --include-usr         Include results/ usr folder');
  console.error('  --json                Print summary JSON to stdout');
  console.error('  --help                Show this help');
};

const parseArgs = (rawArgs = process.argv.slice(2)) => {
  const options = {
    resultsRoot: path.join(process.cwd(), 'benchmarks', 'results'),
    baselineRoot: null,
    runReportPath: null,
    outJsonPath: null,
    outMdPath: null,
    includeUsr: false,
    jsonOutput: false,
    topN: 5
  };
  const args = Array.isArray(rawArgs) ? rawArgs.slice() : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--include-usr') {
      options.includeUsr = true;
      continue;
    }
    if (arg === '--json') {
      options.jsonOutput = true;
      continue;
    }
    const needsValue = (
      arg === '--results'
      || arg === '--baseline'
      || arg === '--run-report'
      || arg === '--out-json'
      || arg === '--out-md'
      || arg === '--top'
    );
    if (!needsValue) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const value = args[i + 1];
    if (value == null || String(value).startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;
    if (arg === '--results') options.resultsRoot = path.resolve(String(value));
    else if (arg === '--baseline') options.baselineRoot = path.resolve(String(value));
    else if (arg === '--run-report') options.runReportPath = path.resolve(String(value));
    else if (arg === '--out-json') options.outJsonPath = path.resolve(String(value));
    else if (arg === '--out-md') options.outMdPath = path.resolve(String(value));
    else if (arg === '--top') {
      const parsed = Number(value);
      options.topN = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
    }
  }
  return options;
};

const run = async () => {
  const options = parseArgs();
  const currentEntries = collectResultEntries({
    resultsRoot: options.resultsRoot,
    includeUsr: options.includeUsr
  });
  const { rows, runReport } = mergeWithRunReport({
    fileEntries: currentEntries,
    runReportPath: options.runReportPath
  });
  const withSummary = rows.map((row) => ({ ...row }));
  withSummary.sort((left, right) => (
    left.language.localeCompare(right.language) || left.repo.localeCompare(right.repo)
  ));
  const aggregate = buildAggregate(withSummary);
  const topN = Math.max(1, options.topN || 5);
  const bottlenecks = {
    buildIndex: buildBottleneckTop(withSummary, 'buildIndexMs', topN),
    buildSqlite: buildBottleneckTop(withSummary, 'buildSqliteMs', topN),
    querySearch: buildBottleneckTop(withSummary, 'queryWallMsPerSearch', topN)
  };
  let baselineDiff = {
    baselineCompared: false,
    totalsDelta: null,
    signalsDelta: null,
    metricDeltas: null,
    regressions: []
  };
  if (options.baselineRoot && fs.existsSync(options.baselineRoot)) {
    const baselineEntries = collectResultEntries({
      resultsRoot: options.baselineRoot,
      includeUsr: options.includeUsr
    });
    const baselineRows = baselineEntries.map((entry) => ({
      ...rowFromEntry(entry),
      _summarySource: entry.summary || null
    }));
    baselineDiff = compareWithBaseline({
      currentRows: withSummary,
      baselineRows,
      topN
    });
  }
  const generatedAt = new Date().toISOString();
  const defaultOutRoot = path.join(options.resultsRoot, 'logs', 'bench-language');
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const outJsonPath = options.outJsonPath || path.join(defaultOutRoot, `summary-${stamp}.json`);
  const outMdPath = options.outMdPath || path.join(defaultOutRoot, `summary-${stamp}.md`);
  const output = {
    generatedAt,
    resultsRoot: options.resultsRoot,
    baselineRoot: options.baselineRoot || null,
    runReportPath: options.runReportPath || null,
    runReportPresent: Boolean(runReport),
    aggregate,
    bottlenecks,
    baselineDiff,
    matrix: withSummary.map(({ _summarySource, ...row }) => row)
  };
  await fsPromises.mkdir(path.dirname(outJsonPath), { recursive: true });
  await fsPromises.mkdir(path.dirname(outMdPath), { recursive: true });
  await fsPromises.writeFile(outJsonPath, JSON.stringify(output, null, 2), 'utf8');
  await fsPromises.writeFile(outMdPath, renderMarkdown({ summary: output }), 'utf8');
  if (options.jsonOutput) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stderr.write(`[bench-lang summarize] repos=${aggregate.totals.repos} passed=${aggregate.totals.passed} failed=${aggregate.totals.failed} skipped=${aggregate.totals.skipped}\n`);
    process.stderr.write(`[bench-lang summarize] warnings=${aggregate.signals.warnings} fallbacks=${aggregate.signals.fallbacks}\n`);
    process.stderr.write(`[bench-lang summarize] wrote ${outJsonPath}\n`);
    process.stderr.write(`[bench-lang summarize] wrote ${outMdPath}\n`);
  }
};

try {
  await run();
} catch (err) {
  process.stderr.write(`[bench-lang summarize] ${err?.message || err}\n`);
  process.exit(1);
}
