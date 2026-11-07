import { createMicrobenchOptions } from '../../shared/operator-cli-options.js';
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
import os from 'node:os';
import { compareSearchMicroBaseline } from './baseline.js';
import { SEARCH_MICRO_REPORT_VERSION, captureMicroQuerySchedule } from './search-observation.js';
import { captureSweepSource } from '../ab-sweep-source.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { readQueryInputPlan } from '../../shared/query-file-utils.js';
import { withMicrobenchCacheOwner } from './cache-owner.js';
const { createCli } = await import('../../../src/shared/cli.js');
const { createSqliteDbCache } = await import('../../../src/retrieval/sqlite-cache.js');
const { parseCommaList } = await import('../../../src/shared/comma-list.js');
const { hasChunkMetaArtifactsSync } = await import('../../../src/shared/artifact-io/chunk-meta-presence.js');
const { getIndexDir, resolveRepoRoot, resolveToolRoot } = await import('../../shared/dict-utils.js');
const { formatMs, formatStats, writeJsonWithDir } = await import('./utils.js');

const toolRoot = resolveToolRoot();
const defaultRepo = path.resolve(toolRoot, 'tests', 'fixtures', 'sample');

const rawArgs = process.argv.slice(2);
const argv = createCli({
  scriptName: 'pairofcleats bench micro',
  options: createMicrobenchOptions(defaultRepo)
}).strictOptions().parse();

// Reject invalid options and serve help before initializing the workflow runtime.
const { buildIndex } = await import('../../../src/integrations/core/index.js');
const { runIndexBuildBenchmark } = await import('./index-build.js');
const { runSearchBenchmark } = await import('./search.js');

const hasRepoArg = rawArgs.includes('--repo');
const repoRoot = argv['repo-current'] && !hasRepoArg
  ? resolveRepoRoot(process.cwd())
  : path.resolve(argv.repo || resolveRepoRoot(process.cwd()));
const warmRuns = Math.max(0, Math.floor(argv.runs));
const warmupRuns = Math.max(0, Math.floor(argv.warmup));
const threads = Number(argv.threads) > 0 ? Math.floor(argv.threads) : undefined;
const mode = argv.mode === 'prose' ? 'prose' : 'code';
const components = parseComponents(argv.components);
const annBackends = parseCommaList(argv['ann-backends']).map((entry) => entry.toLowerCase());
const annBackendList = annBackends.length
  ? Array.from(new Set(annBackends))
  : ['sqlite-vector', 'lancedb'];
const queryPlan = argv.queries ? await readQueryInputPlan(path.resolve(argv.queries), { explicit: true,
  readFile: async file => (await readVerifiedContainedFile(path.dirname(file), file, { maxBytes: 4 * 1024 * 1024 })).buffer }) : null;
const capturedSchedule = captureMicroQuerySchedule(argv.query, queryPlan?.cases.map(entry => entry.query));
const querySchedule = capturedSchedule.queries;

const cpus = os.cpus();
const environment = { node: process.version, abi: process.versions.modules, platform: process.platform,
  arch: process.arch, cpuModel: cpus[0]?.model || 'unknown', cpuCount: cpus.length };

const results = {
  env: environment,
  codeProvenance: captureSweepSource(toolRoot),
  repoRoot,
  mode,
  query: argv.query,
  backend: argv.backend,
  workMode: argv['work-mode'],
  queryPlan,
  querySchedule: capturedSchedule,
  annBackends: annBackendList,
  components: {}
};

const log = argv.json ? () => {} : (message) => {
  if (message != null) console.error(message);
};
const logCompare = (message) => {
  if (!message) return;
  console.error(message);
};

await maybeBuildIndexes();

if (components.includes('index-build')) {
  log('\n[index-build]');
  const bench = await runIndexBuildBenchmark({
    repoRoot,
    mode,
    threads,
    sqlite: argv.sqlite === true,
    stubEmbeddings: argv['stub-embeddings'] !== false,
    warmRuns,
    cleanCache: argv.clean === true
  });
  results.components['index-build'] = bench;
  if (!argv.json) {
    log(`cold: ${formatMs(bench.coldMs)}`);
    log(`warm: ${formatStats(bench.warm)}`);
  }
}

const indexCache = new Map();
const sqliteCache = createSqliteDbCache();

await withMicrobenchCacheOwner(sqliteCache, async () => {
  if (components.includes('sparse')) {
    log('\n[search-sparse]');
    const bench = await runSearchBenchmark({
      repoRoot,
      query: argv.query,
      mode,
      backend: argv.backend,
      ann: false,
      scoreMode: 'sparse',
      workMode: argv['work-mode'],
      quality: argv.quality,
      querySchedule,
      warmRuns,
      warmupRuns,
      indexCache,
      sqliteCache
    });
    results.components['search-sparse'] = bench;
    if (!argv.json) {
      log(`initial (index handles cleared; other cache layers declared in receipt): ${formatMs(bench.initialMs)}`);
      log(`warm: ${formatStats(bench.warm)}`);
    }
  }

  if (components.includes('dense')) {
    log('\n[search-dense]');
    const bench = await runSearchBenchmark({
      repoRoot,
      query: argv.query,
      mode,
      backend: argv.backend,
      ann: true,
      scoreMode: 'dense',
      workMode: argv['work-mode'],
      quality: argv.quality,
      querySchedule,
      warmRuns,
      warmupRuns,
      indexCache,
      sqliteCache
    });
    results.components['search-dense'] = bench;
    if (!argv.json) {
      log(`initial (index handles cleared; other cache layers declared in receipt): ${formatMs(bench.initialMs)}`);
      log(`warm: ${formatStats(bench.warm)}`);
    }
  }

  if (components.includes('ann-backends') || components.includes('ann-backend')) {
    log('\n[ann-backends]');
    const backendResults = {};
    for (const annBackend of annBackendList) {
      log(`\n[ann-${annBackend}]`);
      const bench = await runSearchBenchmark({
        repoRoot,
        query: argv.query,
        mode,
        backend: argv.backend,
        ann: true,
        annBackend,
        scoreMode: 'dense',
        workMode: argv['work-mode'],
        quality: argv.quality,
        querySchedule,
        warmRuns,
        warmupRuns,
        indexCache,
        sqliteCache
      });
      backendResults[annBackend] = bench;
      if (!argv.json) {
        log(`initial (index handles cleared; other cache layers declared in receipt): ${formatMs(bench.initialMs)}`);
        log(`warm: ${formatStats(bench.warm)}`);
      }
    }
    const comparison = buildAnnBackendComparison(backendResults);
    results.components['ann-backends'] = {
      scoreMode: 'dense',
      backends: backendResults,
      comparison
    };
    if (comparison?.summary) {
      logCompare(`\n${comparison.summary}`);
    }
  }

  if (components.includes('hybrid')) {
    log('\n[search-hybrid]');
    const bench = await runSearchBenchmark({
      repoRoot,
      query: argv.query,
      mode,
      backend: argv.backend,
      ann: true,
      scoreMode: 'hybrid',
      workMode: argv['work-mode'],
      quality: argv.quality,
      querySchedule,
      warmRuns,
      warmupRuns,
      indexCache,
      sqliteCache
    });
    results.components['search-hybrid'] = bench;
    if (!argv.json) {
      log(`initial (index handles cleared; other cache layers declared in receipt): ${formatMs(bench.initialMs)}`);
      log(`warm: ${formatStats(bench.warm)}`);
    }
  }

  results.cache = {
    sqliteEntries: sqliteCache.size()
  };
});


if (argv.out) {
  const outPath = path.resolve(argv.out);
  writeJsonWithDir(outPath, results);
  log(`\nSaved results to ${outPath}`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
}

/**
 * Ensure sparse index artifacts exist before running search micro-benchmarks.
 *
 * @returns {Promise<void>}
 */
async function maybeBuildIndexes() {
  if (!argv.build) return;
  const indexDir = getIndexDir(repoRoot, mode);
  const metaExists = hasChunkMeta(indexDir);
  if (metaExists) return;
  log('[setup] building indexes before search benchmarks');
  await buildIndex(repoRoot, {
    mode,
    threads,
    incremental: true,
    sqlite: argv.sqlite === true,
    stubEmbeddings: argv['stub-embeddings'] !== false
  });
}

/**
 * Coarse chunk-meta presence check used for pre-benchmark readiness.
 *
 * @param {string|null|undefined} indexDir
 * @returns {boolean}
 */
function hasChunkMeta(indexDir) {
  if (!indexDir) return false;
  return hasChunkMetaArtifactsSync(indexDir);
}

/**
 * Parse and normalize comma-separated component names.
 *
 * @param {string} value
 * @returns {string[]}
 */
function parseComponents(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Build a deterministic sqlite-vector vs lancedb warm-latency summary.
 *
 * @param {Record<string, any>} backends
 * @returns {{
 *   sqlite:any,
 *   lancedb:any,
 *   ratio:{mean:number|null,p50:number|null},
 *   summary:string
 * }|null}
 */
function buildAnnBackendComparison(backends) {
  if (!backends || typeof backends !== 'object') return null;
  const sqlite = backends['sqlite-vector'] || backends.sqlite || null;
  const lancedb = backends.lancedb || null;
  if (!sqlite || !lancedb) return null;
  const report = entry => ({ schemaVersion: SEARCH_MICRO_REPORT_VERSION, kind: 'search-microbenchmark',
    repoRoot: entry.repoRoot, mode: entry.mode, backend: entry.backend, workMode: entry.workMode,
    querySchedule: entry.querySchedule, env: environment,
    components: { 'search-dense': { samples: entry.warm.count, meanMs: entry.warm.mean,
      p50Ms: entry.warm.p50, p95Ms: entry.warm.p95, p99Ms: entry.warm.p99,
      totalTimeMs: entry.warm.mean * entry.warm.count, scoreMode: entry.scoreMode,
      requestedBackend: entry.backend, requestedAnnBackend: entry.annBackend, work: entry.work } } });
  const admission = compareSearchMicroBaseline(report(sqlite), report(lancedb), { variedAxis: 'ann-backend' });
  const sqliteWarm = sqlite.warm, lanceWarm = lancedb.warm;
  if (admission.state !== 'comparable') return { state: 'incomparable', sqlite: sqliteWarm, lancedb: lanceWarm,
    ratio: { mean: null, p50: null }, admission,
    summary: `Comparison unavailable: ${admission.differences.map(row => row.reason).join(', ')}` };
  const toFixed = (value) => (Number.isFinite(value) ? value.toFixed(1) : 'n/a');
  const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);
  const meanRatio = ratio(sqliteWarm.mean, lanceWarm.mean);
  const p50Ratio = ratio(sqliteWarm.p50, lanceWarm.p50);
  const meanText = meanRatio ? `${meanRatio.toFixed(2)}x` : 'n/a';
  const p50Text = p50Ratio ? `${p50Ratio.toFixed(2)}x` : 'n/a';
  const summary = `Comparison (sqlite-vector vs lancedb): mean ${toFixed(sqliteWarm.mean)}ms vs ${toFixed(lanceWarm.mean)}ms (${meanText}) | p50 ${toFixed(sqliteWarm.p50)}ms vs ${toFixed(lanceWarm.p50)}ms (${p50Text})`;
  return {
    state: 'comparable',
    admission,
    sqlite: sqliteWarm,
    lancedb: lanceWarm,
    ratio: { mean: meanRatio, p50: p50Ratio },
    summary
  };
}
