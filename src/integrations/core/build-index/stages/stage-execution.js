import {
  preprocessFiles,
  writePreprocessStats
} from '../../../../index/build/preprocess.js';
import { buildIndexForMode } from '../../../../index/build/indexer.js';
import { SIGNATURE_VERSION } from '../../../../index/build/indexer/signatures.js';
import { createBuildRuntime } from '../../../../index/build/runtime.js';
import {
  initBuildState,
  markBuildPhase,
  startBuildHeartbeat,
  updateBuildState
} from '../../../../index/build/build-state.js';
import { validateIndexArtifacts } from '../../../../index/validate.js';
import { logError as defaultLogError, logLine } from '../../../../shared/progress.js';
import { isAbortError, throwIfAborted } from '../../../../shared/abort.js';
import { isTestingEnv } from '../../../../shared/env.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../../index/build/runtime/scheduler.js';
import {
  createFeatureMetrics,
  writeFeatureMetrics
} from '../../../../index/build/feature-metrics.js';
import {
  getIndexDir,
  getMetricsDir,
  getToolVersion
} from '../../../../../tools/shared/dict-utils.js';
import { buildSqliteIndex } from '../sqlite.js';
import { computeCompatibilityKey } from '../compatibility.js';
import { createOverallProgress } from '../progress.js';
import { teardownRuntime } from '../runtime.js';
import { updateEnrichmentState } from '../../enrichment-state.js';
import { dedupeModeList, filterPrimaryIndexModes } from './modes.js';
import { markFailedPhases, toPhaseFailureDetail } from './phase-failures.js';
import { createSqliteDirResolver, resolveSqliteModeList } from './sqlite-paths.js';
import { runPromotionPhase } from './promotion.js';

/**
 * Run one build stage (`stage1`/`stage2`/`stage3`/`stage4`) with phase tracking.
 *
 * Stage transition contract:
 * 1. Initialize build state and mark `discovery` before indexing work.
 * 2. Mark stage-specific phase running/done around indexing per mode.
 * 3. Optionally run sqlite and validation, then run `promote` under lock.
 * 4. On any failure, mark still-running phases as failed before rethrow.
 *
 * @param {'stage1'|'stage2'|'stage3'|'stage4'|null} stage
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
 * @param {{allowSqlite?:boolean}} [options]
 * @returns {Promise<object>}
 */
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

    // Throughput: preserve caller-facing `modes` while avoiding duplicate execution work.
    const executionModes = dedupeModeList(modes);
    let sqliteResult = null;
    const phaseState = { running: false, done: false };
    const validationState = { running: false, done: false };
    const promoteState = { running: false, done: false };
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
      const preprocessModes = filterPrimaryIndexModes(executionModes);
      if (preprocessModes.length) {
        await markBuildPhase(runtime.buildRoot, 'preprocessing', 'running');
        throwIfAborted(abortSignal);
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
      computeCompatibilityKey({ runtime, modes: executionModes, sharedDiscovery });
      await markBuildPhase(runtime.buildRoot, 'discovery', 'done');
      await markBuildPhase(runtime.buildRoot, phaseStage, 'running');
      phaseState.running = true;
      for (const modeItem of executionModes) {
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
      phaseState.done = true;
      const sqliteConfigured = runtime.userConfig?.sqlite?.use !== false;
      const sqliteModes = filterPrimaryIndexModes(executionModes);
      const shouldBuildSqlite = allowSqlite
        && (typeof stageArgv.sqlite === 'boolean' ? stageArgv.sqlite : sqliteConfigured);
      const sqliteEnabledForValidation = shouldBuildSqlite && sqliteModes.length > 0;
      if (shouldBuildSqlite && sqliteModes.length) {
        throwIfAborted(abortSignal);
        const scheduleSqlite = (fn) => (runtime?.scheduler?.schedule
          ? runtime.scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage4Sqlite, { cpu: 1, io: 1 }, fn)
          : fn());
        const resolveSqliteDirs = createSqliteDirResolver({
          root,
          userConfig: runtime.userConfig,
          getIndexDir
        });
        const sqliteDirs = resolveSqliteDirs(runtime.buildRoot);
        const sqliteModeList = resolveSqliteModeList(sqliteModes);
        for (const mode of sqliteModeList) {
          throwIfAborted(abortSignal);
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
      validationState.running = true;
      throwIfAborted(abortSignal);
      const validation = await validateIndexArtifacts({
        root: runtime.root,
        indexRoot: runtime.buildRoot,
        modes: executionModes,
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
        validationState.done = true;
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
      validationState.done = true;
      throwIfAborted(abortSignal);
      await runPromotionPhase({
        runtime,
        stage: phaseStage,
        modes,
        log,
        markPhase: markBuildPhase,
        phaseState: promoteState,
        abortSignal
      });
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
          { name: 'promote', running: promoteState.running, done: promoteState.done },
          { name: 'validation', running: validationState.running, done: validationState.done },
          { name: phaseStage, running: phaseState.running, done: phaseState.done }
        ]
      });
      throw err;
    } finally {
      stopHeartbeat();
      let teardownError = null;
      try {
        await teardownRuntime(runtime);
      } catch (err) {
        teardownError = err;
      }
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
