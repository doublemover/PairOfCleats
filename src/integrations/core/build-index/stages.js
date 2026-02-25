import crypto from 'node:crypto';
import path from 'node:path';
import { acquireIndexLock } from '../../../index/build/lock.js';
import { preprocessFiles, writePreprocessStats } from '../../../index/build/preprocess.js';
import { buildIndexForMode } from '../../../index/build/indexer.js';
import { SIGNATURE_VERSION } from '../../../index/build/indexer/signatures.js';
import { createBuildRuntime } from '../../../index/build/runtime.js';
import {
  flushBuildState,
  initBuildState,
  markBuildPhase,
  startBuildHeartbeat,
  updateBuildState
} from '../../../index/build/build-state.js';
import { promoteBuild } from '../../../index/build/promotion.js';
import { validateIndexArtifacts } from '../../../index/validate.js';
import { logError as defaultLogError, logLine, showProgress } from '../../../shared/progress.js';
import { coerceAbortSignal, isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { getEnvConfig, isTestingEnv } from '../../../shared/env.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../index/build/runtime/scheduler.js';
import { createFeatureMetrics, writeFeatureMetrics } from '../../../index/build/feature-metrics.js';
import { runBuildCleanupWithTimeout } from '../../../index/build/cleanup-timeout.js';
import {
  getCacheRoot,
  getCurrentBuildInfo,
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
import { PRIMARY_INDEX_MODES, areAllPrimaryModesRequested, filterPrimaryIndexModes } from './stages/modes.js';
import { markFailedPhases, parseNonNegativeInt, toPhaseFailureDetail } from './stages/phase-failures.js';
import { createSqliteDirResolver, resolveSqliteModeList } from './stages/sqlite-paths.js';

const DEFAULT_BUILD_INDEX_LOCK_WAIT_MS = 15000;
const DEFAULT_BUILD_INDEX_LOCK_POLL_MS = 250;
const ENV_CONFIG = getEnvConfig();

const BUILD_INDEX_LOCK_WAIT_MS = parseNonNegativeInt(
  ENV_CONFIG.buildIndexLockWaitMs,
  DEFAULT_BUILD_INDEX_LOCK_WAIT_MS
);
const BUILD_INDEX_LOCK_POLL_MS = Math.max(
  1,
  parseNonNegativeInt(
    ENV_CONFIG.buildIndexLockPollMs,
    DEFAULT_BUILD_INDEX_LOCK_POLL_MS
  )
);

/**
 * Acquire the build/index global lock using environment-configured wait/poll.
 *
 * Throws when the lock cannot be obtained within configured wait time so
 * callers can fail fast before mutating current build pointers.
 *
 * @param {{repoCacheRoot:string,log:(line:string)=>void}} input
 * @returns {Promise<{release:()=>Promise<void>}>}
 */
const acquireBuildIndexLock = async ({ repoCacheRoot, log }) => {
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: BUILD_INDEX_LOCK_WAIT_MS,
    pollMs: BUILD_INDEX_LOCK_POLL_MS,
    log
  });
  if (lock) return lock;
  if (BUILD_INDEX_LOCK_WAIT_MS > 0) {
    log(`[build] Index lock unavailable after waiting ${BUILD_INDEX_LOCK_WAIT_MS}ms.`);
  }
  throw new Error('Index lock unavailable.');
};

/**
 * Execute embeddings stage (inline or queued service mode) for requested modes.
 *
 * Handles build lock acquisition, mode batching rules, progress updates, and
 * cancellation reporting in a deterministic stage3 result shape.
 *
 * Behavior notes:
 * 1. Service mode enqueues jobs and never runs embeddings inline.
 * 2. Inline mode batches to `--mode all` only when all primary modes share
 *    the same resolved index root.
 * 3. Cancellation returns a non-throwing `cancelled` payload and skips
 *    remaining modes.
 *
 * @param {object} input
 * @param {string} input.root
 * @param {object} input.argv
 * @param {string[]} input.embedModes
 * @param {object} input.embeddingRuntime
 * @param {object|null} input.userConfig
 * @param {string|null} input.indexRoot
 * @param {boolean} input.includeEmbeddings
 * @param {{current?:{advance?:(state:object)=>void}}} input.overallProgressRef
 * @param {(line:string)=>void} input.log
 * @param {AbortSignal|null} input.abortSignal
 * @param {string} input.repoCacheRoot
 * @param {NodeJS.ProcessEnv} input.runtimeEnv
 * @param {(stage:string,status:'ok'|'error'|'aborted',started:bigint)=>void} input.recordIndexMetric
 * @param {string} input.buildEmbeddingsPath
 * @returns {Promise<object>}
 */
export const runEmbeddingsStage = async ({
  root,
  argv,
  embedModes,
  embeddingRuntime,
  userConfig,
  indexRoot,
  includeEmbeddings,
  overallProgressRef,
  log,
  abortSignal,
  repoCacheRoot,
  runtimeEnv,
  recordIndexMetric,
  buildEmbeddingsPath
}) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  const started = process.hrtime.bigint();
  const fileProgressPattern = /^\[embeddings\]\s+([^:]+):\s+processed\s+(\d+)\/(\d+)\s+files\b/;
  const recordOk = (result) => {
    recordIndexMetric('stage3', 'ok', started);
    return result;
  };
  try {
    throwIfAborted(effectiveAbortSignal);
    if (!embeddingRuntime.embeddingEnabled) {
      log('Embeddings disabled; skipping stage3.');
      return recordOk({ modes: embedModes, embeddings: { skipped: true }, repo: root, stage: 'stage3' });
    }
    const explicitIndexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : null;
    const providedIndexRoot = indexRoot ? path.resolve(indexRoot) : null;
    const buildInfo = explicitIndexRoot
      ? null
      : getCurrentBuildInfo(root, userConfig, { mode: embedModes[0] || null });
    const baseIndexRoot = explicitIndexRoot || providedIndexRoot || null;
    const modeIndexRootCache = new Map();
    const resolveModeIndexRoot = (mode) => {
      if (modeIndexRootCache.has(mode)) {
        return modeIndexRootCache.get(mode);
      }
      const resolved = baseIndexRoot
        || (mode ? buildInfo?.buildRoots?.[mode] : null)
        || buildInfo?.buildRoot
        || null;
      modeIndexRootCache.set(mode, resolved);
      return resolved;
    };
    const lock = await acquireBuildIndexLock({ repoCacheRoot, log });
    try {
      throwIfAborted(effectiveAbortSignal);
      const embedTotal = embedModes.length;
      let embedIndex = 0;
      const advanceEmbeddingsProgress = (modeName) => {
        if (includeEmbeddings && overallProgressRef?.current?.advance) {
          overallProgressRef.current.advance({ message: `${modeName} embeddings` });
        }
        if (!embedTotal) return;
        embedIndex += 1;
        showProgress('Embeddings', embedIndex, embedTotal, {
          stage: 'embeddings',
          message: modeName
        });
      };
      if (embedTotal) {
        showProgress('Embeddings', embedIndex, embedTotal, { stage: 'embeddings' });
      }
      const commonEmbeddingArgs = [];
      if (Number.isFinite(Number(argv.dims))) {
        commonEmbeddingArgs.push('--dims', String(argv.dims));
      }
      if (embeddingRuntime.useStubEmbeddings) commonEmbeddingArgs.push('--stub-embeddings');
      commonEmbeddingArgs.push('--progress', 'off');
      if (embeddingRuntime.embeddingService) {
        const queueDir = embeddingRuntime.queueDir
          ? path.resolve(embeddingRuntime.queueDir)
          : path.join(getCacheRoot(), 'service', 'queue');
        await ensureQueueDir(queueDir);
        const jobs = [];
        for (const modeItem of embedModes) {
          throwIfAborted(effectiveAbortSignal);
          const modeIndexRoot = resolveModeIndexRoot(modeItem);
          const modeIndexDir = modeIndexRoot
            ? getIndexDir(root, modeItem, userConfig, { indexRoot: modeIndexRoot })
            : null;
          const jobId = crypto.randomUUID();
          const result = await enqueueJob(
            queueDir,
            {
              id: jobId,
              createdAt: new Date().toISOString(),
              repo: root,
              mode: modeItem,
              buildRoot: modeIndexRoot,
              indexDir: modeIndexDir,
              reason: 'stage3',
              stage: 'stage3'
            },
            embeddingRuntime.queueMaxQueued,
            'embeddings'
          );
          if (!result.ok) {
            log(`[embeddings] Queue full or unavailable; skipped enqueue (${modeItem}).`);
            advanceEmbeddingsProgress(modeItem);
            continue;
          }
          log(`[embeddings] Queued embedding job ${jobId} (${modeItem}).`);
          jobs.push(result.job || { id: jobId, mode: modeItem });
          advanceEmbeddingsProgress(modeItem);
        }
        const queuedAny = jobs.length > 0;
        return recordOk({
          modes: embedModes,
          embeddings: {
            queued: queuedAny,
            inline: false,
            skipped: !queuedAny,
            jobs
          },
          repo: root,
          stage: 'stage3'
        });
      }
      const runInlineEmbeddings = async ({ modeArg, indexRootArg, progressModes }) => {
        const args = [buildEmbeddingsPath, '--repo', root, '--mode', modeArg];
        if (indexRootArg) {
          args.push('--index-root', indexRootArg);
        }
        if (commonEmbeddingArgs.length) {
          args.push(...commonEmbeddingArgs);
        }
        const embedResult = await runEmbeddingsTool(args, {
          baseEnv: runtimeEnv,
          signal: effectiveAbortSignal,
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
        if (embedResult?.cancelled) return embedResult;
        for (const modeName of progressModes) {
          advanceEmbeddingsProgress(modeName);
        }
        return embedResult;
      };

      const allModesRequested = areAllPrimaryModesRequested(embedModes);
      const uniqueIndexRoots = new Set();
      for (const modeItem of embedModes) {
        const modeIndexRoot = resolveModeIndexRoot(modeItem);
        if (typeof modeIndexRoot === 'string' && modeIndexRoot.length > 0) {
          uniqueIndexRoots.add(modeIndexRoot);
        }
      }
      const batchedRoot = uniqueIndexRoots.size === 1
        ? uniqueIndexRoots.values().next().value
        : null;
      const canBatchAllModes = allModesRequested && uniqueIndexRoots.size <= 1;
      const toCancelledInlineResult = (embedResult) => ({
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

      if (canBatchAllModes) {
        throwIfAborted(effectiveAbortSignal);
        const embedResult = await runInlineEmbeddings({
          modeArg: 'all',
          indexRootArg: batchedRoot,
          progressModes: PRIMARY_INDEX_MODES
        });
        if (embedResult?.cancelled) {
          log('[embeddings] build-embeddings cancelled; skipping remaining modes.');
          return recordOk(toCancelledInlineResult(embedResult));
        }
      } else {
        for (const modeItem of embedModes) {
          throwIfAborted(effectiveAbortSignal);
          const modeIndexRoot = resolveModeIndexRoot(modeItem);
          const embedResult = await runInlineEmbeddings({
            modeArg: modeItem,
            indexRootArg: modeIndexRoot,
            progressModes: [modeItem]
          });
          if (embedResult?.cancelled) {
            log('[embeddings] build-embeddings cancelled; skipping remaining modes.');
            return recordOk(toCancelledInlineResult(embedResult));
          }
        }
      }
      return recordOk({ modes: embedModes, embeddings: { queued: false, inline: true }, repo: root, stage: 'stage3' });
    } finally {
      await runBuildCleanupWithTimeout({
        label: 'stage3.lock.release',
        cleanup: () => lock.release(),
        log
      });
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

export const buildStage2ExecutionPlan = (modes = []) => {
  const normalized = Array.isArray(modes) ? modes.filter((mode) => typeof mode === 'string' && mode) : [];
  const hasProsePair = normalized.includes('prose') && normalized.includes('extracted-prose');
  const executionPlan = [];
  let prosePairScheduled = false;
  for (const modeItem of normalized) {
    if (hasProsePair && (modeItem === 'prose' || modeItem === 'extracted-prose')) {
      if (prosePairScheduled) continue;
      executionPlan.push({
        id: 'prose+extracted-prose',
        modes: ['prose', 'extracted-prose'],
        fusedProsePair: true
      });
      prosePairScheduled = true;
      continue;
    }
    executionPlan.push({
      id: modeItem,
      modes: [modeItem],
      fusedProsePair: false
    });
  }
  return executionPlan;
};

/**
 * Execute SQLite materialization stage and optional promotion.
 *
 * Fallback/compat behavior:
 * 1. When explicit `--index-root` is used for stage4, promotion is skipped.
 * 2. Mode list collapses to `all` when all primary modes are requested.
 * 3. Any failure marks active phases as failed before rethrowing.
 *
 * @param {object} input
 * @param {string} input.root
 * @param {object} input.argv
 * @param {string[]} input.rawArgv
 * @param {object} input.policy
 * @param {object|null} input.userConfig
 * @param {string[]} input.sqliteModes
 * @param {boolean} input.shouldBuildSqlite
 * @param {boolean} input.includeSqlite
 * @param {{current?:{advance?:(state:object)=>void}}} input.overallProgressRef
 * @param {(line:string)=>void} input.log
 * @param {AbortSignal|null} input.abortSignal
 * @param {(stage:string,status:'ok'|'error'|'aborted',started:bigint)=>void} input.recordIndexMetric
 * @param {object} input.options
 * @param {object} input.sqliteLogger
 * @returns {Promise<object>}
 */
export const runSqliteStage = async ({
  root,
  argv,
  rawArgv,
  policy,
  userConfig,
  sqliteModes,
  shouldBuildSqlite,
  includeSqlite,
  overallProgressRef,
  log,
  abortSignal,
  recordIndexMetric,
  options,
  sqliteLogger
}) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  const started = process.hrtime.bigint();
  const recordOk = (result) => {
    recordIndexMetric('stage4', 'ok', started);
    return result;
  };
  let runtime = null;
  try {
    throwIfAborted(effectiveAbortSignal);
    if (!shouldBuildSqlite) {
      log('SQLite disabled; skipping stage4.');
      return recordOk({ modes: sqliteModes, sqlite: { skipped: true }, repo: root, stage: 'stage4' });
    }
    if (!sqliteModes.length) return recordOk({ modes: sqliteModes, sqlite: null, repo: root, stage: 'stage4' });
    const explicitIndexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : null;
    const buildInfo = explicitIndexRoot
      ? null
      : getCurrentBuildInfo(root, userConfig, { mode: sqliteModes[0] || null });
    if (!explicitIndexRoot && !buildInfo?.buildRoot) {
      throw new Error('Missing current build for SQLite stage. Run stage2 first or pass --index-root.');
    }
    const runtimeIndexRoot = explicitIndexRoot
      || buildInfo?.buildRoots?.[sqliteModes[0]]
      || buildInfo?.buildRoot
      || null;
    runtime = await createBuildRuntime({
      root,
      argv: { ...argv, stage: 'stage4' },
      rawArgv,
      policy,
      indexRoot: runtimeIndexRoot
    });
    const scheduleSqlite = (fn) => (runtime?.scheduler?.schedule
      ? runtime.scheduler.schedule(
        SCHEDULER_QUEUE_NAMES.stage4Sqlite,
        {
          cpu: 1,
          io: 1,
          signal: effectiveAbortSignal
        },
        fn
      )
      : fn());
    const resolveSqliteDirs = createSqliteDirResolver({ root, userConfig, getIndexDir });
    let lock = null;
    let stage4Running = false;
    let stage4Done = false;
    let promoteRunning = false;
    let promoteDone = false;
    try {
      await markBuildPhase(runtime.buildRoot, 'stage4', 'running');
      stage4Running = true;
      let sqliteResult = null;
      const sqliteModeList = resolveSqliteModeList(sqliteModes);
      for (const mode of sqliteModeList) {
        throwIfAborted(effectiveAbortSignal);
        const indexRoot = explicitIndexRoot
          || buildInfo?.buildRoots?.[mode]
          || buildInfo?.buildRoot
          || runtime?.buildRoot
          || null;
        if (!indexRoot) {
          throw new Error(`Missing index root for SQLite stage (mode=${mode}).`);
        }
        const sqliteDirs = resolveSqliteDirs(indexRoot);
        sqliteResult = await scheduleSqlite(() => buildSqliteIndex(root, {
          mode,
          incremental: argv.incremental === true,
          batchSize: argv['sqlite-batch-size'],
          indexRoot,
          out: sqliteDirs.sqliteOut,
          runtime,
          codeDir: sqliteDirs.codeDir,
          proseDir: sqliteDirs.proseDir,
          extractedProseDir: sqliteDirs.extractedProseDir,
          recordsDir: sqliteDirs.recordsDir,
          emitOutput: options.emitOutput !== false,
          exitOnError: false,
          logger: sqliteLogger
        }));
      }
      await markBuildPhase(runtime.buildRoot, 'stage4', 'done');
      stage4Done = true;
      await updateBuildState(runtime.buildRoot, { stage: 'stage4' });
      const shouldPromote = !(explicitIndexRoot && argv.stage === 'stage4');
      if (shouldPromote) {
        lock = await acquireBuildIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
        await markBuildPhase(runtime.buildRoot, 'promote', 'running');
        promoteRunning = true;
        await promoteBuild({
          repoRoot: runtime.root,
          userConfig: runtime.userConfig,
          buildId: runtime.buildId,
          buildRoot: runtime.buildRoot,
          stage: 'stage4',
          modes: sqliteModes,
          configHash: runtime.configHash,
          repoProvenance: runtime.repoProvenance,
          compatibilityKey: runtime.compatibilityKey || null
        });
        await markBuildPhase(runtime.buildRoot, 'promote', 'done');
        promoteDone = true;
      } else {
        await markBuildPhase(
          runtime.buildRoot,
          'promote',
          'done',
          'skipped promotion for explicit stage4 --index-root'
        );
        log('[build] stage4 ran against explicit --index-root; skipping current.json promotion.');
      }
      if (includeSqlite && overallProgressRef?.current?.advance) {
        for (const modeItem of sqliteModes) {
          overallProgressRef.current.advance({ message: `${modeItem} sqlite` });
        }
      }
      return recordOk({ modes: sqliteModes, sqlite: sqliteResult, repo: root, stage: 'stage4' });
    } catch (err) {
      const phaseFailureDetail = toPhaseFailureDetail(err);
      await markFailedPhases({
        buildRoot: runtime?.buildRoot,
        markPhase: markBuildPhase,
        phaseFailureDetail,
        phases: [
          { name: 'promote', running: promoteRunning, done: promoteDone },
          { name: 'stage4', running: stage4Running, done: stage4Done }
        ]
      });
      throw err;
    } finally {
      if (lock?.release) {
        await runBuildCleanupWithTimeout({
          label: 'stage4.lock.release',
          cleanup: () => lock.release(),
          log
        });
      }
    }
  } catch (err) {
    if (isAbortError(err)) {
      recordIndexMetric('stage4', 'aborted', started);
      throw err;
    }
    recordIndexMetric('stage4', 'error', started);
    throw err;
  } finally {
    if (runtime) {
      await teardownRuntime(runtime);
    }
  }
};

/**
 * Run one build stage (`stage2`/`stage3`/`stage4`) with phase tracking.
 *
 * This is the primary stage orchestrator for discovery, indexing, optional
 * sqlite, validation, and promotion. It always attempts to mark active phases
 * on failure and guarantees runtime teardown in all paths.
 *
 * @param {'stage2'|'stage3'|'stage4'|null} stage
 * @param {object} context
 * @param {string} context.root
 * @param {object} context.argv
 * @param {string[]} context.rawArgv
 * @param {object} context.policy
 * @param {string[]} context.modes
 * @param {object} context.options
 * @param {AbortSignal|null} context.abortSignal
 * @param {(line:string)=>void} context.log
 * @param {object|null} context.overallProgressOptions
 * @param {{current?:object}} context.overallProgressRef
 * @param {(stage:string,status:'ok'|'error'|'aborted',started:bigint)=>void} context.recordIndexMetric
 * @param {object} context.sqliteLogger
 * @param {boolean} context.explicitStage
 * @param {boolean} context.twoStageEnabled
 * @param {{allowSqlite?:boolean,onStage2ModeCompleted?:(input:{mode:string,runtime:object,discovery:object|null})=>Promise<object|null>|object|null}} [options]
 * @returns {Promise<object>}
 */
export const runStage = async (
  stage,
  context,
  { allowSqlite = true, onStage2ModeCompleted = null } = {}
) => {
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
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  const started = process.hrtime.bigint();
  const stageArgv = stage ? { ...argv, stage } : argv;
  let phaseStage = stage || 'stage2';
  let runtime = null;
  let result = null;
  try {
    throwIfAborted(effectiveAbortSignal);
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
    let lock = null;
    let sqliteResult = null;
    let phaseRunning = false;
    let phaseDone = false;
    let phaseCancelled = false;
    let phaseCancelledMode = null;
    let validationRunning = false;
    let validationDone = false;
    let promoteRunning = false;
    let promoteDone = false;
    const stopHeartbeat = (phaseStage === 'stage2' || phaseStage === 'stage3')
      ? startBuildHeartbeat(runtime.buildRoot, phaseStage)
      : () => {};
    try {
      throwIfAborted(effectiveAbortSignal);
      await initBuildState({
        buildRoot: runtime.buildRoot,
        buildId: runtime.buildId,
        repoRoot: runtime.root,
        modes,
        stage: phaseStage,
        configHash: runtime.configHash,
        toolVersion: getToolVersion(),
        repoProvenance: runtime.repoProvenance,
        signatureVersion: SIGNATURE_VERSION,
        profile: runtime.profile || null
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
      const preprocessModes = filterPrimaryIndexModes(modes);
      if (preprocessModes.length) {
        await markBuildPhase(runtime.buildRoot, 'preprocessing', 'running');
        throwIfAborted(effectiveAbortSignal);
        const preprocess = await preprocessFiles({
          root: runtime.root,
          modes: preprocessModes,
          documentExtractionConfig: runtime.indexingConfig?.documentExtraction || null,
          recordsDir: runtime.recordsDir,
          recordsConfig: runtime.recordsConfig,
          scmProvider: runtime.scmProvider,
          scmProviderImpl: runtime.scmProviderImpl,
          scmRepoRoot: runtime.scmRepoRoot,
          ignoreMatcher: runtime.ignoreMatcher,
          generatedPolicy: runtime.generatedPolicy,
          maxFileBytes: runtime.maxFileBytes,
          fileCaps: runtime.fileCaps,
          maxDepth: runtime.guardrails?.maxDepth ?? null,
          maxFiles: runtime.guardrails?.maxFiles ?? null,
          fileScan: runtime.fileScan,
          lineCounts: true,
          concurrency: runtime.ioConcurrency,
          log,
          abortSignal: effectiveAbortSignal
        });
        throwIfAborted(effectiveAbortSignal);
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
      phaseRunning = true;
      const executionPlan = phaseStage === 'stage2'
        ? buildStage2ExecutionPlan(modes)
        : modes.map((modeItem) => ({
          id: modeItem,
          modes: [modeItem],
          fusedProsePair: false
        }));
      executionPlanLoop:
      for (const group of executionPlan) {
        runtime.activeModeGroup = group;
        if (group.fusedProsePair) {
          log('[stage2] fused prose/extracted-prose mode group active.');
        }
        for (const modeItem of group.modes) {
          throwIfAborted(effectiveAbortSignal);
          const discovery = sharedDiscovery ? sharedDiscovery[modeItem] : null;
          await buildIndexForMode({
            mode: modeItem,
            runtime,
            discovery,
            abortSignal: effectiveAbortSignal
          });
          if (phaseStage === 'stage2' && typeof onStage2ModeCompleted === 'function') {
            const callbackResult = await Promise.resolve(onStage2ModeCompleted({
              mode: modeItem,
              runtime,
              discovery
            }));
            if (callbackResult?.cancelled === true) {
              phaseCancelled = true;
              phaseCancelledMode = modeItem;
              break executionPlanLoop;
            }
          }
        }
      }
      runtime.activeModeGroup = null;
      if (runtime.featureMetrics) {
        await writeFeatureMetrics({
          metricsDir: getMetricsDir(runtime.root, runtime.userConfig),
          featureMetrics: runtime.featureMetrics
        });
      }
      if (phaseCancelled) {
        /**
         * Stage2 cancellation is terminal for this run. We intentionally skip
         * validation/promote to avoid publishing a partial build root.
         */
        await markBuildPhase(
          runtime.buildRoot,
          phaseStage,
          'done',
          `cancelled after mode ${phaseCancelledMode || 'unknown'}; validation/promote skipped`
        );
        phaseDone = true;
        result = {
          modes,
          sqlite: null,
          repo: runtime.root,
          stage,
          buildRoot: runtime.buildRoot,
          repoCacheRoot: runtime.repoCacheRoot,
          profile: runtime.profile || null,
          cancelled: true,
          cancelledMode: phaseCancelledMode || null
        };
        return;
      }
      await markBuildPhase(runtime.buildRoot, phaseStage, 'done');
      phaseDone = true;
      const sqliteConfigured = runtime.userConfig?.sqlite?.use !== false;
      const sqliteModes = filterPrimaryIndexModes(modes);
      const shouldBuildSqlite = allowSqlite
        && (typeof stageArgv.sqlite === 'boolean' ? stageArgv.sqlite : sqliteConfigured);
      const sqliteEnabledForValidation = shouldBuildSqlite && sqliteModes.length > 0;
      if (shouldBuildSqlite && sqliteModes.length) {
        throwIfAborted(effectiveAbortSignal);
        const scheduleSqlite = (fn) => (runtime?.scheduler?.schedule
          ? runtime.scheduler.schedule(
            SCHEDULER_QUEUE_NAMES.stage4Sqlite,
            {
              cpu: 1,
              io: 1,
              signal: effectiveAbortSignal
            },
            fn
          )
          : fn());
        const resolveSqliteDirs = createSqliteDirResolver({
          root,
          userConfig: runtime.userConfig,
          getIndexDir
        });
        const sqliteDirs = resolveSqliteDirs(runtime.buildRoot);
        const sqliteModeList = resolveSqliteModeList(sqliteModes);
        for (const mode of sqliteModeList) {
          throwIfAborted(effectiveAbortSignal);
          sqliteResult = await scheduleSqlite(() => buildSqliteIndex(root, {
            mode,
            incremental: stageArgv.incremental === true,
            batchSize: stageArgv['sqlite-batch-size'],
            out: sqliteDirs.sqliteOut,
            indexRoot: runtime.buildRoot,
            runtime,
            codeDir: sqliteDirs.codeDir,
            proseDir: sqliteDirs.proseDir,
            extractedProseDir: sqliteDirs.extractedProseDir,
            recordsDir: sqliteDirs.recordsDir,
            emitOutput: options.emitOutput !== false,
            exitOnError: false,
            logger: sqliteLogger
          }));
        }
      }
      await markBuildPhase(runtime.buildRoot, 'validation', 'running');
      validationRunning = true;
      throwIfAborted(effectiveAbortSignal);
      const validation = await validateIndexArtifacts({
        root: runtime.root,
        indexRoot: runtime.buildRoot,
        modes,
        userConfig: runtime.userConfig,
        sqliteEnabled: sqliteEnabledForValidation,
        validateOrdering: stageArgv['validate-ordering'] === true
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
        validationDone = true;
        if (isTestingEnv()) {
          if (validation.issues?.length) {
            defaultLogError('Index validation issues (first 10):');
            validation.issues.slice(0, 10).forEach((issue) => {
              defaultLogError(`- ${issue}`);
            });
          }
          if (validation.warnings?.length) {
            logLine('[warn] Index validation warnings (first 10):');
            validation.warnings.slice(0, 10).forEach((warning) => {
              logLine(`[warn] - ${warning}`);
            });
          }
        }
        throw new Error('Index validation failed; see index-validate output for details.');
      }
      await markBuildPhase(runtime.buildRoot, 'validation', 'done');
      validationDone = true;
      throwIfAborted(effectiveAbortSignal);
      lock = await acquireBuildIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
      await markBuildPhase(runtime.buildRoot, 'promote', 'running');
      promoteRunning = true;
      throwIfAborted(effectiveAbortSignal);
      await promoteBuild({
        repoRoot: runtime.root,
        userConfig: runtime.userConfig,
        buildId: runtime.buildId,
        buildRoot: runtime.buildRoot,
        stage: phaseStage,
        modes,
        configHash: runtime.configHash,
        repoProvenance: runtime.repoProvenance,
        compatibilityKey: runtime.compatibilityKey || null
      });
      await markBuildPhase(runtime.buildRoot, 'promote', 'done');
      promoteDone = true;
      result = {
        modes,
        sqlite: sqliteResult,
        repo: runtime.root,
        stage,
        buildRoot: runtime.buildRoot,
        repoCacheRoot: runtime.repoCacheRoot,
        profile: runtime.profile || null
      };
    } catch (err) {
      const phaseFailureDetail = toPhaseFailureDetail(err);
      await markFailedPhases({
        buildRoot: runtime?.buildRoot,
        markPhase: markBuildPhase,
        phaseFailureDetail,
        phases: [
          { name: 'promote', running: promoteRunning, done: promoteDone },
          { name: 'validation', running: validationRunning, done: validationDone },
          { name: phaseStage, running: phaseRunning, done: phaseDone }
        ]
      });
      throw err;
    } finally {
      stopHeartbeat();
      try {
        await runBuildCleanupWithTimeout({
          label: `${phaseStage}.build-state.flush`,
          cleanup: () => flushBuildState(runtime?.buildRoot),
          log
        });
      } catch (err) {
        logLine(`[build_state] ${phaseStage} final flush failed: ${err?.message || String(err)}`, {
          kind: 'warning'
        });
      }
      let releaseError = null;
      try {
        if (lock?.release) {
          const releaseResult = await runBuildCleanupWithTimeout({
            label: `${phaseStage}.lock.release`,
            cleanup: () => lock.release(),
            log,
            swallowTimeout: false
          });
          if (releaseResult?.timedOut) {
            releaseError = releaseResult.error || new Error(`[cleanup] ${phaseStage} lock release timed out.`);
          }
        }
      } catch (err) {
        releaseError = err;
      }
      let teardownError = null;
      try {
        await teardownRuntime(runtime);
      } catch (err) {
        teardownError = err;
      }
      if (releaseError) throw releaseError;
      if (teardownError) throw teardownError;
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
