import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { getIndexDir, resolveRepoRoot, resolveToolRoot } from '../../shared/dict-utils.js';
import { parseCommaList } from '../../shared/text-utils.js';
import { formatMs, formatStats, writeJsonWithDir } from './utils.js';
import { runIndexBuildBenchmark } from './index-build.js';
import { runSearchBenchmark } from './search.js';

const toolRoot = resolveToolRoot();
const defaultRepo = path.resolve(toolRoot, 'tests', 'fixtures', 'sample');

const rawArgs = process.argv.slice(2);
const argv = createCli({
  options: {
    repo: {
      type: 'string',
      describe: 'Repo root to benchmark',
      default: defaultRepo
    },
    'repo-current': {
      type: 'boolean',
      describe: 'Use current working repo root instead of the fixture default',
      default: false
    },
    mode: {
      type: 'string',
      describe: 'Index/search mode (code|prose)',
      default: 'code'
    },
    query: {
      type: 'string',
      describe: 'Search query for microbench runs',
      default: 'function'
    },
    backend: {
      type: 'string',
      describe: 'Search backend (memory|sqlite|sqlite-fts)',
      default: 'memory'
    },
    'ann-backends': {
      type: 'string',
      describe: 'Comma-separated ANN backends for ann-backends component (sqlite-vector,lancedb,hnsw,js)',
      default: 'sqlite-vector,lancedb'
    },
    runs: {
      type: 'number',
      describe: 'Warm run count per component',
      default: 5
    },
    warmup: {
      type: 'number',
      describe: 'Warmup runs discarded before measuring warm stats',
      default: 1
    },
    threads: {
      type: 'number',
      describe: 'Index build worker threads',
      default: 0
    },
    build: {
      type: 'boolean',
      describe: 'Build indexes before search benchmarks',
      default: true
    },
    clean: {
      type: 'boolean',
      describe: 'Clean repo cache before cold index build',
      default: true
    },
    sqlite: {
      type: 'boolean',
      describe: 'Enable SQLite builds during index benchmark',
      default: false
    },
    'stub-embeddings': {
      type: 'boolean',
      describe: 'Use stub embeddings for index build',
      default: true
    },
    components: {
      type: 'string',
      describe: 'Comma-separated component list: index-build,sparse,dense,hybrid,ann-backends',
      default: 'index-build,sparse,dense,hybrid'
    },
    json: {
      type: 'boolean',
      describe: 'Emit JSON output only',
      default: false
    },
    out: {
      type: 'string',
      describe: 'Write JSON results to a file'
    }
  }
}).parse();

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

const results = {
  repoRoot,
  mode,
  query: argv.query,
  backend: argv.backend,
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

if (components.includes('sparse')) {
  log('\n[search-sparse]');
  const bench = await runSearchBenchmark({
    repoRoot,
    query: argv.query,
    mode,
    backend: argv.backend,
    ann: false,
    scoreMode: 'sparse',
    warmRuns,
    warmupRuns,
    indexCache,
    sqliteCache
  });
  results.components['search-sparse'] = bench;
  if (!argv.json) {
    log(`cold: ${formatMs(bench.coldMs)}`);
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
    warmRuns,
    warmupRuns,
    indexCache,
    sqliteCache
  });
  results.components['search-dense'] = bench;
  if (!argv.json) {
    log(`cold: ${formatMs(bench.coldMs)}`);
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
      warmRuns,
      warmupRuns,
      indexCache,
      sqliteCache
    });
    backendResults[annBackend] = bench;
    if (!argv.json) {
      log(`cold: ${formatMs(bench.coldMs)}`);
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
    warmRuns,
    warmupRuns,
    indexCache,
    sqliteCache
  });
  results.components['search-hybrid'] = bench;
  if (!argv.json) {
    log(`cold: ${formatMs(bench.coldMs)}`);
    log(`warm: ${formatStats(bench.warm)}`);
  }
}

results.cache = {
  sqliteEntries: sqliteCache.size()
};

if (argv.out) {
  const outPath = path.resolve(argv.out);
  writeJsonWithDir(outPath, results);
  log(`\nSaved results to ${outPath}`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
}

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

function hasChunkMeta(indexDir) {
  const json = path.join(indexDir, 'chunk_meta.json');
  const jsonl = path.join(indexDir, 'chunk_meta.jsonl');
  const meta = path.join(indexDir, 'chunk_meta.meta.json');
  return fs.existsSync(json) || fs.existsSync(jsonl) || fs.existsSync(meta);
}

function parseComponents(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function buildAnnBackendComparison(backends) {
  if (!backends || typeof backends !== 'object') return null;
  const sqlite = backends['sqlite-vector'] || backends.sqlite || null;
  const lancedb = backends.lancedb || null;
  if (!sqlite || !lancedb) return null;
  const pickStat = (entry) => entry?.warm || null;
  const sqliteWarm = pickStat(sqlite);
  const lanceWarm = pickStat(lancedb);
  if (!sqliteWarm || !lanceWarm) return null;
  const toFixed = (value) => (Number.isFinite(value) ? value.toFixed(1) : 'n/a');
  const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);
  const meanRatio = ratio(sqliteWarm.mean, lanceWarm.mean);
  const p50Ratio = ratio(sqliteWarm.p50, lanceWarm.p50);
  const meanText = meanRatio ? `${meanRatio.toFixed(2)}x` : 'n/a';
  const p50Text = p50Ratio ? `${p50Ratio.toFixed(2)}x` : 'n/a';
  const summary = `Comparison (sqlite-vector vs lancedb): mean ${toFixed(sqliteWarm.mean)}ms vs ${toFixed(lanceWarm.mean)}ms (${meanText}) | p50 ${toFixed(sqliteWarm.p50)}ms vs ${toFixed(lanceWarm.p50)}ms (${p50Text})`;
  return {
    sqlite: sqliteWarm,
    lancedb: lanceWarm,
    ratio: { mean: meanRatio, p50: p50Ratio },
    summary
  };
}
