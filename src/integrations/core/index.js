import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseBuildArgs } from '../../index/build/args.js';
import { buildIndexForMode } from '../../index/build/indexer.js';
import { acquireIndexLock } from '../../index/build/lock.js';
import { preprocessFiles, writePreprocessStats } from '../../index/build/preprocess.js';
import { createBuildRuntime } from '../../index/build/runtime.js';
import { initBuildState, markBuildPhase, startBuildHeartbeat, updateBuildState } from '../../index/build/build-state.js';
import { promoteBuild } from '../../index/build/promotion.js';
import { validateIndexArtifacts } from '../../index/validate.js';
import { watchIndex } from '../../index/build/watch.js';
import { getEnvConfig } from '../../shared/env.js';
import { log as defaultLog } from '../../shared/progress.js';
import { observeIndexDuration } from '../../shared/metrics.js';
import { shutdownPythonAstPool } from '../../lang/python.js';
import { createFeatureMetrics, writeFeatureMetrics } from '../../index/build/feature-metrics.js';
import { getCacheRoot, getMetricsDir, getRepoCacheRoot, getToolVersion, getIndexDir, loadUserConfig, resolveRepoRoot, resolveToolRoot } from '../../../tools/dict-utils.js';
import { ensureQueueDir, enqueueJob } from '../../../tools/service/queue.js';
import { runBuildSqliteIndex } from '../../../tools/build-sqlite-index.js';
import { runSearchCli } from '../../retrieval/cli.js';
import { getStatus } from './status.js';

const toolRoot = resolveToolRoot();
const buildEmbeddingsPath = path.join(toolRoot, 'tools', 'build-embeddings.js');

const buildRawArgs = (options = {}) => {
  const args = [];
  if (options.mode) args.push('--mode', String(options.mode));
  if (options.stage) args.push('--stage', String(options.stage));
  if (options.threads !== undefined) args.push('--threads', String(options.threads));
  if (options.incremental) args.push('--incremental');
  if (options['stub-embeddings'] || options.stubEmbeddings) args.push('--stub-embeddings');
  if (options.watch) args.push('--watch');
  if (options['watch-poll'] !== undefined) args.push('--watch-poll', String(options['watch-poll']));
  if (options['watch-debounce'] !== undefined) args.push('--watch-debounce', String(options['watch-debounce']));
  if (options.sqlite === true) args.push('--sqlite');
  if (options.sqlite === false) args.push('--no-sqlite');
  if (options.model) args.push('--model', String(options.model));
  return args;
};

const pushFlag = (args, name, value) => {
  if (value === undefined || value === null) return;
  if (value === true) {
    args.push(`--${name}`);
  } else if (value === false) {
    args.push(`--no-${name}`);
  } else {
    args.push(`--${name}`, String(value));
  }
};

  const buildSearchArgs = (params = {}) => {
    const args = [];
  pushFlag(args, 'mode', params.mode);
  pushFlag(args, 'backend', params.backend);
  pushFlag(args, 'ann', params.ann);
  pushFlag(args, 'json', params.json);
  pushFlag(args, 'json-compact', params.jsonCompact);
  pushFlag(args, 'explain', params.explain);
  pushFlag(args, 'context', params.context);
  pushFlag(args, 'n', params.n);
  pushFlag(args, 'case', params.case);
  pushFlag(args, 'case-file', params.caseFile);
  pushFlag(args, 'case-tokens', params.caseTokens);
  pushFlag(args, 'path', params.path);
  pushFlag(args, 'file', params.file);
  pushFlag(args, 'ext', params.ext);
  pushFlag(args, 'lang', params.lang);
  if (params.args) args.push(...params.args);
    return args;
  };

const normalizeStage = (raw) => {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!value) return null;
    if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
    if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
    if (value === '3' || value === 'stage3' || value === 'embeddings' || value === 'embed') return 'stage3';
    if (value === '4' || value === 'stage4' || value === 'sqlite' || value === 'ann') return 'stage4';
  return null;
};

const resolveEnrichmentStatePath = (repoCacheRoot) => path.join(repoCacheRoot, 'enrichment_state.json');

const updateEnrichmentState = async (repoCacheRoot, patch) => {
  if (!repoCacheRoot) return null;
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(resolveEnrichmentStatePath(repoCacheRoot), 'utf8'));
  } catch {}
  const next = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  try {
    await fs.mkdir(repoCacheRoot, { recursive: true });
    await fs.writeFile(resolveEnrichmentStatePath(repoCacheRoot), JSON.stringify(next, null, 2));
  } catch {}
  return next;
};

const buildStage2Args = ({ root, argv, rawArgv }) => {
  const args = ['--repo', root, '--stage', 'stage2'];
  if (argv.mode && argv.mode !== 'all') args.push('--mode', argv.mode);
  const stageThreads = Number(argv.threads);
  if (Number.isFinite(stageThreads) && stageThreads > 0) {
    args.push('--threads', String(stageThreads));
  }
  if (argv.incremental) args.push('--incremental');
  if (rawArgv.includes('--stub-embeddings')) args.push('--stub-embeddings');
  if (typeof argv.sqlite === 'boolean') args.push(argv.sqlite ? '--sqlite' : '--no-sqlite');
  if (argv.model) args.push('--model', String(argv.model));
  return args;
};

const resolveEmbeddingRuntime = ({ argv, userConfig, envConfig }) => {
  const embeddingsConfig = userConfig?.indexing?.embeddings || {};
  const embeddingModeRaw = typeof embeddingsConfig.mode === 'string'
    ? embeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const baseStubEmbeddings = argv['stub-embeddings'] === true
    || envConfig.embeddings === 'stub';
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
    ? embeddingModeRaw
    : 'auto';
  const resolvedEmbeddingMode = normalizedEmbeddingMode === 'auto'
    ? (baseStubEmbeddings ? 'stub' : 'inline')
    : normalizedEmbeddingMode;
  const embeddingService = embeddingsConfig.enabled !== false
    && resolvedEmbeddingMode === 'service';
  const embeddingEnabled = embeddingsConfig.enabled !== false
    && resolvedEmbeddingMode !== 'off';
  const queueDir = typeof embeddingsConfig.queue?.dir === 'string'
    ? embeddingsConfig.queue.dir.trim()
    : '';
  const queueMaxRaw = Number(embeddingsConfig.queue?.maxQueued);
  const queueMaxQueued = Number.isFinite(queueMaxRaw)
    ? Math.max(0, Math.floor(queueMaxRaw))
    : null;
  return {
    embeddingEnabled,
    embeddingService,
    useStubEmbeddings: resolvedEmbeddingMode === 'stub' || baseStubEmbeddings,
    resolvedEmbeddingMode,
    queueDir,
    queueMaxQueued
  };
};

const teardownRuntime = async (runtime) => {
  if (!runtime) return;
  try {
    if (runtime.workerPools?.destroy) {
      await runtime.workerPools.destroy();
    } else if (runtime.workerPool?.destroy) {
      await runtime.workerPool.destroy();
    }
  } catch {}
  shutdownPythonAstPool();
};

const runEmbeddingsTool = (args, extraEnv = null) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env
  });
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`build-embeddings exited with code ${code ?? 'unknown'}`));
    }
  });
});

/**
 * Build file-backed indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildIndex(repoRoot, options = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot(process.cwd());
  const defaults = parseBuildArgs([]).argv;
  const baseArgv = { ...defaults, ...options, repo: root };
  const explicitStage = normalizeStage(baseArgv.stage);
  const argv = explicitStage ? { ...baseArgv, stage: explicitStage } : baseArgv;
  const mode = argv.mode || 'all';
  const modes = mode === 'all' ? ['prose', 'code', 'extracted-prose'] : [mode];
  const rawArgv = options.rawArgv || buildRawArgs(options);
  const log = typeof options.log === 'function' ? options.log : defaultLog;
  const metricsMode = mode || 'all';
  const recordIndexMetric = (stage, status, start) => {
    try {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
      observeIndexDuration({ stage, mode: metricsMode, status, seconds: elapsed });
    } catch {}
  };

  if (argv.watch) {
    const runtime = await createBuildRuntime({ root, argv, rawArgv });
    const pollMs = Number.isFinite(Number(argv['watch-poll'])) ? Number(argv['watch-poll']) : 2000;
    const debounceMs = Number.isFinite(Number(argv['watch-debounce'])) ? Number(argv['watch-debounce']) : 500;
    try {
      await watchIndex({ runtime, modes, pollMs, debounceMs });
      return { modes, watch: true };
    } finally {
      await teardownRuntime(runtime);
    }
  }

  const userConfig = loadUserConfig(root);
  const envConfig = getEnvConfig();
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const twoStageConfig = userConfig?.indexing?.twoStage || {};
  const twoStageEnabled = twoStageConfig.enabled === true;
  const embeddingRuntime = resolveEmbeddingRuntime({ argv, userConfig, envConfig });
  const buildEmbedModes = modes.filter((modeItem) => modeItem === 'code' || modeItem === 'prose');
  const runEmbeddingsStage = async () => {
    const started = process.hrtime.bigint();
    const recordOk = (result) => {
      recordIndexMetric('stage3', 'ok', started);
      return result;
    };
    if (!embeddingRuntime.embeddingEnabled) {
      log('Embeddings disabled; skipping stage3.');
      return recordOk({ modes: buildEmbedModes, embeddings: { skipped: true }, repo: root, stage: 'stage3' });
    }
    const lock = await acquireIndexLock({ repoCacheRoot, log });
    if (!lock) throw new Error('Index lock unavailable.');
    try {
      if (embeddingRuntime.embeddingService) {
        const queueDir = embeddingRuntime.queueDir
          ? path.resolve(embeddingRuntime.queueDir)
          : path.join(getCacheRoot(), 'service', 'queue');
        await ensureQueueDir(queueDir);
        const jobs = [];
        for (const modeItem of buildEmbedModes) {
          const jobId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
          const result = await enqueueJob(
            queueDir,
            {
              id: jobId,
              createdAt: new Date().toISOString(),
              repo: root,
              mode: modeItem,
              reason: 'stage3',
              stage: 'stage3'
            },
            embeddingRuntime.queueMaxQueued,
            'embeddings'
          );
          if (!result.ok) {
            log(`[embeddings] Queue full or unavailable; skipped enqueue (${modeItem}).`);
            continue;
          }
          log(`[embeddings] Queued embedding job ${jobId} (${modeItem}).`);
          jobs.push(result.job || { id: jobId, mode: modeItem });
        }
        return recordOk({ modes: buildEmbedModes, embeddings: { queued: true, jobs }, repo: root, stage: 'stage3' });
      }
      for (const modeItem of buildEmbedModes) {
        const args = [buildEmbeddingsPath, '--repo', root, '--mode', modeItem];
        if (Number.isFinite(Number(argv.dims))) {
          args.push('--dims', String(argv.dims));
        }
        if (embeddingRuntime.useStubEmbeddings) args.push('--stub-embeddings');
        await runEmbeddingsTool(args);
      }
      return recordOk({ modes: buildEmbedModes, embeddings: { queued: false, inline: true }, repo: root, stage: 'stage3' });
    } catch (err) {
      recordIndexMetric('stage3', 'error', started);
      throw err;
    } finally {
      await lock.release();
    }
  };
  const runSqliteStage = async () => {
    const started = process.hrtime.bigint();
    const recordOk = (result) => {
      recordIndexMetric('stage4', 'ok', started);
      return result;
    };
    const sqliteConfigured = userConfig?.sqlite?.use !== false;
    const shouldBuildSqlite = typeof argv.sqlite === 'boolean' ? argv.sqlite : sqliteConfigured;
    if (!shouldBuildSqlite) {
      log('SQLite disabled; skipping stage4.');
      return recordOk({ modes: buildEmbedModes, sqlite: { skipped: true }, repo: root, stage: 'stage4' });
    }
    const lock = await acquireIndexLock({ repoCacheRoot, log });
    if (!lock) throw new Error('Index lock unavailable.');
    try {
      if (!buildEmbedModes.length) return recordOk({ modes: buildEmbedModes, sqlite: null, repo: root, stage: 'stage4' });
      const sqliteResult = await buildSqliteIndex(root, {
        mode: buildEmbedModes.length === 1 ? buildEmbedModes[0] : 'all',
        incremental: argv.incremental === true,
        emitOutput: options.emitOutput !== false,
        exitOnError: false
      });
      return recordOk({ modes: buildEmbedModes, sqlite: sqliteResult, repo: root, stage: 'stage4' });
    } catch (err) {
      recordIndexMetric('stage4', 'error', started);
      throw err;
    } finally {
      await lock.release();
    }
  };
  const runStage = async (stage, { allowSqlite = true } = {}) => {
    const started = process.hrtime.bigint();
    const stageArgv = stage ? { ...argv, stage } : argv;
    let phaseStage = stage || 'stage2';
    let runtime = null;
    let result = null;
    try {
      runtime = await createBuildRuntime({ root, argv: stageArgv, rawArgv });
      phaseStage = runtime.stage || phaseStage;
      runtime.featureMetrics = createFeatureMetrics({
        buildId: runtime.buildId,
        configHash: runtime.configHash,
        stage: phaseStage,
        repoRoot: runtime.root,
        toolVersion: getToolVersion()
      });
      const lock = await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
      if (!lock) throw new Error('Index lock unavailable.');
      let sqliteResult = null;
      const stopHeartbeat = (phaseStage === 'stage2' || phaseStage === 'stage3')
        ? startBuildHeartbeat(runtime.buildRoot, phaseStage)
        : () => {};
      try {
      await initBuildState({
        buildRoot: runtime.buildRoot,
        buildId: runtime.buildId,
        repoRoot: runtime.root,
        modes,
        stage: phaseStage,
        configHash: runtime.configHash,
        toolVersion: getToolVersion(),
        repoProvenance: runtime.repoProvenance
      });
      await markBuildPhase(runtime.buildRoot, 'discovery', 'running');
      let sharedDiscovery = null;
      const preprocessModes = modes.filter((modeItem) => modeItem === 'code' || modeItem === 'prose');
      if (preprocessModes.length) {
        await markBuildPhase(runtime.buildRoot, 'preprocessing', 'running');
        const preprocess = await preprocessFiles({
          root: runtime.root,
          modes: preprocessModes,
          ignoreMatcher: runtime.ignoreMatcher,
          maxFileBytes: runtime.maxFileBytes,
          fileCaps: runtime.fileCaps,
          maxDepth: runtime.guardrails?.maxDepth ?? null,
          maxFiles: runtime.guardrails?.maxFiles ?? null,
          fileScan: runtime.fileScan,
          lineCounts: runtime.shards?.enabled === true,
          concurrency: runtime.ioConcurrency,
          log
        });
        await writePreprocessStats(runtime.repoCacheRoot, preprocess.stats);
        await markBuildPhase(runtime.buildRoot, 'preprocessing', 'done');
        sharedDiscovery = {};
        for (const modeItem of preprocessModes) {
          sharedDiscovery[modeItem] = {
            entries: preprocess.entriesByMode[modeItem] || [],
            skippedFiles: preprocess.skippedByMode[modeItem] || [],
            lineCounts: preprocess.lineCountsByMode[modeItem] || new Map()
          };
        }
      }
      await markBuildPhase(runtime.buildRoot, 'discovery', 'done');
      await markBuildPhase(runtime.buildRoot, phaseStage, 'running');
      for (const modeItem of modes) {
        const discovery = sharedDiscovery ? sharedDiscovery[modeItem] : null;
        await buildIndexForMode({ mode: modeItem, runtime, discovery });
      }
      if (runtime.featureMetrics) {
        await writeFeatureMetrics({
          metricsDir: getMetricsDir(runtime.root, runtime.userConfig),
          featureMetrics: runtime.featureMetrics
        });
      }
      await markBuildPhase(runtime.buildRoot, phaseStage, 'done');
      const sqliteConfigured = runtime.userConfig?.sqlite?.use !== false;
      const sqliteModes = modes.filter((modeItem) => modeItem === 'code' || modeItem === 'prose');
      const shouldBuildSqlite = allowSqlite
        && (typeof stageArgv.sqlite === 'boolean' ? stageArgv.sqlite : sqliteConfigured);
      const sqliteEnabledForValidation = shouldBuildSqlite && sqliteModes.length > 0;
      if (shouldBuildSqlite && sqliteModes.length) {
        const codeDir = getIndexDir(root, 'code', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const proseDir = getIndexDir(root, 'prose', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const sqliteOut = path.join(runtime.buildRoot, 'index-sqlite');
        sqliteResult = await buildSqliteIndex(root, {
          mode: sqliteModes.length === 1 ? sqliteModes[0] : 'all',
          incremental: stageArgv.incremental === true,
          out: sqliteOut,
          codeDir,
          proseDir,
          emitOutput: options.emitOutput !== false,
          exitOnError: false
        });
      }
      await markBuildPhase(runtime.buildRoot, 'validation', 'running');
      const validation = await validateIndexArtifacts({
        root: runtime.root,
        indexRoot: runtime.buildRoot,
        modes,
        userConfig: runtime.userConfig,
        sqliteEnabled: sqliteEnabledForValidation
      });
      await updateBuildState(runtime.buildRoot, {
        validation: {
          ok: validation.ok,
          issueCount: validation.issues.length,
          warningCount: validation.warnings.length
        }
      });
      if (!validation.ok) {
        await markBuildPhase(runtime.buildRoot, 'validation', 'failed');
        throw new Error('Index validation failed; see index-validate output for details.');
      }
      await markBuildPhase(runtime.buildRoot, 'validation', 'done');
      await markBuildPhase(runtime.buildRoot, 'promote', 'running');
      await promoteBuild({
        repoRoot: runtime.root,
        userConfig: runtime.userConfig,
        buildId: runtime.buildId,
        buildRoot: runtime.buildRoot,
        stage: phaseStage,
        modes,
        configHash: runtime.configHash,
        repoProvenance: runtime.repoProvenance
      });
      await markBuildPhase(runtime.buildRoot, 'promote', 'done');
      result = { modes, sqlite: sqliteResult, repo: runtime.root, stage };
      } finally {
        stopHeartbeat();
        await lock.release();
        await teardownRuntime(runtime);
      }
    } catch (err) {
      recordIndexMetric(phaseStage, 'error', started);
      throw err;
    }

    if (twoStageEnabled) {
      const now = new Date().toISOString();
      if (stage === 'stage1') {
        await updateEnrichmentState(runtime.repoCacheRoot, {
          status: 'pending',
          stage1At: now,
          queued: false
        });
      }
      if (stage === 'stage2') {
        await updateEnrichmentState(runtime.repoCacheRoot, {
          status: 'done',
          stage2At: now,
          queued: false
        });
      }
    }
    recordIndexMetric(phaseStage, 'ok', started);
    return result;
  };

  if (explicitStage === 'stage3') {
    return runEmbeddingsStage();
  }
  if (explicitStage === 'stage4') {
    return runSqliteStage();
  }

  if (explicitStage || !twoStageEnabled) {
    return runStage(explicitStage, { allowSqlite: true });
  }

  const stage1Result = await runStage('stage1', { allowSqlite: false });
  if (twoStageConfig.background === true) {
    const stage2Args = buildStage2Args({ root, argv, rawArgv });
    const queueEnabled = twoStageConfig.queue !== false;
    if (queueEnabled) {
      const queueDir = userConfig?.indexing?.embeddings?.queue?.dir
        ? path.resolve(userConfig.indexing.embeddings.queue.dir)
        : path.join(getCacheRoot(), 'service', 'queue');
      const maxQueuedRaw = Number(userConfig?.indexing?.embeddings?.queue?.maxQueued);
      const maxQueued = Number.isFinite(maxQueuedRaw) ? Math.max(0, Math.floor(maxQueuedRaw)) : null;
      const jobId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      await ensureQueueDir(queueDir);
      const result = await enqueueJob(
        queueDir,
        {
          id: jobId,
          createdAt: new Date().toISOString(),
          repo: root,
          mode: argv.mode || 'all',
          reason: 'stage2',
          stage: 'stage2',
          args: stage2Args
        },
        maxQueued,
        'index'
      );
      if (result.ok) {
        await updateEnrichmentState(repoCacheRoot, {
          queued: true,
          queueId: jobId
        });
        log('Two-stage indexing: stage2 queued for background enrichment.');
        return { modes, stage1: stage1Result, stage2: { queued: true, queueId: jobId }, repo: root };
      }
    }
    const stage2ArgsWithScript = [path.join(toolRoot, 'build_index.js'), ...stage2Args];
    spawn(process.execPath, stage2ArgsWithScript, { stdio: 'ignore', detached: true }).unref();
    return { modes, stage1: stage1Result, stage2: { background: true }, repo: root };
  }

  const stage2Result = await runStage('stage2', { allowSqlite: true });
  return { modes, stage1: stage1Result, stage2: stage2Result, repo: root };
}

/**
 * Build or update SQLite indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildSqliteIndex(repoRoot, options = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot(process.cwd());
  const rawArgs = Array.isArray(options.args) ? options.args.slice() : [];
  if (!options.args) {
    if (options.mode) rawArgs.push('--mode', String(options.mode));
    if (options.incremental) rawArgs.push('--incremental');
    if (options.compact) rawArgs.push('--compact');
    if (options.out) rawArgs.push('--out', String(options.out));
    if (options.codeDir) rawArgs.push('--code-dir', String(options.codeDir));
    if (options.proseDir) rawArgs.push('--prose-dir', String(options.proseDir));
  }
  return runBuildSqliteIndex(rawArgs, {
    root,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true
  });
}

/**
 * Execute a search for a repo.
 * @param {string} repoRoot
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function search(repoRoot, params = {}) {
  const rootOverride = repoRoot
    ? path.resolve(repoRoot)
    : (params.root ? path.resolve(params.root) : null);
  const rawArgs = Array.isArray(params.args) ? params.args.slice() : buildSearchArgs(params);
  const query = typeof params.query === 'string' ? params.query : '';
  if (query) rawArgs.push(query);
  return runSearchCli(rawArgs, {
    root: rootOverride || undefined,
    emitOutput: params.emitOutput === true,
    exitOnError: params.exitOnError === true,
    indexCache: params.indexCache,
    sqliteCache: params.sqliteCache
  });
}

/**
 * Report artifact status for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function status(repoRoot, options = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot(process.cwd());
  return getStatus({ repoRoot: root, includeAll: options.all === true });
}
