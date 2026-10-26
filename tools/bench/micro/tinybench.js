#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import os from 'node:os';
import path from 'node:path';
import { INTERNAL_QUERY_CACHE_BYPASS } from '../../../src/retrieval/query-cache-experiment.js';
import { captureMicroQuerySchedule, createSearchMicroCollector, SEARCH_MICRO_REPORT_VERSION } from './search-observation.js';
import { compareSearchMicroBaseline } from './baseline.js';
import { readQueryInputPlan } from '../../shared/query-file-utils.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';
import { captureSweepSource } from '../ab-sweep-source.js';
import { withMicrobenchCacheOwner } from './cache-owner.js';
const { default: yargs } = await import('yargs/yargs');
const { hideBin } = await import('yargs/helpers');
const { Bench } = await import('tinybench');
const { build: buildHistogram } = await import('hdr-histogram-js');
const { buildIndex, search } = await import('../../../src/integrations/core/index.js');
const { createSqliteDbCache } = await import('../../../src/retrieval/sqlite-cache.js');
const { hasChunkMetaArtifactsSync } = await import('../../../src/shared/artifact-io/chunk-meta-presence.js');
const { getIndexDir, resolveRepoRootArg, resolveToolRoot } = await import('../../shared/dict-utils.js');
const { formatMs, writeJsonWithDir } = await import('./utils.js');

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
  .option('work-mode', { type: 'string', choices: ['retrieval', 'result-cache'], default: 'retrieval' })
  .option('quality', { type: 'string', choices: ['auto', 'fast', 'balanced', 'max'] })
  .option('queries', { type: 'string', describe: 'Frozen ordered query file' })
  .option('comparison-axis', { type: 'string', choices: ['none', 'backend'], default: 'none' })
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

const queryPlan = argv.queries ? await readQueryInputPlan(path.resolve(argv.queries), { explicit: true,
  readFile: async file => (await readVerifiedContainedFile(path.dirname(file), file, { maxBytes: 4 * 1024 * 1024 })).buffer }) : null;
const querySchedule = captureMicroQuerySchedule(argv.query, queryPlan?.cases.map(entry => entry.query));
const codeProvenance = captureSweepSource(toolRoot);

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
const observations = new Map();
for (const component of components) {
  const normalized = component.toLowerCase();
  const scoreMode = normalized === 'search-sparse' ? 'sparse'
    : ['search-ann', 'search-dense'].includes(normalized) ? 'dense' : normalized === 'search-hybrid' ? 'hybrid' : null;
  if (!scoreMode) continue;
  scoreModes.add(scoreMode);
  const collector = createSearchMicroCollector({ mode, scoreMode, workMode: argv['work-mode'], requestedBackend: backend });
  observations.set(normalized, { collector, scoreMode });
  let phase = 'unmeasured', cursor = 0;
  bench.add(normalized, async () => {
    const queryIndex = cursor++ % querySchedule.count;
    const start = bench.now();
    const payload = await runSearch(scoreMode, querySchedule.queries[queryIndex]);
    const durationMs = bench.now() - start;
    collector.observe(payload, { phase, queryIndex, durationMs });
    return { overriddenDuration: durationMs };
  }, { async: true, beforeAll: runMode => { phase = runMode === 'warmup' ? 'warmup' : 'measured'; cursor = 0; } });
}

if (!bench.tasks.length) {
  console.error('[tinybench] No tasks defined. Check --components.');
  process.exit(1);
}

const measured = await withMicrobenchCacheOwner(sqliteCache, async () => {
  for (const modeToCheck of scoreModes) {
    await validateScoreMode(modeToCheck);
  }

  if (indexCache?.clear) indexCache.clear();
  if (sqliteCache?.closeAll) sqliteCache.closeAll();

  await bench.run();

  return { sqliteEntries: sqliteCache.size(), components: summarizeBenchTasks(bench.tasks) };
});

const results = {
  schemaVersion: SEARCH_MICRO_REPORT_VERSION,
  kind: 'search-microbenchmark',
  querySchedule,
  queryPlan,
  workMode: argv['work-mode'],
  codeProvenance,
  coldness: { process: 'not-reset', indexHandles: 'cleared-before-task-loop', model: 'not-reset',
    resultCache: argv['work-mode'] === 'retrieval' ? 'bypassed-without-quality-change' : 'observed-existing-cache-state', filesystem: 'uncontrolled' },
  generatedAt: new Date().toISOString(),
  repoRoot,
  mode,
  backend,
  cache: {
    sqliteEntries: measured.sqliteEntries
  },
  bench: {
    iterations: bench.iterations,
    warmupIterations: bench.warmupIterations,
    timeMs: bench.time,
    warmupTimeMs: bench.warmupTime
  },
  env: buildEnvSnapshot(),
  components: measured.components
};

const comparison = argv.compare ? await compareBaseline(results, baselinePath) : null;
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

async function runSearch(scoreMode, query) {
  const ann = scoreMode !== 'sparse';
  return await search(repoRoot, {
    query,
    args: ['--stats', ...(argv.quality ? ['--quality', argv.quality] : [])], [INTERNAL_QUERY_CACHE_BYPASS]: argv['work-mode'] === 'retrieval',
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
    query: querySchedule.queries[0],
    args: ['--stats', ...(argv.quality ? ['--quality', argv.quality] : [])], [INTERNAL_QUERY_CACHE_BYPASS]: argv['work-mode'] === 'retrieval',
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

/**
 * Build sparse artifacts when required before tinybench search tasks run.
 *
 * @returns {Promise<void>}
 */
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

/**
 * Coarse chunk-meta presence check used for tinybench setup gating.
 *
 * @param {string|null|undefined} indexDir
 * @returns {boolean}
 */
function hasChunkMeta(indexDir) {
  if (!indexDir) return false;
  return hasChunkMetaArtifactsSync(indexDir);
}

/**
 * Parse benchmark component names from a comma-delimited flag value.
 *
 * @param {string} value
 * @returns {string[]}
 */
function parseComponents(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Capture host/runtime metadata for reproducibility.
 *
 * @returns {{node:string,platform:string,arch:string,cpuModel:string,cpuCount:number}}
 */
function buildEnvSnapshot() {
  const cpu = os.cpus();
  return {
    node: process.version,
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpu[0]?.model || 'unknown',
    cpuCount: cpu.length
  };
}

/**
 * Convert Tinybench task results into a stable report object.
 *
 * @param {Array<any>} tasks
 * @returns {Record<string, any>}
 */
function summarizeBenchTasks(tasks) {
  const entries = {};
  for (const task of tasks) {
    const observation = observations.get(task.name);
    entries[task.name] = { ...summarizeTask(task), scoreMode: observation.scoreMode, requestedBackend: backend,
      work: observation.collector.snapshot() };
  }
  return entries;
}

/**
 * Normalize a Tinybench task into percentile and latency metrics.
 *
 * @param {any} task
 * @returns {object}
 */
function summarizeTask(task) {
  const latency = task.result?.latency || {};
  const samples = Array.isArray(latency.samples) ? latency.samples : [];
  const percentiles = summarizeSamples(samples);
  return {
    samples: latency.samplesCount || samples.length || 0,
    meanMs: typeof latency.mean === 'number' && Number.isFinite(latency.mean) ? latency.mean : null,
    minMs: typeof latency.min === 'number' && Number.isFinite(latency.min) ? latency.min : null,
    maxMs: typeof latency.max === 'number' && Number.isFinite(latency.max) ? latency.max : null,
    p50Ms: percentiles.p50,
    p95Ms: percentiles.p95,
    p99Ms: percentiles.p99,
    rawSamplesMs: samples.slice(0, 10000),
    omittedRawSamples: Math.max(0, samples.length - 10000),
    totalTimeMs: typeof task.result?.totalTime === 'number' && Number.isFinite(task.result.totalTime) ? task.result.totalTime : null
  };
}

/**
 * Compute p50/p95/p99 from raw latency samples via HDR histogram.
 *
 * @param {number[]} samples
 * @returns {{p50:number,p95:number,p99:number}}
 */
function summarizeSamples(samples) {
  if (!samples.length) return { p50: null, p95: null, p99: null };
  const scaled = samples.map((value) => Math.max(1, Math.round(value * 1000)));
  const maxValue = scaled.reduce((maximum, value) => Math.max(maximum, value), 1);
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

/**
 * Compare current run metrics against a persisted baseline report.
 *
 * @param {object} current
 * @param {string} baselineFile
 * @returns {{path:string,deltas:Record<string,any>}|null}
 */
async function compareBaseline(current, baselineFile) {
  let baseline;
  try {
    const source = await readVerifiedContainedFile(path.dirname(baselineFile), baselineFile, { maxBytes: 32 * 1024 * 1024 });
    baseline = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.buffer));
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'microbench-baseline-read' });
    return { path: baselineFile, state: 'incomparable', differences: [{ axis: 'baseline',
      reason: diagnostic.code === 'ENOENT' ? 'baseline-missing' : 'baseline-unreadable-or-malformed' }], deltas: {} };
  }
  return { path: baselineFile, ...compareSearchMicroBaseline(current, baseline,
    { variedAxis: argv['comparison-axis'] === 'none' ? null : argv['comparison-axis'] }) };
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function printSummary(results, comparison) {
  console.error(`[tinybench] Results (${results.workMode}; filesystem cache uncontrolled)`);
  if (comparison?.state === 'incomparable') console.error(`[tinybench] Baseline incomparable: ${comparison.differences.map(row => row.reason).join(', ')}`);
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

