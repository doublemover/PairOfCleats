import { normalizeFtsVariants } from '../../fts-variants.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { observeStorageResource } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createTempPath } from '../../../../shared/json-stream/atomic.js';
import { ensureDiskSpace, estimateDirBytes } from '../../../../shared/disk-space.js';
import { createStageCheckpointRecorder } from '../../../../index/build/stage-checkpoints.js';
import { resolveVectorExtensionConfigForMode } from '../../../../../tools/sqlite/vector-extension.js';
import { compactDatabase } from '../../../../../tools/build/compact-sqlite-index.js';
import { loadIncrementalManifest } from '../../incremental.js';
import {
  removeSqliteSidecars,
  replaceSqliteDatabase,
  resolveExpectedDenseCount
} from '../../utils.js';
import { buildDatabaseFromArtifacts } from '../from-artifacts.js';
import { buildDatabaseFromBundles } from '../from-bundles.js';
import { incrementalUpdateDatabase } from '../incremental-update.js';
import {
  BUNDLE_LOADER_WORKER_PATH,
  saveSqliteBundleWorkerProfile,
  writeSqliteZeroStateManifest
} from './config.js';
import { resolveBundleWorkerAutotune } from './build.js';
import {
  countMissingBundleFiles,
  listIncrementalBundleFiles,
  resolveIncrementalInputPlan
} from './incremental.js';
import {
  hasVectorTableAtPath,
  readSqliteCounts,
  readSqliteModeCount
} from './sqlite-probes.js';
import {
  classifySqliteModeBuildFailure,
  createSqliteModeRowLedger,
  validateSqliteRowLedgerPostImport,
  validateSqliteRowLedgerPreImport
} from './row-ledger.js';
import {
  formatBundleManifest,
  formatEmbedStats,
  formatVectorAnnState
} from './logging.js';
import { createModeReporter } from './reporting-state-transitions.js';
import { resolveModeSelectionPlan } from './selection-planning.js';
import { withSqliteStorageOperation, getSqliteStorageOperation } from '../storage-operation.js';

/**
 * Execute sqlite build orchestration for all selected modes.
 *
 * Keeps behavior parity with the previous monolithic runner while isolating
 * per-mode orchestration from selection/reporting responsibilities.
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export const executeSqliteModeBuilds = input => withSqliteStorageOperation({ repoRoot: input.root, userConfig: input.userConfig },
  Object.values(input.modeOutputPaths || {}).filter(Boolean).map(value => path.resolve(value)),
  () => executeSqliteModeBuildsOwned(input));

const executeSqliteModeBuildsOwned = async ({
  Database,
  argv,
  validateMode,
  emitOutput,
  exitOnError,
  externalLogger,
  taskFactory,
  logger,
  schemaVersion,
  bail,
  modeList,
  indexRoot,
  modeIndexRoots = null,
  modeStateRoots = null,
  modeIndexDirs,
  modeOutputPaths,
  modeChunkCountHints,
  root,
  userConfig,
  metricsDir,
  modelConfig,
  vectorExtension,
  vectorAnnEnabled,
  vectorConfig,
  sqliteSharedDb,
  logPrefix,
  repoCacheRoot,
  bundleWorkerProfilePath,
  bundleWorkerProfile,
  incrementalRequested,
  batchSizeOverride,
  resolveAdaptiveBatchConfig,
  indexPieces,
  indexPieceErrors,
  compactMode,
  envConfig,
  threadLimits,
  signal = null
}) => {
  throwIfAborted(signal);
  const requestedFtsVariants = normalizeFtsVariants(argv['fts-variants'] ?? [
    ...(userConfig?.search?.sqliteFtsStemming === true ? ['porter'] : [])
  ]);
  const { log, warn, error } = logger;
  const buildModeTask = taskFactory('SQLite', { total: modeList.length, stage: 'sqlite' });
  let done = 0;

  for (const mode of modeList) {
    throwIfAborted(signal);
    const modeIndexRoot = modeIndexRoots?.[mode] || indexRoot;
    const stateRoot = modeStateRoots ? modeStateRoots[mode] : modeIndexRoot;
    const stageCheckpoints = createStageCheckpointRecorder({
      buildRoot: stateRoot,
      metricsDir,
      mode,
      buildId: modeIndexRoot ? path.basename(modeIndexRoot) : null
    });
    const startTs = Date.now();
    const {
      modeLabel,
      outputPath,
      outDir,
      modeIndexDir,
      modeChunkCountHint,
      modeDenseCountHint,
      modeRowCountHint,
      outputExists,
      sqliteRuntime
    } = resolveModeSelectionPlan({
      repoRoot: root,
      userConfig,
      mode,
      modeIndexDirs,
      modeOutputPaths,
      modeChunkCountHints,
      indexPieces,
      logPrefix,
      Database
    });
    if (!outputPath) {
      return bail('SQLite output path could not be resolved.');
    }
    const reporter = createModeReporter({
      mode,
      modeLabel,
      outputPath,
      root,
      userConfig,
      indexRoot: modeIndexRoot,
      indexDir: modeIndexDir,
      stateUpdates: Boolean(stateRoot),
      schemaVersion,
      threadLimits,
      stageCheckpoints,
      emitOutput,
      logger: { log, error }
    });
    let tempOutputPath = null;
    let modeFailure, modeFailed = false;
    try {
      throwIfAborted(signal);
      const logDetails = [];

      reporter.logBuildStart();
      await reporter.setRunningState();
      throwIfAborted(signal);

      const modeIsZeroState = Boolean(stateRoot) && modeChunkCountHint === 0 && modeDenseCountHint === 0;
      if (modeIsZeroState) {
        const existingRows = outputExists
          ? readSqliteModeCount({
            repoRoot: root,
            userConfig,
            Database,
            dbPath: outputPath,
            mode
          })
          : 0;
        if (!outputExists || existingRows === 0) {
          const zeroStateManifestPath = await writeSqliteZeroStateManifest({
            modeIndexDir,
            mode,
            outputPath,
            chunkCount: modeChunkCountHint,
            denseCount: modeDenseCountHint
          });
          throwIfAborted(signal);
          await reporter.reportSkippedEmpty({
            existingRows: outputExists ? 0 : null,
            denseCount: modeDenseCountHint,
            zeroStateManifestPath
          });
          done += 1;
          buildModeTask.set(done, modeList.length, { message: `${mode} skipped` });
          continue;
        }
      }

      const incrementalData = loadIncrementalManifest(repoCacheRoot, mode, { repoRoot: root });
      const incrementalBundleDir = incrementalData?.bundleDir || null;
      const incrementalFiles = incrementalData?.manifest?.files;
      const incrementalFileCount = incrementalFiles && typeof incrementalFiles === 'object'
        ? Object.keys(incrementalFiles).length
        : 0;
      const bundleInventory = listIncrementalBundleFiles(incrementalBundleDir);
      const incrementalBundleCount = bundleInventory.count;
      const missingBundleCount = countMissingBundleFiles(incrementalData, bundleInventory.names);
      let resolvedInput = null;
      let inputBytes = 0;
      const sqliteStats = {};
      const workTask = taskFactory('Build', { stage: 'sqlite', mode });

      throwIfAborted(signal);
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
        const manifestLine = formatBundleManifest(bundleManifest);
        if (manifestLine) {
          log(`[sqlite] bundle manifest ${mode}: ${manifestLine}.`);
        }
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
      const createModeRowLedger = ({
        source = resolvedInput?.source,
        expectedChunkCount = modeChunkCountHint,
        inputRoot = source === 'incremental' ? incrementalBundleDir : modeIndexDir
      } = {}) => createSqliteModeRowLedger({
        mode,
        source,
        expectedChunkCount,
        expectedDenseCount,
        expectedFileCount: repoFileCountHint,
        inputRoot
      });
      let activeRowLedger = createModeRowLedger();
      let decodedArtifactChunks = null;
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
      sqliteStats.rowLedger = activeRowLedger;
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

      /**
       * Recompute adaptive ingest controls whenever input byte/file hints change.
       * This keeps batch sizing and transaction boundaries consistent with the
       * latest selected source (incremental bundles vs artifacts).
       *
       * @param {object} [hints]
       * @param {number} [hints.inputBytesHint]
       * @param {number} [hints.fileCountHint]
       * @param {number} [hints.repoBytesHint]
       * @returns {{config:object,plan:object}}
       */
      const applyAdaptivePlan = ({
        inputBytesHint = 0,
        fileCountHint = repoFileCountHint,
        repoBytesHint = 0
      } = {}) => {
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
      reporter.recordStartCheckpoint({
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
      });

      if (
        incrementalRequested
        && outputExists
        && incrementalData?.manifest
        && missingBundleCount === 0
        && recordsIncrementalSupported
      ) {
        const updateResult = await incrementalUpdateDatabase({
          signal,
          repoRoot: root,
          ftsVariants: mode === 'code' ? requestedFtsVariants.filter(value => value !== 'porter') : requestedFtsVariants,
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
        } else if (updateResult?.mutated === true) {
          throw new Error(
            `[sqlite] incremental update for ${mode} reported skip after mutating output DB; refusing fallback rebuild.`
          );
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
            repoRoot: root,
            userConfig,
            Database,
            dbPath: outputPath
          });
          const durationMs = Date.now() - startTs;
          let stat = null;
          try {
            stat = await fs.stat(outputPath);
          } catch {}
          await reporter.reportIncrementalReady({
            counts,
            outputBytes: Number(stat?.size) || 0,
            durationMs,
            sqliteStats
          });
          done += 1;
          buildModeTask.set(done, modeList.length, { message: `${mode} done` });
          continue;
        }
        if (emitOutput && updateResult?.used === false && updateResult.reason) {
          warn(`[sqlite] incremental update skipped for ${mode}: ${updateResult.reason}.`);
        }
      } else if (
        incrementalRequested
        && outputExists
        && incrementalData?.manifest
        && !recordsIncrementalSupported
      ) {
        warn(`[sqlite] incremental update skipped for ${mode}: ${recordsIncrementalCapability.reason}.`);
      } else if (
        incrementalRequested
        && outputExists
        && incrementalData?.manifest
        && missingBundleCount > 0
      ) {
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
          signal,
          repoRoot: root,
          ftsVariants: mode === 'code' ? requestedFtsVariants.filter(value => value !== 'porter') : requestedFtsVariants,
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
        const preImportValidation = validateSqliteRowLedgerPreImport({
          rowLedger: activeRowLedger,
          bundleResult,
          denseArtifactsRequired
        });
        sqliteStats.rowLedgerChecks = {
          ...(sqliteStats.rowLedgerChecks || {}),
          preImport: preImportValidation
        };
        if (!preImportValidation.ok) {
          warn(`[sqlite] incremental bundle build failed for ${mode}: ${preImportValidation.message}; using artifacts.`);
          const embedLine = formatEmbedStats(bundleResult?.embedStats);
          if (embedLine) log(`[sqlite] bundle embeddings ${mode}: ${embedLine}.`);
          const annLine = formatVectorAnnState(bundleResult?.vectorAnn);
          if (annLine) log(`[sqlite] vector extension ${mode}: ${annLine}.`);
          const manifestLine = formatBundleManifest(bundleManifest);
          if (manifestLine) log(`[sqlite] bundle manifest ${mode}: ${manifestLine}.`);
          resolvedInput = { source: 'artifacts', indexDir: modeIndexDir };
          activeRowLedger = createModeRowLedger({
            source: resolvedInput.source,
            inputRoot: modeIndexDir
          });
          sqliteStats.rowLedger = activeRowLedger;
          applyAdaptivePlan({
            inputBytesHint: inputBytes,
            fileCountHint: artifactFileCountHint || repoFileCountHint,
            repoBytesHint: Math.max(sqliteRuntime.dbBytes || 0, inputBytes || 0)
          });
          decodedArtifactChunks = await buildDatabaseFromArtifacts({
            signal,
            repoRoot: root,
            ftsVariants: mode === 'code' ? requestedFtsVariants.filter(value => value !== 'porter') : requestedFtsVariants,
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
        decodedArtifactChunks = await buildDatabaseFromArtifacts({
          signal,
          ftsVariants: mode === 'code' ? requestedFtsVariants.filter(value => value !== 'porter') : requestedFtsVariants,
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
      throwIfAborted(signal);
      if (modeChunkCountHint == null && decodedArtifactChunks !== null) {
        if (!Number.isSafeInteger(decodedArtifactChunks) || decodedArtifactChunks < 0) {
          throw Object.assign(new Error('SQLite source decoder did not confirm its input row count.'), { code: 'ERR_SQLITE_SOURCE_COUNT_UNAVAILABLE' });
        }
        // The artifact producer already counts decoded input rows independently
        // of the database query below. Unknown metadata is never an empty index;
        // reuse that count without another artifact pass or relaxing known claims.
        activeRowLedger = createModeRowLedger({ expectedChunkCount: decodedArtifactChunks });
        sqliteStats.rowLedger = activeRowLedger;
        sqliteStats.rowLedgerInputCountSource = 'decoded-artifact-rows';
      }
      const postImportValidation = validateSqliteRowLedgerPostImport({
        repoRoot: root,
        userConfig,
        rowLedger: activeRowLedger,
        Database,
        dbPath: tempOutputPath,
        annTable: resolvedVectorConfig?.extension?.table || 'dense_vectors_ann'
      });
      sqliteStats.rowLedgerChecks = {
        ...(sqliteStats.rowLedgerChecks || {}),
        postImport: postImportValidation
      };
      if (!postImportValidation.ok) {
        const validationError = new Error(postImportValidation.message);
        validationError.code = postImportValidation.code;
        validationError.failureClass = postImportValidation.failureClass;
        validationError.rowLedger = postImportValidation.rowLedger;
        validationError.observed = postImportValidation.observed;
        throw validationError;
      }
      const hadVectorTable = resolvedVectorConfig?.enabled === true
        ? hasVectorTableAtPath({
          repoRoot: root,
          userConfig,
          Database,
          dbPath: tempOutputPath,
          tableName: resolvedVectorConfig?.extension?.table || 'dense_vectors_ann',
          hasVectorTable: vectorConfig.hasVectorTable
        })
        : false;
      if (compactMode) {
        const compacted = await compactDatabase({
          storageContext: { repoRoot: root, userConfig },
          dbPath: tempOutputPath,
          mode,
          vectorExtension: resolvedVectorConfig.extension,
          logger: externalLogger || { log, warn, error }
        });
        if (compacted) logDetails.push('compacted');
      }
      throwIfAborted(signal);
      await replaceSqliteDatabase(tempOutputPath, outputPath, { signal });
      tempOutputPath = null;
      const counts = readSqliteCounts({
        repoRoot: root,
        userConfig,
        Database,
        dbPath: outputPath
      });
      const durationMs = Date.now() - startTs;
      const stat = await fs.stat(outputPath);
      const note = logDetails.length ? logDetails.join(', ') : null;
      await reporter.reportBuildReady({
        counts,
        inputBytes,
        outputBytes: Number(stat?.size) || 0,
        durationMs,
        note,
        sqliteStats
      });
      if (resolvedInput.source === 'artifacts' && !resolvedInput.indexDir) {
        throw new Error('Index directory missing for artifact build.');
      }
      if (mode === 'code' && vectorAnnEnabled && !hadVectorTable) {
        await reporter.setVectorMissingState();
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
      modeFailed = true; modeFailure = err;
      getSqliteStorageOperation()?.retainFailure(err);
      let resourcesSettled = false;
      try { observeStorageResource(err, { phase: 'sqlite-build-failure' }).requireSettled(); resourcesSettled = true; }
      catch (pending) { err = pending; }
      if (tempOutputPath && resourcesSettled) {
        let mainRemoved = true;
        try {
          await fs.rm(tempOutputPath, { force: true });
        } catch (cleanup) {
          if (!['ENOENT', 'ENOTDIR'].includes(cleanup?.code)) {
            mainRemoved = false;
            err = addStorageFailureContext(err, {}, cleanup, { secondaryPresent: true });
          }
        }
        if (mainRemoved) {
          try { await removeSqliteSidecars(tempOutputPath); }
          catch (cleanup) { err = addStorageFailureContext(err, {}, cleanup, { secondaryPresent: true }); }
        }
      }
      modeFailure = err;
      const errorMessage = err?.message || String(err);
      try { await reporter.reportFailure({ errorMessage, err }); }
      catch (reporting) { err = addStorageFailureContext(err, {}, reporting, { secondaryPresent: true }); }
      if (err && typeof err === 'object') {
        const classifiedFailure = classifySqliteModeBuildFailure(err);
        modeFailure = addStorageFailureContext(err, {
          code: err.code || classifiedFailure.code,
          failureClass: err.failureClass || classifiedFailure.failureClass,
          exitCode: Number.isFinite(Number(err.exitCode)) ? err.exitCode : 1,
          exitOnError: exitOnError === true
        });
        throw modeFailure;
      }
      const wrapped = new Error(errorMessage);
      const classifiedFailure = classifySqliteModeBuildFailure(wrapped);
      wrapped.code = classifiedFailure.code;
      wrapped.failureClass = classifiedFailure.failureClass;
      wrapped.exitCode = 1;
      wrapped.exitOnError = exitOnError === true;
      modeFailure = wrapped;
      throw wrapped;
    } finally {
      try { await stageCheckpoints.flush(); }
      catch (cleanup) { throw modeFailed ? addStorageFailureContext(modeFailure, {}, cleanup, { secondaryPresent: true }) : cleanup; }
      // buildDatabaseFromArtifacts/buildDatabaseFromBundles close their DB handles internally.
    }
  }
};
