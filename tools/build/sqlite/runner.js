import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTaskFactory, createToolDisplay } from '../../shared/cli-display.js';
import { createTempPath } from './temp-path.js';
import { updateSqliteState } from './index-state.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../../src/index/build/build-state.js';
import { ensureDiskSpace, estimateDirBytes } from '../../../src/shared/disk-space.js';
import {
  getIndexDir,
  getModelConfig,
  getRepoCacheRoot,
  getToolVersion,
  loadUserConfig,
  resolveIndexRoot,
  resolveRepoRootArg,
  resolveSqlitePaths
} from '../../shared/dict-utils.js';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension
} from '../../sqlite/vector-extension.js';
import { compactDatabase } from '../compact-sqlite-index.js';
import { loadIncrementalManifest } from '../../../src/storage/sqlite/incremental.js';
import { removeSqliteSidecars, replaceSqliteDatabase } from '../../../src/storage/sqlite/utils.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { resolveOutputPaths } from './output-paths.js';

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
  const display = externalLogger
    ? null
    : createToolDisplay({ argv, stream: process.stderr });
  const taskFactory = createTaskFactory(display);
  let stopHeartbeat = () => {};
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    stopHeartbeat();
    if (display) display.close();
  };
  process.once('exit', finalize);
  const emit = (handler, fallback, message) => {
    if (!emitOutput || !message) return;
    if (typeof handler === 'function') {
      handler(message);
      return;
    }
    if (typeof fallback === 'function') fallback(message);
  };
  const log = (message) => {
    emit(externalLogger?.log, display?.log, message);
  };
  const warn = (message) => {
    emit(externalLogger?.warn || externalLogger?.log, display?.warn, message);
  };
  const error = (message) => {
    emit(externalLogger?.error || externalLogger?.log, display?.error, message);
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
  if (!Database) return bail('better-sqlite3 is required. Run npm install first.');

  try {
    const root = resolveRepoRootArg(options.root || argv.repo);
    const envConfig = getEnvConfig();
    const userConfig = loadUserConfig(root);
    const indexRoot = argv['index-root']
      ? path.resolve(argv['index-root'])
      : resolveIndexRoot(root, userConfig);
    const buildStatePath = resolveBuildStatePath(indexRoot);
    const hasBuildState = buildStatePath && fsSync.existsSync(buildStatePath);
    stopHeartbeat = hasBuildState ? startBuildHeartbeat(indexRoot, 'stage4') : () => {};
    const envelope = resolveRuntimeEnvelope({
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
    const threadLimits = {
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
    const { outPath, codeOutPath, proseOutPath, extractedProseOutPath, recordsOutPath } = resolveOutputPaths({
      modeArg,
      outArg: argv.out,
      sqlitePaths
    });
    const logPrefix = modeArg === 'all' ? '[sqlite]' : `[sqlite:${modeArg}]`;
    const explicitDirs = {
      code: argv['code-dir'] ? path.resolve(argv['code-dir']) : null,
      prose: argv['prose-dir'] ? path.resolve(argv['prose-dir']) : null,
      'extracted-prose': argv['extracted-prose-dir'] ? path.resolve(argv['extracted-prose-dir']) : null,
      records: argv['records-dir'] ? path.resolve(argv['records-dir']) : null
    };
    const resolveIndexDir = (mode) => (
      explicitDirs[mode] || getIndexDir(root, mode, userConfig, { indexRoot })
    );
    const indexDir = modeArg === 'all' ? null : resolveIndexDir(modeArg);
    const repoCacheRoot = getRepoCacheRoot(root, userConfig);
    const incrementalRequested = argv.incremental === true;
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
    for (const mode of modeList) {
      const pieces = await loadIndexPieces(modeIndexDirs[mode]);
      if (pieces) indexPieces[mode] = pieces;
    }
    const compactMode = argv.compact === true || (argv.compact == null && argv['no-compact'] !== true);

    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage4', 'running');
    }

    const buildModeTask = taskFactory('SQLite', { total: modeList.length, stage: 'sqlite' });
    let done = 0;
    for (const mode of modeList) {
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
      let hasIncrementalBundles = Boolean(
        incrementalData?.manifest
        && incrementalFileCount > 0
        && incrementalBundleCount > 0
        && incrementalBundleDir
      );
      let resolvedInput = null;
      let tempOutputPath = null;
      let inputBytes = 0;
      const workTask = taskFactory('Build', { stage: 'sqlite', mode });
      try {
        await fs.mkdir(outDir, { recursive: true });
        const pieces = indexPieces?.[mode];
        if (!pieces) {
          throw new Error(`Missing index pieces for ${mode}.`);
        }
        const expectedDenseCount = Number.isFinite(pieces?.denseVec?.vectors?.length)
          ? pieces.denseVec.vectors.length
          : 0;
        const bundleManifest = incrementalData?.manifest || null;
        let bundleSkipReason = null;
        if (hasIncrementalBundles && expectedDenseCount > 0 && bundleManifest?.bundleEmbeddings === false) {
          const stageNote = bundleManifest.bundleEmbeddingStage
            ? ` (stage ${bundleManifest.bundleEmbeddingStage})`
            : '';
          bundleSkipReason = `bundles omit embeddings${stageNote}`;
          hasIncrementalBundles = false;
        }
        if (incrementalRequested && emitOutput && bundleSkipReason) {
          log(`[sqlite] Incremental bundles skipped for ${mode}: ${bundleSkipReason}.`);
        } else if (incrementalRequested && !hasIncrementalBundles && emitOutput && incrementalData?.manifest) {
          log('[sqlite] Incremental bundles unavailable; falling back to artifacts.');
        }
        resolvedInput = hasIncrementalBundles
          ? { source: 'incremental', bundleDir: incrementalBundleDir }
          : { source: 'artifacts', indexDir: modeIndexDir };
        const resolvedVectorConfig = {
          ...vectorConfig,
          enabled: vectorAnnEnabled && (mode === 'code' || mode === 'prose' || mode === 'extracted-prose')
        };

        if (incrementalRequested && fsSync.existsSync(outputPath) && incrementalData?.manifest) {
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
            logger: externalLogger || { log, warn, error }
          });
          if (updateResult?.used) {
            const counts = readSqliteCounts(outputPath);
            const durationMs = Date.now() - startTs;
            let stat = null;
            try {
              stat = await fs.stat(outputPath);
            } catch {}
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
              note: 'incremental update'
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
            logger: externalLogger || { log, warn, error }
          });
          const missingDense = vectorAnnEnabled && expectedDenseCount > 0 && bundleResult?.denseCount === 0;
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
              task: workTask
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
            task: workTask
          });
        }
        const hadVectorTable = await hasVectorTable(Database, tempOutputPath);
        if (compactMode) {
          const compacted = await compactDatabase({
            dbPath: tempOutputPath,
            mode,
            vectorExtension: vectorExtension,
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
          note
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
