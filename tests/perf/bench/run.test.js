#!/usr/bin/env node
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createCli } from '../../../src/shared/cli.js';
import { BENCH_OPTIONS, validateBenchArgs } from '../../../src/shared/cli-options.js';
import { getIndexDir, getRuntimeConfig, loadUserConfig, resolveRuntimeEnv, resolveSqlitePaths } from '../../../tools/dict-utils.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { runWithConcurrency } from '../../../src/shared/concurrency.js';
import os from 'node:os';
import { createSafeRegex, normalizeSafeRegexConfig } from '../../../src/shared/safe-regex.js';
import { build as buildHistogram } from 'hdr-histogram-js';
import { attachSilentLogging } from '../../helpers/test-env.js';

process.env.PAIROFCLEATS_TESTING = '1';

const rawArgs = process.argv.slice(2);
const argv = createCli({
  scriptName: 'bench',
  options: BENCH_OPTIONS,
  aliases: { n: 'top', q: 'queries' }
}).parse();
validateBenchArgs(argv);

const safeRegexConfig = normalizeSafeRegexConfig({
  maxPatternLength: 64,
  maxInputLength: 64,
  timeoutMs: 10,
  flags: 'i'
});
const safeRegex = createSafeRegex('a+b', '', safeRegexConfig);
if (!safeRegex || !safeRegex.test('Aaab')) {
  console.error('Safe regex self-check failed.');
  process.exit(1);
}
const rejected = createSafeRegex('a'.repeat(128), '', safeRegexConfig);
if (rejected) {
  console.error('Safe regex maxPatternLength guard failed.');
  process.exit(1);
}
if (safeRegex.test('a'.repeat(100))) {
  console.error('Safe regex maxInputLength guard failed.');
  process.exit(1);
}

const root = process.cwd();
const repoArg = argv.repo ? path.resolve(argv.repo) : null;
const searchPath = path.join(root, 'search.js');
const reportPath = path.join(root, 'tools', 'report-artifacts.js');
const buildIndexPath = path.join(root, 'build_index.js');
const buildSqlitePath = path.join(root, 'tools', 'build/sqlite-index.js');
const indexerServicePath = path.join(root, 'tools', 'indexer-service.js');

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
const quietMode = argv.quiet === true;
const progressMode = argv.progress || 'auto';
const verboseMode = argv.verbose === true;
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
let buildSqlite = argv['build-sqlite'] || argv.build;
const buildIncremental = argv.incremental === true || buildSqlite;
const envConfig = getEnvConfig();
const runtimeRoot = repoArg || root;
const userConfig = loadUserConfig(runtimeRoot);
const runtimeConfig = getRuntimeConfig(runtimeRoot, userConfig);
const embeddingProvider = userConfig.indexing?.embeddings?.provider || 'xenova';
const needsMemory = backends.includes('memory');
const needsSqlite = backends.some((entry) => entry.startsWith('sqlite'));
const hasIndex = (mode) => {
  const dir = getIndexDir(runtimeRoot, mode, userConfig);
  const metaPaths = [
    'chunk_meta.json',
    'chunk_meta.jsonl',
    'chunk_meta.meta.json',
    'chunk_meta.parts'
  ];
  return metaPaths.some((entry) => fsSync.existsSync(path.join(dir, entry)));
};
const hasSqliteIndex = (mode) => {
  const paths = resolveSqlitePaths(runtimeRoot, userConfig);
  const target = mode === 'prose' ? paths.prosePath : paths.codePath;
  return fsSync.existsSync(target);
};
if (needsMemory && !buildIndex && (!hasIndex('code') || !hasIndex('prose'))) {
  buildIndex = true;
  logBench('[bench] Missing file-backed index; enabling build-index.');
}
if (needsSqlite && !buildSqlite && (!hasSqliteIndex('code') || !hasSqliteIndex('prose'))) {
  buildSqlite = true;
  logBench('[bench] Missing sqlite index; enabling build-sqlite.');
}
if (buildSqlite && !buildIndex) buildIndex = true;
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
  && !envConfig.maxOldSpaceMb
  && !hasHeapFlag
) {
  heapOverride = heapRecommendation.recommendedMb;
}
const runtimeConfigForRun = heapOverride
  ? { ...runtimeConfig, maxOldSpaceMb: heapOverride }
  : runtimeConfig;
const envStubEmbeddings = envConfig.embeddings === 'stub';
const realEmbeddings = argv['real-embeddings'] === true;
const stubEmbeddings = argv['stub-embeddings'] === true
  || (!realEmbeddings && envStubEmbeddings);

const baseEnvCandidate = { ...process.env, NODE_OPTIONS: baseNodeOptions };
const baseEnv = resolveRuntimeEnv(runtimeConfigForRun, baseEnvCandidate);
if (realEmbeddings && baseEnv.PAIROFCLEATS_EMBEDDINGS) {
  delete baseEnv.PAIROFCLEATS_EMBEDDINGS;
}
if (heapOverride) {
  baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB = String(heapOverride);
  logBench(
    `[bench] heap ${formatGb(heapOverride)} (${heapOverride} MB) ` +
      `(override with --heap-mb or PAIROFCLEATS_MAX_OLD_SPACE_MB)`
  );
}
const benchEnv = baseEnv;

function logBench(message) {
  if (!message) return;
  if (quietMode) return;
  if (jsonOutput) process.stderr.write(`${message}\n`);
  else console.log(message);
}

function runSearch(query, backend) {
  const args = [
    searchPath,
    query,
    '--json',
    '--json',
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
  const env = { ...benchEnv };
  if (stubEmbeddings) {
    env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  } else {
    delete env.PAIROFCLEATS_EMBEDDINGS;
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    attachSilentLogging(child, `bench:${backend}`);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      console.error(`Search failed to start for backend=${backend} query="${query}"`);
      if (err?.message) console.error(err.message);
      process.exit(1);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`Search failed for backend=${backend} query="${query}"`);
        if (stderr) console.error(stderr.trim());
        process.exit(code ?? 1);
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (err) {
        console.error(`Search response parse failed for backend=${backend} query="${query}"`);
        if (stderr) console.error(stderr.trim());
        process.exit(1);
      }
    });
  });
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildPercentileHistogram(values, scale) {
  if (!values.length) return null;
  const scaled = values.map((value) => Math.max(1, Math.round(value * scale)));
  const maxValue = Math.max(...scaled, 1);
  const histogram = buildHistogram({
    lowestDiscernibleValue: 1,
    highestTrackableValue: maxValue,
    numberOfSignificantValueDigits: 3
  });
  scaled.forEach((value) => histogram.recordValue(value));
  return histogram;
}

function buildStats(values, { scale = 1 } = {}) {
  if (!values.length) return { mean: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  const histogram = buildPercentileHistogram(values, scale);
  const pct = (value) => (histogram ? histogram.getValueAtPercentile(value) / scale : 0);
  return {
    mean: mean(values),
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    min: Math.min(...values),
    max: Math.max(...values)
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

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return formatDuration(ms);
}

function formatRate(value, unit) {
  if (!Number.isFinite(value)) return 'n/a';
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${unit}/s`;
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

function runServiceQueue(queueName, env) {
  const args = [indexerServicePath, 'work', '--queue', queueName, '--concurrency', '1'];
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
    console.error(`Service queue failed: ${queueName}`);
    process.exit(result.status ?? 1);
  }
}

const buildMs = {};
if (buildIndex || buildSqlite) {
  const buildEnv = { ...benchEnv };
  if (Number.isFinite(Number(argv.threads)) && Number(argv.threads) > 0) {
    buildEnv.PAIROFCLEATS_THREADS = String(argv.threads);
  }
  if (stubEmbeddings) {
    buildEnv.PAIROFCLEATS_EMBEDDINGS = 'stub';
  } else {
    delete buildEnv.PAIROFCLEATS_EMBEDDINGS;
  }
  const twoStageConfig = userConfig.indexing?.twoStage || {};
  const useStageQueue = twoStageConfig.enabled === true
    && twoStageConfig.background === true
    && twoStageConfig.queue !== false;
  const embeddingMode = typeof userConfig.indexing?.embeddings?.mode === 'string'
    ? userConfig.indexing.embeddings.mode.trim().toLowerCase()
    : '';
  const embeddingsEnabled = userConfig.indexing?.embeddings?.enabled !== false;
  const useEmbeddingService = embeddingsEnabled && embeddingMode === 'service';
  const buildProgressArgs = progressMode ? ['--progress', String(progressMode)] : [];
  const buildVerboseArgs = verboseMode ? ['--verbose'] : [];
  const buildQuietArgs = quietMode ? ['--quiet'] : [];
  if (buildIndex) {
    const args = [
      buildIndexPath,
      ...buildProgressArgs,
      ...buildVerboseArgs,
      ...buildQuietArgs
    ];
    if (repoArg) args.push('--repo', repoArg);
    if (stubEmbeddings) args.push('--stub-embeddings');
    if (buildIncremental) args.push('--incremental');
    if (argv.threads) args.push('--threads', String(argv.threads));
    buildMs.index = runBuild(args, 'build index', buildEnv);
    if (useStageQueue) {
      runServiceQueue('index', buildEnv);
      logBench('[bench] Stage2 enrichment complete; continuing with benchmark queries.');
    }
  }
  if (buildSqlite) {
    const args = [
      buildSqlitePath,
      ...buildProgressArgs,
      ...buildVerboseArgs,
      ...buildQuietArgs
    ];
    if (repoArg) args.push('--repo', repoArg);
    if (buildIncremental) args.push('--incremental');
    buildMs.sqlite = runBuild(args, 'build sqlite', buildEnv);
  }
  if (buildIndex && useEmbeddingService) {
    runServiceQueue('embeddings', buildEnv);
  }
}

const queryTasks = [];
let queryIndex = 0;
for (const query of selectedQueries) {
  queryIndex += 1;
  for (const backend of backends) {
    queryTasks.push({ query, backend, queryIndex });
  }
}

const queryConcurrencyRaw = Number(argv['query-concurrency']);
const queryConcurrencyList = Number.isFinite(queryConcurrencyRaw) && queryConcurrencyRaw > 0
  ? [Math.floor(queryConcurrencyRaw)]
  : [4];

const runQueries = async (requestedConcurrency) => {
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

  const totalSearches = selectedQueries.length * backends.length;
  const queryProgress = {
    count: 0,
    startMs: Date.now(),
    lastLogMs: 0,
    lastPct: 0
  };
  const logQueryProgress = (force = false) => {
    if (!totalSearches) return;
    const now = Date.now();
    const pct = (queryProgress.count / totalSearches) * 100;
    const elapsedMs = now - queryProgress.startMs;
    const rate = elapsedMs > 0 ? queryProgress.count / (elapsedMs / 1000) : 0;
    const remaining = totalSearches - queryProgress.count;
    const etaMs = rate > 0 && remaining > 0 ? (remaining / rate) * 1000 : 0;
    const shouldLog = force
      || queryProgress.count === totalSearches
      || now - queryProgress.lastLogMs >= 10000
      || pct - queryProgress.lastPct >= 5;
    if (!shouldLog) return;
    const elapsedText = formatDuration(elapsedMs);
    const avgSearchText = queryProgress.count
      ? formatDurationMs(elapsedMs / queryProgress.count)
      : 'n/a';
    const avgQueryText = selectedQueries.length
      ? formatDurationMs(elapsedMs / selectedQueries.length)
      : 'n/a';
    const etaText = etaMs > 0 ? formatDuration(etaMs) : 'n/a';
    logBench(
      `[bench] Queries ${queryProgress.count}/${totalSearches} (${pct.toFixed(1)}%) | ` +
      `concurrency ${requestedConcurrency} | elapsed ${elapsedText} | ` +
      `avg/search ${avgSearchText} | avg/query ${avgQueryText} | eta ${etaText}`
    );
    queryProgress.lastLogMs = now;
    queryProgress.lastPct = pct;
  };

  logBench(
    `[bench] Running ${selectedQueries.length} queries across ${backends.length} backends ` +
    `(${totalSearches} searches) with concurrency ${requestedConcurrency}.`
  );
  logQueryProgress(true);

  const loggedQueries = new Set();
  const runQueryTask = async (task) => {
    if (!loggedQueries.has(task.queryIndex)) {
      loggedQueries.add(task.queryIndex);
      logBench(
        `[bench] (concurrency ${requestedConcurrency}) Query ` +
        `${task.queryIndex}/${selectedQueries.length}: ${task.query}`
      );
    }
    const payload = await runSearch(task.query, task.backend);
    queryProgress.count += 1;
    logQueryProgress();
    const elapsedMs = Number(payload.stats?.elapsedMs);
    if (!Number.isFinite(elapsedMs)) {
      console.error(`[bench] Missing timing stats for backend=${task.backend} query="${task.query}"`);
      process.exit(1);
    }
    latency[task.backend].push(elapsedMs);
    const codeHits = Array.isArray(payload.code) ? payload.code.length : 0;
    const proseHits = Array.isArray(payload.prose) ? payload.prose.length : 0;
    const totalHits = codeHits + proseHits;
    resultCounts[task.backend].push(totalHits);
    if (totalHits > 0) hitCounts[task.backend] += 1;
    const rss = payload.stats?.memory?.rss;
    if (Number.isFinite(rss)) memoryRss[task.backend].push(rss);
  };
  if (queryTasks.length) {
    await runWithConcurrency(
      queryTasks,
      Math.max(1, Math.min(requestedConcurrency, queryTasks.length)),
      runQueryTask
    );
  }
  logQueryProgress(true);
  const queryWallMs = Date.now() - queryProgress.startMs;
  const queryWallMsPerSearch = totalSearches ? queryWallMs / totalSearches : 0;
  const queryWallMsPerQuery = selectedQueries.length ? queryWallMs / selectedQueries.length : 0;

  const latencyStats = Object.fromEntries(backends.map((b) => [b, buildStats(latency[b], { scale: 1000 })]));
  const memoryStats = Object.fromEntries(backends.map((b) => [b, buildStats(memoryRss[b], { scale: 1 })]));
  const hitRate = Object.fromEntries(backends.map((b) => [
    b,
    selectedQueries.length ? hitCounts[b] / selectedQueries.length : 0
  ]));
  const resultCountAvg = Object.fromEntries(backends.map((b) => [b, mean(resultCounts[b])]));

  const summary = {
    queries: selectedQueries.length,
    topN,
    annEnabled,
    embeddingProvider,
    backends,
    queryConcurrency: requestedConcurrency,
    queryWallMs,
    queryWallMsPerSearch,
    queryWallMsPerQuery,
    latencyMsAvg: Object.fromEntries(backends.map((b) => [b, latencyStats[b].mean])),
    latencyMs: latencyStats,
    hitRate,
    resultCountAvg,
    memoryRss: memoryStats,
    buildMs: Object.keys(buildMs).length ? buildMs : null
  };

  return { summary };
};

const runs = [];
for (const concurrency of queryConcurrencyList) {
  runs.push(await runQueries(concurrency));
}

const reportArgs = [reportPath, '--json'];
if (repoArg) reportArgs.push('--repo', repoArg);
const reportResult = spawnSync(process.execPath, reportArgs, { encoding: 'utf8' });
const artifactReport = reportResult.status === 0 ? JSON.parse(reportResult.stdout || '{}') : {};
const corruption = artifactReport?.corruption || null;
if (corruption && corruption.ok === false) {
  const issues = Array.isArray(corruption.issues) && corruption.issues.length
    ? corruption.issues.join('; ')
    : 'unknown issues';
  console.error(`[bench] Artifact corruption check failed: ${issues}`);
  process.exit(1);
}

const summaries = runs.map((run) => run.summary).filter(Boolean);
const concurrencyStats = {};
for (const runSummary of summaries) {
  const concurrency = runSummary?.queryConcurrency;
  if (concurrency === 4) {
    concurrencyStats[String(concurrency)] = {
      latencyMsAvg: runSummary.latencyMsAvg,
      latencyMs: runSummary.latencyMs,
      hitRate: runSummary.hitRate,
      resultCountAvg: runSummary.resultCountAvg,
      memoryRss: runSummary.memoryRss
    };
  }
}
const summary = summaries[0]
  ? {
    ...summaries[0],
    ...(Object.keys(concurrencyStats).length ? { concurrencyStats } : {})
  }
  : null;

const output = {
  generatedAt: new Date().toISOString(),
  repo: { root: repoArg || root },
  summary,
  runs: summaries,
  artifacts: artifactReport
};

if (argv.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  for (const runSummary of summaries) {
    if (!runSummary) continue;
    const concurrencyLabel = Number.isFinite(runSummary.queryConcurrency)
      ? ` (concurrency ${runSummary.queryConcurrency})`
      : '';
    console.log(`Benchmark summary${concurrencyLabel}`);
    console.log(`- Queries: ${runSummary.queries}`);
    console.log(`- TopN: ${runSummary.topN}`);
    console.log(`- Ann: ${runSummary.annEnabled}`);
    if (Number.isFinite(runSummary.queryWallMs)) {
      console.log(
        `- Query wall time: ${formatDuration(runSummary.queryWallMs)} ` +
        `(avg/search ${formatDurationMs(runSummary.queryWallMsPerSearch)}, ` +
        `avg/query ${formatDurationMs(runSummary.queryWallMsPerQuery)})`
      );
    }
    for (const backend of runSummary.backends || backends) {
      const stats = runSummary.latencyMs?.[backend];
      if (stats) {
        console.log(`- ${backend} avg ms: ${stats.mean.toFixed(1)} (p95 ${stats.p95.toFixed(1)}, p99 ${stats.p99.toFixed(1)})`);
      }
      const hitRate = runSummary.hitRate?.[backend];
      const resultCount = runSummary.resultCountAvg?.[backend];
      if (Number.isFinite(hitRate) && Number.isFinite(resultCount)) {
        console.log(`- ${backend} hit rate: ${(hitRate * 100).toFixed(1)}% (avg hits ${resultCount.toFixed(1)})`);
      }
      const mem = runSummary.memoryRss?.[backend];
      if (mem && mem.mean) {
        console.log(`- ${backend} rss avg mb: ${(mem.mean / (1024 * 1024)).toFixed(1)} (p95 ${(mem.p95 / (1024 * 1024)).toFixed(1)}, p99 ${(mem.p99 / (1024 * 1024)).toFixed(1)})`);
      }
    }
    if (runSummary.buildMs?.index) {
      console.log(`- build index ms: ${runSummary.buildMs.index.toFixed(0)}`);
    }
    if (runSummary.buildMs?.sqlite) {
      console.log(`- build sqlite ms: ${runSummary.buildMs.sqlite.toFixed(0)}`);
    }
    const throughput = artifactReport?.throughput || null;
    if (throughput?.code) {
      const codeThroughput = throughput.code;
      console.log(
        `- throughput code: ${formatRate(codeThroughput.chunksPerSec, 'chunks')}, ` +
        `${formatRate(codeThroughput.tokensPerSec, 'tokens')}, ` +
        `${formatRate(codeThroughput.bytesPerSec, 'bytes')}`
      );
    }
    if (throughput?.prose) {
      const proseThroughput = throughput.prose;
      console.log(
        `- throughput prose: ${formatRate(proseThroughput.chunksPerSec, 'chunks')}, ` +
        `${formatRate(proseThroughput.tokensPerSec, 'tokens')}, ` +
        `${formatRate(proseThroughput.bytesPerSec, 'bytes')}`
      );
    }
    if (throughput?.lmdb?.code) {
      const lmdbCode = throughput.lmdb.code;
      console.log(
        `- throughput lmdb code: ${formatRate(lmdbCode.chunksPerSec, 'chunks')}, ` +
        `${formatRate(lmdbCode.tokensPerSec, 'tokens')}, ` +
        `${formatRate(lmdbCode.bytesPerSec, 'bytes')}`
      );
    }
    if (throughput?.lmdb?.prose) {
      const lmdbProse = throughput.lmdb.prose;
      console.log(
        `- throughput lmdb prose: ${formatRate(lmdbProse.chunksPerSec, 'chunks')}, ` +
        `${formatRate(lmdbProse.tokensPerSec, 'tokens')}, ` +
        `${formatRate(lmdbProse.bytesPerSec, 'bytes')}`
      );
    }
  }
}

if (argv['write-report']) {
  const outPath = argv.out ? path.resolve(argv.out) : path.join(root, 'docs', 'benchmarks.json');
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  if (!argv.json) console.log(`Report written to ${outPath}`);
}
