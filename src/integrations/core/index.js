import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseBuildArgs } from '../../index/build/args.js';
import { buildIndexForMode } from '../../index/build/indexer.js';
import { buildTokenizationKey } from '../../index/build/indexer/signatures.js';
import { acquireIndexLock } from '../../index/build/lock.js';
import { preprocessFiles, writePreprocessStats } from '../../index/build/preprocess.js';
import { createBuildRuntime } from '../../index/build/runtime.js';
import { initBuildState, markBuildPhase, startBuildHeartbeat, updateBuildState } from '../../index/build/build-state.js';
import { SIGNATURE_VERSION } from '../../index/build/indexer/signatures.js';
import { promoteBuild } from '../../index/build/promotion.js';
import { validateIndexArtifacts } from '../../index/validate.js';
import { buildCompatibilityKey } from '../../contracts/compatibility.js';
import { watchIndex } from '../../index/build/watch.js';
import { log as defaultLog, logError as defaultLogError, logLine, showProgress } from '../../shared/progress.js';
import { observeIndexDuration } from '../../shared/metrics.js';
import { shutdownPythonAstPool } from '../../lang/python.js';
import { createFeatureMetrics, writeFeatureMetrics } from '../../index/build/feature-metrics.js';
import { applyAdaptiveDictConfig, getCacheRoot, getMetricsDir, getRepoCacheRoot, getRepoRoot, getToolVersion, getIndexDir, loadUserConfig, resolveToolRoot } from '../../../tools/dict-utils.js';
import { ensureQueueDir, enqueueJob } from '../../../tools/service/queue.js';
import { runBuildSqliteIndex } from '../../../tools/build-sqlite-index.js';
import { shutdownTreeSitterWorkerPool } from '../../lang/tree-sitter.js';
import { runSearchCli } from '../../retrieval/cli.js';
import { getStatus } from './status.js';
import { buildAutoPolicy } from '../../shared/auto-policy.js';
import { buildRawArgs, buildSearchArgs, buildStage2Args, normalizeStage } from './args.js';
import { updateEnrichmentState } from './enrichment-state.js';

const toolRoot = resolveToolRoot();
const buildEmbeddingsPath = path.join(toolRoot, 'tools', 'build-embeddings.js');

const createOverallProgress = ({ modes, buildId, includeEmbeddings = false, includeSqlite = false }) => {
  const stageCounts = {
    code: 6,
    prose: 6,
    'extracted-prose': 6,
    records: 1
  };
  const extraStages = (includeEmbeddings ? 1 : 0) + (includeSqlite ? 1 : 0);
  const total = modes.reduce((sum, mode) => {
    const base = stageCounts[mode] || 0;
    if (!base) return sum;
    return sum + base + extraStages;
  }, 0);
  if (!total) return null;
  const taskId = `overall:${buildId || 'build'}`;
  let current = 0;
  showProgress('Overall', current, total, { taskId, stage: 'overall' });
  return {
    total,
    advance(meta = {}) {
      if (current >= total) return;
      current += 1;
      showProgress('Overall', current, total, {
        taskId,
        stage: 'overall',
        message: meta.message || null
      });
    },
    finish(meta = {}) {
      current = total;
      showProgress('Overall', current, total, {
        taskId,
        stage: 'overall',
        message: meta.message || null
      });
    }
  };
};

const computeCompatibilityKey = ({ runtime, modes, sharedDiscovery }) => {
  const tokenizationKeys = {};
  const baseDictConfig = runtime.dictConfig || {};
  for (const modeItem of modes) {
    const entryCount = sharedDiscovery?.[modeItem]?.entries?.length ?? 0;
    const adaptedDictConfig = applyAdaptiveDictConfig(baseDictConfig, entryCount);
    const runtimeSnapshot = { ...runtime, dictConfig: adaptedDictConfig };
    tokenizationKeys[modeItem] = buildTokenizationKey(runtimeSnapshot, modeItem);
  }
  runtime.tokenizationKeys = tokenizationKeys;
  runtime.compatibilityKey = buildCompatibilityKey({ runtime, modes, tokenizationKeys });
  return tokenizationKeys;
};

const resolveEmbeddingRuntime = ({ argv, userConfig, policy }) => {
  const embeddingsConfig = userConfig?.indexing?.embeddings || {};
  const embeddingModeRaw = typeof embeddingsConfig.mode === 'string'
    ? embeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const baseStubEmbeddings = argv['stub-embeddings'] === true;
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
    ? embeddingModeRaw
    : 'auto';
  const resolvedEmbeddingMode = normalizedEmbeddingMode === 'auto'
    ? (baseStubEmbeddings ? 'stub' : 'inline')
    : normalizedEmbeddingMode;
  const policyEmbeddings = policy?.indexing?.embeddings?.enabled;
  const configEnabled = embeddingsConfig.enabled !== false;
  const embeddingEnabled = (policyEmbeddings ?? configEnabled)
    && resolvedEmbeddingMode !== 'off';
  const embeddingService = embeddingEnabled
    && resolvedEmbeddingMode === 'service';
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
  await shutdownTreeSitterWorkerPool();
  shutdownPythonAstPool();
};

const EMBEDDINGS_CANCEL_CODE = 0xC000013A;

const pipeOutputLines = (stream, onLine) => {
  if (!stream || !onLine) return () => {};
  let buffer = '';
  const flushLine = (line) => {
    const trimmed = line.trimEnd();
    if (trimmed) onLine(trimmed);
  };
  const onData = (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const line of parts) flushLine(line);
  };
  const onEnd = () => {
    if (buffer) flushLine(buffer);
    buffer = '';
  };
  stream.on('data', onData);
  stream.on('end', onEnd);
  return () => {
    stream.off('data', onData);
    stream.off('end', onEnd);
    if (buffer) flushLine(buffer);
  };
};

const runEmbeddingsTool = (args, extraEnv = null, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env
  });
  const onLine = typeof options.onLine === 'function' ? options.onLine : null;
  const detachStdout = pipeOutputLines(child.stdout, onLine);
  const detachStderr = pipeOutputLines(child.stderr, onLine);
  child.on('error', (err) => {
    detachStdout();
    detachStderr();
    reject(err);
  });
  child.on('close', (code, signal) => {
    detachStdout();
    detachStderr();
    if (code === 0) {
      resolve({ ok: true });
      return;
    }
    if (signal || code === EMBEDDINGS_CANCEL_CODE) {
      resolve({ cancelled: true, code: code ?? null, signal: signal || null });
      return;
    }
    reject(new Error(`build-embeddings exited with code ${code ?? 'unknown'}`));
  });
});

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
  const sqliteLogger = { log, warn, error: logError };
  const metricsMode = mode || 'all';
  const recordIndexMetric = (stage, status, start) => {
    try {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
      observeIndexDuration({ stage, mode: metricsMode, status, seconds: elapsed });
    } catch {}
  };

  const userConfig = loadUserConfig(root);
  const qualityOverride = typeof argv.quality === 'string' ? argv.quality.trim().toLowerCase() : '';
  const policyConfig = qualityOverride ? { ...userConfig, quality: qualityOverride } : userConfig;
  const policy = await buildAutoPolicy({ repoRoot: root, config: policyConfig });

  if (argv.watch) {
    const runtime = await createBuildRuntime({ root, argv, rawArgv, policy });
    computeCompatibilityKey({ runtime, modes, sharedDiscovery: null });
    const pollMs = Number.isFinite(Number(argv['watch-poll'])) ? Number(argv['watch-poll']) : 2000;
    const debounceMs = Number.isFinite(Number(argv['watch-debounce'])) ? Number(argv['watch-debounce']) : 500;
    try {
      await watchIndex({ runtime, modes, pollMs, debounceMs });
      return { modes, watch: true };
    } finally {
      await teardownRuntime(runtime);
    }
  }

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
  let overallProgress = null;
  const runEmbeddingsStage = async () => {
    const started = process.hrtime.bigint();
    const fileProgressPattern = /^\[embeddings\]\s+([^:]+):\s+processed\s+(\d+)\/(\d+)\s+files\b/;
    const recordOk = (result) => {
      recordIndexMetric('stage3', 'ok', started);
      return result;
    };
    if (!embeddingRuntime.embeddingEnabled) {
      log('Embeddings disabled; skipping stage3.');
      return recordOk({ modes: embedModes, embeddings: { skipped: true }, repo: root, stage: 'stage3' });
    }
    const lock = await acquireIndexLock({ repoCacheRoot, log });
    if (!lock) throw new Error('Index lock unavailable.');
    try {
      const embedTotal = embedModes.length;
      let embedIndex = 0;
      if (embedTotal) {
        showProgress('Embeddings', embedIndex, embedTotal, { stage: 'embeddings' });
      }
      if (embeddingRuntime.embeddingService) {
        const queueDir = embeddingRuntime.queueDir
          ? path.resolve(embeddingRuntime.queueDir)
          : path.join(getCacheRoot(), 'service', 'queue');
        await ensureQueueDir(queueDir);
        const jobs = [];
        for (const modeItem of embedModes) {
          const jobId = crypto.randomUUID();
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
            if (includeEmbeddings && overallProgress?.advance) {
              overallProgress.advance({ message: `${modeItem} embeddings` });
            }
            if (embedTotal) {
              embedIndex += 1;
              showProgress('Embeddings', embedIndex, embedTotal, {
                stage: 'embeddings',
                message: modeItem
              });
            }
            continue;
          }
          log(`[embeddings] Queued embedding job ${jobId} (${modeItem}).`);
          jobs.push(result.job || { id: jobId, mode: modeItem });
          if (includeEmbeddings && overallProgress?.advance) {
            overallProgress.advance({ message: `${modeItem} embeddings` });
          }
          if (embedTotal) {
            embedIndex += 1;
            showProgress('Embeddings', embedIndex, embedTotal, {
              stage: 'embeddings',
              message: modeItem
            });
          }
        }
        return recordOk({ modes: embedModes, embeddings: { queued: true, jobs }, repo: root, stage: 'stage3' });
      }
      for (const modeItem of embedModes) {
        const args = [buildEmbeddingsPath, '--repo', root, '--mode', modeItem];
        if (Number.isFinite(Number(argv.dims))) {
          args.push('--dims', String(argv.dims));
        }
        if (embeddingRuntime.useStubEmbeddings) args.push('--stub-embeddings');
        args.push('--progress', 'off');
        const embedResult = await runEmbeddingsTool(args, null, {
          onLine: (line) => {
            if (line.includes('lance::dataset::write::insert')
              || line.includes('No existing dataset at')) {
              return;
            }
            const match = fileProgressPattern.exec(line);
            if (match) {
              const mode = match[1];
              const current = Number(match[2]);
              const total = Number(match[3]);
              if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
                showProgress('Files', current, total, {
                  stage: 'embeddings',
                  mode,
                  taskId: `embeddings:${mode}:files`,
                  ephemeral: true
                });
              }
              logLine(line, { kind: 'status' });
              return;
            }
            if (line.startsWith('[embeddings]') || line.includes('embeddings]')) {
              logLine(line, { kind: 'status' });
              return;
            }
            logLine(line);
          }
        });
        if (embedResult?.cancelled) {
          log('[embeddings] build-embeddings cancelled; skipping remaining modes.');
          return recordOk({
            modes: embedModes,
            embeddings: {
              queued: false,
              inline: true,
              cancelled: true,
              code: embedResult.code ?? null,
              signal: embedResult.signal ?? null
            },
            repo: root,
            stage: 'stage3'
          });
        }
        if (includeEmbeddings && overallProgress?.advance) {
          overallProgress.advance({ message: `${modeItem} embeddings` });
        }
        if (embedTotal) {
          embedIndex += 1;
          showProgress('Embeddings', embedIndex, embedTotal, {
            stage: 'embeddings',
            message: modeItem
          });
        }
      }
      return recordOk({ modes: embedModes, embeddings: { queued: false, inline: true }, repo: root, stage: 'stage3' });
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
    if (!shouldBuildSqlite) {
      log('SQLite disabled; skipping stage4.');
      return recordOk({ modes: sqliteModes, sqlite: { skipped: true }, repo: root, stage: 'stage4' });
    }
    const lock = await acquireIndexLock({ repoCacheRoot, log });
    if (!lock) throw new Error('Index lock unavailable.');
    try {
      if (!sqliteModes.length) return recordOk({ modes: sqliteModes, sqlite: null, repo: root, stage: 'stage4' });
      let sqliteResult = null;
      const sqliteModeList = sqliteModes.length === 4 ? ['all'] : sqliteModes;
      for (const mode of sqliteModeList) {
        sqliteResult = await buildSqliteIndex(root, {
          mode,
          incremental: argv.incremental === true,
          emitOutput: options.emitOutput !== false,
          exitOnError: false,
          logger: sqliteLogger
        });
      }
      if (includeSqlite && overallProgress?.advance) {
        for (const modeItem of sqliteModes) {
          overallProgress.advance({ message: `${modeItem} sqlite` });
        }
      }
      return recordOk({ modes: sqliteModes, sqlite: sqliteResult, repo: root, stage: 'stage4' });
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
      runtime = await createBuildRuntime({ root, argv: stageArgv, rawArgv, policy });
      phaseStage = runtime.stage || phaseStage;
      runtime.featureMetrics = createFeatureMetrics({
        buildId: runtime.buildId,
        configHash: runtime.configHash,
        stage: phaseStage,
        repoRoot: runtime.root,
        toolVersion: getToolVersion()
      });
      if (overallProgressOptions) {
        if (!overallProgress) {
          overallProgress = createOverallProgress({
            modes,
            buildId: runtime.buildId,
            ...overallProgressOptions
          });
        }
        runtime.overallProgress = overallProgress;
      } else {
        runtime.overallProgress = null;
      }
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
        repoProvenance: runtime.repoProvenance,
        signatureVersion: SIGNATURE_VERSION
      });
      if (runtime?.ignoreFiles?.length || runtime?.ignoreWarnings?.length) {
        await updateBuildState(runtime.buildRoot, {
          ignore: {
            files: runtime.ignoreFiles || [],
            warnings: runtime.ignoreWarnings?.length ? runtime.ignoreWarnings : null
          }
        });
      }
      await markBuildPhase(runtime.buildRoot, 'discovery', 'running');
      let sharedDiscovery = null;
      const preprocessModes = modes.filter((modeItem) => (
        modeItem === 'code'
        || modeItem === 'prose'
        || modeItem === 'extracted-prose'
        || modeItem === 'records'
      ));
      if (preprocessModes.length) {
        await markBuildPhase(runtime.buildRoot, 'preprocessing', 'running');
        const preprocess = await preprocessFiles({
          root: runtime.root,
          modes: preprocessModes,
          recordsDir: runtime.recordsDir,
          recordsConfig: runtime.recordsConfig,
          ignoreMatcher: runtime.ignoreMatcher,
          maxFileBytes: runtime.maxFileBytes,
          fileCaps: runtime.fileCaps,
          maxDepth: runtime.guardrails?.maxDepth ?? null,
          maxFiles: runtime.guardrails?.maxFiles ?? null,
          fileScan: runtime.fileScan,
          lineCounts: true,
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
      computeCompatibilityKey({ runtime, modes, sharedDiscovery });
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
      const sqliteModes = modes.filter((modeItem) => (
        modeItem === 'code' || modeItem === 'prose' || modeItem === 'extracted-prose' || modeItem === 'records'
      ));
      const shouldBuildSqlite = allowSqlite
        && (typeof stageArgv.sqlite === 'boolean' ? stageArgv.sqlite : sqliteConfigured);
      const sqliteEnabledForValidation = shouldBuildSqlite && sqliteModes.length > 0;
      if (shouldBuildSqlite && sqliteModes.length) {
        const codeDir = getIndexDir(root, 'code', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const proseDir = getIndexDir(root, 'prose', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const extractedProseDir = getIndexDir(root, 'extracted-prose', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const recordsDir = getIndexDir(root, 'records', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const sqliteOut = path.join(runtime.buildRoot, 'index-sqlite');
        const sqliteModeList = sqliteModes.length === 4 ? ['all'] : sqliteModes;
        for (const mode of sqliteModeList) {
          sqliteResult = await buildSqliteIndex(root, {
            mode,
            incremental: stageArgv.incremental === true,
            out: sqliteOut,
            codeDir,
            proseDir,
            extractedProseDir,
            recordsDir,
            emitOutput: options.emitOutput !== false,
            exitOnError: false,
            logger: sqliteLogger
          });
        }
      }
      await markBuildPhase(runtime.buildRoot, 'validation', 'running');
      const validation = await validateIndexArtifacts({
        root: runtime.root,
        indexRoot: runtime.buildRoot,
        modes,
        userConfig: runtime.userConfig,
        sqliteEnabled: sqliteEnabledForValidation
      });
      const validationSummary = {
        ok: validation.ok,
        issueCount: validation.issues.length,
        warningCount: validation.warnings.length,
        issues: validation.ok ? null : validation.issues.slice(0, 10)
      };
      await updateBuildState(runtime.buildRoot, {
        validation: validationSummary
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

    if (twoStageEnabled || explicitStage) {
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

  if (explicitStage) {
    return runStage(explicitStage, { allowSqlite: true });
  }

  if (!twoStageEnabled) {
    const stage2Result = await runStage('stage2', { allowSqlite: false });
    const stage3Result = await runEmbeddingsStage();
    if (stage3Result?.embeddings?.cancelled) {
      return { modes, stage2: stage2Result, stage3: stage3Result, repo: root };
    }
    const stage4Result = await runSqliteStage();
    if (overallProgress?.finish) {
      overallProgress.finish();
    }
    return { modes, stage2: stage2Result, stage3: stage3Result, stage4: stage4Result, repo: root };
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
  const root = getRepoRoot(repoRoot);
  const rawArgs = Array.isArray(options.args) ? options.args.slice() : [];
  if (!options.args) {
    if (options.mode) rawArgs.push('--mode', String(options.mode));
    if (options.incremental) rawArgs.push('--incremental');
    if (options.compact) rawArgs.push('--compact');
    if (options.out) rawArgs.push('--out', String(options.out));
    if (options.codeDir) rawArgs.push('--code-dir', String(options.codeDir));
    if (options.proseDir) rawArgs.push('--prose-dir', String(options.proseDir));
    if (options.extractedProseDir) rawArgs.push('--extracted-prose-dir', String(options.extractedProseDir));
    if (options.recordsDir) rawArgs.push('--records-dir', String(options.recordsDir));
  }
  return runBuildSqliteIndex(rawArgs, {
    root,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true,
    logger: options.logger || null
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
    sqliteCache: params.sqliteCache,
    signal: params.signal || null,
    scoreMode: params.scoreMode ?? null
  });
}

/**
 * Report artifact status for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function status(repoRoot, options = {}) {
  const root = getRepoRoot(repoRoot);
  return getStatus({ repoRoot: root, includeAll: options.all === true });
}
