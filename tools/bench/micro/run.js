import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, resolveRepoRoot, resolveToolRoot } from '../../dict-utils.js';
import { formatMs, formatStats } from './utils.js';
import { runIndexBuildBenchmark } from './index-build.js';
import { runSearchBenchmark } from './search.js';

const toolRoot = resolveToolRoot();
const defaultRepo = path.resolve(toolRoot, 'tests', 'fixtures', 'sample');

const argv = yargs(hideBin(process.argv))
  .option('repo', {
    type: 'string',
    describe: 'Repo root to benchmark',
    default: defaultRepo
  })
  .option('mode', {
    type: 'string',
    describe: 'Index/search mode (code|prose)',
    default: 'code'
  })
  .option('query', {
    type: 'string',
    describe: 'Search query for microbench runs',
    default: 'function'
  })
  .option('backend', {
    type: 'string',
    describe: 'Search backend (memory|sqlite|sqlite-fts)',
    default: 'memory'
  })
  .option('runs', {
    type: 'number',
    describe: 'Warm run count per component',
    default: 5
  })
  .option('warmup', {
    type: 'number',
    describe: 'Warmup runs discarded before measuring warm stats',
    default: 1
  })
  .option('threads', {
    type: 'number',
    describe: 'Index build worker threads',
    default: 0
  })
  .option('build', {
    type: 'boolean',
    describe: 'Build indexes before search benchmarks',
    default: true
  })
  .option('clean', {
    type: 'boolean',
    describe: 'Clean repo cache before cold index build',
    default: true
  })
  .option('sqlite', {
    type: 'boolean',
    describe: 'Enable SQLite builds during index benchmark',
    default: false
  })
  .option('stub-embeddings', {
    type: 'boolean',
    describe: 'Use stub embeddings for index build',
    default: true
  })
  .option('components', {
    type: 'string',
    describe: 'Comma-separated component list: index-build,sparse,dense,hybrid',
    default: 'index-build,sparse,dense,hybrid'
  })
  .option('json', {
    type: 'boolean',
    describe: 'Emit JSON output only',
    default: false
  })
  .option('out', {
    type: 'string',
    describe: 'Write JSON results to a file'
  })
  .help()
  .argv;

const repoRoot = path.resolve(argv.repo || resolveRepoRoot(process.cwd()));
const warmRuns = Math.max(0, Math.floor(argv.runs));
const warmupRuns = Math.max(0, Math.floor(argv.warmup));
const threads = Number(argv.threads) > 0 ? Math.floor(argv.threads) : undefined;
const mode = argv.mode === 'prose' ? 'prose' : 'code';
const components = parseComponents(argv.components);

const results = {
  repoRoot,
  mode,
  query: argv.query,
  backend: argv.backend,
  components: {}
};

const log = argv.json ? () => {} : console.log;

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
const sqliteCache = null;

if (components.includes('sparse')) {
  log('\n[search-sparse]');
  const bench = await runSearchBenchmark({
    repoRoot,
    query: argv.query,
    mode,
    backend: argv.backend,
    ann: false,
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

if (components.includes('hybrid')) {
  log('\n[search-hybrid]');
  const bench = await runSearchBenchmark({
    repoRoot,
    query: argv.query,
    mode,
    backend: argv.backend,
    ann: true,
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

if (argv.out) {
  const outPath = path.resolve(argv.out);
  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
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
