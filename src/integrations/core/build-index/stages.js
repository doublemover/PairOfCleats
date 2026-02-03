import crypto from 'node:crypto';
import path from 'node:path';
import { acquireIndexLock } from '../../../index/build/lock.js';
import { preprocessFiles, writePreprocessStats } from '../../../index/build/preprocess.js';
import { buildIndexForMode } from '../../../index/build/indexer.js';
import { SIGNATURE_VERSION } from '../../../index/build/indexer/signatures.js';
import { createBuildRuntime } from '../../../index/build/runtime.js';
import { initBuildState, markBuildPhase, startBuildHeartbeat, updateBuildState } from '../../../index/build/build-state.js';
import { promoteBuild } from '../../../index/build/promotion.js';
import { validateIndexArtifacts } from '../../../index/validate.js';
import { logError as defaultLogError, logLine, showProgress } from '../../../shared/progress.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { isTestingEnv } from '../../../shared/env.js';
import { createFeatureMetrics, writeFeatureMetrics } from '../../../index/build/feature-metrics.js';
import {
  getCacheRoot,
  getIndexDir,
  getMetricsDir,
  getToolVersion
} from '../../../../tools/shared/dict-utils.js';
import { ensureQueueDir, enqueueJob } from '../../../../tools/service/queue.js';
import { buildSqliteIndex } from './sqlite.js';
import { computeCompatibilityKey } from './compatibility.js';
import { createOverallProgress } from './progress.js';
import { teardownRuntime } from './runtime.js';
import { updateEnrichmentState } from '../enrichment-state.js';
import { runEmbeddingsTool } from '../embeddings.js';

export const runEmbeddingsStage = async ({
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
}) => {
  const started = process.hrtime.bigint();
  const fileProgressPattern = /^\[embeddings\]\s+([^:]+):\s+processed\s+(\d+)\/(\d+)\s+files\b/;
  const recordOk = (result) => {
    recordIndexMetric('stage3', 'ok', started);
    return result;
  };
  try {
    throwIfAborted(abortSignal);
    if (!embeddingRuntime.embeddingEnabled) {
      log('Embeddings disabled; skipping stage3.');
      return recordOk({ modes: embedModes, embeddings: { skipped: true }, repo: root, stage: 'stage3' });
    }
    const lock = await acquireIndexLock({ repoCacheRoot, log });
    if (!lock) throw new Error('Index lock unavailable.');
    try {
      throwIfAborted(abortSignal);
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
          throwIfAborted(abortSignal);
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
            if (includeEmbeddings && overallProgressRef?.current?.advance) {
              overallProgressRef.current.advance({ message: `${modeItem} embeddings` });
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
          if (includeEmbeddings && overallProgressRef?.current?.advance) {
            overallProgressRef.current.advance({ message: `${modeItem} embeddings` });
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
        throwIfAborted(abortSignal);
        const args = [buildEmbeddingsPath, '--repo', root, '--mode', modeItem];
        if (Number.isFinite(Number(argv.dims))) {
          args.push('--dims', String(argv.dims));
        }
        if (embeddingRuntime.useStubEmbeddings) args.push('--stub-embeddings');
        args.push('--progress', 'off');
        const embedResult = await runEmbeddingsTool(args, {
          baseEnv: runtimeEnv,
          signal: abortSignal,
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
        if (includeEmbeddings && overallProgressRef?.current?.advance) {
          overallProgressRef.current.advance({ message: `${modeItem} embeddings` });
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
    } finally {
      await lock.release();
    }
  } catch (err) {
    if (isAbortError(err)) {
      recordIndexMetric('stage3', 'aborted', started);
      throw err;
    }
    recordIndexMetric('stage3', 'error', started);
    throw err;
  }
};

export const runSqliteStage = async ({
  root,
  argv,
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
}) => {
  const started = process.hrtime.bigint();
  const recordOk = (result) => {
    recordIndexMetric('stage4', 'ok', started);
    return result;
  };
  try {
    throwIfAborted(abortSignal);
    if (!shouldBuildSqlite) {
      log('SQLite disabled; skipping stage4.');
      return recordOk({ modes: sqliteModes, sqlite: { skipped: true }, repo: root, stage: 'stage4' });
    }
    const lock = await acquireIndexLock({ repoCacheRoot, log });
    if (!lock) throw new Error('Index lock unavailable.');
    try {
      throwIfAborted(abortSignal);
      if (!sqliteModes.length) return recordOk({ modes: sqliteModes, sqlite: null, repo: root, stage: 'stage4' });
      let sqliteResult = null;
      const sqliteModeList = sqliteModes.length === 4 ? ['all'] : sqliteModes;
      for (const mode of sqliteModeList) {
        throwIfAborted(abortSignal);
        sqliteResult = await buildSqliteIndex(root, {
          mode,
          incremental: argv.incremental === true,
          emitOutput: options.emitOutput !== false,
          exitOnError: false,
          logger: sqliteLogger
        });
      }
      if (includeSqlite && overallProgressRef?.current?.advance) {
        for (const modeItem of sqliteModes) {
          overallProgressRef.current.advance({ message: `${modeItem} sqlite` });
        }
      }
      return recordOk({ modes: sqliteModes, sqlite: sqliteResult, repo: root, stage: 'stage4' });
    } finally {
      await lock.release();
    }
  } catch (err) {
    if (isAbortError(err)) {
      recordIndexMetric('stage4', 'aborted', started);
      throw err;
    }
    recordIndexMetric('stage4', 'error', started);
    throw err;
  }
};

export const runStage = async (stage, context, { allowSqlite = true } = {}) => {
  const {
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
  } = context;
  const started = process.hrtime.bigint();
  const stageArgv = stage ? { ...argv, stage } : argv;
  let phaseStage = stage || 'stage2';
  let runtime = null;
  let result = null;
  try {
    throwIfAborted(abortSignal);
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
      if (!overallProgressRef.current) {
        overallProgressRef.current = createOverallProgress({
          modes,
          buildId: runtime.buildId,
          ...overallProgressOptions
        });
      }
      runtime.overallProgress = overallProgressRef.current;
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
      throwIfAborted(abortSignal);
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
        throwIfAborted(abortSignal);
        const preprocess = await preprocessFiles({
          root: runtime.root,
          modes: preprocessModes,
          recordsDir: runtime.recordsDir,
          recordsConfig: runtime.recordsConfig,
          scmProvider: runtime.scmProvider,
          scmProviderImpl: runtime.scmProviderImpl,
          scmRepoRoot: runtime.scmRepoRoot,
          ignoreMatcher: runtime.ignoreMatcher,
          maxFileBytes: runtime.maxFileBytes,
          fileCaps: runtime.fileCaps,
          maxDepth: runtime.guardrails?.maxDepth ?? null,
          maxFiles: runtime.guardrails?.maxFiles ?? null,
          fileScan: runtime.fileScan,
          lineCounts: true,
          concurrency: runtime.ioConcurrency,
          log,
          abortSignal
        });
        throwIfAborted(abortSignal);
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
        throwIfAborted(abortSignal);
        const discovery = sharedDiscovery ? sharedDiscovery[modeItem] : null;
        await buildIndexForMode({ mode: modeItem, runtime, discovery, abortSignal });
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
        throwIfAborted(abortSignal);
        const codeDir = getIndexDir(root, 'code', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const proseDir = getIndexDir(root, 'prose', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const extractedProseDir = getIndexDir(root, 'extracted-prose', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const recordsDir = getIndexDir(root, 'records', runtime.userConfig, { indexRoot: runtime.buildRoot });
        const sqliteOut = path.join(runtime.buildRoot, 'index-sqlite');
        const sqliteModeList = sqliteModes.length === 4 ? ['all'] : sqliteModes;
        for (const mode of sqliteModeList) {
          throwIfAborted(abortSignal);
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
      throwIfAborted(abortSignal);
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
        if (isTestingEnv()) {
          if (validation.issues?.length) {
            defaultLogError('Index validation issues (first 10):');
            validation.issues.slice(0, 10).forEach((issue) => {
              defaultLogError(`- ${issue}`);
            });
          }
          if (validation.warnings?.length) {
            defaultLogError('Index validation warnings (first 10):');
            validation.warnings.slice(0, 10).forEach((warning) => {
              defaultLogError(`- ${warning}`);
            });
          }
        }
        throw new Error('Index validation failed; see index-validate output for details.');
      }
      await markBuildPhase(runtime.buildRoot, 'validation', 'done');
      await markBuildPhase(runtime.buildRoot, 'promote', 'running');
      throwIfAborted(abortSignal);
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
    if (isAbortError(err)) {
      recordIndexMetric(phaseStage, 'aborted', started);
      throw err;
    }
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
