import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbedder } from '../../../src/index/embedding.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../../src/index/build/build-state.js';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { loadIncrementalManifest } from '../../../src/storage/sqlite/incremental.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';
import {
  loadChunkMetaRows,
  loadFileMetaRows,
  readJsonFile,
  MAX_JSON_BYTES
} from '../../../src/shared/artifact-io.js';
import { readTextFileWithHash } from '../../../src/shared/encoding.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { normalizeLanceDbConfig } from '../../../src/shared/lancedb.js';
import { DEFAULT_STUB_DIMS, resolveStubDims } from '../../../src/shared/embedding.js';
import { sha1 } from '../../../src/shared/hash.js';
import {
  countNonEmptyVectors,
  clampQuantizedVectorsInPlace,
  isNonEmptyVector,
  isVectorLike,
  normalizeEmbeddingVectorInPlace
} from '../../../src/shared/embedding-utils.js';
import { resolveEmbeddingInputFormatting } from '../../../src/shared/embedding-input-format.js';
import { resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings.js';
import { fromPosix, toPosix } from '../../../src/shared/files.js';
import { getEnvConfig, isTestingEnv } from '../../../src/shared/env.js';
import { createLruCache } from '../../../src/shared/cache.js';
import { normalizeDenseVectorMode } from '../../../src/shared/dense-vector-mode.js';
import { formatEmbeddingsPerfLine } from '../../../src/shared/embeddings-progress.js';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { runWithConcurrency } from '../../../src/shared/concurrency.js';
import { formatEtaSeconds } from '../../../src/shared/perf/eta.js';
import {
  getCurrentBuildInfo,
  getIndexDir,
  getMetricsDir,
  getRepoCacheRoot,
  getTriageConfig,
  resolveIndexRoot,
  resolveSqlitePaths
} from '../../shared/dict-utils.js';
import {
  buildChunkHashesFingerprint,
  buildCacheIdentity,
  buildCacheKey,
  buildGlobalChunkCacheKey,
  createShardAppendHandlePool,
  resolveCacheRoot,
  writeCacheMeta
} from './cache.js';
import { buildChunkSignature, buildChunksFromBundles } from './chunks.js';
import {
  assertVectorArrays,
  buildQuantizedVectors,
  createDimsValidator,
  ensureVectorArrays,
  fillMissingVectors,
  runBatched
} from './embed.js';
import { writeHnswBackends, writeLanceDbBackends } from './backends.js';
import { createHnswBuilder } from './hnsw.js';
import { updatePieceManifest } from './manifest.js';
import { createFileEmbeddingsProcessor } from './pipeline.js';
import { createEmbeddingsScheduler } from './scheduler.js';
import { createBoundedWriterQueue } from './writer-queue.js';
import { updateSqliteDense } from './sqlite-dense.js';
import {
  createDeterministicFileStreamSampler,
  selectDeterministicFileSample
} from './sampling.js';
import {
  normalizeEmbeddingsMaintenanceConfig,
  shouldQueueSqliteMaintenance
} from './maintenance.js';
import { createBuildEmbeddingsContext } from './context.js';
import { loadIndexState, writeIndexState } from './state.js';
import {
  normalizeExtractedProseLowYieldBailoutConfig
} from '../../../src/index/chunking/formats/document-common.js';
import {
  resolveEmbeddingSamplingConfig,
  resolveEmbeddingsBundleRefreshParallelism,
  resolveEmbeddingsChunkMetaMaxBytes,
  resolveEmbeddingsFileParallelism,
  resolveEmbeddingsProgressHeartbeatMs,
  shouldUseInlineHnswBuilders
} from './runner/config.js';
import {
  compactChunkForEmbeddings,
  refreshIncrementalBundlesWithEmbeddings
} from './runner/incremental-refresh.js';
import {
  createCacheIndexFlushCoordinator,
  createEmbeddingsCacheCounters,
  enqueueCacheEntryWrite,
  initializeEmbeddingsCacheState,
  lookupCacheEntryWithStats,
  reuseVectorsFromPriorCacheEntry,
  tryApplyCachedVectors
} from './runner/cache-orchestration.js';
import {
  createArtifactTraceLogger,
  promoteBackendArtifacts
} from './runner/artifacts.js';
import { resolvePublishedBackendStates } from './runner/backend-state.js';

const EMBEDDINGS_TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPACT_SQLITE_SCRIPT = path.join(EMBEDDINGS_TOOLS_DIR, '..', 'compact-sqlite-index.js');

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

/**
 * Detect chunk-meta oversize failures from typed codes or fallback text.
 *
 * @param {Error|object|null} err
 * @returns {boolean}
 */
const isChunkMetaTooLargeError = (err) => {
  const code = String(err?.code || '');
  if (code === 'ERR_JSON_TOO_LARGE' || code === 'ERR_ARTIFACT_TOO_LARGE') {
    return true;
  }
  const message = String(err?.message || '').toLowerCase();
  return message.includes('exceeds maxbytes');
};

/**
 * Detect missing artifact errors even when surfaced as generic message text.
 *
 * @param {Error|object|null} err
 * @param {string} artifactBaseName
 * @returns {boolean}
 */
const isMissingArtifactError = (err, artifactBaseName) => {
  const code = String(err?.code || '');
  if (code === 'ERR_MANIFEST_ENTRY_MISSING') return true;
  const message = String(err?.message || '').toLowerCase();
  const baseName = String(artifactBaseName || '').toLowerCase();
  if (!baseName) return false;
  return message.includes(`missing manifest entry for ${baseName}`)
    || message.includes(`missing index artifact: ${baseName}.json`);
};

/**
 * Kick off the `pairofcleats build embeddings` workflow using normalized runtime config.
 * @param {{
 *   argv:string[],
 *   root:string,
 *   userConfig:object,
 *   envConfig:object,
 *   indexingConfig:object,
 *   rawArgv:string[],
 *   embeddingsConfig:object,
 *   embeddingProvider:object|null,
 *   embeddingOnnx:object|null,
 *   hnswConfig:object,
 *   normalizedEmbeddingMode:string,
 *   resolvedEmbeddingMode:string,
 *   useStubEmbeddings:boolean,
 *   embeddingBatchSize:number,
 *   embeddingBatchTokenBudget?:number,
 *   configuredDims:number|null,
 *   modelId:string|null,
 *   modelsDir:string|null,
 *   indexRoot:string,
 *   modes:string[]
 * }} config
 * @returns {Promise<void>}
 */
export async function runBuildEmbeddingsWithConfig(config) {
  const {
    argv,
    root,
    userConfig,
    envConfig: configEnv,
    indexingConfig,
    rawArgv,
    embeddingsConfig,
    embeddingProvider,
    embeddingOnnx,
    hnswConfig,
    normalizedEmbeddingMode,
    resolvedEmbeddingMode,
    useStubEmbeddings,
    embeddingBatchSize,
    embeddingBatchTokenBudget: configuredEmbeddingBatchTokenBudget = null,
    configuredDims,
    modelId,
    modelsDir,
    indexRoot,
    modes
  } = config;
  const {
    display,
    log,
    warn,
    error,
    logger,
    fail,
    finalize,
    setHeartbeat
  } = createBuildEmbeddingsContext({ argv });
  const embeddingNormalize = embeddingsConfig.normalize !== false;
  const extractedProseLowYieldBailout = normalizeExtractedProseLowYieldBailoutConfig(
    indexingConfig?.extractedProse?.lowYieldBailout
  );
  const embeddingSampling = resolveEmbeddingSamplingConfig({ embeddingsConfig, env: configEnv });
  const lanceConfig = normalizeLanceDbConfig(embeddingsConfig.lancedb || {});
  const binaryDenseVectors = embeddingsConfig.binaryDenseVectors !== false;
  const hnswIsolateOverride = typeof embeddingsConfig?.hnsw?.isolate === 'boolean'
    ? embeddingsConfig.hnsw.isolate
    : null;
  const denseVectorMode = normalizeDenseVectorMode(userConfig?.search?.denseVectorMode, 'merged');
  /**
   * Best-effort JSON reader returning `null` when file is absent/invalid.
   *
   * @param {string} filePath
   * @returns {object|null}
   */
  const readJsonOptional = (filePath) => {
    if (!filePath || !fsSync.existsSync(filePath)) return null;
    try {
      return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
    } catch {
      return null;
    }
  };
  const traceArtifactIo = (configEnv || getEnvConfig()).traceArtifactIo === true;
  const { logArtifactLocation, logExpectedArtifacts } = createArtifactTraceLogger({
    traceArtifactIo,
    log
  });

  if (embeddingsConfig.enabled === false || resolvedEmbeddingMode === 'off') {
    error('Embeddings disabled; skipping build-embeddings.');
    finalize();
    return { skipped: true };
  }

  const quantization = resolveQuantizationParams(embeddingsConfig.quantization);
  const quantRange = quantization.maxVal - quantization.minVal;
  const quantLevels = Number.isFinite(quantization.levels) ? quantization.levels : 256;
  const denseScale = quantLevels > 1 && Number.isFinite(quantRange) && quantRange !== 0
    ? quantRange / (quantLevels - 1)
    : 2 / 255;
  const cacheDims = useStubEmbeddings ? resolveStubDims(configuredDims) : configuredDims;
  const embeddingInputFormatting = resolveEmbeddingInputFormatting(modelId);
  const resolvedOnnxModelPath = embeddingProvider === 'onnx'
    ? resolveOnnxModelPath({
      rootDir: root,
      modelPath: embeddingOnnx?.modelPath,
      modelsDir,
      modelId
    })
    : null;
  let runtimeEmbeddingProvider = embeddingProvider;
  const buildCacheIdentityForProvider = (provider) => {
    const identityPayload = buildCacheIdentity({
      modelId,
      provider,
      mode: resolvedEmbeddingMode,
      stub: useStubEmbeddings,
      dims: cacheDims,
      scale: denseScale,
      pooling: 'mean',
      normalize: embeddingNormalize,
      truncation: 'truncate',
      maxLength: null,
      inputFormatting: embeddingInputFormatting,
      quantization: {
        version: 1,
        minVal: quantization.minVal,
        maxVal: quantization.maxVal,
        levels: quantization.levels
      },
      onnx: provider === 'onnx' ? {
        ...embeddingOnnx,
        resolvedModelPath: resolvedOnnxModelPath
      } : null
    });
    return {
      cacheIdentity: identityPayload.identity,
      cacheIdentityKey: identityPayload.key,
      cacheKeyFlags: [
        provider ? `provider:${provider}` : null,
        resolvedEmbeddingMode ? `mode:${resolvedEmbeddingMode}` : null,
        embeddingNormalize ? 'normalize' : 'no-normalize',
        useStubEmbeddings ? 'stub' : null
      ].filter(Boolean)
    };
  };
  let {
    cacheIdentity,
    cacheIdentityKey,
    cacheKeyFlags
  } = buildCacheIdentityForProvider(runtimeEmbeddingProvider);

  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const repoCacheRootResolved = path.resolve(repoCacheRoot);
  /**
   * Detect whether the caller explicitly supplied an index root, which means
   * we must fail fast on missing artifacts instead of auto-falling back.
   *
   * @param {Record<string, any>} parsedArgv
   * @param {string[]|unknown} rawArgs
   * @returns {boolean}
   */
  const hasExplicitIndexRootArg = (parsedArgv, rawArgs) => {
    if (typeof parsedArgv?.['index-root'] === 'string' && parsedArgv['index-root'].trim()) return true;
    if (typeof parsedArgv?.indexRoot === 'string' && parsedArgv.indexRoot.trim()) return true;
    if (!Array.isArray(rawArgs) || !rawArgs.length) return false;
    return rawArgs.some((arg) => arg === '--index-root' || arg.startsWith('--index-root='));
  };
  const explicitIndexRoot = hasExplicitIndexRootArg(argv, rawArgv);
  let activeIndexRoot = indexRoot
    ? path.resolve(indexRoot)
    : resolveIndexRoot(root, userConfig, { mode: modes[0] || null });
  /**
   * Normalize path for case-insensitive comparisons on Windows.
   *
   * @param {string} value
   * @returns {string|null}
   */
  const normalizePath = (value) => {
    if (!value) return null;
    const normalized = path.resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const repoCacheRootKey = normalizePath(repoCacheRootResolved);
  const buildsRootKey = normalizePath(path.join(repoCacheRootResolved, 'builds'));
  /**
   * Detect whether an index root contains stage2 artifacts for a mode.
   *
   * @param {string} candidateRoot
   * @param {string|null} [mode]
   * @returns {boolean}
   */
  const hasModeArtifacts = (candidateRoot, mode = null) => {
    if (!candidateRoot || !fsSync.existsSync(candidateRoot)) return false;
    const candidateModes = mode
      ? [mode]
      : (Array.isArray(modes) && modes.length ? modes : ['code', 'prose', 'extracted-prose', 'records']);
    for (const modeName of candidateModes) {
      if (typeof modeName !== 'string' || !modeName) continue;
      const indexDir = path.join(candidateRoot, `index-${modeName}`);
      if (!fsSync.existsSync(indexDir)) continue;
      const hasPiecesManifest = fsSync.existsSync(path.join(indexDir, 'pieces', 'manifest.json'));
      const hasChunkMeta = (
        fsSync.existsSync(path.join(indexDir, 'chunk_meta.json'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.json.gz'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.json.zst'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.jsonl'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.jsonl.gz'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.jsonl.zst'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.meta.json'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.parts'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.columnar.json'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.binary-columnar.meta.json'))
      );
      if (hasPiecesManifest || hasChunkMeta) {
        return true;
      }
    }
    return false;
  };
  const primaryMode = typeof modes?.[0] === 'string' && modes[0] ? modes[0] : null;
  /**
   * Resolve newest build root containing artifacts for requested mode.
   *
   * @param {string|null} [mode]
   * @returns {string|null}
   */
  const findLatestModeRoot = (mode = primaryMode) => {
    const buildsRoot = path.join(repoCacheRootResolved, 'builds');
    if (!fsSync.existsSync(buildsRoot)) return null;
    let entries = [];
    try {
      entries = fsSync.readdirSync(buildsRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry?.isDirectory?.()) continue;
      const candidateRoot = path.join(buildsRoot, entry.name);
      if (!hasModeArtifacts(candidateRoot, mode)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = Number(fsSync.statSync(candidateRoot).mtimeMs) || 0;
      } catch {}
      candidates.push({ root: candidateRoot, mtimeMs });
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.root || null;
  };
  /**
   * Resolve the effective root for a mode. Auto mode can fall back to current
   * build/latest build; explicit --index-root always stays pinned to caller root.
   *
   * @param {string} mode
   * @returns {string|null}
   */
  const resolveModeIndexRoot = (mode) => {
    if (hasModeArtifacts(activeIndexRoot, mode)) return activeIndexRoot;
    if (explicitIndexRoot) return activeIndexRoot;
    const currentBuild = getCurrentBuildInfo(root, userConfig, { mode });
    const currentRoot = currentBuild?.activeRoot || currentBuild?.buildRoot || null;
    if (currentRoot && hasModeArtifacts(currentRoot, mode)) return currentRoot;
    return findLatestModeRoot(mode) || activeIndexRoot;
  };
  if (activeIndexRoot && !explicitIndexRoot) {
    const activeRootKey = normalizePath(activeIndexRoot);
    const underRepoCache = activeRootKey
      && repoCacheRootKey
      && (activeRootKey === repoCacheRootKey || activeRootKey.startsWith(`${repoCacheRootKey}${path.sep}`));
    const needsCurrentBuildRoot = underRepoCache && (
      activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey
      || !hasModeArtifacts(activeIndexRoot, primaryMode)
    );
    if (needsCurrentBuildRoot) {
      const currentBuild = getCurrentBuildInfo(root, userConfig, { mode: modes[0] || null });
      const buildRootCandidate = currentBuild?.buildRoot || null;
      const activeRootCandidate = currentBuild?.activeRoot || null;
      const promotedRoot = hasModeArtifacts(buildRootCandidate, primaryMode)
        ? buildRootCandidate
        : (hasModeArtifacts(activeRootCandidate, primaryMode) ? activeRootCandidate : null);
      const promotedRootKey = normalizePath(promotedRoot);
      if (promotedRoot && promotedRootKey && promotedRootKey !== activeRootKey) {
        activeIndexRoot = promotedRoot;
        log(`[embeddings] using active build root from current.json: ${activeIndexRoot}`);
      }
    }
  }
  if (!explicitIndexRoot && activeIndexRoot && !hasModeArtifacts(activeIndexRoot, primaryMode)) {
    const activeRootKey = normalizePath(activeIndexRoot);
    const allowLatestFallback = !activeRootKey
      || !fsSync.existsSync(activeIndexRoot)
      || activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey;
    if (allowLatestFallback) {
      const fallbackRoot = findLatestModeRoot(primaryMode);
      if (fallbackRoot && normalizePath(fallbackRoot) !== normalizePath(activeIndexRoot)) {
        activeIndexRoot = fallbackRoot;
        log(`[embeddings] index root lacked mode artifacts; using latest build root: ${activeIndexRoot}`);
      }
    }
  }
  const metricsDir = getMetricsDir(root, userConfig);
  const envConfig = configEnv || getEnvConfig();
  const crashLogger = await createCrashLogger({
    repoCacheRoot,
    enabled: true,
    log
  });
  crashLogger.updatePhase('stage3:init');
  let embedder;
  try {
    embedder = createEmbedder({
      rootDir: root,
      useStubEmbeddings,
      modelId,
      dims: argv.dims,
      modelsDir,
      provider: embeddingProvider,
      onnx: embeddingOnnx,
      normalize: embeddingNormalize
    });
  } catch (err) {
    crashLogger.logError({
      phase: 'stage3:init',
      stage: 'embedder',
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    throw err;
  }
  const getChunkEmbeddings = embedder.getChunkEmbeddings;
  if (!useStubEmbeddings && embeddingProvider === 'onnx') {
    try {
      await getChunkEmbeddings(['pairofcleats-provider-probe']);
    } catch (err) {
      crashLogger.logError({
        phase: 'stage3:init',
        stage: 'embedder-probe',
        message: err?.message || String(err),
        stack: err?.stack || null
      });
      throw err;
    }
    const detectedProvider = typeof embedder.getActiveProvider === 'function'
      ? embedder.getActiveProvider()
      : runtimeEmbeddingProvider;
    if (typeof detectedProvider === 'string' && detectedProvider && detectedProvider !== runtimeEmbeddingProvider) {
      const priorProvider = runtimeEmbeddingProvider;
      runtimeEmbeddingProvider = detectedProvider;
      ({
        cacheIdentity,
        cacheIdentityKey,
        cacheKeyFlags
      } = buildCacheIdentityForProvider(runtimeEmbeddingProvider));
      log(
        `[embeddings] provider fallback resolved before stage3 cache identity: ` +
        `${priorProvider} -> ${runtimeEmbeddingProvider}.`
      );
    }
  }
  const resolvedRawArgv = Array.isArray(rawArgv) ? rawArgv : [];
  const {
    scheduler,
    scheduleCompute,
    scheduleIo,
    envelopeCpuConcurrency
  } = createEmbeddingsScheduler({
    argv,
    rawArgv: resolvedRawArgv,
    userConfig,
    envConfig,
    indexingConfig
  });
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsDir = triageConfig.recordsDir;
  const buildStateTrackers = new Map();
  /**
   * Lazily initialize build-state tracking for each unique build root used by
   * stage3 so mixed-root mode runs emit accurate heartbeat/phase markers.
   *
   * @param {string|null} buildRoot
   * @returns {{
   *   root:string,
   *   hasBuildState:boolean,
   *   runningMarked:boolean,
   *   stopHeartbeat:() => void
   * }|null}
   */
  const ensureBuildStateTracker = (buildRoot) => {
    const key = normalizePath(buildRoot);
    if (!buildRoot || !key) return null;
    if (buildStateTrackers.has(key)) return buildStateTrackers.get(key);
    const buildStatePath = resolveBuildStatePath(buildRoot);
    const hasBuildState = Boolean(buildStatePath && fsSync.existsSync(buildStatePath));
    const tracker = {
      root: buildRoot,
      hasBuildState,
      runningMarked: false,
      stopHeartbeat: hasBuildState ? startBuildHeartbeat(buildRoot, 'stage3') : () => {}
    };
    buildStateTrackers.set(key, tracker);
    return tracker;
  };
  setHeartbeat(() => {
    for (const tracker of buildStateTrackers.values()) {
      try {
        tracker.stopHeartbeat?.();
      } catch {}
    }
  });

  const cacheScopeRaw = embeddingsConfig.cache?.scope;
  const cacheScope = typeof cacheScopeRaw === 'string' ? cacheScopeRaw.trim().toLowerCase() : '';
  const resolvedCacheScope = cacheScope === 'global' ? 'global' : 'repo';
  const cacheRoot = resolveCacheRoot({
    repoCacheRoot,
    cacheDirConfig: embeddingsConfig.cache?.dir,
    scope: resolvedCacheScope
  });
  const cacheMaxGb = Number(embeddingsConfig.cache?.maxGb);
  const cacheMaxAgeDays = Number(embeddingsConfig.cache?.maxAgeDays);
  const cacheMaxBytes = Number.isFinite(cacheMaxGb) ? Math.max(0, cacheMaxGb) * 1024 * 1024 * 1024 : 0;
  const cacheMaxAgeMs = Number.isFinite(cacheMaxAgeDays) ? Math.max(0, cacheMaxAgeDays) * 24 * 60 * 60 * 1000 : 0;
  const persistentTextCacheEnabled = resolveEmbeddingsPersistentTextCacheEnabled(indexingConfig);
  const persistentTextCacheMaxEntries = resolveEmbeddingsPersistentTextCacheMaxEntries(indexingConfig);
  const persistentTextCacheVectorEncoding = resolveEmbeddingsPersistentTextCacheVectorEncoding(indexingConfig);
  const persistentTextCacheStore = persistentTextCacheEnabled
    ? await createPersistentEmbeddingTextKvStore({
      Database,
      cacheRoot,
      cacheIdentity,
      cacheIdentityKey,
      maxEntries: persistentTextCacheMaxEntries,
      vectorEncoding: persistentTextCacheVectorEncoding,
      log
    })
    : null;
  if (persistentTextCacheStore) {
    log(
      `[embeddings] persistent text cache enabled ` +
      `(maxEntries=${persistentTextCacheMaxEntries}, encoding=${persistentTextCacheVectorEncoding}).`
    );
  }
  const maintenanceConfig = normalizeEmbeddingsMaintenanceConfig(embeddingsConfig.maintenance || {});
  const queuedMaintenance = new Set();
  /**
   * Queue detached sqlite maintenance against the same mode-specific db root
   * that stage3 just updated, avoiding maintenance drift across mixed roots.
   *
   * @param {{
   *   mode:string,
   *   denseCount:number,
   *   modeIndexRoot:string|null,
   *   sqlitePathsForMode?:{codePath?:string|null,prosePath?:string|null}|null
   * }} input
   * @returns {void}
   */
  const queueBackgroundSqliteMaintenance = ({ mode, denseCount, modeIndexRoot, sqlitePathsForMode }) => {
    if (maintenanceConfig.background !== true || isTestingEnv()) return;
    if (mode !== 'code' && mode !== 'prose') return;
    const dbPath = mode === 'code' ? sqlitePathsForMode?.codePath : sqlitePathsForMode?.prosePath;
    if (!dbPath || !fsSync.existsSync(dbPath)) return;
    const walPath = `${dbPath}-wal`;
    const dbBytes = Number(fsSync.statSync(dbPath).size) || 0;
    const walBytes = fsSync.existsSync(walPath)
      ? (Number(fsSync.statSync(walPath).size) || 0)
      : 0;
    const decision = shouldQueueSqliteMaintenance({
      config: maintenanceConfig,
      dbBytes,
      walBytes,
      denseCount
    });
    if (!decision.queue) return;
    const key = `${mode}:${dbPath}`;
    if (queuedMaintenance.has(key)) return;
    queuedMaintenance.add(key);
    log(
      `[embeddings] ${mode}: queueing background sqlite maintenance ` +
      `(reason=${decision.reason}, dbBytes=${dbBytes}, walBytes=${walBytes}, denseCount=${denseCount}).`
    );
    const args = [COMPACT_SQLITE_SCRIPT, '--repo', root, '--mode', mode];
    if (typeof modeIndexRoot === 'string' && modeIndexRoot) {
      args.push('--index-root', modeIndexRoot);
    }
    void spawnSubprocess(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: 'ignore',
      detached: true,
      unref: true,
      rejectOnNonZeroExit: false,
      name: `background sqlite compact ${mode}`
    })
      .catch((err) => {
        warn(`[embeddings] ${mode}: background sqlite maintenance failed: ${err?.message || err}`);
      })
      .finally(() => {
        queuedMaintenance.delete(key);
      });
  };

  const modeTask = display.task('Embeddings', { total: modes.length, stage: 'embeddings' });
  let completedModes = 0;
  const writerStatsByMode = {};
  const crossFileChunkDedupeEnabled = embeddingsConfig?.crossFileChunkDedupe !== false;
  const crossFileChunkDedupeMaxEntries = resolveCrossFileChunkDedupeMaxEntries(indexingConfig);
  const crossFileChunkDedupe = crossFileChunkDedupeEnabled ? new Map() : null;
  const sourceFileHashCacheMaxEntries = resolveEmbeddingsSourceHashCacheMaxEntries(indexingConfig);
  const sourceFileHashes = new Map();
  const hnswIsolateState = {
    disabled: false,
    reason: null
  };

  try {
    for (const mode of modes) {
      if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) {
        fail(`Invalid mode: ${mode}`);
      }
      let stageCheckpoints = null;
      modeTask.set(completedModes, modes.length, { message: `building ${mode}` });
      /**
       * Mark one mode complete in top-level progress task.
       *
       * @param {string} message
       * @returns {void}
       */
      const finishMode = (message) => {
        completedModes += 1;
        modeTask.set(completedModes, modes.length, { message });
      };
      const cacheCounters = createEmbeddingsCacheCounters();
      const chunkMetaMaxBytes = resolveEmbeddingsChunkMetaMaxBytes(indexingConfig);
      const modeIndexRoot = resolveModeIndexRoot(mode);
      const modeTracker = ensureBuildStateTracker(modeIndexRoot);
      if (modeTracker?.hasBuildState && !modeTracker.runningMarked) {
        await markBuildPhase(modeIndexRoot, 'stage3', 'running');
        modeTracker.runningMarked = true;
      }
      if (explicitIndexRoot && !hasModeArtifacts(modeIndexRoot, mode)) {
        fail(
          `Missing index artifacts for mode "${mode}" under explicit --index-root: ${modeIndexRoot}. ` +
          'Run stage2 for that root/mode or choose the correct --index-root.'
        );
      }
      if (normalizePath(modeIndexRoot) !== normalizePath(activeIndexRoot)) {
        log(`[embeddings] ${mode}: using mode-specific index root: ${modeIndexRoot}`);
      }
      const indexDir = getIndexDir(root, mode, userConfig, { indexRoot: modeIndexRoot });
      const statePath = path.join(indexDir, 'index_state.json');
      logExpectedArtifacts(mode, indexDir, 'pre-stage3');
      const stateNow = new Date().toISOString();
      let indexState = loadIndexState(statePath);
      indexState.generatedAt = indexState.generatedAt || stateNow;
      indexState.updatedAt = stateNow;
      indexState.mode = indexState.mode || mode;
      indexState.embeddings = {
        ...(indexState.embeddings || {}),
        enabled: true,
        ready: false,
        pending: true,
        mode: indexState.embeddings?.mode || resolvedEmbeddingMode,
        service: indexState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
        embeddingIdentity: cacheIdentity || indexState.embeddings?.embeddingIdentity || null,
        embeddingIdentityKey: cacheIdentityKey || indexState.embeddings?.embeddingIdentityKey || null,
        lastError: null,
        updatedAt: stateNow
      };
      const cacheRepoId = indexState?.repoId || null;
      try {
        await scheduleIo(() => writeIndexState(statePath, indexState));
      } catch {
        // Ignore index state write failures.
      }

      let fileTask = null;
      let chunkTask = null;
      let cacheTask = null;
      let embedTask = null;
      let writerTask = null;
      let bundleTask = null;
      let backendTask = null;
      try {
        const incremental = loadIncrementalManifest(repoCacheRoot, mode);
        const manifestFiles = incremental?.manifest?.files || {};

        let chunksByFile = new Map();
        let totalChunks = 0;
        let loadedChunkMetaFromArtifacts = false;
        let streamSamplingSummary = null;
        try {
          await scheduleIo(async () => {
            const fileMetaById = new Map();
            const streamSampler = embeddingSampling.maxFiles
              ? createDeterministicFileStreamSampler({
                mode,
                maxFiles: embeddingSampling.maxFiles,
                seed: embeddingSampling.seed
              })
              : null;
            let fileMetaLoaded = false;
            let fileMetaLoadFailed = false;
            /**
             * Lazily load file id -> file path mapping for chunk rows that only
             * include `fileId`.
             *
             * @returns {Promise<void>}
             */
            const ensureFileMetaById = async () => {
              if (fileMetaLoaded || fileMetaLoadFailed) return;
              try {
                for await (const row of loadFileMetaRows(indexDir, {
                  maxBytes: chunkMetaMaxBytes,
                  strict: false
                })) {
                  if (!row || !Number.isFinite(Number(row.id)) || typeof row.file !== 'string') continue;
                  fileMetaById.set(Number(row.id), row.file);
                }
                fileMetaLoaded = true;
              } catch (err) {
                fileMetaLoadFailed = true;
                if (!isMissingArtifactError(err, 'file_meta')) {
                  warn(`[embeddings] Failed to stream file_meta for ${mode}: ${err?.message || err}`);
                }
              }
            };
            let unresolvedFileRows = 0;
            let nextIndex = 0;
            for await (const chunkRow of loadChunkMetaRows(indexDir, {
              maxBytes: chunkMetaMaxBytes,
              strict: false,
              includeCold: false
            })) {
              const chunkIndex = nextIndex;
              nextIndex += 1;
              if (!chunkRow || typeof chunkRow !== 'object') continue;
              const fileId = Number(chunkRow.fileId);
              let filePath = typeof chunkRow.file === 'string' && chunkRow.file
                ? chunkRow.file
                : null;
              let fileMetaLoaded = false;
              let fileMetaLoadFailed = false;
              const ensureFileMetaById = async () => {
                if (fileMetaLoaded || fileMetaLoadFailed) return;
                try {
                  for await (const row of loadFileMetaRows(indexDir, {
                    maxBytes: chunkMetaMaxBytesActive,
                    strict: false
                  })) {
                    if (!row || !Number.isFinite(Number(row.id)) || typeof row.file !== 'string') continue;
                    fileMetaById.set(Number(row.id), row.file);
                  }
                  fileMetaLoaded = true;
                } catch (err) {
                  fileMetaLoadFailed = true;
                  if (!isMissingArtifactError(err, 'file_meta')) {
                    warn(`[embeddings] Failed to stream file_meta for ${mode}: ${err?.message || err}`);
                  }
                }
              };
              let unresolvedFileRows = 0;
              let nextIndex = 0;
              for await (const chunkRow of loadChunkMetaRows(indexDir, {
                maxBytes: chunkMetaMaxBytesActive,
                strict: false,
                includeCold: false
              })) {
                const chunkIndex = nextIndex;
                nextIndex += 1;
                if (!chunkRow || typeof chunkRow !== 'object') continue;
                const fileId = Number(chunkRow.fileId);
                let filePath = typeof chunkRow.file === 'string' && chunkRow.file
                  ? chunkRow.file
                  : null;
                if (!filePath && Number.isFinite(fileId)) {
                  if (!fileMetaLoaded && !fileMetaLoadFailed) {
                    await ensureFileMetaById();
                  }
                  filePath = fileMetaById.get(fileId) || null;
                }
                if (!filePath) {
                  unresolvedFileRows += 1;
                  continue;
                }
                const normalizedFilePath = toPosix(filePath);
                if (!normalizedFilePath) {
                  unresolvedFileRows += 1;
                  continue;
                }
                if (streamSampler) {
                  const decision = streamSampler.considerFile(normalizedFilePath);
                  if (decision.evicted) {
                    chunksByFile.delete(decision.evicted);
                  }
                  if (!decision.selected) {
                    continue;
                  }
                }
                const compactChunk = compactChunkForEmbeddings(chunkRow, filePath);
                if (!compactChunk) {
                  unresolvedFileRows += 1;
                  continue;
                }
                const list = chunksByFile.get(normalizedFilePath) || [];
                list.push({ index: chunkIndex, chunk: compactChunk });
                chunksByFile.set(normalizedFilePath, list);
              }
              if (unresolvedFileRows > 0) {
                warn(
                  `[embeddings] ${mode}: skipped ${unresolvedFileRows} chunk_meta rows with unresolved file mapping.`
                );
              }
              if (streamSampler) {
                streamSamplingSummary = {
                  seenFiles: streamSampler.getSeenCount(),
                  selectedFiles: streamSampler.getSelectedCount()
                };
              }
              totalChunks = nextIndex;
            });
            loadedChunkMetaFromArtifacts = true;
          } catch (err) {
            chunkMetaLoadError = err;
            const retryMaxBytes = resolveChunkMetaRetryMaxBytes({
              err,
              currentMaxBytes: chunkMetaMaxBytesActive,
              retryCeilingBytes: chunkMetaRetryCeilingBytes
            });
            if (retryMaxBytes && retryMaxBytes > chunkMetaMaxBytesActive) {
              warn(
                `[embeddings] chunk_meta exceeded budget for ${mode} ` +
                `(${chunkMetaMaxBytesActive} bytes); retrying with ${retryMaxBytes} bytes.`
              );
              chunkMetaMaxBytesActive = retryMaxBytes;
              continue;
            }
            break;
          }
        }
        if (!loadedChunkMetaFromArtifacts) {
          if (isChunkMetaTooLargeError(chunkMetaLoadError)) {
            warn(
              `[embeddings] chunk_meta exceeded budget for ${mode} ` +
              `(${chunkMetaMaxBytesActive} bytes); using incremental bundles if available.`
            );
          } else if (!isMissingArtifactError(chunkMetaLoadError, 'chunk_meta')) {
            warn(`[embeddings] Failed to load chunk_meta for ${mode}: ${chunkMetaLoadError?.message || chunkMetaLoadError}`);
          }
        }
        if (!loadedChunkMetaFromArtifacts) {
          if (!manifestFiles || !Object.keys(manifestFiles).length) {
            warn(`[embeddings] Missing chunk_meta and no incremental bundles for ${mode}; skipping.`);
            finishMode(`skipped ${mode}`);
            continue;
          }
          const bundleResult = await scheduleIo(() => buildChunksFromBundles(
            incremental.bundleDir,
            manifestFiles,
            incremental?.manifest?.bundleFormat
          ));
          chunksByFile = bundleResult.chunksByFile;
          totalChunks = bundleResult.totalChunks;
          if (!chunksByFile.size || !totalChunks) {
            warn(`[embeddings] Incremental bundles empty for ${mode}; skipping.`);
            finishMode(`skipped ${mode}`);
            continue;
          }
          log(`[embeddings] ${mode}: using incremental bundles (${chunksByFile.size} files).`);
        }

        // Deterministic chunk ordering per file, independent of Map insertion order.
        for (const list of chunksByFile.values()) {
          if (!Array.isArray(list) || list.length < 2) continue;
          list.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
        }
        const fileEntries = Array.from(chunksByFile.entries())
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        let sampledFileEntries = fileEntries;
        let totalFileCount = fileEntries.length;
        let sampledChunkCount = totalChunks;
        if (streamSamplingSummary && embeddingSampling.maxFiles) {
          totalFileCount = Math.max(fileEntries.length, streamSamplingSummary.seenFiles || 0);
          sampledChunkCount = sampledFileEntries.reduce(
            (sum, entry) => sum + (Array.isArray(entry?.[1]) ? entry[1].length : 0),
            0
          );
          if (totalFileCount > sampledFileEntries.length) {
            log(
              `[embeddings] ${mode}: sampling ${sampledFileEntries.length}/${totalFileCount} files ` +
              `(${sampledChunkCount}/${totalChunks} chunks, seed=${embeddingSampling.seed}).`
            );
          }
        } else if (embeddingSampling.maxFiles && embeddingSampling.maxFiles < fileEntries.length) {
          sampledFileEntries = selectDeterministicFileSample({
            fileEntries,
            mode,
            maxFiles: embeddingSampling.maxFiles,
            seed: embeddingSampling.seed
          });
          sampledChunkCount = sampledFileEntries.reduce(
            (sum, entry) => sum + (Array.isArray(entry?.[1]) ? entry[1].length : 0),
            0
          );
          log(
            `[embeddings] ${mode}: sampling ${sampledFileEntries.length}/${totalFileCount} files ` +
            `(${sampledChunkCount}/${totalChunks} chunks, seed=${embeddingSampling.seed}).`
          );
        }
        const sampledChunksByFile = new Map(sampledFileEntries);
        const samplingActive = sampledChunkCount < totalChunks;

        stageCheckpoints = createStageCheckpointRecorder({
          buildRoot: modeIndexRoot,
          metricsDir,
          mode,
          buildId: modeIndexRoot ? path.basename(modeIndexRoot) : null
        });
        stageCheckpoints.record({
          stage: 'stage3',
          step: 'chunks',
          extra: {
            files: sampledFileEntries.length,
            totalFiles: totalFileCount,
            sampledFiles: totalFileCount - sampledFileEntries.length,
            totalChunks,
            sampledChunks: sampledChunkCount
          }
        });

        const codeVectors = new Array(totalChunks).fill(null);
        const docVectors = new Array(totalChunks).fill(null);
        const mergedVectors = new Array(totalChunks).fill(null);
        stageCheckpoints.record({
          stage: 'stage3',
          step: 'vectors-allocated',
          extra: {
            vectors: {
              merged: mergedVectors.length,
              doc: docVectors.length,
              code: codeVectors.length
            }
          }
        });
        const hnswIsolate = hnswConfig.enabled
          ? (hnswIsolateOverride ?? isTestingEnv())
          : false;
        const hnswEnabled = shouldUseInlineHnswBuilders({
          enabled: hnswConfig.enabled,
          hnswIsolate,
          samplingActive
        });
        if (hnswConfig.enabled && !hnswIsolate && samplingActive) {
          log(
            `[embeddings] ${mode}: deferring HNSW build until post-fill because sampling is active ` +
            `(${sampledChunkCount}/${totalChunks} chunks).`
          );
        }
        const hnswBuilders = hnswEnabled ? {
          merged: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          }),
          doc: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          }),
          code: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          })
        } : null;
        /**
         * Append float vector to HNSW builder for one target collection.
         *
         * @param {'merged'|'doc'|'code'} target
         * @param {number} chunkIndex
         * @param {Float32Array|number[]} floatVec
         * @returns {void}
         */
        const addHnswFloatVector = (target, chunkIndex, floatVec) => {
          if (!hnswEnabled || !floatVec || !floatVec.length) return;
          const builder = hnswBuilders?.[target];
          if (!builder) return;
          builder.addVector(chunkIndex, floatVec);
        };
        /**
         * Dequantize uint8 vector then append to HNSW builder.
         *
         * @param {'merged'|'doc'|'code'} target
         * @param {number} chunkIndex
         * @param {Uint8Array|number[]} quantizedVec
         * @returns {void}
         */
        const addHnswFromQuantized = (target, chunkIndex, quantizedVec) => {
          if (!hnswEnabled || !quantizedVec || !quantizedVec.length) return;
          const floatVec = dequantizeUint8ToFloat32(
            quantizedVec,
            quantization.minVal,
            quantization.maxVal,
            quantization.levels
          );
          if (floatVec && embeddingNormalize) {
            normalizeEmbeddingVectorInPlace(floatVec);
          }
          if (floatVec) addHnswFloatVector(target, chunkIndex, floatVec);
        };
        const hnswResults = { merged: null, doc: null, code: null };

        const {
          cacheState,
          cacheMeta,
          cacheMetaMatches
        } = await initializeEmbeddingsCacheState({
          mode,
          cacheRoot,
          cacheIdentity,
          cacheIdentityKey,
          configuredDims,
          scheduleIo,
          warn
        });

        const globalChunkCacheDir = resolveGlobalChunkCacheDir(cacheRoot, cacheIdentity);
        await scheduleIo(() => fs.mkdir(globalChunkCacheDir, { recursive: true }));
        const globalChunkCacheMemo = new Map();
        const globalChunkCacheExistingKeys = new Set();
        const globalChunkCachePendingWrites = new Set();
        const resolveGlobalChunkVectors = async (chunkHash) => {
          const cacheKey = buildGlobalChunkCacheKey({
            chunkHash,
            identityKey: cacheIdentityKey,
            featureFlags: cacheKeyFlags,
            pathPolicy: 'posix'
          });
          if (!cacheKey) return null;
          let pending = globalChunkCacheMemo.get(cacheKey);
          if (!pending) {
            pending = (async () => {
              try {
                const cachedResult = await scheduleIo(() => readCacheEntry(globalChunkCacheDir, cacheKey));
                const cached = cachedResult?.entry || null;
                if (!cached) return { cacheKey, vectors: null, rejected: false };
                if (!isGlobalChunkCacheValid({
                  cached,
                  identityKey: cacheIdentityKey,
                  chunkHash
                })) {
                  return { cacheKey, vectors: null, rejected: true };
                }
                const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
                validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
                validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
                validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
                const codeVec = ensureVectorArrays(cached.codeVectors, 1)[0] || [];
                const docVec = ensureVectorArrays(cached.docVectors, 1)[0] || [];
                const mergedVec = ensureVectorArrays(cached.mergedVectors, 1)[0] || [];
                if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
                  return { cacheKey, vectors: null, rejected: true };
                }
                globalChunkCacheExistingKeys.add(cacheKey);
                return {
                  cacheKey,
                  vectors: { code: codeVec, doc: docVec, merged: mergedVec },
                  rejected: false
                };
              } catch (err) {
                if (isDimsMismatch(err)) throw err;
                return { cacheKey, vectors: null, rejected: true };
              }
            })();
            globalChunkCacheMemo.set(cacheKey, pending);
          }
          return pending;
        };

        const dimsValidator = createDimsValidator({ mode, configuredDims });
        const assertDims = dimsValidator.assertDims;
        const {
          noteFileProcessed: noteCacheFileProcessed,
          flushMaybe: flushCacheIndexMaybe
        } = createCacheIndexFlushCoordinator({
          cacheState,
          cacheIdentityKey,
          cacheMaxBytes,
          cacheMaxAgeMs,
          scheduleIo
        });

        let processedFiles = 0;
        let processedChunks = 0;
        let cacheHitFiles = 0;
        let computedFiles = 0;
        let skippedFiles = 0;
        fileTask = display.task('Files', {
          taskId: `embeddings:${mode}:files`,
          total: sampledFileEntries.length,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });
        chunkTask = display.task('Chunks', {
          taskId: `embeddings:${mode}:chunks`,
          total: sampledChunkCount,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });
        cacheTask = display.task('Cache', {
          taskId: `embeddings:${mode}:cache`,
          total: sampledFileEntries.length,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });
        embedTask = display.task('Embed', {
          taskId: `embeddings:${mode}:embed`,
          total: 0,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });
        writerTask = display.task('Writer', {
          taskId: `embeddings:${mode}:writer`,
          total: 0,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });
        bundleTask = display.task('Bundles', {
          taskId: `embeddings:${mode}:bundles`,
          total: 1,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });
        backendTask = display.task('Backends', {
          taskId: `embeddings:${mode}:backends`,
          total: 5,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });

        // Cache shard writes are serialized via cache.lock but can still be queued.
        // Keep a bounded in-process queue so compute does not outrun IO and retain
        // unbounded payloads in memory.
        const schedulerStatsForWriter = scheduler?.stats?.() || null;
        const schedulerIoQueue = schedulerStatsForWriter?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsIo] || null;
        const schedulerIoMaxPending = Number.isFinite(Number(schedulerIoQueue?.maxPending))
          ? Math.max(1, Math.floor(Number(schedulerIoQueue.maxPending)))
          : null;
        const ioTokensTotal = Number.isFinite(Number(schedulerStatsForWriter?.tokens?.io?.total))
          ? Math.max(1, Math.floor(Number(schedulerStatsForWriter.tokens.io.total)))
          : 1;
        const computeTokensTotal = Number.isFinite(Number(schedulerStatsForWriter?.tokens?.cpu?.total))
          ? Math.max(1, Math.floor(Number(schedulerStatsForWriter.tokens.cpu.total)))
          : 1;
        const schedulerFdTokenCap = Number.isFinite(Number(schedulerStatsForWriter?.adaptive?.fd?.tokenCap))
          ? Math.max(1, Math.floor(Number(schedulerStatsForWriter.adaptive.fd.tokenCap)))
          : null;
        const staticFdCap = resolveFdConcurrencyCap(
          Math.max(
            1,
            Number.isFinite(Number(envelopeCpuConcurrency))
              ? Math.floor(Number(envelopeCpuConcurrency))
              : 1,
            computeTokensTotal
          ),
          { fdPressure: indexingConfig?.scheduler?.adaptiveSurfaces?.fdPressure }
        );
        const resolveCurrentFdConcurrencyCap = () => {
          const schedulerStats = scheduler?.stats?.() || null;
          const dynamicSchedulerFdTokenCap = Number.isFinite(Number(schedulerStats?.adaptive?.fd?.tokenCap))
            ? Math.max(1, Math.floor(Number(schedulerStats.adaptive.fd.tokenCap)))
            : schedulerFdTokenCap;
          if (Number.isFinite(Number(dynamicSchedulerFdTokenCap))) {
            return Math.max(
              1,
              Math.min(
                Number(dynamicSchedulerFdTokenCap),
                Number.isFinite(Number(staticFdCap)) ? Number(staticFdCap) : Number(dynamicSchedulerFdTokenCap)
              )
            );
          }
          return staticFdCap;
        };
        const fdConcurrencyCap = resolveCurrentFdConcurrencyCap();
        const fileParallelism = resolveEmbeddingsFileParallelism({
          indexingConfig,
          computeTokensTotal,
          cpuConcurrency: envelopeCpuConcurrency,
          fdConcurrencyCap,
          hnswEnabled
        });
        const bundleRefreshParallelism = resolveEmbeddingsBundleRefreshParallelism({
          indexingConfig,
          ioTokensTotal
        });
        const backendParallelDispatch = getChunkEmbeddings?.supportsParallelDispatch === true;
        const parallelBatchDispatch = backendParallelDispatch && computeTokensTotal > 1;
        const mergeCodeDocBatches = indexingConfig?.embeddings?.mergeCodeDocBatches !== false;
        const globalMicroBatchingEnabled = indexingConfig?.embeddings?.globalMicroBatching !== false;
        const globalMicroBatchingFillTarget = Number.isFinite(Number(indexingConfig?.embeddings?.globalBatchFillTarget))
          ? Math.max(0.5, Math.min(0.99, Number(indexingConfig.embeddings.globalBatchFillTarget)))
          : 0.85;
        const globalMicroBatchingMaxWaitMs = Number.isFinite(Number(indexingConfig?.embeddings?.globalBatchMaxWaitMs))
          ? Math.max(0, Math.floor(Number(indexingConfig.embeddings.globalBatchMaxWaitMs)))
          : 8;
        const embeddingBatchTokenBudget = Number.isFinite(Number(configuredEmbeddingBatchTokenBudget))
          && Number(configuredEmbeddingBatchTokenBudget) > 0
          ? Math.max(1, Math.floor(Number(configuredEmbeddingBatchTokenBudget)))
          : resolveEmbeddingsBatchTokenBudget({
            indexingConfig,
            embeddingBatchSize
          });
        const embeddingCharsPerToken = resolveEmbeddingsCharsPerToken(indexingConfig);
        const estimateEmbeddingTokensFallback = (text) => {
          const chars = typeof text === 'string' ? text.length : 0;
          return Math.max(1, Math.ceil(chars / embeddingCharsPerToken));
        };
        const estimateEmbeddingTokensBatch = typeof getChunkEmbeddings?.estimateTokensBatch === 'function'
          ? async (texts) => {
            try {
              const estimated = await getChunkEmbeddings.estimateTokensBatch(texts);
              if (!Array.isArray(estimated) || estimated.length !== texts.length) return null;
              return estimated.map((value, index) => {
                const numeric = Math.floor(Number(value));
                return Number.isFinite(numeric) && numeric > 0
                  ? numeric
                  : estimateEmbeddingTokensFallback(texts[index]);
              });
            } catch {
              return null;
            }
          }
          : null;
        const estimateEmbeddingTokens = (text) => estimateEmbeddingTokensFallback(text);
        const textReuseCacheEntries = resolveEmbeddingsTextReuseCacheEntries(indexingConfig);
        const textReuseMaxTextChars = resolveEmbeddingsTextReuseMaxTextChars(indexingConfig);
        const sqliteDenseWriteBatchSize = resolveEmbeddingsSqliteDenseWriteBatchSize(indexingConfig);
        const embeddingTextCache = createEmbeddingTextReuseCache({
          maxEntries: textReuseCacheEntries,
          maxTextChars: textReuseMaxTextChars,
          persistentStore: persistentTextCacheStore
        });
        if (fileParallelism > 1) {
          log(`[embeddings] ${mode}: file parallelism enabled (${fileParallelism} workers).`);
        }
        if (bundleRefreshParallelism > 1) {
          log(
            `[embeddings] ${mode}: incremental bundle refresh parallelism enabled `
              + `(${bundleRefreshParallelism} workers).`
          );
        }
        const defaultWriterMaxPending = Math.max(1, Math.min(4, ioTokensTotal * 2));
        const writerMaxPending = schedulerIoMaxPending
          ? Math.max(1, Math.min(defaultWriterMaxPending, schedulerIoMaxPending))
          : defaultWriterMaxPending;
        const writerAdaptiveCeiling = Math.max(writerMaxPending, Math.min(16, writerMaxPending * 2));
        const writerAdaptiveFloor = Math.max(1, Math.min(writerMaxPending, Math.ceil(writerMaxPending * 0.5)));
        const writerAdaptiveStepMs = Number.isFinite(Number(indexingConfig?.embeddings?.writerAdaptiveStepMs))
          ? Math.max(100, Math.floor(Number(indexingConfig.embeddings.writerAdaptiveStepMs)))
          : 500;
        const writerAdaptiveRssLow = Number.isFinite(Number(indexingConfig?.embeddings?.writerAdaptiveRssLow))
          ? Math.max(0, Math.min(1, Number(indexingConfig.embeddings.writerAdaptiveRssLow)))
          : 0.62;
        const writerAdaptiveRssHigh = Number.isFinite(Number(indexingConfig?.embeddings?.writerAdaptiveRssHigh))
          ? Math.max(writerAdaptiveRssLow, Math.min(1, Number(indexingConfig.embeddings.writerAdaptiveRssHigh)))
          : 0.9;
        let writerAdaptiveLimit = writerMaxPending;
        let writerAdaptiveLastAdjustAt = 0;
        /**
         * Adapt writer queue limit based on scheduler memory pressure signals.
         *
         * @returns {number}
         */
        const resolveAdaptiveWriterLimit = () => {
          const nowMs = Date.now();
          if ((nowMs - writerAdaptiveLastAdjustAt) < writerAdaptiveStepMs) {
            return writerAdaptiveLimit;
          }
          const schedulerStats = scheduler?.stats?.();
          const ioQueue = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsIo] || null;
          const dynamicSchedulerIoMaxPending = Number.isFinite(Number(ioQueue?.maxPending))
            ? Math.max(1, Math.floor(Number(ioQueue.maxPending)))
            : null;
          const effectiveAdaptiveCeiling = dynamicSchedulerIoMaxPending
            ? Math.max(1, Math.min(writerAdaptiveCeiling, dynamicSchedulerIoMaxPending))
            : writerAdaptiveCeiling;
          const effectiveAdaptiveFloor = Math.max(1, Math.min(writerAdaptiveFloor, effectiveAdaptiveCeiling));
          writerAdaptiveLimit = Math.max(
            effectiveAdaptiveFloor,
            Math.min(writerAdaptiveLimit, effectiveAdaptiveCeiling)
          );
          const memorySignals = schedulerStats?.adaptive?.signals?.memory || null;
          const rssUtilization = Number(memorySignals?.rssUtilization);
          const gcPressure = Number(memorySignals?.gcPressureScore);
          if (!Number.isFinite(rssUtilization) || !Number.isFinite(gcPressure)) {
            return writerAdaptiveLimit;
          }
          if (rssUtilization >= writerAdaptiveRssHigh || gcPressure >= 0.4) {
            writerAdaptiveLimit = Math.max(effectiveAdaptiveFloor, writerAdaptiveLimit - 1);
            writerAdaptiveLastAdjustAt = nowMs;
            return writerAdaptiveLimit;
          }
          if (rssUtilization <= writerAdaptiveRssLow && gcPressure <= 0.2) {
            writerAdaptiveLimit = Math.min(effectiveAdaptiveCeiling, writerAdaptiveLimit + 1);
            writerAdaptiveLastAdjustAt = nowMs;
            return writerAdaptiveLimit;
          }
          return writerAdaptiveLimit;
        };
        const writerQueue = createBoundedWriterQueue({
          scheduleIo,
          maxPending: writerMaxPending,
          resolveMaxPending: resolveAdaptiveWriterLimit
        });
        const cacheShardHandlePool = createShardAppendHandlePool();
        const progressHeartbeatMs = resolveEmbeddingsProgressHeartbeatMs(indexingConfig);
        const progressStartedAtMs = Date.now();
        let embeddingTextsScheduled = 0;
        let embeddingTextsResolved = 0;
        let embeddingTextsEmbedded = 0;
        let embeddingBatchesCompleted = 0;
        let embeddingBatchTokensProcessed = 0;
        let embeddingBatchComputeMs = 0;
        let embeddingBatchTargetTokens = 0;
        let embeddingBatchUnderfilledTokens = 0;
        let embeddingBatchFillRatioSum = 0;
        let embeddingBatchQueueWaitMs = 0;
        let embeddingBatchMergedRequests = 0;
        let embeddingBatchMergedLabels = 0;
        let embeddingTextCacheHits = 0;
        let embeddingTextCacheMisses = 0;
        let embeddingTextBatchDedupHits = 0;
        let embeddingInFlightJoinHits = 0;
        let embeddingInFlightClaims = 0;
        let embeddingFileConcurrencyPeak = 0;
        let lastProgressEmitMs = 0;
        let progressTimer = null;
        /**
         * Emit combined files/chunks throughput snapshot for current mode.
         *
         * @param {{force?:boolean}} [input]
         * @returns {void}
         */
        const emitProgressSnapshot = ({ force = false } = {}) => {
          const nowMs = Date.now();
          if (!force && (nowMs - lastProgressEmitMs) < progressHeartbeatMs) return;
          lastProgressEmitMs = nowMs;
          const elapsedSec = Math.max(0.001, (nowMs - progressStartedAtMs) / 1000);
          const filesPerSec = processedFiles / elapsedSec;
          const chunksPerSec = processedChunks / elapsedSec;
          const remainingChunks = Math.max(0, sampledChunkCount - processedChunks);
          const etaSeconds = chunksPerSec > 0 ? (remainingChunks / chunksPerSec) : null;
          const etaText = formatEtaSeconds(etaSeconds, { fallback: 'n/a' });
          const cacheHitRate = cacheCounters.attempts > 0
            ? ((cacheCounters.hits / cacheCounters.attempts) * 100)
            : null;
          const writerStats = writerQueue.stats();
          const writerCompleted = Math.max(
            0,
            Number(writerStats.scheduled || 0) - Number(writerStats.pending || 0)
          );
          const writerTotal = Math.max(
            Number(writerStats.scheduled || 0),
            writerCompleted + Number(writerStats.pending || 0)
          );
          const schedulerStats = scheduler?.stats?.();
          const computeQueueStats = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsCompute] || {};
          const ioQueueStats = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsIo] || {};
          const embeddingTextReuseHits = embeddingTextCacheHits + embeddingTextBatchDedupHits;
          const embeddingTextReuseRate = embeddingTextsScheduled > 0
            ? (embeddingTextReuseHits / embeddingTextsScheduled) * 100
            : 0;
          const inFlightStats = embeddingInFlightCoalescer?.stats?.() || {};
          const embeddingTextsPerSec = elapsedSec > 0
            ? (embeddingTextsResolved / elapsedSec)
            : 0;
          const embeddingBatchFillPercent = embeddingBatchTargetTokens > 0
            ? Math.max(0, Math.min(1, embeddingBatchTokensProcessed / embeddingBatchTargetTokens)) * 100
            : 100;
          const embeddingBatchAvgWaitMs = embeddingBatchesCompleted > 0
            ? (embeddingBatchQueueWaitMs / embeddingBatchesCompleted)
            : 0;
          const embedEtaSeconds = embeddingTextsPerSec > 0
            ? Math.max(0, (embeddingTextsScheduled - embeddingTextsResolved) / embeddingTextsPerSec)
            : null;
          const perfMetrics = {
            files_total: sampledFileEntries.length,
            files_done: processedFiles,
            chunks_total: sampledChunkCount,
            chunks_done: processedChunks,
            cache_attempts: cacheAttempts,
            cache_hits: cacheHits,
            cache_misses: cacheMisses,
            cache_rejected: cacheRejected,
            cache_fast_rejects: cacheFastRejects,
            cache_hit_files: cacheHitFiles,
            computed_files: computedFiles,
            skipped_files: skippedFiles,
            texts_scheduled: embeddingTextsScheduled,
            texts_resolved: embeddingTextsResolved,
            texts_embedded: embeddingTextsEmbedded,
            batches_completed: embeddingBatchesCompleted,
            tokens_processed: embeddingBatchTokensProcessed,
            inflight_join_hits: embeddingInFlightJoinHits,
            inflight_claims: embeddingInFlightClaims,
            embed_compute_ms: Math.max(0, Math.round(embeddingBatchComputeMs)),
            elapsed_ms: Math.max(0, nowMs - progressStartedAtMs),
            files_per_sec: filesPerSec,
            chunks_per_sec: chunksPerSec,
            embed_resolved_per_sec: embeddingTextsPerSec,
            file_parallelism_current: adaptiveFileParallelismCurrent,
            file_parallelism_peak: Math.max(embeddingFileConcurrencyPeak, adaptiveFileParallelismCurrent),
            file_parallelism_adjustments: adaptiveFileParallelismAdjustments,
            writer_pending: Number(writerStats.pending || 0),
            writer_max_pending: Number(writerStats.currentMaxPending || 0),
            queue_compute_pending: Number(computeQueueStats.pending || 0),
            queue_io_pending: Number(ioQueueStats.pending || 0)
          };
          return {
            elapsedSec,
            filesPerSec,
            chunksPerSec,
            etaSeconds,
            cacheHitRate,
            writerStats,
            writerCompleted,
            writerTotal,
            computeQueueStats,
            ioQueueStats,
            embeddingTextReuseHits,
            embeddingTextReuseRate,
            inFlightStats,
            embeddingTextsPerSec,
            embedEtaSeconds,
            embeddingBatchFillPercent,
            embeddingBatchAvgWaitMs,
            perfMetrics
          };
        };
        const emitProgressSnapshot = ({ force = false, summary = false } = {}) => {
          const nowMs = Date.now();
          if (!force && (nowMs - lastProgressEmitMs) < progressHeartbeatMs) return;
          lastProgressEmitMs = nowMs;
          const {
            filesPerSec,
            chunksPerSec,
            etaSeconds,
            cacheHitRate,
            writerStats,
            writerCompleted,
            writerTotal,
            computeQueueStats,
            ioQueueStats,
            embeddingTextReuseHits,
            embeddingTextReuseRate,
            inFlightStats,
            embeddingTextsPerSec,
            embedEtaSeconds,
            embeddingBatchFillPercent,
            embeddingBatchAvgWaitMs,
            perfMetrics
          } = buildPerfSnapshot(nowMs);
          const perfStatusLine = formatEmbeddingsPerfLine({
            mode,
            kind: summary ? 'perf_summary' : 'perf_progress',
            metrics: perfMetrics
          });
          if (force || perfStatusLine !== lastPerfStatusLine) {
            lastPerfStatusLine = perfStatusLine;
            log(perfStatusLine);
          }
          const filesMessage = [
            `${processedFiles}/${sampledFileEntries.length} files`,
            `${processedChunks}/${sampledChunkCount} chunks`,
            `${filesPerSec.toFixed(1)} files/s`,
            `${chunksPerSec.toFixed(1)} chunks/s`,
            `eta ${etaText}`,
            `cache ${cacheHitRate == null ? 'n/a' : `${cacheHitRate.toFixed(1)}%`}`,
            `fp ${adaptiveFileParallelismCurrent}/${Math.max(embeddingFileConcurrencyPeak, adaptiveFileParallelismCurrent)}`,
            `writer ${writerStats.pending}/${writerStats.currentMaxPending}`,
            `q(c=${Number(computeQueueStats.pending || 0)},io=${Number(ioQueueStats.pending || 0)})`
          ].join(' | ');
          fileTask.set(processedFiles, sampledFileEntries.length, {
            message: filesMessage,
            throughput: {
              filesPerSec,
              chunksPerSec
            },
            etaSeconds,
            cache: {
              attempts: cacheCounters.attempts,
              hits: cacheCounters.hits,
              misses: cacheCounters.misses,
              rejected: cacheCounters.rejected,
              fastRejects: cacheCounters.fastRejects,
              hitRate: cacheHitRate
            },
            writer: writerStats,
            queue: {
              computePending: Number(computeQueueStats.pending || 0),
              ioPending: Number(ioQueueStats.pending || 0)
            },
            completed: {
              files: processedFiles,
              chunks: processedChunks,
              cacheHitFiles,
              computedFiles,
              skippedFiles
            }
          });
          chunkTask.set(Math.min(processedChunks, sampledChunkCount), sampledChunkCount, {
            message: `${processedChunks}/${sampledChunkCount} chunks | ${chunksPerSec.toFixed(1)} chunks/s | eta ${etaText}`,
            throughput: {
              chunksPerSec
            },
            etaSeconds
          });
          cacheTask.set(Math.min(cacheAttempts, sampledFileEntries.length), sampledFileEntries.length, {
            message: [
              `${cacheHits}/${cacheAttempts} hits`,
              `${cacheMisses} miss`,
              `${cacheRejected} rejected`,
              `${cacheFastRejects} fast-reject`
            ].join(' | ')
          });
          embedTask.set(
            Math.min(embeddingTextsResolved, Math.max(embeddingTextsScheduled, embeddingTextsResolved)),
            Math.max(embeddingTextsScheduled, embeddingTextsResolved),
            {
              message: [
                `${embeddingTextsResolved}/${embeddingTextsScheduled} resolved`,
                `${embeddingTextsEmbedded} embedded`,
                `reuse ${embeddingTextReuseHits} (${embeddingTextReuseRate.toFixed(1)}%)`,
                `coalesced ${embeddingInFlightJoinHits}`,
                `${embeddingBatchesCompleted} batches`,
                `${embeddingBatchTokensProcessed} tokens`,
                `fill ${embeddingBatchFillPercent.toFixed(1)}%`,
                `wait ${embeddingBatchAvgWaitMs.toFixed(1)}ms`,
                `${embeddingTextsPerSec.toFixed(1)} resolved/s`,
                `eta ${formatEta(embedEtaSeconds)}`,
                `compute ${Math.max(0, Math.round(embeddingBatchComputeMs))}ms`,
                `cache ${embeddingTextCache ? embeddingTextCache.size() : 0}`,
                `inflight ${Number(inFlightStats.size || 0)}`
              ].join(' | ')
            }
          );
          writerTask.set(writerCompleted, writerTotal, {
            message: [
              `pending ${writerStats.pending}/${writerStats.currentMaxPending}`,
              `scheduled ${writerStats.scheduled}`,
              `waits ${writerStats.waits}`,
              `failed ${writerStats.failed}`
            ].join(' | ')
          });
        };
        /**
         * Stop mode-local progress heartbeat timer.
         *
         * @returns {void}
         */
        const stopProgressTimer = () => {
          if (!progressTimer) return;
          clearInterval(progressTimer);
          progressTimer = null;
        };
        progressTimer = setInterval(() => {
          try {
            emitProgressSnapshot();
          } catch {
            // Progress reporting must never fail the embedding pass.
          }
        }, progressHeartbeatMs);

        let sharedZeroVec = new Float32Array(0);
        /**
         * Update per-mode progress/cache counters after one file completion.
         *
         * @param {{chunkCount?:number,source?:'computed'|'cache',skipped?:boolean}} [input]
         * @returns {Promise<void>}
         */
        const markFileProcessed = async ({ chunkCount = 0, source = 'computed', skipped = false } = {}) => {
          processedFiles += 1;
          processedChunks += Math.max(0, Math.floor(Number(chunkCount) || 0));
          if (source === 'cache') cacheHitFiles += 1;
          if (source === 'computed') computedFiles += 1;
          if (skipped) skippedFiles += 1;
          noteCacheFileProcessed();
          await flushCacheIndexMaybe();
          emitProgressSnapshot({ force: processedFiles === sampledFileEntries.length });
          if (traceArtifactIo && (processedFiles % 8 === 0 || processedFiles === sampledFileEntries.length)) {
            log(
              `[embeddings] ${mode}: processed ${processedFiles}/${sampledFileEntries.length} files ` +
              `(${processedChunks}/${sampledChunkCount} chunks)`
            );
          }
        };
        /**
         * Merge computed/reused vectors for one file and update output arrays.
         *
         * @param {object} entry
         * @returns {Promise<void>}
         */
        const processFileEmbeddings = async (entry) => {
          const codeEmbeds = entry.codeEmbeds || [];
          const docVectorsRaw = entry.docVectorsRaw || [];
          const reuse = entry.reuse || null;
          if (!Array.isArray(codeEmbeds) || codeEmbeds.length !== entry.items.length) {
            throw new Error(
              `[embeddings] ${mode} code batch size mismatch (expected ${entry.items.length}, got ${codeEmbeds?.length ?? 0}).`
            );
          }
          if (!Array.isArray(docVectorsRaw) || docVectorsRaw.length !== entry.items.length) {
            throw new Error(
              `[embeddings] ${mode} doc batch size mismatch (expected ${entry.items.length}, got ${docVectorsRaw?.length ?? 0}).`
            );
          }
          const fileCodeEmbeds = ensureVectorArrays(codeEmbeds, entry.items.length);
          for (const vec of fileCodeEmbeds) {
            if (isVectorLike(vec) && vec.length) assertDims(vec.length);
          }
          for (const vec of docVectorsRaw) {
            if (isVectorLike(vec) && vec.length) assertDims(vec.length);
          }

          const dims = dimsValidator.getDims();
          if (dims && sharedZeroVec.length !== dims) {
            sharedZeroVec = new Float32Array(dims);
          }
          const zeroVec = sharedZeroVec;

          const cachedCodeVectors = [];
          const cachedDocVectors = [];
          const cachedMergedVectors = [];
          for (let i = 0; i < entry.items.length; i += 1) {
            const chunkIndex = entry.items[i].index;
            const reusedCode = reuse?.code?.[i];
            const reusedDoc = reuse?.doc?.[i];
            const reusedMerged = reuse?.merged?.[i];
            if (isNonEmptyVector(reusedCode) && isNonEmptyVector(reusedDoc) && isNonEmptyVector(reusedMerged)) {
              assertDims(reusedCode.length);
              assertDims(reusedDoc.length);
              assertDims(reusedMerged.length);
              codeVectors[chunkIndex] = reusedCode;
              docVectors[chunkIndex] = reusedDoc;
              mergedVectors[chunkIndex] = reusedMerged;
              if (hnswEnabled) {
                addHnswFromQuantized('merged', chunkIndex, reusedMerged);
                addHnswFromQuantized('doc', chunkIndex, reusedDoc);
                addHnswFromQuantized('code', chunkIndex, reusedCode);
              }
              cachedCodeVectors.push(reusedCode);
              cachedDocVectors.push(reusedDoc);
              cachedMergedVectors.push(reusedMerged);
              continue;
            }
            const embedCode = isVectorLike(fileCodeEmbeds[i]) ? fileCodeEmbeds[i] : [];
            const embedDoc = isVectorLike(docVectorsRaw[i]) ? docVectorsRaw[i] : zeroVec;
            const quantized = buildQuantizedVectors({
              chunkIndex,
              codeVector: embedCode,
              docVector: embedDoc,
              zeroVector: zeroVec,
              addHnswVectors: hnswEnabled ? {
                merged: (id, vec) => addHnswFloatVector('merged', id, vec),
                doc: (id, vec) => addHnswFloatVector('doc', id, vec),
                code: (id, vec) => addHnswFloatVector('code', id, vec)
              } : null,
              quantization,
              normalize: embeddingNormalize
            });
            codeVectors[chunkIndex] = quantized.quantizedCode;
            docVectors[chunkIndex] = quantized.quantizedDoc;
            mergedVectors[chunkIndex] = quantized.quantizedMerged;
            cachedCodeVectors.push(quantized.quantizedCode);
            cachedDocVectors.push(quantized.quantizedDoc);
            cachedMergedVectors.push(quantized.quantizedMerged);
          }

          if (entry.cacheKey) {
            try {
              await enqueueCacheEntryWrite({
                cacheState,
                cacheIdentity,
                cacheIdentityKey,
                cacheKey: entry.cacheKey,
                normalizedRel: entry.normalizedRel,
                fileHash: entry.fileHash,
                chunkSignature: entry.chunkSignature,
                chunkHashes: entry.chunkHashes,
                chunkHashesFingerprint: entry.chunkHashesFingerprint || null,
                chunkCount: entry.items.length,
                codeVectors: cachedCodeVectors,
                docVectors: cachedDocVectors,
                mergedVectors: cachedMergedVectors,
                writerQueue,
                cacheShardHandlePool
              });
            } catch {
            // Ignore cache write failures.
            }
          }

          if (Array.isArray(entry.chunkHashes) && entry.chunkHashes.length) {
            try {
              const writes = [];
              for (let i = 0; i < entry.items.length; i += 1) {
                const chunkHash = entry.chunkHashes[i];
                if (!chunkHash) continue;
                const globalCacheKey = buildGlobalChunkCacheKey({
                  chunkHash,
                  identityKey: cacheIdentityKey,
                  featureFlags: cacheKeyFlags,
                  pathPolicy: 'posix'
                });
                if (!globalCacheKey) continue;
                if (
                  globalChunkCacheExistingKeys.has(globalCacheKey)
                  || globalChunkCachePendingWrites.has(globalCacheKey)
                ) {
                  continue;
                }
                const codeVec = cachedCodeVectors[i] || null;
                const docVec = cachedDocVectors[i] || null;
                const mergedVec = cachedMergedVectors[i] || null;
                if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
                  continue;
                }
                const payload = {
                  key: globalCacheKey,
                  hash: chunkHash,
                  cacheMeta: {
                    schemaVersion: 1,
                    scope: 'global-chunk',
                    identityKey: cacheIdentityKey,
                    identity: cacheIdentity,
                    createdAt: new Date().toISOString()
                  },
                  codeVectors: [codeVec],
                  docVectors: [docVec],
                  mergedVectors: [mergedVec]
                };
                globalChunkCachePendingWrites.add(globalCacheKey);
                writes.push({
                  globalCacheKey,
                  payload,
                  vectors: { code: codeVec, doc: docVec, merged: mergedVec }
                });
              }
              if (writes.length) {
                try {
                  const encodedWrites = await Promise.all(
                    writes.map(async (write) => ({
                      ...write,
                      encodedPayload: await encodeCacheEntryPayload(write.payload)
                    }))
                  );
                  await writerQueue.enqueue(async () => {
                    for (const write of encodedWrites) {
                      try {
                        await writeCacheEntry(globalChunkCacheDir, write.globalCacheKey, write.payload, {
                          encodedBuffer: write.encodedPayload
                        });
                        globalChunkCacheExistingKeys.add(write.globalCacheKey);
                        globalChunkCacheMemo.set(
                          write.globalCacheKey,
                          Promise.resolve({
                            cacheKey: write.globalCacheKey,
                            vectors: write.vectors,
                            rejected: false
                          })
                        );
                        globalChunkCacheStores += 1;
                      } catch {
                        globalChunkCacheMemo.delete(write.globalCacheKey);
                      } finally {
                        globalChunkCachePendingWrites.delete(write.globalCacheKey);
                      }
                    }
                  });
                } catch (err) {
                  for (const write of writes) {
                    globalChunkCachePendingWrites.delete(write.globalCacheKey);
                  }
                  throw err;
                }
              }
            } catch {
              // Ignore global chunk cache write failures.
            }
          }

          await markFileProcessed({
            chunkCount: entry.items.length,
            source: 'computed'
          });
        };

        const computeFileEmbeddings = createFileEmbeddingsProcessor({
          embeddingBatchSize,
          embeddingBatchTokenBudget,
          estimateEmbeddingTokens,
          estimateEmbeddingTokensBatch,
          getChunkEmbeddings,
          runBatched,
          assertVectorArrays,
          scheduleCompute,
          processFileEmbeddings,
          mode,
          parallelDispatch: parallelBatchDispatch,
          mergeCodeDocBatches,
          globalMicroBatching: globalMicroBatchingEnabled,
          globalMicroBatchingFillTarget,
          globalMicroBatchingMaxWaitMs,
          embeddingTextCache,
          embeddingInFlightCoalescer,
          onEmbeddingBatch: ({
            durationMs,
            batchTokens,
            targetBatchTokens,
            underfilledTokens,
            batchFillRatio,
            queueWaitMs,
            mergedRequests,
            mergedLabels
          }) => {
            embeddingBatchesCompleted += 1;
            embeddingBatchTokensProcessed += Math.max(0, Math.floor(Number(batchTokens) || 0));
            embeddingBatchComputeMs += Math.max(0, Number(durationMs) || 0);
            embeddingBatchTargetTokens += Math.max(
              0,
              Math.floor(Number(targetBatchTokens) || Number(batchTokens) || 0)
            );
            embeddingBatchUnderfilledTokens += Math.max(0, Math.floor(Number(underfilledTokens) || 0));
            embeddingBatchFillRatioSum += Math.max(0, Math.min(1, Number(batchFillRatio) || 0));
            embeddingBatchQueueWaitMs += Math.max(0, Number(queueWaitMs) || 0);
            embeddingBatchMergedRequests += Math.max(0, Math.floor(Number(mergedRequests) || 0));
            embeddingBatchMergedLabels += Math.max(0, Math.floor(Number(mergedLabels) || 0));
          },
          onEmbeddingUsage: ({
            requested,
            embedded,
            cacheHits,
            cacheMisses,
            batchDedupHits,
            inFlightJoined,
            inFlightOwned
          }) => {
            embeddingTextsResolved += Math.max(0, Math.floor(Number(requested) || 0));
            embeddingTextsEmbedded += Math.max(0, Math.floor(Number(embedded) || 0));
            embeddingTextCacheHits += Math.max(0, Math.floor(Number(cacheHits) || 0));
            embeddingTextCacheMisses += Math.max(0, Math.floor(Number(cacheMisses) || 0));
            embeddingTextBatchDedupHits += Math.max(0, Math.floor(Number(batchDedupHits) || 0));
            embeddingInFlightJoinHits += Math.max(0, Math.floor(Number(inFlightJoined) || 0));
            embeddingInFlightClaims += Math.max(0, Math.floor(Number(inFlightOwned) || 0));
          }
        });
        try {
          /**
           * Process one file's chunk items with cache lookup and fallback compute.
           *
           * @param {[string, object[]]} input
           * @returns {Promise<void>}
           */
          const processFileEntry = async ([relPath, items]) => {
            const normalizedRel = toPosix(relPath);
            const chunkSignature = buildChunkSignature(items);
            const manifestEntry = manifestFiles[normalizedRel] || null;
            const manifestHash = typeof manifestEntry?.hash === 'string' ? manifestEntry.hash : null;
            let fileHash = manifestHash;
            const resolveCacheKey = (hash) => buildCacheKey({
              file: normalizedRel,
              hash,
              signature: chunkSignature,
              identityKey: cacheIdentityKey,
              repoId: cacheRepoId,
              mode,
              featureFlags: cacheKeyFlags,
              pathPolicy: 'posix'
            });
            let cacheKey = resolveCacheKey(fileHash);
            /**
             * Try serving this file fully from cache for the provided content hash.
             *
             * @param {{cacheKeyForFile:string|null,fileHashForFile:string|null}} input
             * @returns {Promise<boolean>}
             */
            const tryServeFromCache = async ({ cacheKeyForFile, fileHashForFile }) => {
              const cached = await lookupCacheEntryWithStats({
                cacheState,
                cacheKey: cacheKeyForFile,
                fileHash: fileHashForFile,
                chunkSignature,
                cacheIdentityKey,
                scheduleIo,
                counters: cacheCounters
              });
              const reused = tryApplyCachedVectors({
                cached,
                items,
                normalizedRel,
                mode,
                configuredDims,
                cacheIdentityKey,
                chunkSignature,
                fileHash: fileHashForFile,
                cacheKey: cacheKeyForFile,
                cacheState,
                counters: cacheCounters,
                assertDims,
                codeVectors,
                docVectors,
                mergedVectors,
                addHnswFromQuantized
              });
              if (!reused) return false;
              await markFileProcessed({
                chunkCount: items.length,
                source: 'cache'
              });
              return true;
            };
            if (await tryServeFromCache({ cacheKeyForFile: cacheKey, fileHashForFile: fileHash })) {
              return;
            }

            /**
             * Resolve candidate absolute paths for a logical relative file.
             *
             * @returns {string[]}
             */
            const candidates = (() => {
              if (mode !== 'records') {
                return [path.resolve(root, fromPosix(normalizedRel))];
              }
              const resolvedRecordsDir = typeof recordsDir === 'string' && recordsDir
                ? recordsDir
                : root;
              if (normalizedRel.startsWith('triage/records/')) {
                const stripped = normalizedRel.slice('triage/records/'.length);
                return [
                  path.resolve(resolvedRecordsDir, fromPosix(stripped)),
                  path.resolve(root, fromPosix(normalizedRel))
                ];
              }
              return [
                path.resolve(root, fromPosix(normalizedRel)),
                path.resolve(resolvedRecordsDir, fromPosix(normalizedRel))
              ];
            })();
            let absPath = candidates[0];
            let textInfo = null;
            let lastErr = null;
            try {
              for (const candidate of candidates) {
                absPath = candidate;
                try {
                  textInfo = await scheduleIo(() => readTextFileWithHash(candidate));
                  lastErr = null;
                  break;
                } catch (err) {
                  lastErr = err;
                  if (mode === 'records' && err?.code === 'ENOENT') {
                    continue;
                  }
                  break;
                }
              }
              if (!textInfo) {
                throw lastErr || new Error('Unknown read error');
              }
            } catch (err) {
              const reason = err?.code ? `${err.code}: ${err.message || err}` : (err?.message || err);
              warn(`[embeddings] ${mode}: Failed to read ${normalizedRel}; skipping (${reason}).`);
              await markFileProcessed({
                chunkCount: items.length,
                source: 'skipped',
                skipped: true
              });
              return;
            }
            const text = textInfo.text;
            if (!fileHash) {
              fileHash = textInfo.hash;
              cacheKey = resolveCacheKey(fileHash);
              if (await tryServeFromCache({ cacheKeyForFile: cacheKey, fileHashForFile: fileHash })) {
                return;
              }
            }

            const codeTexts = [];
            const docTexts = [];
            const codeMapping = [];
            const docMapping = [];
            const chunkHashes = new Array(items.length);
            const chunkCodeTexts = new Array(items.length);
            const chunkDocTexts = new Array(items.length);
            let missingCodeTextCount = 0;
            for (let i = 0; i < items.length; i += 1) {
              const { chunk } = items[i];
              if (typeof chunk?.text === 'string') {
                chunkCodeTexts[i] = chunk.text;
              } else {
                missingCodeTextCount += 1;
              }
              const docText = typeof chunk?.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
              chunkDocTexts[i] = docText.trim() ? docText : '';
            }

            if (missingCodeTextCount > 0 && incremental?.bundleDir && manifestEntry?.bundle) {
              try {
                const bundleName = manifestEntry.bundle;
                const bundlePath = path.join(incremental.bundleDir, bundleName);
                const bundleResult = await scheduleIo(() => readBundleFile(bundlePath, {
                  format: resolveBundleFormatFromName(bundleName, incremental?.manifest?.bundleFormat)
                }));
                const bundleChunks = Array.isArray(bundleResult?.bundle?.chunks)
                  ? bundleResult.bundle.chunks
                  : [];
                missingCodeTextCount = hydrateMissingChunkTextsFromBundle({
                  items,
                  chunkCodeTexts,
                  bundleChunks
                });
              } catch {
                // Fall through to source-file reads for unresolved chunk text.
              }
            }

            const requiresSourceReadForText = missingCodeTextCount > 0;
            const requiresSourceReadForHash = !fileHash;
            let sourceText = null;
            if (requiresSourceReadForText || requiresSourceReadForHash) {
              const candidates = (() => {
                if (mode !== 'records') {
                  return [path.resolve(root, fromPosix(normalizedRel))];
                }
                const resolvedRecordsDir = typeof recordsDir === 'string' && recordsDir
                  ? recordsDir
                  : root;
                if (normalizedRel.startsWith('triage/records/')) {
                  const stripped = normalizedRel.slice('triage/records/'.length);
                  return [
                    path.resolve(resolvedRecordsDir, fromPosix(stripped)),
                    path.resolve(root, fromPosix(normalizedRel))
                  ];
                }
                return [
                  path.resolve(root, fromPosix(normalizedRel)),
                  path.resolve(resolvedRecordsDir, fromPosix(normalizedRel))
                ];
              })();
              let textInfo = null;
              let lastErr = null;
              try {
                for (const candidate of candidates) {
                  try {
                    textInfo = await scheduleIo(() => readTextFileWithHash(candidate));
                    lastErr = null;
                    break;
                  } catch (err) {
                    lastErr = err;
                    if (mode === 'records' && err?.code === 'ENOENT') {
                      continue;
                    }
                    break;
                  }
                }
                if (!textInfo) {
                  throw lastErr || new Error('Unknown read error');
                }
              } catch (err) {
                if (requiresSourceReadForText) {
                  const reason = err?.code ? `${err.code}: ${err.message || err}` : (err?.message || err);
                  warn(`[embeddings] ${mode}: Failed to read ${normalizedRel}; skipping (${reason}).`);
                  await markFileProcessed({
                    chunkCount: items.length,
                    source: 'skipped',
                    skipped: true
                  });
                  return;
                }
              }
              if (textInfo) {
                sourceText = textInfo.text;
                if (!fileHash) {
                  fileHash = textInfo.hash;
                  boundedMapSet(
                    sourceFileHashes,
                    normalizedRel,
                    fileHash,
                    sourceFileHashCacheMaxEntries
                  );
                  cacheKey = buildCacheKey({
                    file: normalizedRel,
                    hash: fileHash,
                    signature: chunkSignature,
                    identityKey: cacheIdentityKey,
                    repoId: cacheRepoId,
                    mode,
                    featureFlags: cacheKeyFlags,
                    pathPolicy: 'posix'
                  });
                  let cachedAfterHash = null;
                  if (cacheEligible && cacheKey) {
                    cacheAttempts += 1;
                    if (shouldFastRejectCacheLookup({
                      cacheIndex,
                      cacheKey,
                      identityKey: cacheIdentityKey,
                      fileHash,
                      chunkSignature
                    })) {
                      cacheFastRejects += 1;
                    } else {
                      cachedAfterHash = await scheduleIo(() => readCacheEntry(cacheDir, cacheKey, cacheIndex));
                    }
                  }
                  const cached = cachedAfterHash?.entry;
                  if (!cached && cacheEligible && cacheKey) {
                    cacheMisses += 1;
                  }
                  if (cached) {
                    try {
                      const cacheIdentityMatches = cached.cacheMeta?.identityKey === cacheIdentityKey;
                      if (cacheIdentityMatches) {
                        const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
                        validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
                        validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
                        validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
                      }
                      if (isCacheValid({
                        cached,
                        signature: chunkSignature,
                        identityKey: cacheIdentityKey,
                        hash: fileHash
                      })) {
                        const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
                        const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
                        const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
                        let hasEmptyCached = false;
                        for (let i = 0; i < items.length; i += 1) {
                          const chunkIndex = items[i].index;
                          const codeVec = cachedCode[i] || [];
                          const docVec = cachedDoc[i] || [];
                          const mergedVec = cachedMerged[i] || [];
                          if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
                            hasEmptyCached = true;
                            break;
                          }
                          assertDims(codeVec.length);
                          assertDims(docVec.length);
                          assertDims(mergedVec.length);
                          codeVectors[chunkIndex] = codeVec;
                          docVectors[chunkIndex] = docVec;
                          mergedVectors[chunkIndex] = mergedVec;
                          if (hnswEnabled) {
                            addHnswFromQuantized('merged', chunkIndex, mergedVec);
                            addHnswFromQuantized('doc', chunkIndex, docVec);
                            addHnswFromQuantized('code', chunkIndex, codeVec);
                          }
                        }
                        if (hasEmptyCached) {
                          throw new Error(`[embeddings] ${mode} cached vectors incomplete; recomputing ${normalizedRel}.`);
                        }
                        if (cacheIndex && cacheKey) {
                          updateCacheIndexAccess(cacheIndex, cacheKey);
                          if (!cacheIndex.files || typeof cacheIndex.files !== 'object') {
                            cacheIndex.files = {};
                          }
                          if (!cacheIndex.files[normalizedRel]) {
                            cacheIndex.files[normalizedRel] = cacheKey;
                          }
                          markCacheIndexDirty();
                        }
                        cacheHits += 1;
                        await markFileProcessed({
                          chunkCount: items.length,
                          source: 'cache'
                        });
                        return;
                      }
                    } catch (err) {
                      if (isDimsMismatch(err)) throw err;
                      // Ignore cache parse errors.
                      cacheRejected += 1;
                    }
                  }
                }
              }
            }

            for (let i = 0; i < items.length; i += 1) {
              const { chunk } = items[i];
              if (typeof chunkCodeTexts[i] !== 'string') {
                const start = Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : 0;
                const end = Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : start;
                chunkCodeTexts[i] = sourceText ? sourceText.slice(start, end) : '';
              }
              const codeText = chunkCodeTexts[i] || '';
              const trimmedDoc = chunkDocTexts[i] || '';
              chunkHashes[i] = buildNormalizedChunkPayloadHash({
                codeText,
                docText: trimmedDoc
              });
            }
            const chunkHashesFingerprint = buildChunkHashesFingerprint(chunkHashes);
            const reuse = {
              code: new Array(items.length).fill(null),
              doc: new Array(items.length).fill(null),
              merged: new Array(items.length).fill(null)
            };
            await reuseVectorsFromPriorCacheEntry({
              cacheState,
              cacheKey,
              normalizedRel,
              chunkHashes,
              chunkHashesFingerprint,
              reuse,
              scheduleIo
            });
            for (let i = 0; i < items.length; i += 1) {
              if (reuse.code[i] && reuse.doc[i] && reuse.merged[i]) {
                continue;
              }
              const chunkHash = chunkHashes[i];
              if (crossFileChunkDedupe instanceof Map) {
                const dedupeEntry = crossFileChunkDedupe.get(chunkHash);
                if (
                  dedupeEntry
                  && isNonEmptyVector(dedupeEntry.code)
                  && isNonEmptyVector(dedupeEntry.doc)
                  && isNonEmptyVector(dedupeEntry.merged)
                ) {
                  // Promote recency and reuse vectors for identical chunk payloads
                  // across files/modes within this embeddings run.
                  crossFileChunkDedupe.delete(chunkHash);
                  crossFileChunkDedupe.set(chunkHash, dedupeEntry);
                  reuse.code[i] = dedupeEntry.code;
                  reuse.doc[i] = dedupeEntry.doc;
                  reuse.merged[i] = dedupeEntry.merged;
                  crossFileChunkDedupeHits += 1;
                  continue;
                }
              }
              if (chunkHash) {
                globalChunkCacheAttempts += 1;
                const globalChunkHit = await resolveGlobalChunkVectors(chunkHash);
                if (globalChunkHit?.vectors) {
                  reuse.code[i] = globalChunkHit.vectors.code;
                  reuse.doc[i] = globalChunkHit.vectors.doc;
                  reuse.merged[i] = globalChunkHit.vectors.merged;
                  globalChunkCacheHits += 1;
                  continue;
                }
                if (globalChunkHit?.rejected) {
                  globalChunkCacheRejected += 1;
                } else {
                  globalChunkCacheMisses += 1;
                }
              }
              codeMapping.push(i);
              codeTexts.push(chunkCodeTexts[i]);
              docMapping.push(i);
              docTexts.push(chunkDocTexts[i]);
            }
            let docTextsNonEmpty = 0;
            for (const value of docTexts) {
              if (typeof value === 'string' && value) docTextsNonEmpty += 1;
            }
            embeddingTextsScheduled += codeTexts.length + docTextsNonEmpty;
            await computeFileEmbeddings({
              normalizedRel,
              items,
              cacheKey,
              fileHash,
              chunkSignature,
              chunkHashes,
              chunkHashesFingerprint,
              codeTexts,
              docTexts,
              codeMapping,
              docMapping,
              reuse
            });
            if (crossFileChunkDedupe instanceof Map) {
              for (let i = 0; i < items.length; i += 1) {
                const chunkIndex = items[i]?.index;
                if (!Number.isFinite(chunkIndex)) continue;
                const dedupeKey = chunkHashes[i];
                if (!dedupeKey) continue;
                const codeVec = codeVectors[chunkIndex];
                const docVec = docVectors[chunkIndex];
                const mergedVec = mergedVectors[chunkIndex];
                if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
                  continue;
                }
                boundedMapSet(
                  crossFileChunkDedupe,
                  dedupeKey,
                  { code: codeVec, doc: docVec, merged: mergedVec },
                  crossFileChunkDedupeMaxEntries
                );
                crossFileChunkDedupeStores += 1;
              }
            }
          };
          if (fileParallelism <= 1 || sampledFileEntries.length <= 1) {
            for (const entry of sampledFileEntries) {
              await processFileEntry(entry);
            }
            embeddingFileConcurrencyPeak = Math.max(embeddingFileConcurrencyPeak, 1);
          } else {
            const adaptiveRun = await runWithAdaptiveConcurrency({
              items: sampledFileEntries,
              initialConcurrency: fileParallelism,
              resolveConcurrency: () => resolveAdaptiveFileParallelism(),
              worker: async (entry) => processFileEntry(entry)
            });
            embeddingFileConcurrencyPeak = Math.max(
              embeddingFileConcurrencyPeak,
              Number(adaptiveRun?.peakConcurrency || 0)
            );
            adaptiveFileParallelismCurrent = Math.max(
              fileParallelism,
              Math.floor(Number(adaptiveRun?.finalConcurrency || adaptiveFileParallelismCurrent || fileParallelism))
            );
            adaptiveFileParallelismAdjustments = Math.max(
              adaptiveFileParallelismAdjustments,
              Math.max(0, Math.floor(Number(adaptiveRun?.adjustments || 0)))
            );
          }
        } finally {
          stopProgressTimer();
          if (typeof computeFileEmbeddings?.drain === 'function') {
            await computeFileEmbeddings.drain();
          }
          await writerQueue.onIdle();
          await cacheShardHandlePool.close();
          emitProgressSnapshot({ force: true, summary: true });
          cacheTask.done({ message: `${cacheHits}/${cacheAttempts} cache hits` });
          embedTask.done({
            message: [
              `${embeddingTextsResolved}/${Math.max(embeddingTextsScheduled, embeddingTextsResolved)} resolved`,
              `${embeddingTextsEmbedded} embedded`,
              `${embeddingTextCacheHits + embeddingTextBatchDedupHits} reused`
            ].join(' | ')
          });
          writerTask.done({ message: 'writer queue drained' });
        }
        await flushCacheIndexMaybe({ force: true });

        stageCheckpoints.record({
          stage: 'stage3',
          step: 'vectors-filled',
          extra: {
            vectors: {
              merged: countNonEmptyVectors(mergedVectors),
              doc: countNonEmptyVectors(docVectors),
              code: countNonEmptyVectors(codeVectors)
            }
          }
        });

        const observedDims = dimsValidator.getDims();
        if (configuredDims && observedDims && configuredDims !== observedDims) {
          throw new Error(
            `[embeddings] ${mode} embedding dims mismatch (configured=${configuredDims}, observed=${observedDims}).`
          );
        }
        const finalDims = observedDims
        || configuredDims
        || (useStubEmbeddings ? resolveStubDims(configuredDims) : DEFAULT_STUB_DIMS);
        fillMissingVectors(codeVectors, finalDims);
        fillMissingVectors(docVectors, finalDims);
        fillMissingVectors(mergedVectors, finalDims);
        clampQuantizedVectorsInPlace(codeVectors);
        clampQuantizedVectorsInPlace(docVectors);
        clampQuantizedVectorsInPlace(mergedVectors);

        const bundleRefreshStartedAtMs = Date.now();
        bundleTask.set(0, 1, { message: 'refreshing incremental bundles' });
        const refreshedBundles = await refreshIncrementalBundlesWithEmbeddings({
          mode,
          incremental,
          chunksByFile: sampledChunksByFile,
          mergedVectors,
          embeddingMode: resolvedEmbeddingMode,
          embeddingIdentityKey: cacheIdentityKey,
          lowYieldBailout: extractedProseLowYieldBailout,
          parallelism: bundleRefreshParallelism,
          scheduleIo,
          log,
          warn
        });
        bundleTask.done({
          message: `${refreshedBundles.rewritten || 0}/${refreshedBundles.eligible || 0} rewritten`
        });
        if (refreshedBundles.attempted > 0 && !refreshedBundles.completeCoverage) {
          warn(
            `[embeddings] ${mode}: incremental bundle embedding coverage incomplete; ` +
            'sqlite incremental builds may fall back to artifacts.'
          );
        }

        const mergedVectorsPath = path.join(indexDir, 'dense_vectors_uint8.json');
        const docVectorsPath = path.join(indexDir, 'dense_vectors_doc_uint8.json');
        const codeVectorsPath = path.join(indexDir, 'dense_vectors_code_uint8.json');
        backendTask.set(0, 5, { message: 'writing dense vector artifacts' });
        if (traceArtifactIo) {
          log(`[embeddings] ${mode}: writing vectors to ${mergedVectorsPath}`);
          log(`[embeddings] ${mode}: writing vectors to ${docVectorsPath}`);
          log(`[embeddings] ${mode}: writing vectors to ${codeVectorsPath}`);
        }
        const vectorFields = {
          model: modelId,
          dims: finalDims,
          scale: denseScale,
          minVal: quantization.minVal,
          maxVal: quantization.maxVal,
          levels: quantization.levels
        };
        await Promise.all([
          scheduleIo(() => writeDenseVectorArtifacts({
            indexDir,
            baseName: 'dense_vectors_uint8',
            vectorFields,
            vectors: mergedVectors,
            writeBinary: binaryDenseVectors
          })),
          scheduleIo(() => writeDenseVectorArtifacts({
            indexDir,
            baseName: 'dense_vectors_doc_uint8',
            vectorFields,
            vectors: docVectors,
            writeBinary: binaryDenseVectors
          })),
          scheduleIo(() => writeDenseVectorArtifacts({
            indexDir,
            baseName: 'dense_vectors_code_uint8',
            vectorFields,
            vectors: codeVectors,
            writeBinary: binaryDenseVectors
          }))
        ]);
        backendTask.set(1, 5, { message: 'building ANN backends (hnsw/lancedb)' });
        logArtifactLocation(mode, 'dense_vectors_uint8', mergedVectorsPath);
        logArtifactLocation(mode, 'dense_vectors_doc_uint8', docVectorsPath);
        logArtifactLocation(mode, 'dense_vectors_code_uint8', codeVectorsPath);

        const backendStageRoot = path.join(modeIndexRoot || indexDir, '.embeddings-backend-staging');
        const backendStageDir = path.join(backendStageRoot, `index-${mode}`);
        await scheduleIo(async () => {
          await fs.rm(backendStageDir, { recursive: true, force: true });
          await fs.mkdir(backendStageDir, { recursive: true });
        });
        const stagedHnswPaths = {
          merged: resolveHnswPaths(backendStageDir, 'merged'),
          doc: resolveHnswPaths(backendStageDir, 'doc'),
          code: resolveHnswPaths(backendStageDir, 'code')
        };
        try {
          Object.assign(hnswResults, await scheduleIo(() => writeHnswBackends({
            mode,
            hnswConfig,
            hnswIsolate,
            isolateState: hnswIsolateState,
            hnswBuilders,
            hnswPaths: stagedHnswPaths,
            vectors: { merged: mergedVectors, doc: docVectors, code: codeVectors },
            vectorsPaths: { merged: mergedVectorsPath, doc: docVectorsPath, code: codeVectorsPath },
            modelId,
            dims: finalDims,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            logger,
            log,
            warn
          })));

          await scheduleIo(() => writeLanceDbBackends({
            mode,
            indexDir: backendStageDir,
            lanceConfig,
            vectors: { merged: mergedVectors, doc: docVectors, code: codeVectors },
            vectorsPaths: { merged: mergedVectorsPath, doc: docVectorsPath, code: codeVectorsPath },
            dims: finalDims,
            modelId,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            logger,
            warn
          }));
          await scheduleIo(() => promoteBackendArtifacts({
            stageDir: backendStageDir,
            indexDir
          }));
          backendTask.set(2, 5, { message: 'updating sqlite dense vectors' });
        } finally {
          await scheduleIo(() => fs.rm(backendStageDir, { recursive: true, force: true }));
        }

        let sqliteVecState = { enabled: false, available: false };
        if (mode === 'code' || mode === 'prose') {
          const sqlitePathsForMode = resolveSqlitePaths(root, userConfig, { indexRoot: modeIndexRoot });
          const sqliteSharedDbForMode = sqlitePathsForMode?.codePath
            && sqlitePathsForMode?.prosePath
            && path.resolve(sqlitePathsForMode.codePath) === path.resolve(sqlitePathsForMode.prosePath);
          const sqliteResult = await scheduleIo(() => updateSqliteDense({
            Database,
            root,
            userConfig,
            indexRoot: modeIndexRoot,
            mode,
            vectors: mergedVectors,
            dims: finalDims,
            scale: denseScale,
            modelId,
            quantization,
            sharedDb: sqliteSharedDbForMode,
            writeBatchSize: sqliteDenseWriteBatchSize,
            emitOutput: true,
            warnOnMissing: false,
            logger
          }));
          const vectorAnn = sqliteResult?.vectorAnn || null;
          sqliteVecState = {
            enabled: vectorAnn?.enabled === true,
            available: vectorAnn?.available === true
          };
          if (sqliteVecState.available) {
            sqliteVecState.dims = finalDims;
            sqliteVecState.count = totalChunks;
          }
          const sqliteMetaPath = path.join(indexDir, 'dense_vectors_sqlite_vec.meta.json');
          if (vectorAnn?.available && vectorAnn?.table) {
            const sqliteMeta = {
              version: 1,
              generatedAt: new Date().toISOString(),
              model: modelId || null,
              dims: finalDims,
              count: totalChunks,
              table: vectorAnn.table,
              embeddingColumn: vectorAnn.column || null,
              idColumn: vectorAnn.idColumn || 'rowid',
              ingestEncoding: sqliteResult?.ingestEncoding || 'float32',
              scale: denseScale,
              minVal: quantization.minVal,
              maxVal: quantization.maxVal,
              levels: quantization.levels
            };
            try {
              await scheduleIo(() => writeJsonObjectFile(sqliteMetaPath, { fields: sqliteMeta, atomic: true }));
            } catch {
            // Ignore sqlite vec meta write failures.
            }
          } else {
            try {
              if (traceArtifactIo) {
                log(`[embeddings] ${mode}: deleting optional sqlite vec meta ${sqliteMetaPath}`);
              }
              await scheduleIo(() => fs.rm(sqliteMetaPath, { force: true }));
              logArtifactLocation(mode, 'dense_vectors_sqlite_vec_meta', sqliteMetaPath);
            } catch {}
          }
          queueBackgroundSqliteMaintenance({
            mode,
            denseCount: Number.isFinite(sqliteResult?.count) ? Number(sqliteResult.count) : totalChunks,
            modeIndexRoot,
            sqlitePathsForMode
          });
        }
        backendTask.set(3, 5, { message: 'validating backend metadata' });

        const { hnswState, lancedbState } = await resolvePublishedBackendStates({
          mode,
          indexDir,
          denseVectorMode,
          hnswConfig,
          lanceConfig,
          finalDims,
          totalChunks,
          scheduleIo,
          readJsonOptional
        });

        stageCheckpoints.record({
          stage: 'stage3',
          step: 'write',
          extra: {
            vectors: {
              merged: countNonEmptyVectors(mergedVectors),
              doc: countNonEmptyVectors(docVectors),
              code: countNonEmptyVectors(codeVectors)
            },
            hnsw: hnswState.available ? (hnswState.count || 0) : 0,
            lancedb: lancedbState.available ? (lancedbState.count || 0) : 0,
            sqliteVec: sqliteVecState.available ? (sqliteVecState.count || 0) : 0
          }
        });

        const now = new Date().toISOString();
        indexState.generatedAt = indexState.generatedAt || now;
        indexState.updatedAt = now;
        indexState.mode = indexState.mode || mode;
        indexState.embeddings = {
          ...(indexState.embeddings || {}),
          enabled: true,
          ready: true,
          pending: false,
          mode: indexState.embeddings?.mode || resolvedEmbeddingMode,
          service: indexState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
          embeddingIdentity: cacheIdentity || indexState.embeddings?.embeddingIdentity || null,
          embeddingIdentityKey: cacheIdentityKey || indexState.embeddings?.embeddingIdentityKey || null,
          lastError: null,
          cacheStats: {
            attempts: cacheCounters.attempts,
            hits: cacheCounters.hits,
            misses: cacheCounters.misses,
            rejected: cacheCounters.rejected,
            fastRejects: cacheCounters.fastRejects
          },
          backends: {
            ...(indexState.embeddings?.backends || {}),
            hnsw: hnswState,
            lancedb: lancedbState,
            sqliteVec: sqliteVecState
          },
          updatedAt: now
        };
        if (indexState.enrichment && indexState.enrichment.enabled) {
          indexState.enrichment = {
            ...indexState.enrichment,
            pending: false,
            stage: indexState.enrichment.stage || indexState.stage || 'stage2'
          };
        }
        try {
          await scheduleIo(() => writeIndexState(statePath, indexState));
        } catch {
        // Ignore index state write failures.
        }

        try {
          await scheduleIo(() => updatePieceManifest({ indexDir, mode, totalChunks, dims: finalDims }));
          logArtifactLocation(mode, 'pieces_manifest', path.join(indexDir, 'pieces', 'manifest.json'));
        } catch {
        // Ignore piece manifest write failures.
        }
        logExpectedArtifacts(mode, indexDir, 'pre-validate');

        const validation = await scheduleIo(() => validateIndexArtifacts({
          root,
          indexRoot: modeIndexRoot,
          modes: [mode],
          userConfig,
          sqliteEnabled: false
        }));
        backendTask.set(4, 5, { message: 'writing cache metadata + finalizing mode' });
        if (!validation.ok) {
          if (validation.issues?.length) {
            error('Index validation issues (first 10):');
            validation.issues.slice(0, 10).forEach((issue) => {
              error(`- ${issue}`);
            });
          }
          if (validation.warnings?.length) {
            warn('Index validation warnings (first 10):');
            validation.warnings.slice(0, 10).forEach((warning) => {
              warn(`- ${warning}`);
            });
          }
          crashLogger.logError({
            phase: `embeddings:${mode}`,
            stage: 'validation',
            message: `[embeddings] ${mode} index validation failed`,
            issues: validation.issues || [],
            warnings: validation.warnings || [],
            hints: validation.hints || []
          });
          throw new Error(`[embeddings] ${mode} index validation failed; see index-validate output for details.`);
        }

        const cacheMetaNow = new Date().toISOString();
        const cacheMetaPayload = {
          version: 1,
          identityKey: cacheIdentityKey,
          identity: cacheIdentity,
          dims: finalDims,
          mode,
          provider: runtimeEmbeddingProvider,
          modelId: modelId || null,
          normalize: embeddingNormalize,
          createdAt: cacheMetaMatches ? (cacheMeta?.createdAt || cacheMetaNow) : cacheMetaNow,
          updatedAt: cacheMetaNow
        };
        try {
          await scheduleIo(() => writeCacheMeta(cacheRoot, cacheIdentity, mode, cacheMetaPayload));
        } catch {
        // Ignore cache meta write failures.
        }

        {
          const vectorSummary = `[embeddings] ${mode}: wrote ${totalChunks} vectors (dims=${finalDims}).`;
          if (typeof display?.logLine === 'function') {
            display.logLine(vectorSummary, { kind: 'status' });
          } else {
            log(vectorSummary);
          }
        }
        if (crossFileChunkDedupeEnabled) {
          log(
            `[embeddings] ${mode}: cross-file chunk dedupe ` +
            `(hits=${crossFileChunkDedupeHits}, stores=${crossFileChunkDedupeStores}, ` +
            `cacheSize=${crossFileChunkDedupe?.size || 0}, maxEntries=${crossFileChunkDedupeMaxEntries}).`
          );
        }
        if (globalChunkCacheAttempts > 0 || globalChunkCacheStores > 0) {
          log(
            `[embeddings] ${mode}: global chunk cache ` +
            `(attempts=${globalChunkCacheAttempts}, hits=${globalChunkCacheHits}, ` +
            `misses=${globalChunkCacheMisses}, rejected=${globalChunkCacheRejected}, ` +
            `stores=${globalChunkCacheStores}).`
          );
        }
        {
          const inFlightStats = embeddingInFlightCoalescer?.stats?.() || {};
          log(
            `[embeddings] ${mode}: in-flight coalescing ` +
            `(joins=${inFlightStats.joins || 0}, claims=${inFlightStats.claims || 0}, ` +
            `bypassed=${inFlightStats.bypassed || 0}, peak=${inFlightStats.peakSize || 0}).`
          );
        }
        if (adaptiveFileParallelismEnabled) {
          log(
            `[embeddings] ${mode}: adaptive file parallelism ` +
            `(base=${fileParallelism}, final=${adaptiveFileParallelismCurrent}, ` +
            `peak=${embeddingFileConcurrencyPeak || adaptiveFileParallelismCurrent}, ` +
            `adjustments=${adaptiveFileParallelismAdjustments}).`
          );
        }
        if (globalMicroBatchingEnabled && embeddingBatchesCompleted > 0) {
          const fillPercent = embeddingBatchTargetTokens > 0
            ? Math.max(0, Math.min(1, embeddingBatchTokensProcessed / embeddingBatchTargetTokens)) * 100
            : 100;
          const avgQueueWaitMs = embeddingBatchQueueWaitMs / embeddingBatchesCompleted;
          const avgMergedRequests = embeddingBatchMergedRequests / embeddingBatchesCompleted;
          const avgMergedLabels = embeddingBatchMergedLabels / embeddingBatchesCompleted;
          const avgFillRatio = embeddingBatchFillRatioSum / embeddingBatchesCompleted;
          log(
            `[embeddings] ${mode}: global micro-batching ` +
            `(fill=${fillPercent.toFixed(1)}% avgFill=${(avgFillRatio * 100).toFixed(1)}% ` +
            `underfilled=${embeddingBatchUnderfilledTokens} wait=${avgQueueWaitMs.toFixed(1)}ms ` +
            `mergedRequests=${avgMergedRequests.toFixed(2)} mergedLabels=${avgMergedLabels.toFixed(2)}).`
          );
        }
        writerStatsByMode[mode] = writerQueue.stats();
        const schedulerStats = scheduler?.stats?.();
        const starvationCount = schedulerStats?.counters?.starvation ?? 0;
        if (starvationCount > 0) {
          const starvedQueues = Object.entries(schedulerStats?.queues || {})
            .filter(([, stats]) => stats.starvation > 0)
            .map(([name, stats]) => `${name}:${stats.starvation}`)
            .join(', ');
          warn(`[embeddings] scheduler starvation events: ${starvationCount}${starvedQueues ? ` (${starvedQueues})` : ''}`);
        }
        {
          const computeQueue = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsCompute] || {};
          const computeQueuePressure = (() => {
            const pending = Math.max(0, Number(computeQueue.pending) || 0);
            const maxPending = Math.max(1, Number(computeQueue.maxPending) || 1);
            return Math.max(0, Math.min(1, pending / maxPending));
          })();
          const reuseRate = embeddingTextsResolved > 0
            ? (embeddingTextCacheHits + embeddingTextBatchDedupHits) / embeddingTextsResolved
            : 0;
          const observed = {
            mode,
            textsResolved: embeddingTextsResolved,
            textsEmbedded: embeddingTextsEmbedded,
            reuseRate,
            batches: embeddingBatchesCompleted,
            batchComputeMs: embeddingBatchComputeMs,
            tokensProcessed: embeddingBatchTokensProcessed,
            computeQueuePressure,
            inFlightJoinHits: embeddingInFlightJoinHits,
            inFlightClaims: embeddingInFlightClaims,
            fileConcurrencyBase: fileParallelism,
            fileConcurrencyFinal: adaptiveFileParallelismCurrent,
            fileConcurrencyPeak: Math.max(embeddingFileConcurrencyPeak, adaptiveFileParallelismCurrent),
            fileConcurrencyAdjustments: adaptiveFileParallelismAdjustments
          };
          const recommendation = deriveEmbeddingsAutoTuneRecommendation({
            observed,
            current: {
              batchSize: embeddingBatchSize,
              maxBatchTokens: embeddingBatchTokenBudget,
              fileParallelism: adaptiveFileParallelismCurrent
            }
          });
          if (recommendation) {
            await writeEmbeddingsAutoTuneRecommendation({
              repoCacheRoot,
              provider: runtimeEmbeddingProvider,
              modelId,
              recommended: recommendation,
              observed,
              log
            });
          }
        }
        backendTask.done({ message: 'backend outputs ready' });
        finishMode(`built ${mode}`);
      } catch (err) {
        cacheTask?.fail?.(err);
        embedTask?.fail?.(err);
        writerTask?.fail?.(err);
        bundleTask?.fail?.(err);
        backendTask?.fail?.(err);
        logExpectedArtifacts(mode, indexDir, 'failure');
        const now = new Date().toISOString();
        const failureState = loadIndexState(statePath);
        failureState.generatedAt = failureState.generatedAt || now;
        failureState.updatedAt = now;
        failureState.mode = failureState.mode || mode;
        failureState.embeddings = {
          ...(failureState.embeddings || {}),
          enabled: true,
          ready: false,
          pending: false,
          mode: failureState.embeddings?.mode || resolvedEmbeddingMode,
          service: failureState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
          embeddingIdentity: cacheIdentity || failureState.embeddings?.embeddingIdentity || null,
          embeddingIdentityKey: cacheIdentityKey || failureState.embeddings?.embeddingIdentityKey || null,
          lastError: err?.message || String(err),
          updatedAt: now
        };
        if (failureState.enrichment && failureState.enrichment.enabled) {
          failureState.enrichment = {
            ...failureState.enrichment,
            pending: false,
            stage: failureState.enrichment.stage || failureState.stage || 'stage2'
          };
        }
        try {
          await scheduleIo(() => writeIndexState(statePath, failureState));
        } catch {
          // Ignore index state write failures.
        }
        throw err;
      } finally {
        if (stageCheckpoints) {
          await stageCheckpoints.flush();
        }
      }
    }

    for (const tracker of buildStateTrackers.values()) {
      if (!tracker?.hasBuildState || !tracker.runningMarked) continue;
      await markBuildPhase(tracker.root, 'stage3', 'done');
    }
    return { modes, scheduler: scheduler?.stats?.(), writer: writerStatsByMode };
  } catch (err) {
    crashLogger.logError({
      phase: 'stage3',
      stage: 'embeddings',
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    throw err;
  } finally {
    await persistentTextCacheStore?.close?.();
    scheduler?.shutdown?.();
    finalize();
  }
}

