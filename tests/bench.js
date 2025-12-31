#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2), {
  boolean: ['ann', 'no-ann', 'json', 'write-report', 'build', 'build-index', 'build-sqlite', 'incremental', 'stub-embeddings'],
  string: ['queries', 'backend', 'out', 'bm25-k1', 'bm25-b', 'fts-profile', 'fts-weights'],
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
const bm25K1Arg = argv['bm25-k1'];
const bm25BArg = argv['bm25-b'];
const ftsProfileArg = argv['fts-profile'];
const ftsWeightsArg = argv['fts-weights'];
function resolveBackends(value) {
  if (!value) return ['memory', 'sqlite'];
  const trimmed = String(value).trim();
  if (!trimmed) return ['memory', 'sqlite'];
  const lower = trimmed.toLowerCase();
  const list = lower === 'all' ? ['memory', 'sqlite', 'sqlite-fts'] : lower.split(',');
  return Array.from(new Set(list.map((entry) => entry.trim()).filter(Boolean)));
}
const backends = resolveBackends(argv.backend);
const buildIndex = argv['build-index'] || argv.build;
const buildSqlite = argv['build-sqlite'] || argv.build;
const buildIncremental = argv.incremental === true;
const stubEmbeddings = argv['stub-embeddings'] === true;

function runSearch(query, backend) {
  const args = [
    searchPath,
    query,
    '--json',
    '--json-compact',
    '--stats',
    '--backend',
    backend,
    '-n',
    String(topN),
    annArg
  ];
  if (bm25K1Arg) args.push('--bm25-k1', String(bm25K1Arg));
  if (bm25BArg) args.push('--bm25-b', String(bm25BArg));
  if (ftsProfileArg) args.push('--fts-profile', String(ftsProfileArg));
  if (ftsWeightsArg) args.push('--fts-weights', String(ftsWeightsArg));
  const env = stubEmbeddings
    ? { ...process.env, PAIROFCLEATS_EMBEDDINGS: 'stub' }
    : process.env;
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env });
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
const memoryRss = {};
const hitCounts = {};
const resultCounts = {};
for (const backend of backends) {
  latency[backend] = [];
  memoryRss[backend] = [];
  hitCounts[backend] = 0;
  resultCounts[backend] = [];
}

for (const query of selectedQueries) {
  for (const backend of backends) {
    const payload = runSearch(query, backend);
    latency[backend].push(payload.stats?.elapsedMs || 0);
    const codeHits = Array.isArray(payload.code) ? payload.code.length : 0;
    const proseHits = Array.isArray(payload.prose) ? payload.prose.length : 0;
    const totalHits = codeHits + proseHits;
    resultCounts[backend].push(totalHits);
    if (totalHits > 0) hitCounts[backend] += 1;
    const rss = payload.stats?.memory?.rss;
    if (Number.isFinite(rss)) memoryRss[backend].push(rss);
  }
}

const reportResult = spawnSync(process.execPath, [reportPath, '--json'], { encoding: 'utf8' });
const artifactReport = reportResult.status === 0 ? JSON.parse(reportResult.stdout || '{}') : {};

const latencyStats = Object.fromEntries(backends.map((b) => [b, buildStats(latency[b])]));
const memoryStats = Object.fromEntries(backends.map((b) => [b, buildStats(memoryRss[b])]));
const hitRate = Object.fromEntries(backends.map((b) => [
  b,
  selectedQueries.length ? hitCounts[b] / selectedQueries.length : 0
]));
const resultCountAvg = Object.fromEntries(backends.map((b) => [b, mean(resultCounts[b])]));
const summary = {
  queries: selectedQueries.length,
  topN,
  annEnabled,
  backends,
  latencyMsAvg: Object.fromEntries(backends.map((b) => [b, latencyStats[b].mean])),
  latencyMs: latencyStats,
  hitRate,
  resultCountAvg,
  memoryRss: memoryStats,
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
    console.log(`- ${backend} hit rate: ${(hitRate[backend] * 100).toFixed(1)}% (avg hits ${resultCountAvg[backend].toFixed(1)})`);
    const mem = memoryStats[backend];
    if (mem && mem.mean) {
      console.log(`- ${backend} rss avg mb: ${(mem.mean / (1024 * 1024)).toFixed(1)} (p95 ${(mem.p95 / (1024 * 1024)).toFixed(1)})`);
    }
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
