import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTempPath } from '../../../shared/json-stream.js';
import { resolveTaskFactory } from '../../../shared/cli/noop-task.js';
import { getEnvConfig } from '../../../shared/env.js';
import { resolveRuntimeEnvelope } from '../../../shared/runtime-envelope.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../../index/build/build-state.js';
import { createStageCheckpointRecorder } from '../../../index/build/stage-checkpoints.js';
import { ensureDiskSpace, estimateDirBytes } from '../../../shared/disk-space.js';
import {
  getMetricsDir,
  getModelConfig,
  getRepoCacheRoot,
  getToolVersion,
  loadUserConfig,
  resolveRepoRootArg,
  resolveSqlitePaths
} from '../../../shared/dict-utils.js';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension,
  resolveVectorExtensionConfigForMode
} from '../../../../tools/sqlite/vector-extension.js';
import { compactDatabase } from '../../../../tools/build/compact-sqlite-index.js';
import { loadIncrementalManifest } from '../incremental.js';
import { removeSqliteSidecars, replaceSqliteDatabase } from '../utils.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from './from-artifacts.js';
import { buildDatabaseFromBundles } from './from-bundles.js';
import { incrementalUpdateDatabase } from './incremental-update.js';
import { SCHEMA_VERSION } from '../schema.js';
import { resolveOutputPaths } from './output-paths.js';
import {
  BUNDLE_LOADER_WORKER_PATH,
  loadSqliteBundleWorkerProfile,
  resolveSqliteBundleWorkerProfilePath,
  saveSqliteBundleWorkerProfile,
  writeSqliteZeroStateManifest
} from './runner/config.js';
import {
  createAdaptiveBatchPlanner,
  probeSqliteTargetRuntime,
  resolveBundleWorkerAutotune
} from './runner/build.js';
import { resolveModeExecutionPlan } from './runner/mode-plan.js';
import { normalizeModeArg, normalizeValidateMode } from './runner/options.js';
import { resolveChunkMetaTotalRecords } from './runner/chunk-meta.js';
import {
  countMissingBundleFiles,
  listIncrementalBundleFiles,
  resolveIncrementalInputPlan
} from './runner/incremental.js';
import {
  hasVectorTableAtPath,
  readSqliteCounts,
  readSqliteModeCount,
  resolveExpectedDenseCount
} from './runner/sqlite-probes.js';
import {
  createRunnerLogger,
  formatBundleManifest,
  formatEmbedStats,
  formatVectorAnnState
} from './runner/logging.js';
import {
  setSqliteModeBuildReadyState,
  setSqliteModeFailedState,
  setSqliteModeIncrementalReadyState,
  setSqliteModeRunningState,
  setSqliteModeSkippedEmptyState,
  setSqliteModeVectorMissingState
} from './runner/state.js';

export { normalizeValidateMode } from './runner/options.js';

/**
 * Build sqlite indexes without CLI parsing.
 * @param {object} options
 * @param {string} options.root
 * @param {string} [options.mode]
 * @param {boolean} [options.incremental]
 * @param {boolean} [options.compact]
 * @param {string} [options.out]
 * @param {string} [options.indexRoot]
 * @param {string} [options.asOf]
 * @param {string} [options.snapshot]
 * @param {string} [options.codeDir]
 * @param {string} [options.proseDir]
 * @param {string} [options.extractedProseDir]
 * @param {string} [options.recordsDir]
 * @param {string|boolean} [options.validateMode]
 * @param {number} [options.batchSize]
 * @param {string} [options.progress]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.quiet]
 * @param {string[]} [options.rawArgs]
 * @param {object|null} [options.logger]
 * @param {boolean} [options.emitOutput]
 * @param {boolean} [options.exitOnError]
 * @returns {Promise<{ok:boolean,mode:string,outPath:string,outputPaths:object}>}
 */
export async function buildSqliteIndex(options = {}) {
  const modeArg = normalizeModeArg(options.mode);
  const validateMode = normalizeValidateMode(options.validateMode ?? options.validate);
  const root = options.root || options.runtime?.root || null;
  const argv = {
    repo: root,
    mode: modeArg,
    incremental: options.incremental === true,
    compact: options.compact === true,
    'no-compact': options.compact === true ? false : (options.noCompact === true),
    validate: validateMode,
    out: options.out || null,
    'index-root': options.indexRoot || null,
    'as-of': options.asOf || null,
    snapshot: options.snapshot || null,
    'code-dir': options.codeDir || null,
    'prose-dir': options.proseDir || null,
    'extracted-prose-dir': options.extractedProseDir || null,
    'records-dir': options.recordsDir || null,
    'batch-size': options.batchSize ?? null,
    progress: options.progress || 'auto',
    verbose: options.verbose === true,
    quiet: options.quiet === true
  };
  const parsed = {
    argv,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true,
    validateMode,
    modeArg,
    rawArgs: Array.isArray(options.rawArgs) ? options.rawArgs : []
  };
  return runBuildSqliteIndexWithConfig(parsed, {
    logger: options.logger || null,
    root,
    runtime: options.runtime || null,
    userConfig: options.userConfig || null,
    envelope: options.envelope || null,
    threadLimits: options.threadLimits || null,
    repoCacheRoot: options.repoCacheRoot || null,
    metricsDir: options.metricsDir || null,
    taskFactory: options.taskFactory || null,
    onFinalize: options.onFinalize || null,
    indexRoot: options.indexRoot || null,
    out: options.out || null,
    codeDir: options.codeDir || null,
    proseDir: options.proseDir || null,
    extractedProseDir: options.extractedProseDir || null,
    recordsDir: options.recordsDir || null,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true
  });
}

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

/**
 * Build sqlite indexes from artifacts or incremental bundles.
 * @param {object} parsed
 * @param {object} [options]
 * @param {object} [options.logger]
 * @param {string} [options.root]
 * @returns {Promise<{ok:boolean,mode:string,outPath:string,outputPaths:object}>}
 */
export async function runBuildSqliteIndexWithConfig(parsed, options = {}) {
  const {
    argv,
    emitOutput,
    exitOnError,
    validateMode,
    modeArg,
    rawArgs: parsedRawArgs
  } = parsed;
  const externalLogger = options.logger && typeof options.logger === 'object'
    ? options.logger
    : null;
  const taskFactory = resolveTaskFactory(options.taskFactory);
  let stopHeartbeat = () => {};
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    stopHeartbeat();
    if (typeof options.onFinalize === 'function') {
      try {
        options.onFinalize();
      } catch {}
    }
  };
  process.once('exit', finalize);
  const { log, warn, error } = createRunnerLogger({
    emitOutput,
    externalLogger
  });
  const bail = (message, code = 1) => {
    if (message) error(message);
    finalize();
    if (exitOnError) process.exit(code);
    throw new Error(message || 'SQLite index build failed.');
  };
  if (!Database) return bail('better-sqlite3 is required. Run npm install first.');

  try {
    const runtime = options.runtime && typeof options.runtime === 'object'
      ? options.runtime
      : null;
    const root = runtime?.root ? path.resolve(runtime.root) : resolveRepoRootArg(options.root || argv.repo);
    const envConfig = getEnvConfig();
    const userConfig = runtime?.userConfig || options.userConfig || loadUserConfig(root);
    const metricsDir = options.metricsDir || getMetricsDir(root, userConfig);
    const modePlan = resolveModeExecutionPlan({
      modeArg,
      root,
      argv,
      options,
      runtime,
      userConfig
    });
    if (modePlan.errorMessage) {
      return bail(modePlan.errorMessage);
    }
    const {
      modeList,
      indexRoot,
      modeIndexDirs
    } = modePlan;
    const buildStatePath = resolveBuildStatePath(indexRoot);
    const hasBuildState = buildStatePath && fsSync.existsSync(buildStatePath);
    stopHeartbeat = hasBuildState ? startBuildHeartbeat(indexRoot, 'stage4') : () => {};
    const envelope = options.envelope || runtime?.envelope || resolveRuntimeEnvelope({
      argv,
      rawArgv: parsedRawArgs,
      userConfig,
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
    const threadLimits = options.threadLimits || {
      cpuCount: envelope.concurrency.cpuCount,
      maxConcurrencyCap: envelope.concurrency.maxConcurrencyCap,
      threads: envelope.concurrency.threads.value,
      fileConcurrency: envelope.concurrency.fileConcurrency.value,
      importConcurrency: envelope.concurrency.importConcurrency.value,
      ioConcurrency: envelope.concurrency.ioConcurrency.value,
      cpuConcurrency: envelope.concurrency.cpuConcurrency.value,
      procConcurrency: envelope.queues?.proc?.concurrency ?? null,
      source: envelope.concurrency.threads.source,
      sourceDetail: envelope.concurrency.threads.detail
    };
    if (emitOutput && argv.verbose === true) {
      log(
        `[sqlite] Thread limits (${threadLimits.source}): ` +
        `cpu=${threadLimits.cpuCount}, cap=${threadLimits.maxConcurrencyCap}, ` +
        `files=${threadLimits.fileConcurrency}, imports=${threadLimits.importConcurrency}, ` +
        `io=${threadLimits.ioConcurrency}, cpuWork=${threadLimits.cpuConcurrency}.`
      );
    }
    if (argv.compact && argv['no-compact']) {
      return bail('Cannot use --compact and --no-compact together.');
    }
    const modelConfig = getModelConfig(root, userConfig);
    const vectorExtension = getVectorExtensionConfig(root, userConfig);
    const vectorAnnEnabled = vectorExtension.enabled;
    const vectorConfig = {
      enabled: vectorAnnEnabled,
      extension: vectorExtension,
      encodeVector,
      hasVectorTable,
      ensureVectorTable,
      loadVectorExtension
    };
    const sqlitePaths = resolveSqlitePaths(root, userConfig, { indexRoot });
    const sqliteSharedDb = Boolean(
      sqlitePaths?.codePath
      && sqlitePaths?.prosePath
      && path.resolve(sqlitePaths.codePath) === path.resolve(sqlitePaths.prosePath)
    );
    const outArg = argv.out || options.out || null;
    const { outPath, codeOutPath, proseOutPath, extractedProseOutPath, recordsOutPath } = resolveOutputPaths({
      modeArg,
      outArg,
      sqlitePaths
    });
    const logPrefix = modeArg === 'all' ? '[sqlite]' : `[sqlite:${modeArg}]`;
    const repoCacheRoot = options.repoCacheRoot || runtime?.repoCacheRoot || getRepoCacheRoot(root, userConfig);
    const {
      profilePath: bundleWorkerProfilePath,
      profile: bundleWorkerProfile
    } = await loadSqliteBundleWorkerProfile(repoCacheRoot);
    const incrementalRequested = argv.incremental === true;
    const requestedBatchSize = Number(argv['batch-size'] ?? options.batchSize);
    const batchSizeOverride = Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
      ? Math.floor(requestedBatchSize)
      : null;
    const resolveAdaptiveBatchConfig = createAdaptiveBatchPlanner();
    const modeOutputPaths = {
      code: codeOutPath,
      prose: proseOutPath,
      'extracted-prose': extractedProseOutPath,
      records: recordsOutPath
    };
    const indexPieces = {};
    const indexPieceErrors = {};
    const pieceResults = await Promise.all(
      modeList.map(async (mode) => {
        try {
          const pieces = await loadIndexPieces(modeIndexDirs[mode]);
          return { mode, pieces, error: null };
        } catch (error) {
          return { mode, pieces: null, error };
        }
      })
    );
    for (const result of pieceResults) {
      if (result?.pieces) indexPieces[result.mode] = result.pieces;
      if (result?.error) indexPieceErrors[result.mode] = result.error;
    }
    const compactMode = argv.compact === true || (argv.compact == null && argv['no-compact'] !== true);

    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage4', 'running');
    }

    const buildModeTask = taskFactory('SQLite', { total: modeList.length, stage: 'sqlite' });
    let done = 0;
    for (const mode of modeList) {
      const stageCheckpoints = createStageCheckpointRecorder({
        buildRoot: indexRoot,
        metricsDir,
        mode,
        buildId: indexRoot ? path.basename(indexRoot) : null
      });
      const modeLabel = `${logPrefix} ${mode}`;
      const startTs = Date.now();
      const modeIndexDir = modeIndexDirs[mode];
      const outputPath = modeOutputPaths[mode];
      if (!outputPath) return bail('SQLite output path could not be resolved.');
      const outDir = path.dirname(outputPath);
      const logDetails = [];
      const modeChunkCountHint = resolveChunkMetaTotalRecords(modeIndexDir);
      const modeDenseCountHint = resolveExpectedDenseCount(indexPieces?.[mode]?.denseVec);
      const modeRowCountHint = Number.isFinite(Number(modeChunkCountHint)) && Number(modeChunkCountHint) > 0
        ? Number(modeChunkCountHint)
        : 0;
      const sqliteRuntime = probeSqliteTargetRuntime({
        Database,
        dbPath: outputPath
      });
      if (emitOutput) {
        log(`${modeLabel} build start`, {
          fileOnlyLine: `${modeLabel} building ${mode} index -> ${outputPath}`
        });
      }
      await setSqliteModeRunningState({
        root,
        userConfig,
        indexRoot,
        mode,
        path: outputPath,
        schemaVersion: SCHEMA_VERSION,
        threadLimits
      });

      const modeIsZeroState = modeChunkCountHint === 0 && modeDenseCountHint === 0;
      if (modeIsZeroState) {
        const outputExists = fsSync.existsSync(outputPath);
        const existingRows = outputExists
          ? readSqliteModeCount({
            Database,
            dbPath: outputPath,
            mode
          })
          : 0;
        if (existingRows === 0) {
          const zeroStateManifestPath = await writeSqliteZeroStateManifest({
            modeIndexDir,
            mode,
            outputPath,
            chunkCount: modeChunkCountHint,
            denseCount: modeDenseCountHint
          });
          stageCheckpoints.record({
            stage: 'stage4',
            step: `skip-empty-${mode}`,
            extra: {
              modeArtifactsRows: 0,
              mode,
              existingRows: outputExists ? 0 : null,
              denseCount: modeDenseCountHint,
              zeroStateManifestPath
            }
          });
          await setSqliteModeSkippedEmptyState({
            root,
            userConfig,
            indexRoot,
            mode,
            path: outputPath,
            schemaVersion: SCHEMA_VERSION,
            threadLimits,
            zeroStateManifestPath
          });
          if (emitOutput) {
            if (mode === 'records') {
              log(`${modeLabel} skipping records sqlite rebuild (artifacts empty; zero-state).`);
            } else {
              log(`${modeLabel} skipping sqlite rebuild (artifacts empty; zero-state).`);
            }
          }
          done += 1;
          buildModeTask.set(done, modeList.length, { message: `${mode} skipped` });
          continue;
        }
      }

      const incrementalData = loadIncrementalManifest(repoCacheRoot, mode);
      const incrementalBundleDir = incrementalData?.bundleDir || null;
      const incrementalFiles = incrementalData?.manifest?.files;
      const incrementalFileCount = incrementalFiles && typeof incrementalFiles === 'object'
        ? Object.keys(incrementalFiles).length
        : 0;
      const bundleInventory = listIncrementalBundleFiles(incrementalBundleDir);
      const incrementalBundleCount = bundleInventory.count;
      const missingBundleCount = countMissingBundleFiles(incrementalData, bundleInventory.names);
      let resolvedInput = null;
      let tempOutputPath = null;
      let inputBytes = 0;
      const sqliteStats = {};
      const workTask = taskFactory('Build', { stage: 'sqlite', mode });
      try {
        await fs.mkdir(outDir, { recursive: true });
        const piecesLoadError = indexPieceErrors?.[mode];
        if (piecesLoadError) {
          const message = piecesLoadError?.message || String(piecesLoadError);
          error(
            `[sqlite:${mode}] Failed to load index pieces.` +
            ` indexRoot=${indexRoot || '(none)'}` +
            ` indexDir=${modeIndexDir || '(unresolved)'}` +
            ` error=${message}`
          );
          throw new Error(`Failed to load index pieces for ${mode}: ${message}`);
        }
        const pieces = indexPieces?.[mode];
        if (!pieces) {
          const indexDir = modeIndexDir || '(unresolved)';
          const manifestPath = modeIndexDir ? path.join(modeIndexDir, 'pieces', 'manifest.json') : null;
          const manifestExists = manifestPath ? fsSync.existsSync(manifestPath) : false;
          error(
            `[sqlite:${mode}] Missing index pieces.` +
            ` indexRoot=${indexRoot || '(none)'}` +
            ` indexDir=${indexDir}` +
            ` manifest=${manifestPath || '(n/a)'}` +
            ` exists=${manifestExists}`
          );
          throw new Error(`Missing index pieces for ${mode}.`);
        }
        const expectedDenseCount = resolveExpectedDenseCount(pieces?.denseVec);
        const modeSupportsDense = mode === 'code' || mode === 'prose' || mode === 'extracted-prose';
        const denseArtifactsRequired = modeSupportsDense && expectedDenseCount > 0;
        const artifactManifestFiles = pieces?.manifestFiles;
        const artifactFileCountHint = artifactManifestFiles && typeof artifactManifestFiles === 'object'
          ? Object.keys(artifactManifestFiles).length
          : 0;
        const repoFileCountHint = Math.max(incrementalFileCount, artifactFileCountHint);
        const incrementalPlan = resolveIncrementalInputPlan({
          mode,
          modeIndexDir,
          incrementalRequested,
          incrementalData,
          incrementalFileCount,
          incrementalBundleCount,
          missingBundleCount,
          denseArtifactsRequired
        });
        const {
          bundleManifest,
          recordsIncrementalCapability,
          recordsIncrementalSupported,
          hasIncrementalBundles,
          bundleSkipReason
        } = incrementalPlan;
        if (incrementalRequested && emitOutput && !hasIncrementalBundles) {
          const skipMessage = bundleSkipReason
            ? `[sqlite] incremental bundles skipped for ${mode}: ${bundleSkipReason}; using artifacts.`
            : '[sqlite] incremental bundles unavailable; using artifacts.';
          if (bundleSkipReason?.includes('bundle file missing')) {
            warn(skipMessage);
          } else {
            log(skipMessage);
          }
        }
        resolvedInput = { ...incrementalPlan.resolvedInput };
        const bundleWorkerAutotune = resolveBundleWorkerAutotune({
          mode,
          manifestFiles: incrementalFiles,
          bundleDir: incrementalBundleDir,
          threadLimits,
          envConfig,
          profile: bundleWorkerProfile
        });
        const envConfigForMode = {
          ...envConfig,
          bundleThreads: bundleWorkerAutotune.threads
        };
        sqliteStats.bundleWorkerAutotune = {
          mode,
          threads: bundleWorkerAutotune.threads,
          reason: bundleWorkerAutotune.reason,
          bundleCount: bundleWorkerAutotune.bundleCount,
          avgBundleBytes: bundleWorkerAutotune.avgBundleBytes
        };
        if (emitOutput && hasIncrementalBundles) {
          log(
            `[sqlite] bundle worker autotune ${mode}: threads=${bundleWorkerAutotune.threads} ` +
            `(reason=${bundleWorkerAutotune.reason}, bundles=${bundleWorkerAutotune.bundleCount}, ` +
            `avgBundleBytes=${bundleWorkerAutotune.avgBundleBytes}).`
          );
        }
        const modeVectorExtension = resolveVectorExtensionConfigForMode(vectorExtension, mode, {
          sharedDb: sqliteSharedDb
        });
        const resolvedVectorConfig = {
          ...vectorConfig,
          extension: modeVectorExtension,
          enabled: vectorAnnEnabled && (mode === 'code' || mode === 'prose' || mode === 'extracted-prose')
        };
        let activeBatchConfig = null;
        let activeIngestPlan = null;
        const applyAdaptivePlan = ({ inputBytesHint = 0, fileCountHint = repoFileCountHint, repoBytesHint = 0 } = {}) => {
          const resolved = resolveAdaptiveBatchConfig({
            requestedBatchSize: batchSizeOverride,
            runtime: sqliteRuntime,
            inputBytes: inputBytesHint,
            rowCount: modeRowCountHint,
            fileCount: fileCountHint,
            repoBytes: repoBytesHint
          });
          activeBatchConfig = resolved.config;
          activeIngestPlan = resolved.plan;
          sqliteStats.sqliteRuntime = {
            pageSize: sqliteRuntime.pageSize,
            journalMode: sqliteRuntime.journalMode,
            walEnabled: sqliteRuntime.walEnabled,
            walBytes: sqliteRuntime.walBytes,
            source: sqliteRuntime.source
          };
          sqliteStats.ingestPlan = {
            ...activeIngestPlan,
            source: sqliteRuntime.source
          };
          sqliteStats.transactionBoundaries = {
            rowsPerTransaction: activeIngestPlan.transactionRows,
            batchesPerTransaction: activeIngestPlan.batchesPerTransaction,
            filesPerTransaction: activeIngestPlan.filesPerTransaction,
            repoTier: activeIngestPlan.repoTier,
            walPressure: activeIngestPlan.walPressure
          };
          return resolved;
        };
        applyAdaptivePlan({
          inputBytesHint: sqliteRuntime.dbBytes,
          fileCountHint: repoFileCountHint,
          repoBytesHint: sqliteRuntime.dbBytes
        });
        stageCheckpoints.record({
          stage: 'stage4',
          step: 'start',
          extra: {
            incrementalRequested: incrementalRequested ? 1 : 0,
            incrementalBundles: hasIncrementalBundles ? 1 : 0,
            incrementalFiles: incrementalFileCount,
            incrementalBundlesCount: incrementalBundleCount,
            missingBundles: missingBundleCount,
            recordsIncrementalSupported: mode === 'records'
              ? (recordsIncrementalSupported ? 1 : 0)
              : null,
            recordsIncrementalCapabilityExplicit: mode === 'records'
              ? (recordsIncrementalCapability.explicit === true ? 1 : 0)
              : null,
            inputSource: resolvedInput.source === 'incremental' ? 1 : 0,
            pageSize: activeIngestPlan?.pageSize ?? null,
            walBytes: activeIngestPlan?.walBytes ?? null,
            walPressure: activeIngestPlan?.walPressure ?? null,
            adaptiveBatchSize: activeIngestPlan?.batchSize ?? null,
            transactionRows: activeIngestPlan?.transactionRows ?? null,
            transactionFiles: activeIngestPlan?.filesPerTransaction ?? null
          }
        });

        if (
          incrementalRequested
          && fsSync.existsSync(outputPath)
          && incrementalData?.manifest
          && missingBundleCount === 0
          && recordsIncrementalSupported
        ) {
          const updateResult = await incrementalUpdateDatabase({
            Database,
            outPath: outputPath,
            mode,
            incrementalData,
            modelConfig,
            vectorConfig: resolvedVectorConfig,
            emitOutput,
            validateMode,
            expectedDense: pieces?.denseVec || null,
            logger: externalLogger || { log, warn, error },
            inputBytes,
            batchSize: activeBatchConfig,
            stats: sqliteStats
          });
          if (updateResult?.used) {
            sqliteStats.incrementalUsed = true;
          } else if (updateResult?.reason) {
            sqliteStats.incrementalSkipReason = updateResult.reason;
            sqliteStats.incrementalSummary = {
              totalFiles: updateResult.totalFiles ?? null,
              changedFiles: updateResult.changedFiles ?? null,
              deletedFiles: updateResult.deletedFiles ?? null,
              manifestUpdates: updateResult.manifestUpdates ?? null
            };
          }
          if (updateResult?.used) {
            const counts = readSqliteCounts({
              Database,
              dbPath: outputPath
            });
            const durationMs = Date.now() - startTs;
            let stat = null;
            try {
              stat = await fs.stat(outputPath);
            } catch {}
            stageCheckpoints.record({
              stage: 'stage4',
              step: 'incremental-update',
              extra: {
                outputBytes: Number(stat?.size) || 0,
                batchSize: sqliteStats.batchSize ?? null,
                transactionRows: sqliteStats.transactionBoundaries?.rowsPerTransaction ?? null,
                transactionFiles: sqliteStats.transactionBoundaries?.filesPerTransaction ?? null,
                walPressure: sqliteStats.transactionBoundaries?.walPressure ?? null,
                validationMs: sqliteStats.validationMs ?? null,
                pragmas: sqliteStats.pragmas ?? null,
                rows: {
                  code: counts.code || 0,
                  prose: counts.prose || 0,
                  extractedProse: counts['extracted-prose'] || 0,
                  records: counts.records || 0
                }
              }
            });
            await setSqliteModeIncrementalReadyState({
              root,
              userConfig,
              indexRoot,
              mode,
              path: outputPath,
              schemaVersion: SCHEMA_VERSION,
              bytes: stat?.size,
              elapsedMs: durationMs,
              threadLimits,
              stats: sqliteStats
            });
            if (emitOutput) {
              const summaryLine = (
                `${modeLabel} incremental update applied (${counts.code || 0} code, ` +
                `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
              );
              log(summaryLine, {
                fileOnlyLine:
                  `${modeLabel} sqlite incremental update applied at ${outputPath} (${counts.code || 0} code, ` +
                  `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
              });
            }
            done += 1;
            buildModeTask.set(done, modeList.length, { message: `${mode} done` });
            continue;
          }
          if (emitOutput && updateResult?.used === false && updateResult.reason) {
            warn(`[sqlite] incremental update skipped for ${mode}: ${updateResult.reason}.`);
          }
        } else if (
          incrementalRequested
          && fsSync.existsSync(outputPath)
          && incrementalData?.manifest
          && !recordsIncrementalSupported
        ) {
          warn(`[sqlite] incremental update skipped for ${mode}: ${recordsIncrementalCapability.reason}.`);
        } else if (incrementalRequested && fsSync.existsSync(outputPath) && incrementalData?.manifest && missingBundleCount > 0) {
          warn(`[sqlite] incremental update skipped for ${mode}: bundle file missing (${missingBundleCount}).`);
        }

        tempOutputPath = createTempPath(outputPath);

        if (resolvedInput.source === 'incremental' && resolvedInput.bundleDir) {
          const estimate = await estimateDirBytes(incrementalBundleDir);
          inputBytes = estimate.bytes;
          applyAdaptivePlan({
            inputBytesHint: inputBytes,
            fileCountHint: incrementalFileCount || repoFileCountHint,
            repoBytesHint: Math.max(sqliteRuntime.dbBytes || 0, inputBytes || 0)
          });
          await ensureDiskSpace({
            targetPath: outDir,
            requiredBytes: Math.max(estimate.bytes * 2, 64 * 1024 * 1024),
            label: `${mode} sqlite incremental`
          });
          const bundleResult = await buildDatabaseFromBundles({
            Database,
            outPath: tempOutputPath,
            mode,
            incrementalData,
            envConfig: envConfigForMode,
            threadLimits,
            emitOutput,
            validateMode,
            vectorConfig: resolvedVectorConfig,
            modelConfig,
            workerPath: BUNDLE_LOADER_WORKER_PATH,
            logger: externalLogger || { log, warn, error },
            inputBytes,
            batchSize: activeBatchConfig,
            stats: sqliteStats
          });
          const missingDense = denseArtifactsRequired && bundleResult?.denseCount === 0;
          const bundleFailureReason = bundleResult?.reason || (missingDense ? 'bundles missing embeddings' : '');
          if (bundleFailureReason) {
            warn(`[sqlite] incremental bundle build failed for ${mode}: ${bundleFailureReason}; using artifacts.`);
            const embedLine = formatEmbedStats(bundleResult?.embedStats);
            if (embedLine) log(`[sqlite] bundle embeddings ${mode}: ${embedLine}.`);
            const annLine = formatVectorAnnState(bundleResult?.vectorAnn);
            if (annLine) log(`[sqlite] vector extension ${mode}: ${annLine}.`);
            const manifestLine = formatBundleManifest(bundleManifest);
            if (manifestLine) log(`[sqlite] bundle manifest ${mode}: ${manifestLine}.`);
            resolvedInput = { source: 'artifacts', indexDir: modeIndexDir };
            applyAdaptivePlan({
              inputBytesHint: inputBytes,
              fileCountHint: artifactFileCountHint || repoFileCountHint,
              repoBytesHint: Math.max(sqliteRuntime.dbBytes || 0, inputBytes || 0)
            });
            await buildDatabaseFromArtifacts({
              Database,
              index: pieces,
              indexDir: modeIndexDir,
              mode,
              outputPath: tempOutputPath,
              vectorConfig: resolvedVectorConfig,
              emitOutput,
              logger: externalLogger || { log, warn, error },
              task: workTask,
              inputBytes,
              batchSize: activeBatchConfig,
              stats: sqliteStats
            });
          } else {
          }
        } else {
          const estimate = await estimateDirBytes(modeIndexDir);
          inputBytes = estimate.bytes;
          applyAdaptivePlan({
            inputBytesHint: inputBytes,
            fileCountHint: artifactFileCountHint || repoFileCountHint,
            repoBytesHint: Math.max(sqliteRuntime.dbBytes || 0, inputBytes || 0)
          });
          await ensureDiskSpace({
            targetPath: outDir,
            requiredBytes: Math.max(estimate.bytes * 2, 64 * 1024 * 1024),
            label: `${mode} sqlite artifacts`
          });
          await buildDatabaseFromArtifacts({
            Database,
            index: pieces,
            indexDir: modeIndexDir,
            mode,
            outputPath: tempOutputPath,
            vectorConfig: resolvedVectorConfig,
            emitOutput,
            logger: externalLogger || { log, warn, error },
            task: workTask,
            inputBytes,
            batchSize: activeBatchConfig,
            stats: sqliteStats
          });
        }
        const hadVectorTable = resolvedVectorConfig?.enabled === true
          ? hasVectorTableAtPath({
            Database,
            dbPath: tempOutputPath,
            tableName: resolvedVectorConfig?.extension?.table || 'dense_vectors_ann',
            hasVectorTable
          })
          : false;
        if (compactMode) {
          const compacted = await compactDatabase({
            dbPath: tempOutputPath,
            mode,
            vectorExtension: resolvedVectorConfig.extension,
            logger: externalLogger || { log, warn, error }
          });
          if (compacted) logDetails.push('compacted');
        }
        await replaceSqliteDatabase(tempOutputPath, outputPath);
        tempOutputPath = null;
        await removeSqliteSidecars(outputPath);
        const counts = readSqliteCounts({
          Database,
          dbPath: outputPath
        });
        const durationMs = Date.now() - startTs;
        const stat = await fs.stat(outputPath);
        stageCheckpoints.record({
          stage: 'stage4',
          step: 'build',
          extra: {
            inputBytes,
            outputBytes: Number(stat?.size) || 0,
            batchSize: sqliteStats.batchSize ?? null,
            transactionRows: sqliteStats.transactionBoundaries?.rowsPerTransaction ?? null,
            transactionFiles: sqliteStats.transactionBoundaries?.filesPerTransaction ?? null,
            walPressure: sqliteStats.transactionBoundaries?.walPressure ?? null,
            validationMs: sqliteStats.validationMs ?? null,
            pragmas: sqliteStats.pragmas ?? null,
            rows: {
              code: counts.code || 0,
              prose: counts.prose || 0,
              extractedProse: counts['extracted-prose'] || 0,
              records: counts.records || 0
            }
          }
        });
        const note = logDetails.length ? logDetails.join(', ') : null;
        await setSqliteModeBuildReadyState({
          root,
          userConfig,
          indexRoot,
          mode,
          path: outputPath,
          schemaVersion: SCHEMA_VERSION,
          bytes: stat.size,
          inputBytes,
          elapsedMs: durationMs,
          threadLimits,
          note,
          stats: sqliteStats
        });
        if (emitOutput) {
          const summaryLine = (
            `${modeLabel} index built (${counts.code || 0} code, ` +
            `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
          );
          log(summaryLine, {
            fileOnlyLine:
              `${modeLabel} ${mode} index built at ${outputPath} (${counts.code || 0} code, ` +
              `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
          });
        }
        if (resolvedInput.source === 'artifacts' && !resolvedInput.indexDir) {
          throw new Error('Index directory missing for artifact build.');
        }
        if (mode === 'code' && vectorAnnEnabled && !hadVectorTable) {
          await setSqliteModeVectorMissingState({
            root,
            userConfig,
            indexRoot,
            mode,
            path: outputPath,
            schemaVersion: SCHEMA_VERSION,
            threadLimits
          });
        }
        if (sqliteStats?.bundleWorkerAutotune && bundleWorkerProfile?.modes) {
          bundleWorkerProfile.modes[mode] = {
            threads: sqliteStats.bundleWorkerAutotune.threads,
            reason: sqliteStats.bundleWorkerAutotune.reason,
            bundleCount: sqliteStats.bundleWorkerAutotune.bundleCount,
            avgBundleBytes: sqliteStats.bundleWorkerAutotune.avgBundleBytes,
            updatedAt: new Date().toISOString()
          };
          await saveSqliteBundleWorkerProfile({
            profilePath: bundleWorkerProfilePath,
            profile: bundleWorkerProfile
          });
        }
        done += 1;
        buildModeTask.set(done, modeList.length, { message: `${mode} done` });
      } catch (err) {
        if (tempOutputPath) {
          try {
            await fs.rm(tempOutputPath, { force: true });
          } catch {}
        }
        const errorMessage = err?.message || String(err);
        stageCheckpoints.record({
          stage: 'stage4',
          step: 'error',
          label: errorMessage
        });
        await setSqliteModeFailedState({
          root,
          userConfig,
          indexRoot,
          mode,
          path: outputPath,
          schemaVersion: SCHEMA_VERSION,
          threadLimits,
          error: errorMessage
        });
        if (emitOutput) {
          error(`${modeLabel} failed: ${errorMessage}`);
          if (err?.stack) {
            error(err.stack);
          }
        }
        if (exitOnError) process.exit(1);
        throw err;
      } finally {
        await stageCheckpoints.flush();
        // buildDatabaseFromArtifacts/buildDatabaseFromBundles close their DB handles internally.
      }
    }
    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage4', 'done');
    }

    if (emitOutput && incrementalRequested) {
      const summary = modeList.length > 1 ? 'indexes updated' : 'index updated';
      log(`[sqlite] ${summary}.`);
    }
    return { ok: true, mode: modeArg, outPath, outputPaths: modeOutputPaths };
  } finally {
    finalize();
  }
}

export const sqliteBuildRunnerInternals = Object.freeze({
  resolveSqliteBundleWorkerProfilePath,
  resolveBundleWorkerAutotune
});
