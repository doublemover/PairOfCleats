import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { parseBuildArgs } from '../../../index/build/args.js';
import { createBuildRuntime } from '../../../index/build/runtime.js';
import { watchIndex } from '../../../index/build/watch.js';
import { log as defaultLog, logError as defaultLogError } from '../../../shared/progress.js';
import { observeIndexDuration } from '../../../shared/metrics.js';
import { buildAutoPolicy } from '../../../shared/auto-policy.js';
import { resolveRuntimeEnvelope, resolveRuntimeEnv } from '../../../shared/runtime-envelope.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { spawnSubprocess } from '../../../shared/subprocess.js';
import { resolveEmbeddingRuntime } from '../embeddings.js';
import { buildRawArgs, buildStage2Args, normalizeStage } from '../args.js';
import { updateEnrichmentState } from '../enrichment-state.js';
import {
  getCacheRoot,
  getRepoCacheRoot,
  getRepoRoot,
  getToolVersion,
  loadUserConfig,
  resolveToolRoot
} from '../../../../tools/shared/dict-utils.js';
import { ensureQueueDir, enqueueJob } from '../../../../tools/service/queue.js';
import { computeCompatibilityKey } from './compatibility.js';
import { teardownRuntime } from './runtime.js';
import { buildSqliteIndex } from './sqlite.js';
import { runEmbeddingsStage, runSqliteStage, runStage } from './stages.js';

const toolRoot = resolveToolRoot();
const buildEmbeddingsPath = path.join(toolRoot, 'tools', 'build/embeddings.js');

/**
 * Build file-backed indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildIndex(repoRoot, options = {}) {
  const root = getRepoRoot(repoRoot);
  const defaults = parseBuildArgs([]).argv;
  const baseArgv = { ...defaults, ...options, repo: root };
  const explicitStage = normalizeStage(baseArgv.stage);
  const argv = explicitStage ? { ...baseArgv, stage: explicitStage } : baseArgv;
  const mode = argv.mode || 'all';
  const requestedModes = Array.isArray(options.modes) && options.modes.length ? options.modes : null;
  const modes = requestedModes || (mode === 'all'
    ? ['code', 'prose', 'extracted-prose', 'records']
    : [mode]);
  const rawArgv = options.rawArgv || buildRawArgs(options);
  const log = typeof options.log === 'function' ? options.log : defaultLog;
  const logError = typeof options.logError === 'function' ? options.logError : defaultLogError;
  const warn = typeof options.warn === 'function' ? options.warn : ((message) => log(`[warn] ${message}`));
  const abortSignal = options.abortSignal || null;
  const sqliteLogger = { log, warn, error: logError };
  const metricsMode = mode || 'all';
  const recordIndexMetric = (stage, status, start) => {
    try {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
      observeIndexDuration({ stage, mode: metricsMode, status, seconds: elapsed });
    } catch {}
  };

  throwIfAborted(abortSignal);
  const userConfig = loadUserConfig(root);
  const qualityOverride = typeof argv.quality === 'string' ? argv.quality.trim().toLowerCase() : '';
  const policyConfig = qualityOverride ? { ...userConfig, quality: qualityOverride } : userConfig;
  const policy = await buildAutoPolicy({ repoRoot: root, config: policyConfig });
  const envelope = resolveRuntimeEnvelope({
    argv,
    rawArgv,
    userConfig,
    autoPolicy: policy,
    env: process.env,
    execArgv: process.execArgv,
    cpuCount: os.cpus().length,
    processInfo: {
      pid: process.pid,
      argv: process.argv,
      execPath: process.execPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length
    },
    toolVersion: getToolVersion()
  });
  const runtimeEnv = resolveRuntimeEnv(envelope, process.env);
  throwIfAborted(abortSignal);

  if (argv.watch) {
    const runtime = await createBuildRuntime({ root, argv, rawArgv, policy });
    computeCompatibilityKey({ runtime, modes, sharedDiscovery: null });
    const pollMs = Number.isFinite(Number(argv['watch-poll'])) ? Number(argv['watch-poll']) : 2000;
    const debounceMs = Number.isFinite(Number(argv['watch-debounce'])) ? Number(argv['watch-debounce']) : 500;
    try {
      await watchIndex({ runtime, modes, pollMs, debounceMs, abortSignal });
      return { modes, watch: true };
    } finally {
      await teardownRuntime(runtime);
    }
  }

  throwIfAborted(abortSignal);
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const twoStageConfig = userConfig?.indexing?.twoStage || {};
  const twoStageEnabled = twoStageConfig.enabled === true;
  const embeddingRuntime = resolveEmbeddingRuntime({ argv, userConfig, policy });
  const embedModes = modes.filter((modeItem) => (
    modeItem === 'code'
    || modeItem === 'prose'
    || modeItem === 'extracted-prose'
    || modeItem === 'records'
  ));
  const sqliteModes = modes.filter((modeItem) => (
    modeItem === 'code' || modeItem === 'prose' || modeItem === 'extracted-prose' || modeItem === 'records'
  ));
  const sqliteConfigured = userConfig?.sqlite?.use !== false;
  const shouldBuildSqlite = typeof argv.sqlite === 'boolean' ? argv.sqlite : sqliteConfigured;
  const includeEmbeddings = (embeddingRuntime.embeddingEnabled || embeddingRuntime.embeddingService)
    && embedModes.length > 0;
  const includeSqlite = shouldBuildSqlite && sqliteModes.length > 0;
  const overallProgressOptions = (!explicitStage && !twoStageEnabled)
    ? { includeEmbeddings, includeSqlite }
    : null;
  const overallProgressRef = { current: null };

  const stageContext = {
    root,
    argv,
    rawArgv,
    policy,
    modes,
    options,
    abortSignal,
    log,
    overallProgressOptions,
    overallProgressRef,
    recordIndexMetric,
    sqliteLogger,
    explicitStage,
    twoStageEnabled
  };

  if (explicitStage === 'stage3') {
    return runEmbeddingsStage({
      root,
      argv,
      embedModes,
      embeddingRuntime,
      includeEmbeddings,
      overallProgressRef,
      log,
      abortSignal,
      repoCacheRoot,
      runtimeEnv,
      recordIndexMetric,
      buildEmbeddingsPath
    });
  }
  if (explicitStage === 'stage4') {
    return runSqliteStage({
      root,
      argv,
      rawArgv,
      userConfig,
      envelope,
      sqliteModes,
      shouldBuildSqlite,
      includeSqlite,
      overallProgressRef,
      log,
      abortSignal,
      repoCacheRoot,
      recordIndexMetric,
      options,
      sqliteLogger
    });
  }

  if (explicitStage) {
    const allowSqlite = explicitStage !== 'stage1' && explicitStage !== 'stage2';
    return runStage(explicitStage, stageContext, { allowSqlite });
  }

  if (!twoStageEnabled) {
    const stage2Result = await runStage('stage2', stageContext, { allowSqlite: false });
    const stage3Result = await runEmbeddingsStage({
      root,
      argv,
      embedModes,
      embeddingRuntime,
      includeEmbeddings,
      overallProgressRef,
      log,
      abortSignal,
      repoCacheRoot,
      runtimeEnv,
      recordIndexMetric,
      buildEmbeddingsPath
    });
    if (stage3Result?.embeddings?.cancelled) {
      return { modes, stage2: stage2Result, stage3: stage3Result, repo: root };
    }
    const stage4Result = await runSqliteStage({
      root,
      argv,
      rawArgv,
      userConfig,
      envelope,
      sqliteModes,
      shouldBuildSqlite,
      includeSqlite,
      overallProgressRef,
      log,
      abortSignal,
      repoCacheRoot,
      recordIndexMetric,
      options,
      sqliteLogger
    });
    if (overallProgressRef.current?.finish) {
      overallProgressRef.current.finish();
    }
    return { modes, stage2: stage2Result, stage3: stage3Result, stage4: stage4Result, repo: root };
  }

  const stage1Result = await runStage('stage1', stageContext, { allowSqlite: false });
  if (twoStageConfig.background === true) {
    const stage2Args = buildStage2Args({ root, argv, rawArgv });
    const queueEnabled = twoStageConfig.queue !== false;
    if (queueEnabled) {
      const queueDir = userConfig?.indexing?.embeddings?.queue?.dir
        ? path.resolve(userConfig.indexing.embeddings.queue.dir)
        : path.join(getCacheRoot(), 'service', 'queue');
      const maxQueuedRaw = Number(userConfig?.indexing?.embeddings?.queue?.maxQueued);
      const maxQueued = Number.isFinite(maxQueuedRaw) ? Math.max(0, Math.floor(maxQueuedRaw)) : null;
      const jobId = crypto.randomUUID();
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
    void spawnSubprocess(process.execPath, stage2ArgsWithScript, {
      stdio: 'ignore',
      env: runtimeEnv,
      detached: true,
      unref: true,
      rejectOnNonZeroExit: false,
      captureStdout: false,
      captureStderr: false
    }).catch((err) => {
      log(`[stage2] background spawn failed: ${err?.message || err}`);
    });
    return { modes, stage1: stage1Result, stage2: { background: true }, repo: root };
  }

  const stage2Result = await runStage('stage2', stageContext, { allowSqlite: true });
  return { modes, stage1: stage1Result, stage2: stage2Result, repo: root };
}

export { buildSqliteIndex };
