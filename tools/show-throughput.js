#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { color } from '../src/retrieval/cli/ansi.js';

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

const loadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
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
