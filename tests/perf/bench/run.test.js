#!/usr/bin/env node
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { createCli } from '../../../src/shared/cli.js';
import { BENCH_OPTIONS, validateBenchArgs } from '../../../src/shared/cli-options.js';
import { createDisplay } from '../../../src/shared/cli/display.js';
import { hasChunkMetaArtifactsSync } from '../../../src/shared/index-artifact-helpers.js';
import { buildSearchCliArgs } from '../../../tools/shared/search-cli-harness.js';
import { readQueryFileSafe, resolveTopNAndLimit, selectQueriesByLimit } from '../../../tools/shared/query-file-utils.js';
import { getIndexDir, getRuntimeConfig, loadUserConfig, resolveRuntimeEnv, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { runWithConcurrency } from '../../../src/shared/concurrency.js';
import os from 'node:os';
import { createSafeRegex, normalizeSafeRegexConfig } from '../../../src/shared/safe-regex.js';
import { build as buildHistogram } from 'hdr-histogram-js';
import { applyTestEnv, attachSilentLogging } from '../../helpers/test-env.js';
import { formatBenchDuration as formatDuration, formatBenchDurationMs as formatDurationMs } from '../../helpers/duration-format.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

applyTestEnv();

const rawArgs = process.argv.slice(2);
const argv = createCli({
  scriptName: 'bench',
  options: BENCH_OPTIONS,
  aliases: { n: 'top', q: 'queries' }
}).parse();
validateBenchArgs(argv);

const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: argv.quiet === true,
  json: argv.json === true
});
let displayClosed = false;
const closeDisplay = () => {
  if (displayClosed) return;
  display.close();
  displayClosed = true;
};
const fatalExit = (message, code = 1) => {
  display.error(String(message || 'Unknown error'));
  closeDisplay();
  process.exit(code);
};

const safeRegexConfig = normalizeSafeRegexConfig({
  maxPatternLength: 64,
  maxInputLength: 64,
  timeoutMs: 10,
  flags: 'i'
});
const safeRegex = createSafeRegex('a+b', '', safeRegexConfig);
if (!safeRegex || !safeRegex.test('Aaab')) {
  fatalExit('Safe regex self-check failed.');
}
const rejected = createSafeRegex('a'.repeat(128), '', safeRegexConfig);
if (rejected) {
  fatalExit('Safe regex maxPatternLength guard failed.');
}
if (safeRegex.test('a'.repeat(100))) {
  fatalExit('Safe regex maxInputLength guard failed.');
}

const root = process.cwd();
const repoArg = argv.repo ? path.resolve(argv.repo) : null;
const reportPath = path.join(root, 'tools', 'index', 'report-artifacts.js');
const buildIndexPath = path.join(root, 'build_index.js');
const indexerServicePath = path.join(root, 'tools', 'service', 'indexer-service.js');
const queryWorkerPath = path.join(root, 'tests', 'perf', 'bench', 'query-worker.js');

const defaultQueriesPath = path.join(root, 'tests', 'retrieval', 'parity', 'parity-queries.txt');
const queriesPath = argv.queries ? path.resolve(argv.queries) : defaultQueriesPath;

const queries = await readQueryFileSafe(queriesPath, { allowJson: false });
if (!queries.length) {
  fatalExit(`No queries found at ${queriesPath}`);
}

const { topN, limit } = resolveTopNAndLimit({
  top: argv.top,
  limit: argv.limit,
  defaultTop: 5,
  defaultLimit: 0
});
const selectedQueries = selectQueriesByLimit(queries, limit);
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
/**
 * Detect whether sparse index artifacts already exist for a mode.
 *
 * @param {'code'|'prose'} mode
 * @returns {boolean}
 */
const hasIndex = (mode) => {
  const dir = getIndexDir(runtimeRoot, mode, userConfig);
  return hasChunkMetaArtifactsSync(dir);
};
/**
 * Detect whether sqlite artifacts already exist for a mode.
 *
 * @param {'code'|'prose'} mode
 * @returns {boolean}
 */
const hasSqliteIndex = (mode) => {
  const paths = resolveSqlitePaths(runtimeRoot, userConfig);
  const target = mode === 'prose' ? paths.prosePath : paths.codePath;
  return fsSync.existsSync(target);
};
if (needsMemory && !buildIndex && (!hasIndex('code') || !hasIndex('prose'))) {
  buildIndex = true;
  logBench('[bench] Missing index artifacts; enabling --build-index.');
}
if (needsSqlite && !buildSqlite && (!hasSqliteIndex('code') || !hasSqliteIndex('prose'))) {
  buildSqlite = true;
  logBench('[bench] Missing sqlite artifacts; enabling --build-sqlite.');
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
  baseEnv.NODE_OPTIONS = stripMaxOldSpaceFlag(baseEnv.NODE_OPTIONS || '');
  baseEnv.NODE_OPTIONS = [baseEnv.NODE_OPTIONS, `--max-old-space-size=${heapOverride}`]
    .filter(Boolean)
    .join(' ')
    .trim();
  baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB = String(heapOverride);
  logBench(
    `[bench] Heap ${formatGb(heapOverride)} (${heapOverride} MB) ` +
      `(override with --heap-mb or PAIROFCLEATS_MAX_OLD_SPACE_MB)`
  );
}
const benchEnv = baseEnv;
benchEnv.PAIROFCLEATS_BENCH_RUN = '1';

function logBench(message) {
  if (!message) return;
  if (quietMode) return;
  display.log(message);
}

function formatQueryPreview(query, maxChars = 120) {
  const value = String(query || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function buildSearchArgs(query, backend) {
  const extraArgs = [];
  if (bm25K1Arg) extraArgs.push('--bm25-k1', String(bm25K1Arg));
  if (bm25BArg) extraArgs.push('--bm25-b', String(bm25BArg));
  if (ftsProfileArg) extraArgs.push('--fts-profile', String(ftsProfileArg));
  if (ftsWeightsArg) extraArgs.push('--fts-weights', String(ftsWeightsArg));
  return buildSearchCliArgs({
    query,
    json: true,
    jsonCount: 2,
    stats: true,
    backend,
    topN,
    annArg,
    repo: repoArg,
    extraArgs
  });
}

function createSearchWorker(label, env) {
  const child = fork(queryWorkerPath, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  attachSilentLogging(child, label);
  let nextMessageId = 1;
  const pending = new Map();
  child.on('message', (message) => {
    const id = Number(message?.id);
    if (!Number.isFinite(id) || !pending.has(id)) return;
    const entry = pending.get(id);
    pending.delete(id);
    if (message?.ok) {
      entry.resolve(message.payload || {});
      return;
    }
    const err = new Error(message?.error?.message || `Query worker ${label} failed`);
    err.code = message?.error?.code || 'ERR_QUERY_WORKER';
    entry.reject(err);
  });
  const rejectAll = (reason) => {
    for (const [, entry] of pending) {
      entry.reject(reason);
    }
    pending.clear();
  };
  child.on('error', (err) => {
    rejectAll(err instanceof Error ? err : new Error(String(err)));
  });
  child.on('exit', (code, signal) => {
    if (!pending.size) return;
    rejectAll(new Error(`Query worker ${label} exited early (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
  });
  const run = (args) => new Promise((resolve, reject) => {
    const id = nextMessageId;
    nextMessageId += 1;
    pending.set(id, { resolve, reject });
    child.send({ type: 'run', id, args });
  });
  const close = async () => {
    if (!child || child.killed) return;
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      try {
        child.send({ type: 'shutdown' });
      } catch {
        resolve();
      }
      setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        resolve();
      }, 2000).unref?.();
    });
  };
  return { run, close };
}

function createSearchWorkerPool({ size, env }) {
  const workerCount = Math.max(1, Math.floor(size) || 1);
  const workers = Array.from({ length: workerCount }, (_, index) => (
    createSearchWorker(`bench-worker:${index + 1}`, env)
  ));
  let nextWorker = 0;
  const run = (args) => {
    const worker = workers[nextWorker];
    nextWorker = (nextWorker + 1) % workers.length;
    return worker.run(args);
  };
  const close = async () => {
    await Promise.all(workers.map((worker) => worker.close()));
  };
  return { run, close };
}

function runSearch(pool, query, backend) {
  const args = buildSearchArgs(query, backend);
  return pool.run(args);
}

function buildQueryWorkerEnv() {
  const env = { ...benchEnv };
  if (stubEmbeddings) {
    env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  } else {
    delete env.PAIROFCLEATS_EMBEDDINGS;
  }
  return env;
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
    fatalExit(`Build failed: ${label}`, result.status ?? 1);
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
    fatalExit(`Service queue failed: ${queueName}`, result.status ?? 1);
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
    // Bench controls sqlite timing separately via runSqliteBuild; keep stage4 out
    // of build_index to avoid duplicate sqlite passes and distorted timings.
    args.push('--no-sqlite');
    if (repoArg) args.push('--repo', repoArg);
    if (stubEmbeddings) args.push('--stub-embeddings');
    if (buildIncremental) args.push('--incremental');
    if (argv.threads) args.push('--threads', String(argv.threads));
    buildMs.index = runBuild(args, 'build index', buildEnv);
    if (useStageQueue) {
      runServiceQueue('index', buildEnv);
      logBench('[bench] Stage2 enrichment complete; continuing to query run.');
    }
  }
  if (buildSqlite) {
    Object.assign(process.env, buildEnv);
    const sqliteStarted = Date.now();
    await runSqliteBuild(runtimeRoot, {
      incremental: buildIncremental,
      emitOutput: true,
      logger: {
        log: logBench,
        warn: logBench,
        error: logBench
      }
    });
    buildMs.sqlite = Date.now() - sqliteStarted;
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
  const missTaxonomyByBackend = {};
  const missTaxonomyLowHitByBackend = {};
  const tallyMissTaxonomy = (target, labels = []) => {
    if (!(target instanceof Map)) return;
    for (const rawLabel of labels) {
      const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
      if (!label) continue;
      target.set(label, (target.get(label) || 0) + 1);
    }
  };
  const toSortedObject = (target) => Object.fromEntries(
    Array.from(target.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );
  for (const backend of backends) {
    latency[backend] = [];
    memoryRss[backend] = [];
    hitCounts[backend] = 0;
    resultCounts[backend] = [];
    missTaxonomyByBackend[backend] = new Map();
    missTaxonomyLowHitByBackend[backend] = new Map();
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
    `[bench] Running ${selectedQueries.length} queries x ${backends.length} backends ` +
    `(${totalSearches} searches) | concurrency ${requestedConcurrency}`
  );
  logQueryProgress(true);
  const workerPool = createSearchWorkerPool({
    size: Math.max(1, Math.min(requestedConcurrency, queryTasks.length || 1)),
    env: buildQueryWorkerEnv()
  });

  const loggedQueries = new Set();
  const runQueryTask = async (task) => {
    if (!loggedQueries.has(task.queryIndex)) {
      loggedQueries.add(task.queryIndex);
      logBench(
        `[bench] Query ${task.queryIndex}/${selectedQueries.length} | ` +
        `c${requestedConcurrency} | ${formatQueryPreview(task.query)}`
      );
    }
    const payload = await runSearch(workerPool, task.query, task.backend);
    queryProgress.count += 1;
    logQueryProgress();
    const elapsedMs = Number(payload.stats?.elapsedMs);
    if (!Number.isFinite(elapsedMs)) {
      fatalExit(`[bench] Missing timing stats for backend=${task.backend} query="${task.query}"`);
    }
    latency[task.backend].push(elapsedMs);
    const codeHits = Array.isArray(payload.code) ? payload.code.length : 0;
    const proseHits = Array.isArray(payload.prose) ? payload.prose.length : 0;
    const totalHits = codeHits + proseHits;
    const taxonomyLabels = Array.isArray(payload?.stats?.intent?.missTaxonomy?.labels)
      ? payload.stats.intent.missTaxonomy.labels
      : [];
    tallyMissTaxonomy(missTaxonomyByBackend[task.backend], taxonomyLabels);
    if (totalHits <= 0) {
      tallyMissTaxonomy(missTaxonomyLowHitByBackend[task.backend], taxonomyLabels);
    }
    resultCounts[task.backend].push(totalHits);
    if (totalHits > 0) hitCounts[task.backend] += 1;
    const rss = payload.stats?.memory?.rss;
    if (Number.isFinite(rss)) memoryRss[task.backend].push(rss);
  };
  try {
    if (queryTasks.length) {
      await runWithConcurrency(
        queryTasks,
        Math.max(1, Math.min(requestedConcurrency, queryTasks.length)),
        runQueryTask
      );
    }
  } finally {
    await workerPool.close();
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
    missTaxonomy: {
      byBackend: Object.fromEntries(backends.map((backend) => [
        backend,
        toSortedObject(missTaxonomyByBackend[backend])
      ])),
      lowHitByBackend: Object.fromEntries(backends.map((backend) => [
        backend,
        toSortedObject(missTaxonomyLowHitByBackend[backend])
      ]))
    },
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
  fatalExit(`[bench] Artifact corruption check failed: ${issues}`);
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
  closeDisplay();
  console.log(JSON.stringify(output, null, 2));
} else {
  for (const runSummary of summaries) {
    if (!runSummary) continue;
    const concurrencyLabel = Number.isFinite(runSummary.queryConcurrency)
      ? ` (concurrency ${runSummary.queryConcurrency})`
      : '';
    logBench(`Benchmark summary${concurrencyLabel}`);
    logBench(`- Queries: ${runSummary.queries}`);
    logBench(`- TopN: ${runSummary.topN}`);
    logBench(`- Ann: ${runSummary.annEnabled}`);
    if (Number.isFinite(runSummary.queryWallMs)) {
      logBench(
        `- Query wall time: ${formatDuration(runSummary.queryWallMs)} ` +
        `(avg/search ${formatDurationMs(runSummary.queryWallMsPerSearch)}, ` +
        `avg/query ${formatDurationMs(runSummary.queryWallMsPerQuery)})`
      );
    }
    for (const backend of runSummary.backends || backends) {
      const stats = runSummary.latencyMs?.[backend];
      if (stats) {
        logBench(`- ${backend} avg ms: ${stats.mean.toFixed(1)} (p95 ${stats.p95.toFixed(1)}, p99 ${stats.p99.toFixed(1)})`);
      }
      const hitRate = runSummary.hitRate?.[backend];
      const resultCount = runSummary.resultCountAvg?.[backend];
      if (Number.isFinite(hitRate) && Number.isFinite(resultCount)) {
        logBench(`- ${backend} hit rate: ${(hitRate * 100).toFixed(1)}% (avg hits ${resultCount.toFixed(1)})`);
      }
      const mem = runSummary.memoryRss?.[backend];
      if (mem && mem.mean) {
        logBench(`- ${backend} rss avg mb: ${(mem.mean / (1024 * 1024)).toFixed(1)} (p95 ${(mem.p95 / (1024 * 1024)).toFixed(1)}, p99 ${(mem.p99 / (1024 * 1024)).toFixed(1)})`);
      }
    }
    if (runSummary.buildMs?.index) {
      logBench(`- build index ms: ${runSummary.buildMs.index.toFixed(0)}`);
    }
    if (runSummary.buildMs?.sqlite) {
      logBench(`- build sqlite ms: ${runSummary.buildMs.sqlite.toFixed(0)}`);
    }
    const throughput = artifactReport?.throughput || null;
    if (throughput?.code) {
      const codeThroughput = throughput.code;
      logBench(
        `- throughput code: ${formatRate(codeThroughput.chunksPerSec, 'chunks')}, ` +
        `${formatRate(codeThroughput.tokensPerSec, 'tokens')}, ` +
        `${formatRate(codeThroughput.bytesPerSec, 'bytes')}`
      );
    }
    if (throughput?.prose) {
      const proseThroughput = throughput.prose;
      logBench(
        `- throughput prose: ${formatRate(proseThroughput.chunksPerSec, 'chunks')}, ` +
        `${formatRate(proseThroughput.tokensPerSec, 'tokens')}, ` +
        `${formatRate(proseThroughput.bytesPerSec, 'bytes')}`
      );
    }
    if (throughput?.lmdb?.code) {
      const lmdbCode = throughput.lmdb.code;
      logBench(
        `- throughput lmdb code: ${formatRate(lmdbCode.chunksPerSec, 'chunks')}, ` +
        `${formatRate(lmdbCode.tokensPerSec, 'tokens')}, ` +
        `${formatRate(lmdbCode.bytesPerSec, 'bytes')}`
      );
    }
    if (throughput?.lmdb?.prose) {
      const lmdbProse = throughput.lmdb.prose;
      logBench(
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
  if (!argv.json) logBench(`[bench] Report written (${path.basename(outPath)}).`);
}
closeDisplay();
