import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from '../../../../shared/env.js';
import { resolveRuntimeEnvelope } from '../../../../shared/runtime-envelope.js';
import { resolveBuildStatePath } from '../../../../index/build/build-state.js';
import {
  getMetricsDir,
  getModelConfig,
  getRepoCacheRoot,
  getToolVersion,
  loadUserConfig,
  resolveRepoRootArg,
  resolveSqlitePaths
} from '../../../../shared/dict-utils.js';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension
} from '../../../../../tools/sqlite/vector-extension.js';
import { loadIndexPieces } from '../from-artifacts.js';
import { resolveOutputPaths } from '../output-paths.js';
import { createAdaptiveBatchPlanner, probeSqliteTargetRuntime } from './build.js';
import { resolveChunkMetaTotalRecords, resolveChunkMetaTotalRecordsFromSources } from './chunk-meta.js';
import { loadSqliteBundleWorkerProfile } from './config.js';
import { resolveModeExecutionPlan } from './mode-plan.js';
import { resolveExpectedDenseCount } from './sqlite-probes.js';

const resolveThreadLimits = (envelope) => ({
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
});

const loadModeIndexPieces = async (modeList, modeIndexDirs) => {
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
  return { indexPieces, indexPieceErrors };
};

/**
 * Resolve chunk-count hints for each mode.
 *
 * Uses `loadIndexPieces().chunkMetaSources` first so we can reuse metadata already
 * touched during piece discovery. This avoids a second manifest walk in the
 * mode loop when metadata already carries deterministic counts.
 *
 * @param {object} input
 * @param {string[]} input.modeList
 * @param {Record<string,string>} input.modeIndexDirs
 * @param {Record<string,object>} input.indexPieces
 * @returns {Record<string,number|null>}
 */
const resolveModeChunkCountHints = ({ modeList, modeIndexDirs, indexPieces }) => {
  const hints = {};
  for (const mode of modeList) {
    const sourceHint = resolveChunkMetaTotalRecordsFromSources(indexPieces?.[mode]?.chunkMetaSources);
    hints[mode] = sourceHint == null
      ? resolveChunkMetaTotalRecords(modeIndexDirs[mode])
      : sourceHint;
  }
  return hints;
};

/**
 * Resolve immutable build-wide selection and planning state.
 *
 * The returned payload is intentionally free of mode-local side effects so the
 * execution stage can focus on build mechanics and error handling.
 *
 * @param {object} input
 * @param {any} input.Database
 * @param {object} input.argv
 * @param {string} input.modeArg
 * @param {string[]} input.parsedRawArgs
 * @param {object} [input.options]
 * @returns {Promise<object>}
 */
export const resolveRunnerSelectionPlan = async ({
  Database,
  argv,
  modeArg,
  parsedRawArgs,
  options = {}
}) => {
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
    return { errorMessage: modePlan.errorMessage };
  }

  const {
    modeList,
    indexRoot,
    modeIndexDirs
  } = modePlan;
  const buildStatePath = resolveBuildStatePath(indexRoot);
  const hasBuildState = buildStatePath && fsSync.existsSync(buildStatePath);
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
  const threadLimits = options.threadLimits || resolveThreadLimits(envelope);
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
  const {
    indexPieces,
    indexPieceErrors
  } = await loadModeIndexPieces(modeList, modeIndexDirs);
  const modeChunkCountHints = resolveModeChunkCountHints({
    modeList,
    modeIndexDirs,
    indexPieces
  });
  const compactMode = argv.compact === true || (argv.compact == null && argv['no-compact'] !== true);

  return {
    modeList,
    indexRoot,
    modeIndexDirs,
    outPath,
    modeOutputPaths,
    hasBuildState,
    root,
    envConfig,
    userConfig,
    metricsDir,
    threadLimits,
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
    modeChunkCountHints,
    compactMode
  };
};

/**
 * Resolve mode-local selection data from the build-wide plan.
 *
 * `outputExists` is intentionally captured once and reused for zero-state and
 * incremental eligibility checks to avoid redundant synchronous existence probes.
 *
 * @param {object} input
 * @param {string} input.mode
 * @param {Record<string,string>} input.modeIndexDirs
 * @param {Record<string,string>} input.modeOutputPaths
 * @param {Record<string,number|null>} input.modeChunkCountHints
 * @param {Record<string,object>} input.indexPieces
 * @param {string} input.logPrefix
 * @param {any} input.Database
 * @returns {object}
 */
export const resolveModeSelectionPlan = ({
  mode,
  modeIndexDirs,
  modeOutputPaths,
  modeChunkCountHints,
  indexPieces,
  logPrefix,
  Database
}) => {
  const outputPath = modeOutputPaths[mode];
  const modeIndexDir = modeIndexDirs[mode];
  const modeChunkCountHint = modeChunkCountHints?.[mode] ?? null;
  const modeDenseCountHint = resolveExpectedDenseCount(indexPieces?.[mode]?.denseVec);
  const modeRowCountHint = Number.isFinite(Number(modeChunkCountHint)) && Number(modeChunkCountHint) > 0
    ? Number(modeChunkCountHint)
    : 0;
  const outputExists = outputPath ? fsSync.existsSync(outputPath) : false;
  return {
    modeLabel: `${logPrefix} ${mode}`,
    outputPath,
    outDir: outputPath ? path.dirname(outputPath) : null,
    modeIndexDir,
    modeChunkCountHint,
    modeDenseCountHint,
    modeRowCountHint,
    outputExists,
    sqliteRuntime: probeSqliteTargetRuntime({
      Database,
      dbPath: outputPath
    })
  };
};
