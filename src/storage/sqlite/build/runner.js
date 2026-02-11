import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTempPath } from '../../../shared/json-stream.js';
import { resolveTaskFactory } from '../../../shared/cli/noop-task.js';
import { updateSqliteState } from './index-state.js';
import { getEnvConfig } from '../../../shared/env.js';
import { resolveRuntimeEnvelope } from '../../../shared/runtime-envelope.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../../index/build/build-state.js';
import { createStageCheckpointRecorder } from '../../../index/build/stage-checkpoints.js';
import { ensureDiskSpace, estimateDirBytes } from '../../../shared/disk-space.js';
import {
  getIndexDir,
  getMetricsDir,
  getModelConfig,
  getRepoCacheRoot,
  getToolVersion,
  loadUserConfig,
  resolveIndexRoot,
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

export const normalizeValidateMode = (value) => {
  if (value === false || value == null) return 'off';
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'true') return 'smoke';
  if (['off', 'false', '0', 'no'].includes(normalized)) return 'off';
  if (['full', 'integrity'].includes(normalized)) return 'full';
  if (['auto', 'adaptive'].includes(normalized)) return 'auto';
  return 'smoke';
};

const normalizeModeArg = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['code', 'prose', 'extracted-prose', 'records', 'all'].includes(normalized)) {
    return normalized;
  }
  return 'all';
};

const countMissingBundleFiles = (incrementalData) => {
  const bundleDir = incrementalData?.bundleDir;
  const files = incrementalData?.manifest?.files;
  if (!bundleDir || !files || typeof files !== 'object') return 0;
  let missing = 0;
  for (const entry of Object.values(files)) {
    const bundleName = entry?.bundle;
    if (!bundleName || typeof bundleName !== 'string') {
      missing += 1;
      continue;
    }
    const bundlePath = path.join(bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) {
      missing += 1;
    }
  }
  return missing;
};

/**
 * Build sqlite indexes without CLI parsing.
 * @param {object} options
 * @param {string} options.root
 * @param {string} [options.mode]
 * @param {boolean} [options.incremental]
 * @param {boolean} [options.compact]
 * @param {string} [options.out]
 * @param {string} [options.indexRoot]
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
  const log = (message) => {
    if (!emitOutput || !message) return;
    if (typeof externalLogger?.log === 'function') {
      externalLogger.log(message);
      return;
    }
    console.error(message);
  };
  const warn = (message) => {
    if (!emitOutput || !message) return;
    if (typeof externalLogger?.warn === 'function') {
      externalLogger.warn(message);
      return;
    }
    if (typeof externalLogger?.log === 'function') {
      externalLogger.log(message);
      return;
    }
    console.error(message);
  };
  const error = (message) => {
    if (!emitOutput || !message) return;
    if (typeof externalLogger?.error === 'function') {
      externalLogger.error(message);
      return;
    }
    if (typeof externalLogger?.log === 'function') {
      externalLogger.log(message);
      return;
    }
    console.error(message);
  };
  const bail = (message, code = 1) => {
    if (message) error(message);
    finalize();
    if (exitOnError) process.exit(code);
    throw new Error(message || 'SQLite index build failed.');
  };
  /**
   * Format embedding stats for logging.
   * @param {object|null} stats
   * @returns {string|null}
   */
  const formatEmbedStats = (stats) => {
    if (!stats || typeof stats !== 'object') return null;
    const parts = [];
    if (Number.isFinite(stats.denseChunks) || Number.isFinite(stats.totalChunks)) {
      const dense = Number.isFinite(stats.denseChunks) ? stats.denseChunks : 0;
      const total = Number.isFinite(stats.totalChunks) ? stats.totalChunks : 0;
      parts.push(`chunks ${dense}/${total}`);
    }
    if (Number.isFinite(stats.denseFloatChunks) || Number.isFinite(stats.denseU8Chunks)) {
      const floatChunks = Number.isFinite(stats.denseFloatChunks) ? stats.denseFloatChunks : 0;
      const u8Chunks = Number.isFinite(stats.denseU8Chunks) ? stats.denseU8Chunks : 0;
      parts.push(`float=${floatChunks} u8=${u8Chunks}`);
    }
    if (Number.isFinite(stats.filesTotal)) {
      const withEmbeddings = Number.isFinite(stats.filesWithEmbeddings) ? stats.filesWithEmbeddings : 0;
      const totalFiles = Number.isFinite(stats.filesTotal) ? stats.filesTotal : 0;
      const missing = Number.isFinite(stats.filesMissingEmbeddings) ? stats.filesMissingEmbeddings : 0;
      parts.push(`files ${withEmbeddings}/${totalFiles} (missing ${missing})`);
    }
    if (Array.isArray(stats.sampleMissingFiles) && stats.sampleMissingFiles.length) {
      parts.push(`sample missing: ${stats.sampleMissingFiles.join(', ')}`);
    }
    return parts.length ? parts.join(', ') : null;
  };
  /**
   * Format vector extension state for logging.
   * @param {object|null} state
   * @returns {string|null}
   */
  const formatVectorAnnState = (state) => {
    if (!state || typeof state !== 'object') return null;
    const parts = [
      `enabled=${state.enabled === true}`,
      `loaded=${state.loaded === true}`,
      `ready=${state.ready === true}`
    ];
    if (state.table) parts.push(`table=${state.table}`);
    if (state.column) parts.push(`column=${state.column}`);
    if (state.reason) parts.push(`reason=${state.reason}`);
    return parts.join(', ');
  };
  /**
   * Format incremental bundle manifest metadata for logging.
   * @param {object|null} manifest
   * @returns {string|null}
   */
  const formatBundleManifest = (manifest) => {
    if (!manifest || typeof manifest !== 'object') return null;
    const parts = [];
    if (manifest.bundleEmbeddings !== undefined) {
      parts.push(`bundleEmbeddings=${manifest.bundleEmbeddings}`);
    }
    if (manifest.bundleEmbeddingStage) parts.push(`bundleEmbeddingStage=${manifest.bundleEmbeddingStage}`);
    if (manifest.bundleEmbeddingMode) parts.push(`bundleEmbeddingMode=${manifest.bundleEmbeddingMode}`);
    if (manifest.bundleEmbeddingIdentityKey) {
      parts.push(`bundleEmbeddingIdentityKey=${manifest.bundleEmbeddingIdentityKey}`);
    }
    return parts.length ? parts.join(', ') : null;
  };
  const readSqliteCounts = (dbPath) => {
    const counts = {};
    let db = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const rows = db.prepare('SELECT mode, COUNT(*) AS total FROM chunks GROUP BY mode').all();
      for (const row of rows || []) {
        if (!row?.mode) continue;
        counts[row.mode] = Number.isFinite(row.total) ? row.total : 0;
      }
    } catch {}
    if (db) {
      try {
        db.close();
      } catch {}
    }
    return counts;
  };
  const resolveExpectedDenseCount = (denseVec) => {
    if (!denseVec || typeof denseVec !== 'object') return 0;
    const fields = denseVec.fields && typeof denseVec.fields === 'object' ? denseVec.fields : null;
    const fromCount = Number(denseVec.count ?? fields?.count);
    if (Number.isFinite(fromCount) && fromCount > 0) return Math.floor(fromCount);
    const fromTotalRecords = Number(denseVec.totalRecords ?? fields?.totalRecords);
    if (Number.isFinite(fromTotalRecords) && fromTotalRecords > 0) return Math.floor(fromTotalRecords);
    const vectors = denseVec.vectors ?? denseVec.arrays?.vectors;
    if (Array.isArray(vectors) && vectors.length > 0) return vectors.length;
    return 0;
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
    const indexRoot = argv['index-root']
      ? path.resolve(argv['index-root'])
      : (options.indexRoot
        ? path.resolve(options.indexRoot)
        : (runtime?.buildRoot ? path.resolve(runtime.buildRoot) : resolveIndexRoot(root, userConfig)));
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
    const explicitDirs = {
      code: argv['code-dir']
        ? path.resolve(argv['code-dir'])
        : (options.codeDir ? path.resolve(options.codeDir) : null),
      prose: argv['prose-dir']
        ? path.resolve(argv['prose-dir'])
        : (options.proseDir ? path.resolve(options.proseDir) : null),
      'extracted-prose': argv['extracted-prose-dir']
        ? path.resolve(argv['extracted-prose-dir'])
        : (options.extractedProseDir ? path.resolve(options.extractedProseDir) : null),
      records: argv['records-dir']
        ? path.resolve(argv['records-dir'])
        : (options.recordsDir ? path.resolve(options.recordsDir) : null)
    };
    const resolveIndexDir = (mode) => (
      explicitDirs[mode] || getIndexDir(root, mode, userConfig, { indexRoot })
    );
    const indexDir = modeArg === 'all' ? null : resolveIndexDir(modeArg);
    const repoCacheRoot = options.repoCacheRoot || runtime?.repoCacheRoot || getRepoCacheRoot(root, userConfig);
    const incrementalRequested = argv.incremental === true;
    const requestedBatchSize = Number(argv['batch-size'] ?? options.batchSize);
    const batchSizeOverride = Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
      ? Math.floor(requestedBatchSize)
      : null;
    const modeList = modeArg === 'all'
      ? ['code', 'prose', 'extracted-prose', 'records']
      : [modeArg];
    const modeOutputPaths = {
      code: codeOutPath,
      prose: proseOutPath,
      'extracted-prose': extractedProseOutPath,
      records: recordsOutPath
    };
    const modeIndexDirs = {};
    for (const mode of modeList) {
      modeIndexDirs[mode] = resolveIndexDir(mode);
    }
    const indexPieces = {};
    const indexPieceErrors = {};
    for (const mode of modeList) {
      try {
        const pieces = await loadIndexPieces(modeIndexDirs[mode]);
        if (pieces) indexPieces[mode] = pieces;
      } catch (err) {
        indexPieceErrors[mode] = err;
      }
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
      const modeIndexDir = modeIndexDirs[mode] || getIndexDir(root, mode, userConfig, { indexRoot });
      const outputPath = modeOutputPaths[mode];
      if (!outputPath) return bail('SQLite output path could not be resolved.');
      const outDir = path.dirname(outputPath);
      const logDetails = [];
      if (emitOutput) {
        log(`${modeLabel} building ${mode} index -> ${outputPath}`);
      }
      const buildState = await updateSqliteState({
        root,
        userConfig,
        indexRoot,
        mode,
        status: 'running',
        path: outputPath,
        schemaVersion: SCHEMA_VERSION,
        threadLimits,
        note: null
      });

      const incrementalData = loadIncrementalManifest(repoCacheRoot, mode);
      const incrementalBundleDir = incrementalData?.bundleDir || null;
      const incrementalFiles = incrementalData?.manifest?.files;
      const incrementalFileCount = incrementalFiles && typeof incrementalFiles === 'object'
        ? Object.keys(incrementalFiles).length
        : 0;
      const incrementalBundleCount = incrementalBundleDir && fsSync.existsSync(incrementalBundleDir)
        ? fsSync.readdirSync(incrementalBundleDir).filter((name) => !name.startsWith('.')).length
        : 0;
      const missingBundleCount = countMissingBundleFiles(incrementalData);
      let hasIncrementalBundles = incrementalRequested && Boolean(
        incrementalData?.manifest
        && incrementalFileCount > 0
        && incrementalBundleCount > 0
        && missingBundleCount === 0
        && incrementalBundleDir
      );
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
        const bundleManifest = incrementalData?.manifest || null;
        let bundleSkipReason = null;
        if (hasIncrementalBundles
          && denseArtifactsRequired
          && bundleManifest?.bundleEmbeddings !== true) {
          const stageNote = bundleManifest.bundleEmbeddingStage
            ? ` (stage ${bundleManifest.bundleEmbeddingStage})`
            : '';
          bundleSkipReason = `bundles omit embeddings${stageNote}`;
          hasIncrementalBundles = false;
        }
        if (missingBundleCount > 0) {
          bundleSkipReason = `bundle file missing (${missingBundleCount})`;
          hasIncrementalBundles = false;
        }
        if (incrementalRequested && emitOutput && !hasIncrementalBundles) {
          const skipMessage = bundleSkipReason
            ? `[sqlite] Incremental bundles skipped for ${mode}: ${bundleSkipReason}; falling back to artifacts.`
            : '[sqlite] Incremental bundles unavailable; falling back to artifacts.';
          if (bundleSkipReason?.includes('bundle file missing')) {
            warn(skipMessage);
          } else {
            log(skipMessage);
          }
        }
        resolvedInput = hasIncrementalBundles
          ? { source: 'incremental', bundleDir: incrementalBundleDir }
          : { source: 'artifacts', indexDir: modeIndexDir };
        const modeVectorExtension = resolveVectorExtensionConfigForMode(vectorExtension, mode, {
          sharedDb: sqliteSharedDb
        });
        const resolvedVectorConfig = {
          ...vectorConfig,
          extension: modeVectorExtension,
          enabled: vectorAnnEnabled && (mode === 'code' || mode === 'prose' || mode === 'extracted-prose')
        };
        stageCheckpoints.record({
          stage: 'stage4',
          step: 'start',
          extra: {
            incrementalRequested: incrementalRequested ? 1 : 0,
            incrementalBundles: hasIncrementalBundles ? 1 : 0,
            incrementalFiles: incrementalFileCount,
            incrementalBundlesCount: incrementalBundleCount,
            missingBundles: missingBundleCount,
            inputSource: resolvedInput.source === 'incremental' ? 1 : 0
          }
        });

        if (incrementalRequested && fsSync.existsSync(outputPath) && incrementalData?.manifest && missingBundleCount === 0) {
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
            batchSize: batchSizeOverride,
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
            const counts = readSqliteCounts(outputPath);
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
            await updateSqliteState({
              root,
              userConfig,
              indexRoot,
              mode,
              status: 'ready',
              path: outputPath,
              schemaVersion: SCHEMA_VERSION,
              bytes: stat?.size,
              inputBytes: 0,
              elapsedMs: durationMs,
              threadLimits,
              note: 'incremental update',
              stats: sqliteStats
            });
            if (emitOutput) {
              log(
                `${modeLabel} sqlite incremental update applied at ${outputPath} (${counts.code || 0} code, ` +
                `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
              );
            }
            done += 1;
            buildModeTask.set(done, modeList.length, { message: `${mode} done` });
            continue;
          }
          if (emitOutput && updateResult?.used === false && updateResult.reason) {
            warn(`[sqlite] Incremental update skipped for ${mode}: ${updateResult.reason}.`);
          }
        } else if (incrementalRequested && fsSync.existsSync(outputPath) && incrementalData?.manifest && missingBundleCount > 0) {
          warn(`[sqlite] Incremental update skipped for ${mode}: bundle file missing (${missingBundleCount}).`);
        }

        tempOutputPath = createTempPath(outputPath);

        if (resolvedInput.source === 'incremental' && resolvedInput.bundleDir) {
          const estimate = await estimateDirBytes(incrementalBundleDir);
          inputBytes = estimate.bytes;
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
            envConfig,
            threadLimits,
            emitOutput,
            validateMode,
            vectorConfig: resolvedVectorConfig,
            modelConfig,
            logger: externalLogger || { log, warn, error },
            inputBytes,
            batchSize: batchSizeOverride,
            stats: sqliteStats
          });
          const missingDense = denseArtifactsRequired && bundleResult?.denseCount === 0;
          const bundleFailureReason = bundleResult?.reason || (missingDense ? 'bundles missing embeddings' : '');
          if (bundleFailureReason) {
            warn(`[sqlite] Incremental bundle build failed for ${mode}: ${bundleFailureReason}; falling back to artifacts.`);
            const embedLine = formatEmbedStats(bundleResult?.embedStats);
            if (embedLine) log(`[sqlite] Bundle embeddings for ${mode}: ${embedLine}.`);
            const annLine = formatVectorAnnState(bundleResult?.vectorAnn);
            if (annLine) log(`[sqlite] Vector extension state for ${mode}: ${annLine}.`);
            const manifestLine = formatBundleManifest(bundleManifest);
            if (manifestLine) log(`[sqlite] Bundle manifest for ${mode}: ${manifestLine}.`);
            resolvedInput = { source: 'artifacts', indexDir: modeIndexDir };
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
              batchSize: batchSizeOverride,
              stats: sqliteStats
            });
          } else {
          }
        } else {
          const estimate = await estimateDirBytes(modeIndexDir);
          inputBytes = estimate.bytes;
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
            batchSize: batchSizeOverride,
            stats: sqliteStats
          });
        }
        const hadVectorTable = await hasVectorTable(Database, tempOutputPath);
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
        const counts = readSqliteCounts(outputPath);
        const durationMs = Date.now() - startTs;
        const stat = await fs.stat(outputPath);
        stageCheckpoints.record({
          stage: 'stage4',
          step: 'build',
          extra: {
            inputBytes,
            outputBytes: Number(stat?.size) || 0,
            batchSize: sqliteStats.batchSize ?? null,
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
        await updateSqliteState({
          root,
          userConfig,
          indexRoot,
          mode,
          status: 'ready',
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
          log(
            `${modeLabel} ${mode} index built at ${outputPath} (${counts.code || 0} code, ` +
            `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
          );
        }
        if (resolvedInput.source === 'artifacts' && !resolvedInput.indexDir) {
          throw new Error('Index directory missing for artifact build.');
        }
        if (mode === 'code' && vectorAnnEnabled && !hadVectorTable) {
          await updateSqliteState({
            root,
            userConfig,
            indexRoot,
            mode,
            status: 'ready',
            path: outputPath,
            schemaVersion: SCHEMA_VERSION,
            threadLimits,
            note: 'vector table missing after build'
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
        await updateSqliteState({
          root,
          userConfig,
          indexRoot,
          mode,
          status: 'failed',
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
      const summary = modeList.length > 1 ? 'SQLite Indexes Updated' : 'SQLite Index Updated';
      log(`[sqlite] ${summary}.`);
    }
    return { ok: true, mode: modeArg, outPath, outputPaths: modeOutputPaths };
  } finally {
    finalize();
  }
}
