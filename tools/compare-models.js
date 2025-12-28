#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import minimist from 'minimist';
import { resolveAnnSetting, resolveBaseline, resolveCompareModels } from '../src/compare/config.js';
import {
  DEFAULT_MODEL_ID,
  getCacheRoot,
  getDictConfig,
  getModelConfig,
  getRepoId,
  loadUserConfig,
  resolveSqlitePaths
} from './dict-utils.js';

const rawArgs = process.argv.slice(2);
const argv = minimist(rawArgs, {
  boolean: ['json', 'build', 'build-index', 'build-sqlite', 'incremental', 'stub-embeddings', 'ann', 'no-ann'],
  string: ['models', 'baseline', 'queries', 'backend', 'out', 'mode', 'cache-root'],
  alias: { n: 'top', q: 'queries' },
  default: { top: 5, limit: 0 }
});

const root = process.cwd();
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userConfig = loadUserConfig(root);
const configCacheRoot = typeof userConfig.cache?.root === 'string' && userConfig.cache.root.trim()
  ? path.resolve(userConfig.cache.root)
  : null;
const cacheRootBase = argv['cache-root']
  ? path.resolve(argv['cache-root'])
  : (process.env.PAIROFCLEATS_CACHE_ROOT
    ? path.resolve(process.env.PAIROFCLEATS_CACHE_ROOT)
    : getCacheRoot());
const repoId = getRepoId(root);
const modelConfig = getModelConfig(root, userConfig);
const dictConfig = getDictConfig(root, userConfig);
const sharedModelsDir = process.env.PAIROFCLEATS_MODELS_DIR || modelConfig.dir;
const sharedDictDir = process.env.PAIROFCLEATS_DICT_DIR || dictConfig.dir;

const configCompareModels = Array.isArray(userConfig.models?.compare)
  ? userConfig.models.compare
  : [];

const models = resolveCompareModels({
  argvModels: argv.models,
  configCompareModels,
  defaultModel: modelConfig.id || DEFAULT_MODEL_ID
});

if (!models.length) {
  console.error('No models specified. Use --models or configure models.compare.');
  process.exit(1);
}

let baseline;
try {
  baseline = resolveBaseline(models, argv.baseline);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const backendInput = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : 'memory';
const backend = backendInput === 'fts' ? 'sqlite-fts' : backendInput;
const sqliteBackend = backend.startsWith('sqlite');
const buildIndex = argv.build || argv['build-index'];
const buildSqlite = argv['build-sqlite'] === true;
const buildIncremental = argv.incremental === true;
const stubEmbeddings = argv['stub-embeddings'] === true;

const modeArg = argv.mode ? String(argv.mode).toLowerCase() : null;
if (modeArg && !['code', 'prose', 'both'].includes(modeArg)) {
  console.error('Invalid mode. Use --mode code|prose|both');
  process.exit(1);
}
const compareCode = modeArg !== 'prose';
const compareProse = modeArg !== 'code';

const { annEnabled } = resolveAnnSetting({ rawArgs, argv, userConfig });
const annArg = annEnabled ? '--ann' : '--no-ann';

if (sqliteBackend && models.length > 1 && !buildSqlite) {
  console.error('SQLite backend with multiple models requires --build-sqlite to rebuild per model.');
  process.exit(1);
}

if (!buildIndex && models.length > 1 && configCacheRoot) {
  console.error('cache.root is set; use --build to rebuild per model or clear cache.root to isolate caches.');
  process.exit(1);
}

/**
 * Create a stable slug for a model id.
 * @param {string} modelId
 * @returns {string}
 */
function modelSlug(modelId) {
  const safe = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const hash = crypto.createHash('sha1').update(modelId).digest('hex').slice(0, 8);
  return `${safe || 'model'}-${hash}`;
}

/**
 * Resolve the cache root for a specific model comparison run.
 * @param {string} modelId
 * @returns {string}
 */
function getModelCacheRoot(modelId) {
  if (configCacheRoot) return configCacheRoot;
  return path.join(cacheRootBase, 'model-compare', modelSlug(modelId));
}

/**
 * Build environment overrides for a model run.
 * @param {string} modelId
 * @param {string} modelCacheRoot
 * @returns {object}
 */
function buildEnv(modelId, modelCacheRoot) {
  const env = {
    ...process.env,
    PAIROFCLEATS_MODEL: modelId
  };
  if (modelCacheRoot) env.PAIROFCLEATS_CACHE_ROOT = modelCacheRoot;
  if (sharedModelsDir) env.PAIROFCLEATS_MODELS_DIR = sharedModelsDir;
  if (sharedDictDir) env.PAIROFCLEATS_DICT_DIR = sharedDictDir;
  if (stubEmbeddings) env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  return env;
}

/**
 * Check if an index exists for a mode.
 * @param {string} modelCacheRoot
 * @param {'code'|'prose'} mode
 * @returns {boolean}
 */
function indexExists(modelCacheRoot, mode) {
  const metaPath = path.join(modelCacheRoot, 'repos', repoId, `index-${mode}`, 'chunk_meta.json');
  return fs.existsSync(metaPath);
}

/**
 * Ensure indexes exist for required modes.
 * @param {string} modelCacheRoot
 * @returns {boolean}
 */
function ensureIndex(modelCacheRoot) {
  const needsCode = modeArg !== 'prose';
  const needsProse = modeArg !== 'code';
  if (needsCode && !indexExists(modelCacheRoot, 'code')) return false;
  if (needsProse && !indexExists(modelCacheRoot, 'prose')) return false;
  return true;
}

/**
 * Run a Node command and exit on failure.
 * @param {string[]} args
 * @param {object} env
 * @param {string} label
 */
function runCommand(args, env, label) {
  const stdio = argv.json ? ['ignore', process.stderr, process.stderr] : 'inherit';
  const result = spawnSync(process.execPath, args, { env, stdio });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

/**
 * Run a search query for a model env.
 * @param {string} query
 * @param {object} env
 * @returns {{payload:object,wallMs:number}}
 */
function runSearch(query, env) {
  const args = [
    path.join(scriptRoot, 'search.js'),
    query,
    '--json',
    '--stats',
    '--backend',
    backend,
    '-n',
    String(topN),
    annArg
  ];
  if (modeArg && modeArg !== 'both') {
    args.push('--mode', modeArg);
  }
  const start = Date.now();
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  const wallMs = Date.now() - start;
  if (result.status !== 0) {
    console.error(`Search failed for query="${query}" (model=${env.PAIROFCLEATS_MODEL})`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  const payload = JSON.parse(result.stdout || '{}');
  return { payload, wallMs };
}

/**
 * Load queries from a text or JSON file.
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function loadQueries(filePath) {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      if (Array.isArray(parsed.queries)) return parsed.queries.map(String).filter(Boolean);
      return [];
    }
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

const defaultQueryCandidates = [
  path.join(root, 'tests', 'parity-queries.txt'),
  path.join(root, 'queries.txt'),
  path.join(scriptRoot, 'tests', 'parity-queries.txt')
];
const defaultQueriesPath = defaultQueryCandidates.find((candidate) => fs.existsSync(candidate)) || defaultQueryCandidates[0];
const queriesPath = argv.queries ? path.resolve(argv.queries) : defaultQueriesPath;
const queries = await loadQueries(queriesPath);
if (!queries.length) {
  console.error(`No queries found at ${queriesPath}`);
  process.exit(1);
}

const topN = Math.max(1, parseInt(argv.top, 10) || 5);
const limit = Math.max(0, parseInt(argv.limit, 10) || 0);
const selectedQueries = limit > 0 ? queries.slice(0, limit) : queries;

if (sqliteBackend && buildSqlite) {
  const sqlitePaths = resolveSqlitePaths(root, userConfig);
  if (!buildIndex && !fs.existsSync(sqlitePaths.codePath) && !fs.existsSync(sqlitePaths.prosePath)) {
    console.error('SQLite index missing. Use --build or build the indexes first.');
    process.exit(1);
  }
}

const results = selectedQueries.map((query) => ({ query, runs: {}, comparisons: {} }));
const warnings = [];

for (const modelId of models) {
  const modelCacheRoot = getModelCacheRoot(modelId);
  const env = buildEnv(modelId, modelCacheRoot);
  if (configCacheRoot && argv['cache-root']) {
    warnings.push('cache.root overrides --cache-root; model caches are shared.');
  }

  if (buildIndex) {
    const args = [path.join(scriptRoot, 'build_index.js')];
    if (buildIncremental) args.push('--incremental');
    if (stubEmbeddings) args.push('--stub-embeddings');
    runCommand(args, env, `build index (${modelId})`);
  } else if (!ensureIndex(modelCacheRoot)) {
    console.error(`Index missing for model ${modelId}. Run with --build or build the index first.`);
    process.exit(1);
  }

  if (buildSqlite) {
    const args = [path.join(scriptRoot, 'tools', 'build-sqlite-index.js')];
    if (buildIncremental) args.push('--incremental');
    runCommand(args, env, `build sqlite (${modelId})`);
  } else if (sqliteBackend) {
    const sqlitePaths = resolveSqlitePaths(root, userConfig);
    if (!fs.existsSync(sqlitePaths.codePath) && !fs.existsSync(sqlitePaths.prosePath)) {
      console.error('SQLite index missing. Run with --build-sqlite or build it first.');
      process.exit(1);
    }
  }

  for (let i = 0; i < selectedQueries.length; i++) {
    const query = selectedQueries[i];
    const { payload, wallMs } = runSearch(query, env);
    const codeHits = Array.isArray(payload.code) ? payload.code : [];
    const proseHits = Array.isArray(payload.prose) ? payload.prose : [];
    results[i].runs[modelId] = {
      elapsedMs: payload.stats?.elapsedMs || 0,
      wallMs,
      codeCount: codeHits.length,
      proseCount: proseHits.length,
      codeHits,
      proseHits
    };
  }
}

/**
 * Build a stable key for a search hit.
 * @param {object} hit
 * @param {number} index
 * @returns {string}
 */
function hitKey(hit, index) {
  if (hit && (hit.id || hit.id === 0)) return String(hit.id);
  if (hit && hit.file) {
    const start = hit.startLine ?? hit.start ?? 0;
    const end = hit.endLine ?? hit.end ?? 0;
    return `${hit.file}:${start}:${end}:${hit.kind || ''}:${hit.name || ''}`;
  }
  return String(index);
}

/**
 * Compare top-N hit lists and compute overlap metrics.
 * @param {Array<object>} baseHits
 * @param {Array<object>} otherHits
 * @returns {{overlap:number,avgDelta:number,rankCorr:(number|null),top1Same:boolean}}
 */
function compareHits(baseHits, otherHits) {
  const base = baseHits.slice(0, topN);
  const other = otherHits.slice(0, topN);
  const baseKeys = base.map(hitKey);
  const otherKeys = other.map(hitKey);
  const baseRanks = new Map(baseKeys.map((key, idx) => [key, idx + 1]));
  const otherRanks = new Map(otherKeys.map((key, idx) => [key, idx + 1]));
  const baseSet = new Set(baseKeys);
  const otherSet = new Set(otherKeys);
  const intersection = baseKeys.filter((key) => otherSet.has(key));
  const overlap = intersection.length / Math.max(1, Math.min(baseKeys.length, otherKeys.length));

  const baseScores = new Map(base.map((hit, idx) => [hitKey(hit, idx), hit.annScore || 0]));
  const otherScores = new Map(other.map((hit, idx) => [hitKey(hit, idx), hit.annScore || 0]));
  const deltas = intersection.map((key) => Math.abs((baseScores.get(key) || 0) - (otherScores.get(key) || 0)));
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;

  let rankCorr = null;
  if (intersection.length >= 2) {
    let sum = 0;
    for (const key of intersection) {
      const d = (baseRanks.get(key) || 0) - (otherRanks.get(key) || 0);
      sum += d * d;
    }
    const n = intersection.length;
    rankCorr = 1 - (6 * sum) / (n * (n * n - 1));
  }

  const top1Same = baseKeys[0] && otherKeys[0] ? baseKeys[0] === otherKeys[0] : false;
  return { overlap, avgDelta, rankCorr, top1Same };
}

/**
 * Compute mean of numeric values.
 * @param {number[]} values
 * @returns {number}
 */
function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Compute mean of numeric values; return null if none.
 * @param {number[]} values
 * @returns {number|null}
 */
function meanNullable(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

for (const entry of results) {
  for (const modelId of models) {
    if (modelId === baseline) continue;
    const baseRun = entry.runs[baseline];
    const otherRun = entry.runs[modelId];
    if (!baseRun || !otherRun) continue;
    entry.comparisons[modelId] = {
      code: compareCode ? compareHits(baseRun.codeHits || [], otherRun.codeHits || []) : null,
      prose: compareProse ? compareHits(baseRun.proseHits || [], otherRun.proseHits || []) : null
    };
  }
}

const summaryByModel = {};
for (const modelId of models) {
  const elapsed = results.map((entry) => entry.runs[modelId]?.elapsedMs || 0);
  const wall = results.map((entry) => entry.runs[modelId]?.wallMs || 0);
  const codeCounts = results.map((entry) => entry.runs[modelId]?.codeCount || 0);
  const proseCounts = results.map((entry) => entry.runs[modelId]?.proseCount || 0);
  summaryByModel[modelId] = {
    elapsedMsAvg: mean(elapsed),
    wallMsAvg: mean(wall),
    codeCountAvg: mean(codeCounts),
    proseCountAvg: mean(proseCounts)
  };
}

const comparisonSummary = {};
for (const modelId of models) {
  if (modelId === baseline) continue;
  const codeComparisons = results
    .map((entry) => entry.comparisons[modelId]?.code)
    .filter(Boolean);
  const proseComparisons = results
    .map((entry) => entry.comparisons[modelId]?.prose)
    .filter(Boolean);
  comparisonSummary[modelId] = {
    code: compareCode ? {
      overlapAvg: mean(codeComparisons.map((entry) => entry.overlap)),
      scoreDeltaAvg: mean(codeComparisons.map((entry) => entry.avgDelta)),
      rankCorrAvg: meanNullable(codeComparisons.map((entry) => entry.rankCorr)),
      top1MatchRate: mean(codeComparisons.map((entry) => (entry.top1Same ? 1 : 0)))
    } : null,
    prose: compareProse ? {
      overlapAvg: mean(proseComparisons.map((entry) => entry.overlap)),
      scoreDeltaAvg: mean(proseComparisons.map((entry) => entry.avgDelta)),
      rankCorrAvg: meanNullable(proseComparisons.map((entry) => entry.rankCorr)),
      top1MatchRate: mean(proseComparisons.map((entry) => (entry.top1Same ? 1 : 0)))
    } : null
  };
}

const outputResults = results.map((entry) => {
  const runs = {};
  for (const modelId of models) {
    const run = entry.runs[modelId] || {};
    runs[modelId] = {
      elapsedMs: run.elapsedMs || 0,
      wallMs: run.wallMs || 0,
      codeCount: run.codeCount || 0,
      proseCount: run.proseCount || 0
    };
  }
  return {
    query: entry.query,
    runs,
    comparisons: entry.comparisons
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  repo: {
    root: path.resolve(root),
    repoId
  },
  settings: {
    backend,
    topN,
    annEnabled,
    mode: modeArg || 'both',
    models,
    baseline,
    cacheRootBase: configCacheRoot || cacheRootBase,
    cacheIsolation: !configCacheRoot
  },
  summary: {
    models: summaryByModel,
    comparisons: comparisonSummary
  },
  warnings: Array.from(new Set(warnings)),
  results: outputResults
};

if (argv.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log('Model comparison summary');
  console.log(`- Backend: ${backend}`);
  console.log(`- Queries: ${selectedQueries.length}`);
  console.log(`- TopN: ${topN}`);
  console.log(`- Ann: ${annEnabled}`);
  console.log(`- Baseline: ${baseline}`);
  for (const modelId of models) {
    const stats = summaryByModel[modelId];
    console.log(`- ${modelId}: avg ${stats.elapsedMsAvg.toFixed(1)} ms (wall ${stats.wallMsAvg.toFixed(1)} ms)`);
  }
  for (const modelId of models) {
    if (modelId === baseline) continue;
    const cmp = comparisonSummary[modelId];
    const codeLabel = cmp.code ? `code overlap ${cmp.code.overlapAvg.toFixed(3)}` : 'code n/a';
    const proseLabel = cmp.prose ? `prose overlap ${cmp.prose.overlapAvg.toFixed(3)}` : 'prose n/a';
    console.log(`- ${modelId} vs ${baseline}: ${codeLabel}, ${proseLabel}`);
  }
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
  await fsPromises.writeFile(outPath, JSON.stringify(output, null, 2));
  if (!argv.json) {
    console.log(`Report written to ${outPath}`);
  }
}
