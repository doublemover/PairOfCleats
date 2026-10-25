#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { resolveEmbeddingInputFormatting } from '../../src/shared/embedding-input-format.js';
import { normalizeEmbeddingProvider, resolveOnnxConfig, resolveOnnxModelPath } from '../../src/shared/onnx-embeddings.js';
import { normalizeLegacyCacheRootPath, resolveVersionedCacheRoot } from '../../src/shared/cache-roots.js';
import { hasChunkMetaArtifactsSync } from '../../src/shared/artifact-io/chunk-meta-presence.js';
import { resolveCurrentBuildRoots } from '../../src/shared/indexing/build-pointer.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { COMPARE_MODELS_OPTIONS } from '../../src/shared/cli-options.js';
import { resolveAnnSetting, resolveBaseline, resolveCompareModels, resolveCompareModelCacheRoot } from '../../src/experimental/compare/config.js';
import { summarizeRetrievalHitComparison } from '../../src/retrieval/hit-comparison.js';
import { resolveRetrievalCorpusIdentity } from '../../src/retrieval/corpus-comparison.js';
import { readQueryInputPlan, resolveTopNAndLimit } from '../shared/query-file-utils.js';
import { meanNullable } from '../../src/shared/stats.js';
import { readJsonFileSyncSafe } from '../../src/shared/file-read.js';
import { runSearchCliWithSubprocessSync } from '../shared/search-cli-harness.js';
import { admitComparisonResponse } from '../shared/retrieval-result-admission.js';
import { createRetrievalEvidenceRegistry } from '../shared/retrieval-execution-evidence.js';
import { emitJson, exitLikeCommandResult, runSubprocessOrExit } from '../shared/cli-utils.js';
import {
  DEFAULT_MODEL_ID,
  bootstrapRuntime,
  getCacheRoot,
  getDictConfig,
  getModelConfig,
  getRepoId,
  resolveSqlitePaths,
  resolveToolRoot
} from '../shared/dict-utils.js';

const rawArgs = process.argv.slice(2);
const argv = createCli({
  scriptName: 'compare-models',
  options: COMPARE_MODELS_OPTIONS,
  aliases: { n: 'top', q: 'queries' }
}).parse();

const { repoRoot: root, userConfig, runtimeEnv: baseEnv } = bootstrapRuntime(argv.repo);
const scriptRoot = resolveToolRoot();
const defaultQueryCandidates = [
  path.join(root, 'tests', 'retrieval', 'parity', 'parity-queries.txt'),
  path.join(root, 'queries.txt'),
  path.join(scriptRoot, 'tests', 'retrieval', 'parity', 'parity-queries.txt')
];
const defaultQueriesPath = defaultQueryCandidates.find((candidate) => fs.existsSync(candidate)) || defaultQueryCandidates[0];
const queriesPath = argv.queries != null ? path.resolve(argv.queries) : defaultQueriesPath;
const { topN, limit } = resolveTopNAndLimit({ top: argv.top, limit: argv.limit, defaultTop: 5, defaultLimit: 0 });
let queryPlan;
try { queryPlan = await readQueryInputPlan(queriesPath, { limit, explicit: argv.queries != null }); }
catch (error) { console.error(`[${error.code || 'ERR_QUERY_INPUT'}] ${error.message}`); process.exit(1); }
const selectedQueries = queryPlan.cases.map(entry => entry.query);

const envConfig = getEnvConfig();
const embeddingsConfig = userConfig.indexing?.embeddings || {};
const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
const embeddingOnnx = resolveOnnxConfig(embeddingsConfig.onnx || {});
const configCacheRoot = typeof userConfig.cache?.root === 'string' && userConfig.cache.root.trim()
  ? path.resolve(userConfig.cache.root)
  : null;
const cacheRootBaseInput = argv['cache-root'] || envConfig.cacheRoot || getCacheRoot();
const cacheRootBase = normalizeLegacyCacheRootPath(cacheRootBaseInput) || path.resolve(cacheRootBaseInput);
const repoId = getRepoId(root);
const modelConfig = getModelConfig(root, userConfig);
const dictConfig = getDictConfig(root, userConfig);
const sharedModelsDir = envConfig.modelsDir || modelConfig.dir;
const sharedDictDir = envConfig.dictDir || dictConfig.dir;

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

const knownModels = new Set(models);
const resolveModelLabel = (env) => {
  const candidate = typeof env?.PAIROFCLEATS_MODEL === 'string' ? env.PAIROFCLEATS_MODEL.trim() : '';
  if (candidate && knownModels.has(candidate)) return candidate;
  return 'unknown';
};

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

if (!buildIndex && models.length > 1 && configCacheRoot) {
  console.error('cache.root is set; use --build to rebuild per model or clear cache.root to isolate caches.');
  process.exit(1);
}

/**
 * Resolve the cache root for a specific model comparison run.
 * @param {string} modelId
 * @returns {string}
 */
function getModelCacheRoot(modelId) {
  return resolveCompareModelCacheRoot({ modelId, cacheRootBase, configCacheRoot });
}

/**
 * Build environment overrides for a model run.
 * @param {string} modelId
 * @param {string} modelCacheRoot
 * @returns {object}
 */
function buildEnv(modelId, modelCacheRoot) {
  const env = {
    ...baseEnv,
    PAIROFCLEATS_MODEL: modelId
  };
  if (modelCacheRoot) env.PAIROFCLEATS_CACHE_ROOT = modelCacheRoot;
  if (sharedModelsDir) env.PAIROFCLEATS_MODELS_DIR = sharedModelsDir;
  if (sharedDictDir) env.PAIROFCLEATS_DICT_DIR = sharedDictDir;
  if (stubEmbeddings) env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  return env;
}

/**
 * Resolve the active build root for a model/mode from current.json metadata.
 * Falls back to repo cache root when build metadata is unavailable.
 * @param {string} modelCacheRoot
 * @param {'code'|'prose'} mode
 * @returns {string}
 */
function resolveModelIndexRoot(modelCacheRoot, mode) {
  const resolvedCacheRoot = resolveVersionedCacheRoot(modelCacheRoot);
  const repoCacheRoot = path.join(resolvedCacheRoot, 'repos', repoId);
  let indexRoot = repoCacheRoot;
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  const data = readJsonFileSyncSafe(currentPath, null);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const buildsRoot = path.join(repoCacheRoot, 'builds');
    const { buildRoot, buildRoots } = resolveCurrentBuildRoots(data, {
      repoCacheRoot,
      buildsRoot,
      preferredMode: mode
    });
    const modeRoot = buildRoots[mode] || null;
    if (modeRoot && fs.existsSync(modeRoot)) {
      indexRoot = modeRoot;
    } else if (buildRoot && fs.existsSync(buildRoot)) {
      indexRoot = buildRoot;
    }
  }
  return indexRoot;
}

/**
 * Check if an index exists for a mode.
 * @param {string} modelCacheRoot
 * @param {'code'|'prose'} mode
 * @returns {boolean}
 */
function indexExists(modelCacheRoot, mode) {
  const indexRoot = resolveModelIndexRoot(modelCacheRoot, mode);
  const modeRoot = path.join(indexRoot, `index-${mode}`);
  return hasChunkMetaArtifactsSync(modeRoot);
}

/**
 * Check whether sqlite artifacts exist for required compare mode(s).
 * @param {string} modelCacheRoot
 * @returns {boolean}
 */
function ensureSqliteIndex(modelCacheRoot) {
  const sqlitePathForMode = (mode) => {
    const indexRoot = resolveModelIndexRoot(modelCacheRoot, mode);
    const filename = mode === 'code' ? 'index-code.db' : 'index-prose.db';
    return path.join(indexRoot, 'index-sqlite', filename);
  };
  const needsCode = modeArg !== 'prose';
  const needsProse = modeArg !== 'code';
  if (needsCode && !fs.existsSync(sqlitePathForMode('code'))) return false;
  if (needsProse && !fs.existsSync(sqlitePathForMode('prose'))) return false;
  return true;
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
  const stdio = argv.json ? ['ignore', 'ignore', 'inherit'] : 'inherit';
  runSubprocessOrExit({
    command: process.execPath,
    args,
    label,
    env,
    stdio
  });
}

/**
 * Run a search query for a model env.
 * @param {string} query
 * @param {object} env
 * @returns {{payload:object,wallMs:number}}
 */
function runSearch(query, env) {
  try {
    return runSearchCliWithSubprocessSync({
      query,
      searchPath: path.join(scriptRoot, 'search.js'),
      stats: true,
      backend,
      topN,
      annArg,
      repo: root,
      mode: modeArg && modeArg !== 'both' ? modeArg : null,
      env,
      now: Date.now,
      maxOutputBytes: 64 * 1024 * 1024,
      jsonFallback: '{}'
    });
  } catch (err) {
    if (err?.code !== 'ERR_SEARCH_CLI_EXIT') throw err;
    console.error(`Search failed for query="${query}" (model=${resolveModelLabel(env)})`);
    if (err.stderr) console.error(String(err.stderr).trim());
    exitLikeCommandResult({ status: err?.exitCode ?? null, signal: err?.signal ?? null });
  }
}

if (sqliteBackend && buildSqlite) {
  if (!buildIndex && !ensureIndex(getModelCacheRoot(models[0]))) {
    console.error('Index missing. Use --build or build the index first.');
    process.exit(1);
  }
}

const results = queryPlan.cases.map(({ query, caseId, weight }) => ({ query, caseId, weight, runs: {}, comparisons: {} }));
const warnings = [];
const corpusByModel = new Map();
const executionRegistries = new Map();
const selectedModes = ['code', 'prose'].filter(mode => mode === 'code' ? compareCode : compareProse);

for (const modelId of models) {
  const modelCacheRoot = getModelCacheRoot(modelId);
  const env = buildEnv(modelId, modelCacheRoot);
  if (configCacheRoot && argv['cache-root']) {
    warnings.push('cache.root overrides --cache-root; model caches are shared.');
  }

  if (buildIndex) {
    const args = [path.join(scriptRoot, 'build_index.js'), '--repo', root];
    if (buildIncremental) args.push('--incremental');
    if (stubEmbeddings) args.push('--stub-embeddings');
    runCommand(args, env, `build index (${modelId})`);
  } else if (!ensureIndex(modelCacheRoot)) {
    console.error(`Index missing for model ${modelId}. Run with --build or build the index first.`);
    process.exit(1);
  }

  if (buildSqlite) {
    const args = [path.join(scriptRoot, 'build_index.js'), '--stage', '4', '--repo', root];
    if (buildIncremental) args.push('--incremental');
    runCommand(args, env, `build sqlite (${modelId})`);
  } else if (sqliteBackend) {
    if (!ensureSqliteIndex(modelCacheRoot)) {
      console.error(`SQLite index missing for model ${modelId}. Run with --build-sqlite or build it first.`);
      process.exit(1);
    }
  }

  const corpus = {};
  for (const mode of ['code', 'prose']) {
    if ((mode === 'code' && !compareCode) || (mode === 'prose' && !compareProse)) continue;
    corpus[mode] = await resolveRetrievalCorpusIdentity(path.join(resolveModelIndexRoot(modelCacheRoot, mode), `index-${mode}`), mode);
  }
  corpusByModel.set(modelId, corpus);
  const registry = createRetrievalEvidenceRegistry();
  executionRegistries.set(modelId, registry);
  for (let i = 0; i < selectedQueries.length; i++) {
    const query = selectedQueries[i];
    const { payload, wallMs } = runSearch(query, env);
    const observed = admitComparisonResponse(payload, selectedModes, { registry, expectedBackend: backend });
    const codeHits = observed.cohorts?.code ?? null;
    const proseHits = observed.cohorts?.prose ?? null;
    results[i].runs[modelId] = {
      elapsedMs: Number.isFinite(payload?.stats?.elapsedMs) ? payload.stats.elapsedMs : null,
      admission: observed.admission,
      wallMs,
      codeCount: codeHits?.length ?? null,
      proseCount: proseHits?.length ?? null,
      codeHits,
      proseHits
    };
  }
}

/**
 * Compare top-N hit lists and compute overlap metrics.
 * @param {Array<object>} baseHits
 * @param {Array<object>} otherHits
 * @returns {{overlap:number,avgDelta:number,rankCorr:(number|null),top1Same:boolean}}
 */
function compareHits(baseRun, otherRun, modelId, mode) {
  const baseCorpus = corpusByModel.get(baseline)?.[mode];
  const otherCorpus = corpusByModel.get(modelId)?.[mode];
  if (!baseCorpus?.comparable || !otherCorpus?.comparable || baseCorpus.digest !== otherCorpus.digest) {
    const reason = 'source-or-chunking-corpus-mismatch-or-unverified';
    return { comparable: false, reason, overlap: null, avgDelta: null, rankCorr: null, top1Same: null, baseCorpus, otherCorpus };
  }
  const baseHits = baseRun[mode + 'Hits'], otherHits = otherRun[mode + 'Hits'];
  if (!baseHits || !otherHits) return { comparable: false, reason: 'selected-response-unavailable',
    overlap: null, avgDelta: null, rankCorr: null, top1Same: null, zeroHits: false };
  const comparison = summarizeRetrievalHitComparison(baseHits, otherHits, { topN, mode, repoScope: repoId });
  const comparable = comparison.comparable && baseRun.admission.byMode[mode].qualified && otherRun.admission.byMode[mode].qualified;
  return { ...comparison, comparable, reason: comparable ? null : comparison.comparable
    ? 'observed-execution-unqualified' : 'unknown-hit-identity',
  overlap: comparison.comparable ? comparison.overlap : null, avgDelta: comparison.comparable ? comparison.avgDelta : null,
  rankCorr: comparison.comparable ? comparison.rankCorr : null };

}

for (const entry of results) {
  for (const modelId of models) {
    if (modelId === baseline) continue;
    const baseRun = entry.runs[baseline];
    const otherRun = entry.runs[modelId];
    if (!baseRun || !otherRun) continue;
    entry.comparisons[modelId] = {
      code: compareCode ? compareHits(baseRun, otherRun, modelId, 'code') : null,
      prose: compareProse ? compareHits(baseRun, otherRun, modelId, 'prose') : null
    };
  }
}

const summaryByModel = {};
for (const modelId of models) {
  const elapsed = results.map((entry) => entry.runs[modelId]?.elapsedMs);
  const wall = results.map((entry) => entry.runs[modelId]?.wallMs);
  const codeCounts = results.map((entry) => entry.runs[modelId]?.codeCount);
  const proseCounts = results.map((entry) => entry.runs[modelId]?.proseCount);
  const resolvedOnnxModelPath = embeddingProvider === 'onnx'
    ? resolveOnnxModelPath({
      rootDir: root,
      modelPath: embeddingOnnx.modelPath,
      modelsDir: sharedModelsDir,
      modelId
    })
    : null;
  summaryByModel[modelId] = {
    elapsedMsAvg: meanNullable(elapsed),
    wallMsAvg: meanNullable(wall),
    codeCountAvg: meanNullable(codeCounts),
    proseCountAvg: meanNullable(proseCounts),
    embeddingConfig: {
      provider: embeddingProvider,
      mode: embeddingsConfig.mode || 'auto',
      stub: stubEmbeddings,
      inputFormatting: resolveEmbeddingInputFormatting(modelId),
      onnx: embeddingProvider === 'onnx'
        ? {
          modelPath: embeddingOnnx.modelPath || null,
          tokenizerId: embeddingOnnx.tokenizerId || null,
          executionProviders: embeddingOnnx.executionProviders || null,
          intraOpNumThreads: embeddingOnnx.intraOpNumThreads || null,
          interOpNumThreads: embeddingOnnx.interOpNumThreads || null,
          graphOptimizationLevel: embeddingOnnx.graphOptimizationLevel || null,
          resolvedModelPath: resolvedOnnxModelPath
        }
        : null
    }
  };
}

const comparisonSummary = {};
for (const modelId of models) {
  if (modelId === baseline) continue;
  const codeComparisons = results
    .map((entry) => entry.comparisons[modelId]?.code)
    .filter(entry => entry && entry.comparable !== false);
  const proseComparisons = results
    .map((entry) => entry.comparisons[modelId]?.prose)
    .filter(entry => entry && entry.comparable !== false);
  comparisonSummary[modelId] = {
    code: compareCode ? {
      comparableQueries: codeComparisons.length,
      requestedQueries: results.length, unavailableQueries: results.length - codeComparisons.length,
      zeroHitQueries: codeComparisons.filter(row => row.zeroHits).length,
      positiveHitQueries: codeComparisons.filter(row => !row.zeroHits).length,
      overlapAvg: meanNullable(codeComparisons.map((entry) => entry.overlap)),
      scoreDeltaAvg: meanNullable(codeComparisons.map((entry) => entry.avgDelta)),
      rankCorrAvg: meanNullable(codeComparisons.map((entry) => entry.rankCorr)),
      top1MatchRate: meanNullable(codeComparisons.map((entry) => (entry.top1Same ? 1 : 0)))
    } : null,
    prose: compareProse ? {
      comparableQueries: proseComparisons.length,
      requestedQueries: results.length, unavailableQueries: results.length - proseComparisons.length,
      zeroHitQueries: proseComparisons.filter(row => row.zeroHits).length,
      positiveHitQueries: proseComparisons.filter(row => !row.zeroHits).length,
      overlapAvg: meanNullable(proseComparisons.map((entry) => entry.overlap)),
      scoreDeltaAvg: meanNullable(proseComparisons.map((entry) => entry.avgDelta)),
      rankCorrAvg: meanNullable(proseComparisons.map((entry) => entry.rankCorr)),
      top1MatchRate: meanNullable(proseComparisons.map((entry) => (entry.top1Same ? 1 : 0)))
    } : null
  };
}

const outputResults = results.map((entry) => {
  const runs = {};
  for (const modelId of models) {
    const run = entry.runs[modelId] || {};
    runs[modelId] = {
      elapsedMs: run.elapsedMs ?? null,
      admission: run.admission,
      wallMs: run.wallMs ?? null,
      codeCount: run.codeCount ?? null,
      proseCount: run.proseCount ?? null
    };
  }
  return {
    query: entry.query,
    caseId: entry.caseId,
    weight: entry.weight,
    runs,
    comparisons: entry.comparisons
  };
});

const requestedComparisons = results.flatMap(entry => Object.values(entry.comparisons)
  .flatMap(comparison => selectedModes.map(mode => comparison[mode]).filter(Boolean)));
const qualifiedComparisons = requestedComparisons.filter(comparison => comparison.comparable);
const executionEvidence = Object.fromEntries([...executionRegistries].map(([model, registry]) => [model, registry.snapshot()]));
const output = {
  schemaVersion: 2,
  kind: 'model-retrieval-comparison',
  generatedAt: new Date().toISOString(),
  repo: {
    root: path.resolve(root),
    repoId
  },
  queryPlan,
  executionEvidence,
  qualification: { state: requestedComparisons.length > 0 && qualifiedComparisons.length === requestedComparisons.length
    && qualifiedComparisons.some(comparison => !comparison.zeroHits)
    && Object.values(executionEvidence).every(evidence => evidence.status === 'qualified' && evidence.consistency === 'stable') ? 'qualified' : 'unqualified',
  requestedComparisons: requestedComparisons.length, comparableComparisons: qualifiedComparisons.length,
  unavailableComparisons: requestedComparisons.length - qualifiedComparisons.length,
  zeroHitComparisons: qualifiedComparisons.filter(comparison => comparison.zeroHits).length },
  settings: {
    backend,
    topN,
    annEnabled,
    mode: modeArg || 'both',
    models,
    baseline,
    cacheRootBase: configCacheRoot || cacheRootBase,
    embeddings: {
      provider: embeddingProvider,
      mode: embeddingsConfig.mode || 'auto',
      stub: stubEmbeddings
    },
    cacheIsolation: !configCacheRoot
  },
  summary: {
    models: summaryByModel,
    comparisons: comparisonSummary
  },
  warnings: Array.from(new Set(warnings)),
  results: outputResults
};

const metric = (value, digits) => Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
if (results.some(row => Object.values(row.runs).some(run => run.admission.state === 'unavailable'))) process.exitCode = 1;

if (argv.json) {
  emitJson(output);
} else {
  console.error('Model comparison summary');
  console.error(`- Backend: ${backend}`);
  console.error(`- Queries: ${selectedQueries.length}`);
  console.error(`- TopN: ${topN}`);
  console.error(`- Ann: ${annEnabled}`);
  console.error(`- Baseline: ${baseline}`);
  for (const modelId of models) {
    const stats = summaryByModel[modelId];
    console.error(`- ${modelId}: avg ${metric(stats.elapsedMsAvg, 1)} ms (wall ${metric(stats.wallMsAvg, 1)} ms)`);
  }
  for (const modelId of models) {
    if (modelId === baseline) continue;
    const cmp = comparisonSummary[modelId];
    const codeLabel = cmp.code ? `code overlap ${metric(cmp.code.overlapAvg, 3)}` : 'code n/a';
    const proseLabel = cmp.prose ? `prose overlap ${metric(cmp.prose.overlapAvg, 3)}` : 'prose n/a';
    console.error(`- ${modelId} vs ${baseline}: ${codeLabel}, ${proseLabel}`);
  }
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  await writeJsonFileResolved(outPath, output);
  if (!argv.json) {
    console.error(`Report written to ${outPath}`);
  }
}
