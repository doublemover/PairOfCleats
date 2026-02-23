#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { Bench } from 'tinybench';
import { build as buildHistogram } from 'hdr-histogram-js';
import { buildIndex, search } from '../../../src/integrations/core/index.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { hasChunkMetaArtifactsSync } from '../../../src/shared/index-artifact-helpers.js';
import { getIndexDir, resolveRepoRootArg, resolveToolRoot } from '../../shared/dict-utils.js';
import { formatMs, writeJsonWithDir } from './utils.js';

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
  .option('backend', {
    type: 'string',
    describe: 'Search backend (memory|sqlite|sqlite-fts)',
    default: 'memory'
  })
  .option('query', {
    type: 'string',
    describe: 'Query used for search benchmarks',
    default: 'function'
  })
  .option('iterations', {
    type: 'number',
    describe: 'Iterations per task',
    default: 64
  })
  .option('warmup-iterations', {
    type: 'number',
    describe: 'Warmup iterations per task',
    default: 8
  })
  .option('time', {
    type: 'number',
    describe: 'Target runtime per task in ms',
    default: 1000
  })
  .option('warmup-time', {
    type: 'number',
    describe: 'Warmup time per task in ms',
    default: 250
  })
  .option('components', {
    type: 'string',
    describe: 'Comma-separated components (search-sparse,search-ann,search-dense,search-hybrid)',
    default: 'search-sparse,search-ann'
  })
  .option('build', {
    type: 'boolean',
    describe: 'Build indexes before running the bench',
    default: true
  })
  .option('stub-embeddings', {
    type: 'boolean',
    describe: 'Use stub embeddings when building indexes',
    default: true
  })
  .option('baseline', {
    type: 'string',
    describe: 'Baseline file for comparisons'
  })
  .option('write-baseline', {
    type: 'boolean',
    describe: 'Write results to the baseline file',
    default: false
  })
  .option('compare', {
    type: 'boolean',
    describe: 'Compare results against the baseline file',
    default: true
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

const repoRoot = resolveRepoRootArg(argv.repo);
const mode = argv.mode === 'prose' ? 'prose' : 'code';
const backend = String(argv.backend || 'memory').toLowerCase();
const components = parseComponents(argv.components);
const baselinePath = path.resolve(
  argv.baseline || path.join(toolRoot, 'benchmarks', 'baselines', 'microbench.json')
);

await maybeBuildIndexes();

const bench = new Bench({
  name: 'pairofcleats-microbench',
  iterations: Math.max(1, Math.floor(argv.iterations)),
  warmupIterations: Math.max(0, Math.floor(argv['warmup-iterations'])),
  time: Math.max(0, Math.floor(argv.time)),
  warmupTime: Math.max(0, Math.floor(argv['warmup-time'])),
  throws: true,
  retainSamples: true
});

const indexCache = new Map();
const sqliteCache = createSqliteDbCache();
const scoreModes = new Set();
for (const component of components) {
  const normalized = component.toLowerCase();
  if (normalized === 'search-sparse') {
    scoreModes.add('sparse');
    bench.add('search-sparse', () => runSearch('sparse'));
  } else if (normalized === 'search-ann' || normalized === 'search-dense') {
    scoreModes.add('dense');
    bench.add(normalized, () => runSearch('dense'));
  } else if (normalized === 'search-hybrid') {
    scoreModes.add('hybrid');
    bench.add('search-hybrid', () => runSearch('hybrid'));
  }
}

if (!bench.tasks.length) {
  console.error('[tinybench] No tasks defined. Check --components.');
  process.exit(1);
}

for (const modeToCheck of scoreModes) {
  await validateScoreMode(modeToCheck);
}

if (indexCache?.clear) indexCache.clear();
if (sqliteCache?.closeAll) sqliteCache.closeAll();

await bench.run();

const results = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  mode,
  backend,
  cache: {
    sqliteEntries: sqliteCache.size()
  },
  bench: {
    iterations: bench.iterations,
    warmupIterations: bench.warmupIterations,
    timeMs: bench.time,
    warmupTimeMs: bench.warmupTime
  },
  env: buildEnvSnapshot(),
  components: summarizeBenchTasks(bench.tasks)
};

const comparison = argv.compare ? compareBaseline(results, baselinePath) : null;
if (comparison) {
  results.baseline = comparison;
}

if (argv['write-baseline']) {
  writeJsonWithDir(baselinePath, results);
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  printSummary(results, comparison);
}

async function runSearch(scoreMode) {
  const ann = scoreMode !== 'sparse';
  await search(repoRoot, {
    query: argv.query,
    mode,
    backend,
    ann,
    scoreMode,
    json: true,
    jsonCompact: true,
    emitOutput: false,
    indexCache,
    sqliteCache
  });
}

async function validateScoreMode(scoreMode) {
  const ann = scoreMode !== 'sparse';
  const payload = await search(repoRoot, {
    query: argv.query,
    mode,
    backend,
    ann,
    scoreMode,
    explain: true,
    json: true,
    jsonCompact: true,
    emitOutput: false,
    indexCache,
    sqliteCache
  });
  const hits = mode === 'prose' ? payload.prose || [] : payload.code || [];
  const first = hits[0];
  if (!first) {
    throw new Error(`tinybench sanity failed: no hits for scoreMode=${scoreMode}`);
  }
  if (scoreMode === 'sparse') {
    if (first.scoreType === 'blend' || first.scoreType === 'ann') {
      throw new Error(`tinybench sanity failed: expected sparse scoring, saw ${first.scoreType}`);
    }
    return;
  }
  if (first.scoreType !== 'blend') {
    throw new Error(`tinybench sanity failed: expected blend scoring, saw ${first.scoreType}`);
  }
  const blend = first.scoreBreakdown?.blend;
  if (!blend) {
    throw new Error('tinybench sanity failed: missing blend breakdown');
  }
  if (scoreMode === 'dense') {
    if (blend.sparseWeight !== 0 || blend.annWeight <= 0) {
      throw new Error('tinybench sanity failed: dense weights not applied');
    }
  } else if (scoreMode === 'hybrid') {
    if (blend.sparseWeight === 0 || blend.annWeight === 0) {
      throw new Error('tinybench sanity failed: hybrid weights not applied');
    }
  }
}

async function maybeBuildIndexes() {
  if (!argv.build) return;
  const indexDir = getIndexDir(repoRoot, mode);
  const metaExists = hasChunkMeta(indexDir);
  if (metaExists) return;
  await buildIndex(repoRoot, {
    mode,
    incremental: true,
    sqlite: backend !== 'memory',
    stubEmbeddings: argv['stub-embeddings'] !== false
  });
}

function hasChunkMeta(indexDir) {
  if (!indexDir) return false;
  return hasChunkMetaArtifactsSync(indexDir);
}

function parseComponents(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildEnvSnapshot() {
  const cpu = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpu[0]?.model || 'unknown',
    cpuCount: cpu.length
  };
}

function summarizeBenchTasks(tasks) {
  const entries = {};
  for (const task of tasks) {
    entries[task.name] = summarizeTask(task);
  }
  return entries;
}

function summarizeTask(task) {
  const latency = task.result?.latency || {};
  const samples = Array.isArray(latency.samples) ? latency.samples : [];
  const percentiles = summarizeSamples(samples);
  return {
    samples: latency.samplesCount || samples.length || 0,
    meanMs: latency.mean || 0,
    minMs: latency.min || 0,
    maxMs: latency.max || 0,
    p50Ms: percentiles.p50,
    p95Ms: percentiles.p95,
    p99Ms: percentiles.p99,
    totalTimeMs: task.result?.totalTime || 0
  };
}

function summarizeSamples(samples) {
  if (!samples.length) return { p50: 0, p95: 0, p99: 0 };
  const scaled = samples.map((value) => Math.max(1, Math.round(value * 1000)));
  const maxValue = Math.max(...scaled, 1);
  const histogram = buildHistogram({
    lowestDiscernibleValue: 1,
    highestTrackableValue: maxValue,
    numberOfSignificantValueDigits: 3
  });
  scaled.forEach((value) => histogram.recordValue(value));
  return {
    p50: histogram.getValueAtPercentile(50) / 1000,
    p95: histogram.getValueAtPercentile(95) / 1000,
    p99: histogram.getValueAtPercentile(99) / 1000
  };
}

function compareBaseline(current, baselineFile) {
  if (!fs.existsSync(baselineFile)) return null;
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  } catch {
    return null;
  }
  if (!baseline?.components) return null;
  const deltas = {};
  for (const [name, stats] of Object.entries(current.components || {})) {
    const base = baseline.components?.[name];
    if (!base) continue;
    deltas[name] = {
      meanPct: deltaPct(stats.meanMs, base.meanMs),
      p50Pct: deltaPct(stats.p50Ms, base.p50Ms),
      p95Pct: deltaPct(stats.p95Ms, base.p95Ms),
      p99Pct: deltaPct(stats.p99Ms, base.p99Ms)
    };
  }
  return {
    path: baselineFile,
    deltas
  };
}

function deltaPct(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function printSummary(results, comparison) {
  console.error('[tinybench] Results');
  for (const [name, stats] of Object.entries(results.components || {})) {
    console.error(`- ${name}: mean ${formatMs(stats.meanMs)} | p50 ${formatMs(stats.p50Ms)} | p95 ${formatMs(stats.p95Ms)} | p99 ${formatMs(stats.p99Ms)} | n=${stats.samples}`);
    if (comparison?.deltas?.[name]) {
      const delta = comparison.deltas[name];
      console.error(`  delta: mean ${formatDelta(delta.meanPct)} | p50 ${formatDelta(delta.p50Pct)} | p95 ${formatDelta(delta.p95Pct)} | p99 ${formatDelta(delta.p99Pct)}`);
    }
  }
  if (argv['write-baseline']) {
    console.error(`- baseline saved: ${baselinePath}`);
  } else if (comparison?.path) {
    console.error(`- baseline: ${comparison.path}`);
  }
}

