#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2), {
  boolean: ['ann', 'no-ann', 'json', 'write-report', 'build', 'build-index', 'build-sqlite', 'incremental', 'stub-embeddings'],
  string: ['queries', 'backend', 'out'],
  alias: { n: 'top', q: 'queries' },
  default: { top: 5, limit: 0, json: false, 'write-report': false }
});

const root = process.cwd();
const searchPath = path.join(root, 'search.js');
const reportPath = path.join(root, 'tools', 'report-artifacts.js');
const buildIndexPath = path.join(root, 'build_index.js');
const buildSqlitePath = path.join(root, 'tools', 'build-sqlite-index.js');

const defaultQueriesPath = path.join(root, 'tests', 'parity-queries.txt');
const queriesPath = argv.queries ? path.resolve(argv.queries) : defaultQueriesPath;

async function loadQueries(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

const queries = await loadQueries(queriesPath);
if (!queries.length) {
  console.error(`No queries found at ${queriesPath}`);
  process.exit(1);
}

const topN = Math.max(1, parseInt(argv.top, 10) || 5);
const limit = Math.max(0, parseInt(argv.limit, 10) || 0);
const selectedQueries = limit > 0 ? queries.slice(0, limit) : queries;
const annEnabled = argv.ann !== false;
const annArg = annEnabled ? '--ann' : '--no-ann';
const backends = argv.backend ? [argv.backend] : ['memory', 'sqlite'];
const buildIndex = argv['build-index'] || argv.build;
const buildSqlite = argv['build-sqlite'] || argv.build;
const buildIncremental = argv.incremental === true;
const stubEmbeddings = argv['stub-embeddings'] === true;

function runSearch(query, backend) {
  const args = [
    searchPath,
    query,
    '--json',
    '--stats',
    '--backend',
    backend,
    '-n',
    String(topN),
    annArg
  ];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Search failed for backend=${backend} query="${query}"`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((pct / 100) * (sortedValues.length - 1))));
  return sortedValues[idx];
}

function buildStats(values) {
  if (!values.length) return { mean: 0, p50: 0, p95: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: mean(values),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

function runBuild(args, label, env) {
  const start = Date.now();
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Build failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  return Date.now() - start;
}

const buildMs = {};
if (buildIndex || buildSqlite) {
  const buildEnv = { ...process.env };
  if (stubEmbeddings) buildEnv.PAIROFCLEATS_EMBEDDINGS = 'stub';
  if (buildIndex) {
    const args = [buildIndexPath];
    if (stubEmbeddings) args.push('--stub-embeddings');
    if (buildIncremental) args.push('--incremental');
    buildMs.index = runBuild(args, 'build index', buildEnv);
  }
  if (buildSqlite) {
    const args = [buildSqlitePath];
    if (buildIncremental) args.push('--incremental');
    buildMs.sqlite = runBuild(args, 'build sqlite', buildEnv);
  }
}

const latency = {};
for (const backend of backends) latency[backend] = [];

for (const query of selectedQueries) {
  for (const backend of backends) {
    const payload = runSearch(query, backend);
    latency[backend].push(payload.stats?.elapsedMs || 0);
  }
}

const reportResult = spawnSync(process.execPath, [reportPath, '--json'], { encoding: 'utf8' });
const artifactReport = reportResult.status === 0 ? JSON.parse(reportResult.stdout || '{}') : {};

const latencyStats = Object.fromEntries(backends.map((b) => [b, buildStats(latency[b])]));
const summary = {
  queries: selectedQueries.length,
  topN,
  annEnabled,
  backends,
  latencyMsAvg: Object.fromEntries(backends.map((b) => [b, latencyStats[b].mean])),
  latencyMs: latencyStats,
  buildMs: Object.keys(buildMs).length ? buildMs : null
};

const output = {
  generatedAt: new Date().toISOString(),
  summary,
  artifacts: artifactReport
};

if (argv.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log('Benchmark summary');
  console.log(`- Queries: ${summary.queries}`);
  console.log(`- TopN: ${summary.topN}`);
  console.log(`- Ann: ${summary.annEnabled}`);
  for (const backend of backends) {
    const stats = latencyStats[backend];
    console.log(`- ${backend} avg ms: ${stats.mean.toFixed(1)} (p95 ${stats.p95.toFixed(1)})`);
  }
  if (buildMs.index) {
    console.log(`- build index ms: ${buildMs.index.toFixed(0)}`);
  }
  if (buildMs.sqlite) {
    console.log(`- build sqlite ms: ${buildMs.sqlite.toFixed(0)}`);
  }
}

if (argv['write-report']) {
  const outPath = argv.out ? path.resolve(argv.out) : path.join(root, 'docs', 'benchmarks.json');
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  if (!argv.json) console.log(`Report written to ${outPath}`);
}
