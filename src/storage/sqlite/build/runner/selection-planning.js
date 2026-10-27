import fsSync from 'node:fs';
import path from 'node:path';
import { getEnvConfig } from '../../../../shared/env/runtime.js';
import { resolveCurrentProcessRuntimeEnvelope } from '../../../../shared/runtime-envelope/resolve-current-process-envelope.js';
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
import { resolveExpectedDenseCount } from '../../utils.js';
import { createAdaptiveBatchPlanner, probeSqliteTargetRuntime } from './build.js';
import { resolveChunkMetaTotalRecords, resolveChunkMetaTotalRecordsFromSources } from './chunk-meta.js';
import { loadSqliteBundleWorkerProfile, resolveSqliteBundleWorkerProfilePath } from './config.js';
import { resolveModeExecutionPlan } from './mode-plan.js';
import { loadPiecesManifest } from '../../../../shared/artifact-io/manifest.js';
import { loadJsonObjectArtifact } from '../../../../shared/artifact-io/loaders/core.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';
import { withSqliteStorageOperation, getSqliteStorageOperation } from '../storage-operation.js';

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
        const manifest = loadPiecesManifest(modeIndexDirs[mode], { strict: true });
        const hasState = manifest ? manifest.pieces.some(piece => piece.name === 'index_state')
          : fsSync.existsSync(path.join(modeIndexDirs[mode], 'index_state.json'));
        const state = hasState ? await loadJsonObjectArtifact(modeIndexDirs[mode], 'index_state', { manifest, strict: true }) : null;
        for (const declared of [manifest?.mode, state?.fields?.mode, state?.mode].filter(Boolean)) {
          if (declared !== mode) throw Object.assign(new Error(`SQLite ${mode} source declares mode ${declared}.`), { code: 'ERR_SQLITE_SOURCE_MODE' });
        }
        if (manifest?.buildId && state?.buildId && manifest.buildId !== state.buildId) {
          throw Object.assign(new Error('SQLite source manifest and state generations differ.'), { code: 'ERR_SQLITE_SOURCE_GENERATION' });
        }
        const pieces = await loadIndexPieces(modeIndexDirs[mode]);
        if (!pieces) throw Object.assign(new Error(`SQLite ${mode} source has no chunk artifacts.`), { code: 'ERR_SQLITE_SOURCE_UNAVAILABLE' });
        return { mode, pieces, error: null, failed: false };
      } catch (error) {
        return { mode, pieces: null, error, failed: true };
      }
    })
  );
  for (const result of pieceResults) {
    if (result?.pieces) indexPieces[result.mode] = result.pieces;
    if (result?.failed) indexPieceErrors[result.mode] = result.error;
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
  options = {},
  onSelected = selection => selection,
  onFinalized = () => {}
}) => {
  const runtime = options.runtime && typeof options.runtime === 'object'
    ? options.runtime
    : null;
  const root = runtime?.root ? path.resolve(runtime.root) : resolveRepoRootArg(options.root || argv.repo);
  const envConfig = getEnvConfig();
  const userConfig = runtime?.userConfig || options.userConfig || loadUserConfig(root);
  return withSqliteStorageOperation({ repoRoot: root, userConfig }, [], async () => {
    let primary, failed = false;
    try {
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
        return await onSelected({ errorMessage: modePlan.errorMessage });
      }

      const {
        modeList,
        indexRoot,
        modeIndexDirs,
        modeIndexRoots,
        modeStateRoots,
        executionGroups
      } = modePlan;
      getSqliteStorageOperation()?.admitTargets([...Object.values(modeIndexDirs), ...Object.values(modeIndexRoots)]);
      // Admit selected source metadata before state updates, target creation or
      // backend work. A captured source error cannot be reduced to a late message.
      const { indexPieces, indexPieceErrors } = await loadModeIndexPieces(modeList, modeIndexDirs);
      const sourceErrors = Object.values(indexPieceErrors);
      if (sourceErrors.length) {
        let failure = sourceErrors[0];
        for (const error of sourceErrors.slice(1)) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
        throw failure;
      }
      const envelope = options.envelope || runtime?.envelope || resolveCurrentProcessRuntimeEnvelope({
        argv,
        rawArgv: parsedRawArgs,
        userConfig,
        env: process.env,
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
      const outputKeys = { code: 'codePath', prose: 'prosePath',
        'extracted-prose': 'extractedProsePath', records: 'recordsPath' };
      for (const mode of modeList) {
        const selectedPaths = resolveSqlitePaths(root, userConfig, { indexRoot: modeIndexRoots[mode] });
        sqlitePaths[outputKeys[mode]] = selectedPaths[outputKeys[mode]];
      }
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
      getSqliteStorageOperation()?.admitTargets([resolveSqliteBundleWorkerProfilePath(repoCacheRoot)]);
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
      if (modeArg !== 'all' && outPath) modeOutputPaths[modeArg] = outPath;
      getSqliteStorageOperation()?.admitTargets(Object.values(modeOutputPaths));
      for (const mode of modeList) {
        if (!modeStateRoots[mode]) continue;
        const expected = resolveSqlitePaths(root, userConfig, { indexRoot: modeStateRoots[mode] })[outputKeys[mode]];
        const actual = modeOutputPaths[mode];
        const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        if (!actual || identity(actual) !== identity(expected)) modeStateRoots[mode] = null;
      }
      const buildStateRoots = [...new Set(Object.values(modeStateRoots).filter(Boolean))]
        .filter(buildRoot => {
          const buildStatePath = resolveBuildStatePath(buildRoot);
          return buildStatePath && fsSync.existsSync(buildStatePath);
        });
      const hasBuildState = buildStateRoots.length > 0;
      const modeChunkCountHints = resolveModeChunkCountHints({
        modeList,
        modeIndexDirs,
        indexPieces
      });
      const compactMode = argv.compact === true || (argv.compact == null && argv['no-compact'] !== true);

      return await onSelected({
        modeList,
        indexRoot,
        modeIndexDirs,
        modeIndexRoots,
        modeStateRoots,
        executionGroups,
        outPath,
        modeOutputPaths,
        hasBuildState,
        buildStateRoots,
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
      });
    } catch (error) { primary = error; failed = true; getSqliteStorageOperation()?.retainFailure(error); throw error; }
    finally {
      try { await onFinalized(); }
      catch (cleanup) { throw failed && cleanup !== primary ? addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }) : cleanup; }
    }
  });
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
  repoRoot = process.cwd(),
  userConfig = null,
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
      repoRoot,
      userConfig,
      Database,
      dbPath: outputPath
    })
  };
};
