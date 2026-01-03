#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';
import { getRuntimeConfig, loadUserConfig, resolveNodeOptions } from '../tools/dict-utils.js';
import { resolveBenchmarkProfile } from '../src/shared/bench-profile.js';
import os from 'node:os';

const rawArgs = process.argv.slice(2);
const argv = createCli({
  scriptName: 'bench',
  options: {
    ann: { type: 'boolean' },
    'no-ann': { type: 'boolean' },
    json: { type: 'boolean', default: false },
    'write-report': { type: 'boolean', default: false },
    build: { type: 'boolean', default: false },
    'build-index': { type: 'boolean', default: false },
    'build-sqlite': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    'stub-embeddings': { type: 'boolean', default: false },
    'benchmark-profile': { type: 'boolean', default: false },
    queries: { type: 'string' },
    backend: { type: 'string' },
    out: { type: 'string' },
    'bm25-k1': { type: 'number' },
    'bm25-b': { type: 'number' },
    'fts-profile': { type: 'string' },
    'fts-weights': { type: 'string' },
    repo: { type: 'string' },
    top: { type: 'number', default: 5 },
    limit: { type: 'number', default: 0 },
    'heap-mb': { type: 'number' },
    threads: { type: 'number' }
  },
  aliases: { n: 'top', q: 'queries' }
}).parse();

const root = process.cwd();
const repoArg = argv.repo ? path.resolve(argv.repo) : null;
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
const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
const annEnabled = annFlagPresent ? argv.ann === true : true;
const annArg = annEnabled ? '--ann' : '--no-ann';
const jsonOutput = argv.json === true;
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
let buildIndex = argv['build-index'] || argv.build;
const buildSqlite = argv['build-sqlite'] || argv.build;
if (buildSqlite && !buildIndex) buildIndex = true;
const buildIncremental = argv.incremental === true;
const stubEmbeddings = argv['stub-embeddings'] === true;
const runtimeRoot = repoArg || root;
const userConfig = loadUserConfig(runtimeRoot);
const runtimeConfig = getRuntimeConfig(runtimeRoot, userConfig);
const heapArgRaw = argv['heap-mb'];
const heapArg = Number.isFinite(Number(heapArgRaw)) ? Math.floor(Number(heapArgRaw)) : null;
const heapRecommendation = getRecommendedHeapMb();
const baseNodeOptions = stripMaxOldSpaceFlag(process.env.NODE_OPTIONS || '');
const hasHeapFlag = baseNodeOptions.includes('--max-old-space-size');
let heapOverride = null;
if (Number.isFinite(heapArg) && heapArg > 0) {
  heapOverride = heapArg;
} else if (
  !Number.isFinite(runtimeConfig.maxOldSpaceMb)
  && !process.env.PAIROFCLEATS_MAX_OLD_SPACE_MB
  && !hasHeapFlag
) {
  heapOverride = heapRecommendation.recommendedMb;
}
const runtimeConfigForRun = heapOverride
  ? { ...runtimeConfig, maxOldSpaceMb: heapOverride }
  : runtimeConfig;
const resolvedNodeOptions = resolveNodeOptions(runtimeConfigForRun, baseNodeOptions);
const benchmarkProfileArgPresent = rawArgs.includes('--benchmark-profile') || rawArgs.includes('--no-benchmark-profile');
const benchmarkProfileEnvValue = benchmarkProfileArgPresent
  ? (argv['benchmark-profile'] === true ? '1' : '0')
  : (process.env.PAIROFCLEATS_BENCH_PROFILE || null);
const benchmarkProfile = resolveBenchmarkProfile(userConfig.indexing || {}, benchmarkProfileEnvValue);
const baseEnv = resolvedNodeOptions
  ? { ...process.env, NODE_OPTIONS: resolvedNodeOptions }
  : { ...process.env };
if (heapOverride) {
  baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB = String(heapOverride);
  if (!jsonOutput) {
    console.log(
      `[bench] heap ${formatGb(heapOverride)} (${heapOverride} MB) ` +
        `(override with --heap-mb or PAIROFCLEATS_MAX_OLD_SPACE_MB)`
    );
  }
}
const benchEnv = benchmarkProfileEnvValue != null
  ? { ...baseEnv, PAIROFCLEATS_BENCH_PROFILE: String(benchmarkProfileEnvValue) }
  : baseEnv;

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
  if (repoArg) args.push('--repo', repoArg);
  if (bm25K1Arg) args.push('--bm25-k1', String(bm25K1Arg));
  if (bm25BArg) args.push('--bm25-b', String(bm25BArg));
  if (ftsProfileArg) args.push('--fts-profile', String(ftsProfileArg));
  if (ftsWeightsArg) args.push('--fts-weights', String(ftsWeightsArg));
  const env = stubEmbeddings
    ? { ...benchEnv, PAIROFCLEATS_EMBEDDINGS: 'stub' }
    : benchEnv;
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

function stripMaxOldSpaceFlag(options) {
  if (!options) return '';
  return options
    .replace(/--max-old-space-size=\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatGb(mb) {
  return `${(mb / 1024).toFixed(1)} GB`;
}

function getRecommendedHeapMb() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const recommended = Math.max(4096, Math.floor(totalMb * 0.75));
  const rounded = Math.floor(recommended / 256) * 256;
  return {
    totalMb,
    recommendedMb: Math.max(4096, rounded)
  };
}

function runBuild(args, label, env) {
  const start = Date.now();
  const result = spawnSync(process.execPath, args, {
    env,
    encoding: 'utf8',
    stdio: jsonOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (jsonOutput) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    console.error(`Build failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  return Date.now() - start;
}

const buildMs = {};
if (buildIndex || buildSqlite) {
  const buildEnv = { ...benchEnv };
  if (stubEmbeddings) buildEnv.PAIROFCLEATS_EMBEDDINGS = 'stub';
if (buildIndex) {
  const args = [buildIndexPath];
  if (repoArg) args.push('--repo', repoArg);
  if (stubEmbeddings) args.push('--stub-embeddings');
  if (buildIncremental) args.push('--incremental');
  if (argv.threads) args.push('--threads', String(argv.threads));
  buildMs.index = runBuild(args, 'build index', buildEnv);
}
  if (buildSqlite) {
    const args = [buildSqlitePath];
    if (repoArg) args.push('--repo', repoArg);
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

const reportArgs = [reportPath, '--json'];
if (repoArg) reportArgs.push('--repo', repoArg);
const reportResult = spawnSync(process.execPath, reportArgs, { encoding: 'utf8' });
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
  benchmarkProfile: {
    enabled: benchmarkProfile.enabled,
    disabled: benchmarkProfile.disabled
  },
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
  repo: { root: repoArg || root },
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
