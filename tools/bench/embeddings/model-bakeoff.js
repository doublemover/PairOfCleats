#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createCli } from '../../../src/shared/cli.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { resolveEmbeddingInputFormatting } from '../../../src/shared/embedding-input-format.js';
import { hasChunkMetaArtifactsSync } from '../../../src/shared/index-artifact-helpers.js';
import { spawnSubprocess, spawnSubprocessSync } from '../../../src/shared/subprocess.js';
import { isPathWithinRoot } from '../../shared/path-within-root.js';
import {
  resolveBakeoffFastPathDefaults,
  resolveBakeoffBuildPlan,
  resolveBakeoffScriptPaths,
  resolveBakeoffStage4Modes
} from './model-bakeoff-lib.js';
import {
  getCacheRoot,
  getDictConfig,
  getModelConfig,
  getRepoId,
  getRuntimeConfig,
  resolveRepoConfig,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../../shared/dict-utils.js';

const DEFAULT_BAKEOFF_MODELS = ['Xenova/bge-small-en-v1.5', 'Xenova/bge-base-en-v1.5'];
const DEFAULT_BAKEOFF_BASELINE = 'Xenova/bge-base-en-v1.5';

const rawArgs = process.argv.slice(2);
const normalizeWrappedCliValue = (value) => String(value || '')
  .replace(/\r?\n\s*/g, '')
  .trim();
const argv = createCli({
  scriptName: 'bench-embedding-models',
  usage: [
    'Usage: $0 [options]',
    '',
    'Quick defaults: $0',
    'Full run: $0 --full-run --models <list> --dataset <path>'
  ].join('\n'),
  options: {
    models: { type: 'string' },
    baseline: { type: 'string' },
    repo: { type: 'string' },
    dataset: { type: 'string' },
    queries: { type: 'string' },
    backend: { type: 'string', default: 'sqlite' },
    mode: { type: 'string', default: 'both' },
    top: { type: 'number', default: 10 },
    limit: { type: 'number', default: 20, describe: 'Query cap (quick default=20, full-run default=0).' },
    'heap-mb': { type: 'number', default: 8192 },
    'embedding-sample-files': {
      type: 'number',
      default: 50,
      describe: 'Per-mode sampled files (quick default=50, full-run default=0).'
    },
    'embedding-sample-seed': {
      type: 'string',
      default: 'quick-smoke',
      describe: 'Deterministic sampling seed (quick default=quick-smoke).'
    },
    'full-run': {
      type: 'boolean',
      default: false,
      describe: 'Disable quick defaults (sampling/resume/skip-compare/limit) unless explicitly overridden.'
    },
    build: { type: 'boolean', default: true },
    incremental: { type: 'boolean', default: true },
    'build-sqlite': { type: 'boolean' },
    'skip-eval': { type: 'boolean', default: false },
    'skip-compare': {
      type: 'boolean',
      default: true,
      describe: 'Skip compare-models pass (quick default=true, full-run default=false).'
    },
    ann: { type: 'boolean' },
    'no-ann': { type: 'boolean' },
    'stub-embeddings': { type: 'boolean', default: false },
    resume: {
      type: 'boolean',
      default: true,
      describe: 'Reuse completed model checkpoints (quick default=true, full-run default=false).'
    },
    checkpoint: { type: 'string' },
    'cache-root': { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: true },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  }
}).parse();
const positionalArgs = Array.isArray(argv._)
  ? argv._.map((entry) => normalizeWrappedCliValue(entry)).filter(Boolean)
  : [];
const positionalModelsArg = positionalArgs[0] || '';
const positionalDatasetArg = positionalArgs[1] || '';

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const toolRoot = resolveToolRoot();
const envConfig = getEnvConfig();
const runtimeConfig = getRuntimeConfig(root, userConfig);
const baseEnv = resolveRuntimeEnv(runtimeConfig, process.env);
const modelConfig = getModelConfig(root, userConfig);
const dictConfig = getDictConfig(root, userConfig);
const sharedModelsDir = envConfig.modelsDir || modelConfig.dir;
const sharedDictDir = envConfig.dictDir || dictConfig.dir;
const repoId = getRepoId(root);

const parseModelList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const configCompareModels = Array.isArray(userConfig.models?.compare)
  ? userConfig.models.compare.map((entry) => String(entry).trim()).filter(Boolean)
  : [];
const configCacheRoot = typeof userConfig.cache?.root === 'string' && userConfig.cache.root.trim()
  ? path.resolve(userConfig.cache.root)
  : null;
const models = (() => {
  if (argv.models) return parseModelList(argv.models);
  if (positionalModelsArg) return parseModelList(positionalModelsArg);
  return configCompareModels.length
    ? configCompareModels
    : DEFAULT_BAKEOFF_MODELS;
})();
if (!models.length) {
  console.error('No models specified. Use --models or configure models.compare.');
  process.exit(1);
}

const baseline = (() => {
  if (!argv.baseline) {
    return models.includes(DEFAULT_BAKEOFF_BASELINE)
      ? DEFAULT_BAKEOFF_BASELINE
      : models[0];
  }
  const selected = String(argv.baseline).trim();
  if (!selected) {
    return models.includes(DEFAULT_BAKEOFF_BASELINE)
      ? DEFAULT_BAKEOFF_BASELINE
      : models[0];
  }
  if (!models.includes(selected)) {
    console.error(`Baseline "${selected}" is not in --models.`);
    process.exit(1);
  }
  return selected;
})();

const backend = String(argv.backend || 'sqlite').trim().toLowerCase();
const sqliteBackend = backend.startsWith('sqlite');
const mode = String(argv.mode || 'both').trim().toLowerCase();
if (!['code', 'prose', 'both'].includes(mode)) {
  console.error('Invalid --mode. Use code|prose|both.');
  process.exit(1);
}
const topN = Math.max(1, Math.floor(Number(argv.top) || 10));
const heapMb = Math.max(0, Math.floor(Number(argv['heap-mb']) || 0));
const fullRun = argv['full-run'] === true;
const fastPathDefaults = resolveBakeoffFastPathDefaults({
  rawArgs,
  fullRun,
  limit: Number(argv.limit),
  embeddingSampleFiles: Number(argv['embedding-sample-files']),
  embeddingSampleSeed: String(argv['embedding-sample-seed'] || ''),
  skipCompare: argv['skip-compare'] === true,
  resume: argv.resume !== false
});
const limit = fastPathDefaults.limit;
const embeddingSampleFiles = fastPathDefaults.embeddingSampleFiles;
const embeddingSampleSeed = fastPathDefaults.embeddingSampleSeed;
const runEval = argv['skip-eval'] !== true;
const runCompare = fastPathDefaults.skipCompare !== true;
const buildIndex = argv.build === true;
const { buildSqlite, runStage4OnlyBuild } = resolveBakeoffBuildPlan({
  rawArgs,
  buildIndex,
  buildSqlite: argv['build-sqlite'] === true
});
const incremental = argv.incremental === true;
const useStubEmbeddings = argv['stub-embeddings'] === true;
const allowResume = fastPathDefaults.resume === true;
const annOverride = argv['no-ann'] === true
  ? false
  : (argv.ann === true ? true : null);

const cacheRootBase = argv['cache-root']
  ? path.resolve(argv['cache-root'])
  : (envConfig.cacheRoot
    ? path.resolve(envConfig.cacheRoot)
    : getCacheRoot());
const checkpointOutPath = argv.checkpoint
  ? path.resolve(argv.checkpoint)
  : (argv.out
    ? path.resolve(argv.out)
    : path.join(root, '.testLogs', 'embedding-bakeoff.latest.json'));

/**
 * Build a deterministic slug so each model gets an isolated cache root.
 * @param {string} modelId
 * @returns {string}
 */
const modelSlug = (modelId) => {
  const safe = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const hash = crypto.createHash('sha1').update(modelId).digest('hex').slice(0, 8);
  return `${safe || 'model'}-${hash}`;
};

const modelCacheRoot = (modelId) => (
  path.join(cacheRootBase, 'model-compare', modelSlug(modelId))
);

const toFixedMs = (value) => Math.round(Number(value) || 0);

const streamChildOutputToStderr = argv.json === true;
const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isIndexLockContentionMessage = (value) => (
  /index lock (held|unavailable)/i.test(String(value || ''))
);
const runNode = async (args, env, label) => {
  const result = await spawnSubprocess(process.execPath, args, {
    cwd: root,
    env,
    stdio: streamChildOutputToStderr ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    captureStdout: false,
    captureStderr: true,
    maxOutputBytes: 32 * 1024,
    outputMode: 'string',
    onStdout: streamChildOutputToStderr
      ? (chunk) => process.stderr.write(chunk)
      : null,
    onStderr: streamChildOutputToStderr
      ? (chunk) => process.stderr.write(chunk)
      : null,
    rejectOnNonZeroExit: false
  });
  if (result.exitCode !== 0 || result.signal) {
    const stderr = String(result.stderr || '').trim();
    const suffix = stderr ? `\n${stderr}` : '';
    const reason = result.signal
      ? `signal=${result.signal}`
      : `exit=${result.exitCode ?? 'unknown'}`;
    throw new Error(`${label} failed (${reason})${suffix}`);
  }
  return result;
};

/**
 * Run a node subprocess and retry only on index-lock contention failures.
 *
 * Retry delay scales linearly as `baseDelayMs * attempt`. Non-lock failures
 * bypass retry and are rethrown immediately.
 *
 * @param {string[]} args
 * @param {Record<string, string|undefined>} env
 * @param {string} label
 * @param {{maxAttempts?:number,baseDelayMs?:number}} [options]
 * @returns {Promise<{exitCode:number|null,signal:string|null,stdout?:string,stderr?:string}>}
 */
const runNodeWithLockRetry = async (
  args,
  env,
  label,
  { maxAttempts = 5, baseDelayMs = 5000 } = {}
) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runNode(args, env, label);
    } catch (err) {
      const message = err?.message || String(err);
      const retryable = isIndexLockContentionMessage(message);
      if (!retryable || attempt >= maxAttempts) throw err;
      const delayMs = baseDelayMs * attempt;
      display.warn(
        `[bakeoff] ${label}: index lock contention, retrying (${attempt}/${maxAttempts}) in ${delayMs}ms`,
        { kind: 'status', stage: 'bakeoff' }
      );
      await waitMs(delayMs);
    }
  }
  throw new Error(`${label} failed after retries.`);
};

const runJsonNode = (args, env, label) => {
  const result = spawnSubprocessSync(process.execPath, args, {
    cwd: root,
    maxOutputBytes: 64 * 1024 * 1024,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    captureStdout: true,
    captureStderr: true,
    outputMode: 'string',
    rejectOnNonZeroExit: false
  });
  if (result.exitCode !== 0 || result.signal) {
    const stderr = String(result.stderr || '').trim();
    const suffix = stderr ? `\n${stderr}` : '';
    const reason = result.signal
      ? `signal=${result.signal}`
      : `exit=${result.exitCode ?? 'unknown'}`;
    throw new Error(`${label} failed (${reason})${suffix}`);
  }
  const stdout = String(result.stdout || '{}').trim() || '{}';
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`${label} returned invalid JSON: ${err?.message || err}`);
  }
};

/**
 * Build an isolated per-model process environment for bakeoff runs.
 *
 * Each model gets a dedicated cache root while optionally sharing model/dictionary
 * directories to avoid redownloading artifacts across runs.
 *
 * @param {string} modelId
 * @returns {Record<string, string|undefined>}
 */
const toModelEnv = (modelId) => {
  const env = {
    ...baseEnv,
    PAIROFCLEATS_MODEL: modelId,
    PAIROFCLEATS_CACHE_ROOT: modelCacheRoot(modelId)
  };
  if (sharedModelsDir) env.PAIROFCLEATS_MODELS_DIR = sharedModelsDir;
  if (sharedDictDir) env.PAIROFCLEATS_DICT_DIR = sharedDictDir;
  if (useStubEmbeddings) env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  if (heapMb > 0) env.PAIROFCLEATS_MAX_OLD_SPACE_MB = String(heapMb);
  if (embeddingSampleFiles > 0) {
    env.PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES = String(embeddingSampleFiles);
    env.PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED = embeddingSampleSeed;
  }
  return env;
};

const directorySizeBytes = async (dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  const pending = [dirPath];
  let total = 0;
  while (pending.length) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = await fsPromises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fsPromises.stat(full);
          total += stat.size;
        } catch {}
      }
    }
  }
  return total;
};

const formatBytesGiB = (bytes) => Number((bytes / (1024 * 1024 * 1024)).toFixed(4));

/**
 * Expand CLI mode selection into sparse index modes required for stage3.
 *
 * @param {'code'|'prose'|'both'} resolvedMode
 * @returns {string[]}
 */
const resolveRequiredBuildModes = (resolvedMode) => (
  resolvedMode === 'code'
    ? ['code']
    : (resolvedMode === 'prose' ? ['prose', 'extracted-prose'] : ['code', 'prose', 'extracted-prose', 'records'])
);

/**
 * Resolve current build root for a model cache, constrained to repo cache.
 *
 * @param {string} modelCacheRootPath
 * @returns {string|null}
 */
const resolveModelCurrentBuildRoot = (modelCacheRootPath) => {
  const versionedRoot = resolveVersionedCacheRoot(modelCacheRootPath);
  const repoCacheRoot = path.join(versionedRoot, 'repos', repoId);
  const repoCacheCanonical = toRealPathSync(repoCacheRoot);
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  if (!fs.existsSync(currentPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(currentPath, 'utf8')) || {};
    const resolveWithinRepoCache = (value) => {
      if (!value || typeof value !== 'string') return null;
      const resolved = path.isAbsolute(value) ? value : path.join(repoCacheRoot, value);
      const normalized = path.resolve(resolved);
      const normalizedRepo = path.resolve(repoCacheRoot);
      if (!isPathWithinRoot(normalized, normalizedRepo)) return null;
      return normalized;
    };
    const buildRootFromState = resolveWithinRepoCache(parsed.buildRoot);
    if (buildRootFromState && fs.existsSync(buildRootFromState)) return buildRootFromState;
    if (typeof parsed.buildId === 'string' && parsed.buildId.trim()) {
      const buildIdRoot = path.join(repoCacheRoot, 'builds', parsed.buildId.trim());
      if (fs.existsSync(buildIdRoot)) return buildIdRoot;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Decide whether a mode already has readable sparse artifacts so stage3-only
 * resume can be used safely.
 *
 * @param {string|null} buildRoot
 * @param {string} buildMode
 * @returns {boolean}
 */
const modeArtifactsExist = (buildRoot, buildMode) => {
  if (!buildRoot) return false;
  const modeRoot = path.join(buildRoot, `index-${buildMode}`);
  return hasChunkMetaArtifactsSync(modeRoot);
};

/**
 * Decide whether existing sparse artifacts allow stage3-only reuse.
 *
 * @param {string} modelCacheRootPath
 * @param {'code'|'prose'|'both'} resolvedMode
 * @returns {boolean}
 */
const canReuseSparseArtifactsForStage3 = (modelCacheRootPath, resolvedMode) => {
  const buildRoot = resolveModelCurrentBuildRoot(modelCacheRootPath);
  if (!buildRoot) return false;
  const requiredModes = resolveRequiredBuildModes(resolvedMode);
  return requiredModes.every((buildMode) => modeArtifactsExist(buildRoot, buildMode));
};

/**
 * Resolve build strategy for a model run.
 *
 * @param {{modelCacheRootPath:string,shouldBuildIndex:boolean,resolvedMode:'code'|'prose'|'both'}} input
 * @returns {'skip'|'stage3'|'full'}
 */
const resolveBuildStrategy = ({ modelCacheRootPath, shouldBuildIndex, resolvedMode }) => {
  if (!shouldBuildIndex) return 'skip';
  return canReuseSparseArtifactsForStage3(modelCacheRootPath, resolvedMode)
    ? 'stage3'
    : 'full';
};

/**
 * Check stage4 sqlite artifact presence for all required modes.
 *
 * @param {string} modelCacheRootPath
 * @param {'code'|'prose'|'both'} resolvedMode
 * @returns {boolean}
 */
const sqliteArtifactsExist = (modelCacheRootPath, resolvedMode) => {
  const buildRoot = resolveModelCurrentBuildRoot(modelCacheRootPath);
  if (!buildRoot) return false;
  const sqliteRoot = path.join(buildRoot, 'index-sqlite');
  const requiredModes = resolveBakeoffStage4Modes(resolvedMode);
  return requiredModes.every((buildMode) => (
    fs.existsSync(path.join(sqliteRoot, `index-${buildMode}.db`))
  ));
};

/**
 * Run stage4 in isolated per-mode subprocesses so one mode cannot poison the
 * rest of the run when long-lived V8/native state gets unstable.
 *
 * @param {{modelId:string,env:NodeJS.ProcessEnv,resolvedMode:string}} input
 * @returns {number}
 */
const runIsolatedStage4 = async ({ modelId, env, resolvedMode }) => {
  const stage4Modes = resolveBakeoffStage4Modes(resolvedMode);
  const startedAt = Date.now();
  for (const stageMode of stage4Modes) {
    const args = [buildIndexScript, '--stage', '4', '--repo', root, '--mode', stageMode];
    if (incremental) args.push('--incremental');
    await runNodeWithLockRetry(args, env, `build sqlite (${modelId}:${stageMode})`);
  }
  return Date.now() - startedAt;
};

const { buildIndexScript, evalScript, compareScript } = resolveBakeoffScriptPaths({
  repoRoot: root,
  toolRoot
});
const datasetPath = argv.dataset
  ? path.resolve(normalizeWrappedCliValue(argv.dataset))
  : (positionalDatasetArg
    ? path.resolve(positionalDatasetArg)
    : path.join(root, 'tests', 'fixtures', 'eval', 'triplecleat-bakeoff.json'));
const queriesPath = argv.queries ? path.resolve(argv.queries) : null;

const assertScriptExists = (scriptPath, label) => {
  if (fs.existsSync(scriptPath)) return;
  throw new Error(`${label} script not found: ${scriptPath}`);
};
assertScriptExists(buildIndexScript, 'build_index');
if (runEval) assertScriptExists(evalScript, 'eval');
if (runCompare) assertScriptExists(compareScript, 'compare-models');

if (runEval && !datasetPath) {
  console.error('Missing --dataset for evaluation. Use --skip-eval to disable quality scoring.');
  process.exit(1);
}
if (runCompare && models.length > 1 && configCacheRoot && !buildIndex) {
  console.error('cache.root is configured; multi-model compare requires --build to isolate model artifacts.');
  process.exit(1);
}

const outputSettings = {
  models,
  baseline,
  backend,
  mode,
  topN,
  limit,
  runProfile: fastPathDefaults.profile,
  heapMb,
  embeddingSampleFiles,
  embeddingSampleSeed,
  ann: annOverride,
  buildIndex,
  buildSqlite,
  incremental,
  stubEmbeddings: useStubEmbeddings,
  runEval,
  runCompare,
  datasetPath,
  queriesPath,
  cacheRootBase
};
const settingsSignature = JSON.stringify(outputSettings);
const modelsTask = display.task('Models', {
  taskId: 'bakeoff:models',
  total: models.length,
  stage: 'bakeoff'
});
let activeModelId = null;
let activePhase = null;
let activePhaseStartedAt = null;
let completedModelsProgress = 0;

/**
 * Build the current output payload.
 * @param {{
 *  modelReports:object[],
 *  compareReport:object|null,
 *  status:'running'|'completed'|'failed',
 *  error?:object|null,
 *  resumedModels?:number,
 *  currentModel?:string|null,
 *  currentPhase?:string|null,
 *  phaseStartedAt?:string|null
 * }} options
 * @returns {object}
 */
const buildOutputPayload = ({
  modelReports,
  compareReport,
  status,
  error = null,
  resumedModels = 0,
  currentModel = null,
  currentPhase = null,
  phaseStartedAt = null
}) => ({
  generatedAt: new Date().toISOString(),
  repo: {
    root,
    repoId
  },
  progress: {
    status,
    totalModels: models.length,
    completedModels: modelReports.length,
    resumedModels,
    currentModel,
    currentPhase,
    phaseStartedAt
  },
  error: error || null,
  settings: outputSettings,
  models: modelReports,
  compare: compareReport
    ? {
      summary: compareReport.summary || null,
      warnings: compareReport.warnings || [],
      settings: compareReport.settings || null
    }
    : null
});

/**
 * Persist a checkpoint/final bakeoff payload.
 * @param {{
 *  modelReports:object[],
 *  compareReport:object|null,
 *  status:'running'|'completed'|'failed',
 *  error?:object|null,
 *  resumedModels?:number,
 *  currentModel?:string|null,
 *  currentPhase?:string|null,
 *  phaseStartedAt?:string|null
 * }} options
 * @returns {Promise<object>}
 */
const writeOutputPayload = async ({
  modelReports,
  compareReport,
  status,
  error = null,
  resumedModels = 0,
  currentModel = null,
  currentPhase = null,
  phaseStartedAt = null
}) => {
  const payload = buildOutputPayload({
    modelReports,
    compareReport,
    status,
    error,
    resumedModels,
    currentModel,
    currentPhase,
    phaseStartedAt
  });
  await fsPromises.mkdir(path.dirname(checkpointOutPath), { recursive: true });
  await fsPromises.writeFile(checkpointOutPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
};

const isModelReportComplete = (entry) => {
  if (!entry || typeof entry.modelId !== 'string') return false;
  if (runEval && !entry.eval) return false;
  return true;
};

/**
 * Load checkpointed model reports that can be safely resumed for this invocation.
 *
 * Resume is accepted only when saved settings exactly match current settings and
 * each reused model report is complete for the current mode (including eval data
 * when eval is enabled).
 *
 * @returns {Promise<object[]>}
 */
const loadResumedModelReports = async () => {
  if (!allowResume) return [];
  if (!fs.existsSync(checkpointOutPath)) return [];
  try {
    const parsed = JSON.parse(await fsPromises.readFile(checkpointOutPath, 'utf8')) || {};
    if (!parsed || typeof parsed !== 'object') return [];
    const savedSignature = JSON.stringify(parsed.settings || {});
    if (savedSignature !== settingsSignature) return [];
    const savedModels = Array.isArray(parsed.models) ? parsed.models : [];
    const byId = new Map(savedModels.map((entry) => [entry?.modelId, entry]));
    const resumed = [];
    for (const modelId of models) {
      const entry = byId.get(modelId);
      if (!isModelReportComplete(entry)) continue;
      resumed.push(entry);
    }
    return resumed;
  } catch {
    return [];
  }
};

const modelReports = await loadResumedModelReports();
const resumedModels = modelReports.length;
const completedModelIds = new Set(modelReports.map((entry) => entry.modelId));
completedModelsProgress = completedModelIds.size;
modelsTask.set(completedModelsProgress, models.length, {
  message: resumedModels > 0
    ? `${resumedModels} resumed`
    : 'starting'
});

const setActivePhase = (modelId, phase) => {
  activeModelId = modelId || null;
  activePhase = phase || null;
  activePhaseStartedAt = activePhase ? new Date().toISOString() : null;
  const modelPrefix = activeModelId ? `${activeModelId}` : 'idle';
  const phaseLabel = activePhase || 'idle';
  modelsTask.set(completedModelsProgress, models.length, {
    message: `${modelPrefix} · ${phaseLabel}`
  });
};

let compareReport = null;
for (const modelId of models) {
  if (completedModelIds.has(modelId)) {
    display.log(`[bakeoff] resume: skipping completed model=${modelId}`, { kind: 'status', stage: 'bakeoff' });
    continue;
  }
  const env = toModelEnv(modelId);
  const timings = {
    strategy: 'skip',
    buildIndexMs: 0,
    buildSqliteMs: 0,
    totalBuildMs: 0
  };
  display.log(`[bakeoff] model=${modelId} cache=${env.PAIROFCLEATS_CACHE_ROOT}`, {
    kind: 'status',
    stage: 'bakeoff'
  });

  try {
    timings.strategy = resolveBuildStrategy({
      modelCacheRootPath: env.PAIROFCLEATS_CACHE_ROOT,
      shouldBuildIndex: buildIndex,
      resolvedMode: mode
    });
    const sqliteRequested = runStage4OnlyBuild || (sqliteBackend && buildIndex);
    const hasSqliteArtifacts = sqliteRequested
      ? sqliteArtifactsExist(env.PAIROFCLEATS_CACHE_ROOT, mode)
      : false;
    const shouldRunStage4 = sqliteRequested
      ? (runStage4OnlyBuild || timings.strategy === 'full' || !hasSqliteArtifacts)
      : false;

    const phasePlan = [];
    if (timings.strategy === 'full') phasePlan.push('stage2', 'stage3');
    else if (timings.strategy === 'stage3') phasePlan.push('stage3');
    if (shouldRunStage4) phasePlan.push('stage4');
    if (runEval) phasePlan.push('eval');
    const phaseTotal = Math.max(1, phasePlan.length);
    let phaseCompleted = 0;
    const phaseTask = display.task(`Model ${modelId}`, {
      taskId: `bakeoff:model:${modelId}`,
      total: phaseTotal,
      stage: 'bakeoff',
      mode: modelId,
      ephemeral: true
    });
    const runPhase = async (phaseName, fn) => {
      const phaseStartedAtMs = Date.now();
      setActivePhase(modelId, phaseName);
      await writeOutputPayload({
        modelReports,
        compareReport: null,
        status: 'running',
        resumedModels,
        currentModel: activeModelId,
        currentPhase: activePhase,
        phaseStartedAt: activePhaseStartedAt
      });
      const runningStep = Math.min(phaseTotal, phaseCompleted + 1);
      phaseTask.set(runningStep, phaseTotal, {
        message: `${phaseName} running (${formatElapsed(phaseStartedAtMs)})`
      });
      display.log(`[bakeoff] ${modelId}: ${phaseName} started`, { kind: 'status', stage: 'bakeoff' });
      const heartbeat = setInterval(() => {
        phaseTask.set(runningStep, phaseTotal, {
          message: `${phaseName} running (${formatElapsed(phaseStartedAtMs)})`
        });
      }, 1500);
      try {
        return await fn();
      } finally {
        clearInterval(heartbeat);
        phaseCompleted += 1;
        const elapsedLabel = formatElapsed(phaseStartedAtMs);
        phaseTask.set(phaseCompleted, phaseTotal, {
          message: `${phaseName} done (${elapsedLabel})`
        });
        display.log(`[bakeoff] ${modelId}: ${phaseName} completed in ${elapsedLabel}`, {
          kind: 'status',
          stage: 'bakeoff'
        });
        await writeOutputPayload({
          modelReports,
          compareReport: null,
          status: 'running',
          resumedModels,
          currentModel: activeModelId,
          currentPhase: activePhase,
          phaseStartedAt: activePhaseStartedAt
        });
      }
    };

    if (timings.strategy === 'full') {
      const startedAt = Date.now();
      const stage2Args = [buildIndexScript, '--stage', '2', '--repo', root, '--mode', mode];
      if (incremental) stage2Args.push('--incremental');
      await runPhase('stage2', async () => runNodeWithLockRetry(stage2Args, env, `build stage2 (${modelId})`));

      const args = [buildIndexScript, '--stage', '3', '--repo', root, '--mode', mode];
      if (incremental) args.push('--incremental');
      if (useStubEmbeddings) args.push('--stub-embeddings');
      await runPhase('stage3', async () => runNodeWithLockRetry(args, env, `build embeddings (${modelId})`));
      timings.buildIndexMs = Date.now() - startedAt;
    } else if (timings.strategy === 'stage3') {
      const args = [buildIndexScript, '--stage', '3', '--repo', root, '--mode', mode];
      if (incremental) args.push('--incremental');
      if (useStubEmbeddings) args.push('--stub-embeddings');
      const startedAt = Date.now();
      await runPhase('stage3', async () => runNodeWithLockRetry(args, env, `build embeddings (${modelId})`));
      timings.buildIndexMs = Date.now() - startedAt;
    }

    if (shouldRunStage4) {
      timings.buildSqliteMs = await runPhase(
        'stage4',
        async () => runIsolatedStage4({ modelId, env, resolvedMode: mode })
      );
    }
    timings.totalBuildMs = timings.buildIndexMs + timings.buildSqliteMs;

    let evalSummary = null;
    if (runEval) {
      const evalArgs = [
        evalScript,
        '--repo',
        root,
        '--dataset',
        datasetPath,
        '--backend',
        backend,
        '--top',
        String(topN)
      ];
      if (annOverride === true) evalArgs.push('--ann');
      if (annOverride === false) evalArgs.push('--no-ann');
      if (limit > 0) evalArgs.push('--limit', String(limit));
      const evalReport = await runPhase('eval', async () => runJsonNode(evalArgs, env, `eval (${modelId})`));
      evalSummary = evalReport?.summary || null;
    }

    const cacheBytes = await directorySizeBytes(env.PAIROFCLEATS_CACHE_ROOT);
    modelReports.push({
      modelId,
      cacheRoot: env.PAIROFCLEATS_CACHE_ROOT,
      inputFormatting: resolveEmbeddingInputFormatting(modelId),
      build: {
        strategy: timings.strategy,
        buildIndexMs: toFixedMs(timings.buildIndexMs),
        buildSqliteMs: toFixedMs(timings.buildSqliteMs),
        totalBuildMs: toFixedMs(timings.totalBuildMs)
      },
      cache: {
        bytes: cacheBytes,
        gib: formatBytesGiB(cacheBytes)
      },
      eval: evalSummary,
      evalReportPath: null
    });
    completedModelIds.add(modelId);
    completedModelsProgress += 1;
    modelsTask.set(completedModelsProgress, models.length, {
      message: `${modelId} done`
    });
    setActivePhase(modelId, 'checkpoint');
    await writeOutputPayload({
      modelReports,
      compareReport: null,
      status: 'running',
      resumedModels,
      currentModel: activeModelId,
      currentPhase: activePhase,
      phaseStartedAt: activePhaseStartedAt
    });
    setActivePhase(null, null);
  } catch (err) {
    await writeOutputPayload({
      modelReports,
      compareReport: null,
      status: 'failed',
      resumedModels,
      currentModel: activeModelId,
      currentPhase: activePhase,
      phaseStartedAt: activePhaseStartedAt,
      error: {
        phase: 'model',
        modelId,
        message: err?.message || String(err)
      }
    });
    throw err;
  }
}

if (runCompare) {
  let compareTask = null;
  let compareHeartbeat = null;
  let compareStartedAtMs = 0;
  try {
    setActivePhase('compare', 'latency-compare');
    compareTask = display.task('Compare', {
      taskId: 'bakeoff:compare',
      total: 1,
      stage: 'bakeoff',
      ephemeral: true
    });
    compareStartedAtMs = Date.now();
    compareTask.set(0, 1, {
      message: `running (${formatElapsed(compareStartedAtMs)})`
    });
    compareHeartbeat = setInterval(() => {
      compareTask.set(0, 1, {
        message: `running (${formatElapsed(compareStartedAtMs)})`
      });
    }, 1500);
    await writeOutputPayload({
      modelReports,
      compareReport: null,
      status: 'running',
      resumedModels,
      currentModel: activeModelId,
      currentPhase: activePhase,
      phaseStartedAt: activePhaseStartedAt
    });
    const compareArgs = [
      compareScript,
      '--json',
      '--repo',
      root,
      '--models',
      models.join(','),
      '--baseline',
      baseline,
      '--backend',
      backend,
      '--top',
      String(topN),
      '--mode',
      mode,
      '--cache-root',
      cacheRootBase
    ];
    if (annOverride === true) compareArgs.push('--ann');
    if (annOverride === false) compareArgs.push('--no-ann');
    if (queriesPath) compareArgs.push('--queries', queriesPath);
    if (limit > 0) compareArgs.push('--limit', String(limit));
    compareReport = runJsonNode(compareArgs, baseEnv, 'compare-models');
    setActivePhase(null, null);
  } catch (err) {
    await writeOutputPayload({
      modelReports,
      compareReport: null,
      status: 'failed',
      resumedModels,
      currentModel: activeModelId,
      currentPhase: activePhase,
      phaseStartedAt: activePhaseStartedAt,
      error: {
        phase: 'compare',
        message: err?.message || String(err)
      }
    });
    throw err;
  } finally {
    if (compareHeartbeat) {
      clearInterval(compareHeartbeat);
      compareHeartbeat = null;
    }
    if (compareTask) {
      const message = compareReport
        ? `completed (${formatElapsed(compareStartedAtMs)})`
        : `failed (${formatElapsed(compareStartedAtMs)})`;
      compareTask.done({ message });
      compareTask = null;
    }
  }
}

const output = await writeOutputPayload({
  modelReports,
  compareReport,
  status: 'completed',
  resumedModels,
  currentModel: null,
  currentPhase: null,
  phaseStartedAt: null
});
setActivePhase(null, null);
modelsTask.done({ message: 'completed' });
display.flush();
display.close();

if (argv.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.error('Embedding model bakeoff summary');
  for (const entry of modelReports) {
    const recallAt5 = Number(entry.eval?.recallAtK?.['5'] ?? 0);
    const mrr = Number(entry.eval?.mrr ?? 0);
    const ndcgAt10 = Number(entry.eval?.ndcgAtK?.['10'] ?? 0);
    console.error(
      `- ${entry.modelId}: build=${entry.build.totalBuildMs}ms cache=${entry.cache.gib}GiB `
      + `recall@5=${recallAt5.toFixed(3)} mrr=${mrr.toFixed(3)} ndcg@10=${ndcgAt10.toFixed(3)} `
      + `format=${entry.inputFormatting.family}`
    );
  }
  if (compareReport?.summary?.models) {
    for (const modelId of models) {
      const stats = compareReport.summary.models?.[modelId];
      if (!stats) continue;
      console.error(
        `- latency ${modelId}: elapsed=${Number(stats.elapsedMsAvg || 0).toFixed(1)}ms `
        + `wall=${Number(stats.wallMsAvg || 0).toFixed(1)}ms`
      );
    }
  }
  console.error(`Report written to ${checkpointOutPath}`);
}
