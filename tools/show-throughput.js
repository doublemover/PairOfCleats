#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { color } from '../src/retrieval/cli/ansi.js';
import { getMetricsDir, loadUserConfig } from './dict-utils.js';

const resultsRoot = path.join(process.cwd(), 'benchmarks', 'results');

const listDirs = (root) => fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];

const formatNumber = (value, digits = 1) => (
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
);

const formatCount = (value) => (
  Number.isFinite(value) ? value.toLocaleString() : 'n/a'
);

const formatMs = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = (seconds % 60).toFixed(0);
  return `${minutes}m ${rem}s`;
};

const formatBytesPerSec = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB/s`;
  return `${(mb / 1024).toFixed(2)} GB/s`;
};

const mean = (values) => {
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
};

const collect = (items, selector) => items
  .map((item) => selector(item))
  .filter((value) => Number.isFinite(value));

const mergeTotals = (target, entry) => {
  if (!entry) return;
  if (Number.isFinite(entry.files)) target.files += entry.files;
  if (Number.isFinite(entry.chunks)) target.chunks += entry.chunks;
  if (Number.isFinite(entry.tokens)) target.tokens += entry.tokens;
  if (Number.isFinite(entry.bytes)) target.bytes += entry.bytes;
  if (Number.isFinite(entry.totalMs)) target.totalMs += entry.totalMs;
};

const rateFromTotals = (totals, key) => {
  if (!Number.isFinite(totals.totalMs) || totals.totalMs <= 0) return null;
  const value = totals[key];
  if (!Number.isFinite(value)) return null;
  return value / (totals.totalMs / 1000);
};

const sumRates = (...values) => {
  let sum = 0;
  let found = false;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    found = true;
  }
  return found ? sum : null;
};

const loadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const loadFeatureMetrics = (repoRoot) => {
  if (!repoRoot) return null;
  const userConfig = loadUserConfig(repoRoot);
  const metricsDir = getMetricsDir(repoRoot, userConfig);
  const runPath = path.join(metricsDir, 'feature-metrics-run.json');
  const mergedPath = path.join(metricsDir, 'feature-metrics.json');
  return loadJson(runPath) || loadJson(mergedPath);
};

const collectLanguageLines = (metrics, totals) => {
  if (!metrics || !metrics.modes) return;
  for (const modeEntry of Object.values(metrics.modes)) {
    const languages = modeEntry?.languages || {};
    for (const [language, bucket] of Object.entries(languages)) {
      const lines = Number(bucket?.lines) || 0;
      if (!lines) continue;
      totals.set(language, (totals.get(language) || 0) + lines);
    }
  }
};

if (!fs.existsSync(resultsRoot)) {
  console.error(`No benchmark results found at ${resultsRoot}`);
  process.exit(1);
}

const folders = listDirs(resultsRoot).filter((dir) => dir.name !== 'logs');
if (!folders.length) {
  console.log('No benchmark results folders found.');
  process.exit(0);
}

const totalThroughput = {
  code: { files: 0, chunks: 0, tokens: 0, bytes: 0, totalMs: 0 },
  prose: { files: 0, chunks: 0, tokens: 0, bytes: 0, totalMs: 0 }
};
const languageTotals = new Map();
const reposWithMetrics = new Set();

console.log(color.bold(color.cyan('Benchmark Performance Overview')));
console.log(color.gray(`Root: ${resultsRoot}`));

for (const dir of folders) {
  const folderPath = path.join(resultsRoot, dir.name);
  const files = fs.readdirSync(folderPath).filter((name) => name.endsWith('.json'));
  const runs = [];
  const throughputs = [];

  for (const file of files) {
    const payload = loadJson(path.join(folderPath, file));
    if (!payload) continue;
    const summary = payload.summary || payload.runs?.[0] || null;
    const throughput = payload.artifacts?.throughput || {};
    runs.push({ file, summary, throughput });
    throughputs.push(throughput);
    mergeTotals(totalThroughput.code, throughput.code);
    mergeTotals(totalThroughput.prose, throughput.prose);
    const repoRoot = payload.repo?.root;
    if (repoRoot && !reposWithMetrics.has(repoRoot)) {
      const metrics = loadFeatureMetrics(repoRoot);
      if (metrics) {
        collectLanguageLines(metrics, languageTotals);
        reposWithMetrics.add(repoRoot);
      }
    }
  }

  const header = `${dir.name} (${runs.length} run${runs.length === 1 ? '' : 's'})`;
  console.log('');
  console.log(color.bold(color.blue(header)));

  if (!runs.length) {
    console.log(color.gray('  No benchmark JSON files found.'));
    continue;
  }

  const code = throughputs.map((t) => t.code).filter(Boolean);
  const prose = throughputs.map((t) => t.prose).filter(Boolean);

  if (code.length) {
    console.log(
      `  ${color.bold('Code throughput')}: ` +
      `${formatNumber(mean(collect(code, (c) => c.chunksPerSec)))} chunks/s | ` +
      `${formatNumber(mean(collect(code, (c) => c.tokensPerSec)))} tokens/s | ` +
      `${formatBytesPerSec(mean(collect(code, (c) => c.bytesPerSec)))} | ` +
      `${formatNumber(mean(collect(code, (c) => c.filesPerSec)))} files/s`
    );
  }

  if (prose.length) {
    console.log(
      `  ${color.bold('Prose throughput')}: ` +
      `${formatNumber(mean(collect(prose, (c) => c.chunksPerSec)))} chunks/s | ` +
      `${formatNumber(mean(collect(prose, (c) => c.tokensPerSec)))} tokens/s | ` +
      `${formatBytesPerSec(mean(collect(prose, (c) => c.bytesPerSec)))} | ` +
      `${formatNumber(mean(collect(prose, (c) => c.filesPerSec)))} files/s`
    );
  }

  const summaries = runs.map((r) => r.summary).filter(Boolean);
  if (summaries.length) {
    const wallPerQuery = mean(collect(summaries, (s) => s.queryWallMsPerQuery));
    const wallPerSearch = mean(collect(summaries, (s) => s.queryWallMsPerSearch));
    if (wallPerQuery || wallPerSearch) {
      console.log(
        `  ${color.bold('Query wall time')}: ` +
        `avg/query ${formatMs(wallPerQuery)} | avg/search ${formatMs(wallPerSearch)}`
      );
    }

    const backendLatency = {};
    for (const summary of summaries) {
      const latency = summary.latencyMs || {};
      for (const [backend, stats] of Object.entries(latency)) {
        if (!backendLatency[backend]) backendLatency[backend] = { mean: [], p95: [] };
        if (Number.isFinite(stats?.mean)) backendLatency[backend].mean.push(stats.mean);
        if (Number.isFinite(stats?.p95)) backendLatency[backend].p95.push(stats.p95);
      }
    }
    const latencyLine = Object.entries(backendLatency)
      .map(([backend, stats]) => (
        `${backend} ${formatNumber(mean(stats.mean))}ms (p95 ${formatNumber(mean(stats.p95))}ms)`
      ))
      .join(' | ');
    if (latencyLine) {
      console.log(`  ${color.bold('Latency')}: ${latencyLine}`);
    }

    const buildIndexMs = mean(collect(summaries, (s) => s.buildMs?.index));
    const buildSqliteMs = mean(collect(summaries, (s) => s.buildMs?.sqlite));
    if (buildIndexMs || buildSqliteMs) {
      console.log(
        `  ${color.bold('Build time')}: ` +
        `index ${formatMs(buildIndexMs)} | sqlite ${formatMs(buildSqliteMs)}`
      );
    }
  }

  console.log(color.gray('  Runs:'));
  for (const run of runs) {
    const repoLabel = run.file.replace(/\.json$/, '');
    const codeStats = run.throughput?.code || {};
    const proseStats = run.throughput?.prose || {};
    const summary = run.summary || {};
    const line = [
      color.bold(repoLabel),
      `code ${formatNumber(codeStats.chunksPerSec)} ch/s`,
      `prose ${formatNumber(proseStats.chunksPerSec)} ch/s`,
      `query ${formatMs(summary.queryWallMsPerQuery)}`
    ].join(' | ');
    console.log(`    ${line}`);
  }
}

const totalFilesPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'files'),
  rateFromTotals(totalThroughput.prose, 'files')
);
const totalChunksPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'chunks'),
  rateFromTotals(totalThroughput.prose, 'chunks')
);
const totalTokensPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'tokens'),
  rateFromTotals(totalThroughput.prose, 'tokens')
);
const totalBytesPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'bytes'),
  rateFromTotals(totalThroughput.prose, 'bytes')
);

console.log('');
console.log(color.bold(color.green('Totals')));
console.log(
  `  ${color.bold('Files')}: ${formatNumber(totalFilesPerSec)} files/s | ` +
  `${color.bold('Chunks')}: ${formatNumber(totalChunksPerSec)} chunks/s | ` +
  `${color.bold('Tokens')}: ${formatNumber(totalTokensPerSec)} tokens/s | ` +
  `${color.bold('Bytes')}: ${formatBytesPerSec(totalBytesPerSec)}`
);
if (languageTotals.size) {
  const sortedLanguages = Array.from(languageTotals.entries())
    .sort((a, b) => b[1] - a[1]);
  console.log(`  ${color.bold('Lines by language')}:`);
  for (const [language, lines] of sortedLanguages) {
    console.log(`    ${language}: ${formatCount(lines)} lines`);
  }
}
