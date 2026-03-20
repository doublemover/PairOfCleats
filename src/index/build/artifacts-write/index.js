import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { coerceAbortSignal } from '../../../shared/abort.js';
import { log, logLine, showProgress } from '../../../shared/progress.js';
import { MAX_JSON_BYTES, readJsonFile, loadJsonArrayArtifact } from '../../../shared/artifact-io.js';
import { resolveArtifactCompressionTier } from '../../../shared/artifact-io/compression.js';
import { toPosix } from '../../../shared/files.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';
import { createJsonWriteStream, writeChunk, writeChunkWithTiming } from '../../../shared/json-stream/streams.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import { ensureDiskSpace } from '../../../shared/disk-space.js';
import { writeDenseVectorBinaryFile } from '../../../shared/dense-vector-artifacts.js';
import { estimateJsonBytes } from '../../../shared/cache.js';
import { buildCacheKey } from '../../../shared/cache-key.js';
import { sha1 } from '../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { coerceIntAtLeast, coerceNumberAtLeast } from '../../../shared/number-coerce.js';
import { removePathWithRetry } from '../../../shared/io/remove-path-with-retry.js';
import { resolveCompressionConfig } from '../artifacts/compression.js';
import { getToolingConfig } from '../../../shared/dict-utils.js';
import { buildFileMeta, buildFileMetaColumnar, computeFileMetaFingerprint } from '../artifacts/file-meta.js';
import { enqueueGraphRelationsArtifacts } from '../artifacts/graph-relations.js';
import { enqueueRepoMapArtifacts, measureRepoMap } from '../artifacts/repo-map.js';
import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import {
  enqueueTokenPostingsArtifacts,
  resolveTokenPostingsPlan
} from '../artifacts/token-postings.js';
import { resolveTokenMode } from '../artifacts/token-mode.js';
import { createArtifactWriter } from '../artifacts/writer.js';
import { formatBytes } from '../artifacts/helpers.js';
import { resolveFilterIndexArtifactState } from '../artifacts/filter-index-reuse.js';
import { createArtifactPieceRegistry } from '../artifacts/piece-registry.js';
import { createQueuedArtifactWritePlanner } from '../artifacts/write-queue.js';
import { enqueueFileRelationsArtifacts } from '../artifacts/writers/file-relations.js';
import { enqueueCallSitesArtifacts } from '../artifacts/writers/call-sites.js';
import { enqueueRiskInterproceduralArtifacts } from '../artifacts/writers/risk-interprocedural.js';
import { enqueueSymbolsArtifacts } from '../artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from '../artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../artifacts/writers/symbol-edges.js';
import { createRepoMapIterator } from '../artifacts/writers/repo-map.js';
import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts,
  resolveChunkMetaPlan,
  resolveChunkMetaOrder,
  resolveChunkMetaOrderById
} from '../artifacts/writers/chunk-meta.js';
import { enqueueChunkUidMapArtifacts } from '../artifacts/writers/chunk-uid-map.js';
import { enqueueVfsManifestArtifacts } from '../artifacts/writers/vfs-manifest.js';
import {
  BUILD_STATE_DURABILITY_CLASS,
  recordOrderingHash,
  updateBuildState,
  updateBuildStateOutcome
} from '../build-state.js';
import { applyByteBudget, resolveByteBudgetMap } from '../byte-budget.js';
import { CHARGRAM_HASH_META } from '../../../shared/chargram-hash.js';
import { computePackedChecksum } from '../../../shared/artifact-io/checksum.js';
import {
  resolveBinaryColumnarWriteHints,
  writeBinaryRowFrames
} from '../../../shared/artifact-io/binary-columnar.js';
import {
  INDEX_PROFILE_VECTOR_ONLY,
  normalizeIndexProfileId
} from '../../../contracts/index-profile.js';
import { resolveArtifactWriteConcurrency } from '../artifacts/write-concurrency.js';
import {
  resolveArtifactLaneConcurrency,
  resolveArtifactLaneConcurrencyWithMassive,
  resolveArtifactLaneConcurrencyWithUltraLight,
  resolveArtifactWorkClassConcurrency,
  resolveWriteStartTimestampMs
} from '../artifacts/lane-policy.js';
import {
  canDispatchArtifactWriteEntry,
  createAdaptiveWriteConcurrencyController,
  resolveArtifactBlockingState,
  resolveAdaptiveShardCount,
  resolveArtifactEffectiveDispatchBytes,
  resolveArtifactExclusivePublisherFamily,
  resolveArtifactWriteBytesInFlightLimit,
  resolveArtifactWriteFsStrategy,
  resolveArtifactWriteLatencyClass,
  resolveArtifactWriteMemTokens,
  resolveArtifactWriteThroughputProfile,
  selectMicroWriteBatch,
  selectTailWorkerWriteEntry,
  summarizeArtifactLatencyClasses
} from '../artifacts/write-strategy.js';
import {
  buildDeterminismReport,
  buildExtractionReport,
  buildLexiconRelationFilterReport,
  stripIndexStateNondeterministicFields
} from '../artifacts/reporting.js';
import {
  buildBoilerplateCatalog,
  readStableIndexStateHash,
  writeBinaryArtifactAtomically
} from '../artifacts/write-runtime-helpers.js';
import {
  cleanupVectorOnlySparseArtifacts,
  getLingeringSparseArtifacts,
  removeCompressedArtifact,
  removePackedMinhash,
  removePackedPostings,
  VECTOR_ONLY_SPARSE_PIECE_DENYLIST
} from '../artifacts/sparse-cleanup.js';
import { packMinhashSignatures } from '../artifacts/minhash-packed.js';
import { dispatchPlannedArtifactWrites, resolveQueuedWriteLanes } from './planning.js';
import {
  createArtifactOrderingRecorder,
  runArtifactPublicationFinalizers
} from './publication.js';
import {
  createArtifactWriteExecutionState,
  normalizeArtifactWriteInput,
  pathExists,
  resolveArtifactWriteRuntime
} from './runtime.js';
import { createArtifactWriteTelemetryContext } from './telemetry.js';
import {
  enqueueArtifactFamilyWrites,
  prepareArtifactCleanup
} from './family-dispatch.js';

export {
  resolveArtifactWriteConcurrency,
  buildLexiconRelationFilterReport,
  resolveArtifactLaneConcurrency,
  resolveArtifactLaneConcurrencyWithUltraLight,
  resolveArtifactLaneConcurrencyWithMassive,
  resolveArtifactWorkClassConcurrency,
  createAdaptiveWriteConcurrencyController,
  resolveWriteStartTimestampMs,
  resolveArtifactWriteFsStrategy,
  resolveArtifactWriteLatencyClass,
  selectTailWorkerWriteEntry,
  selectMicroWriteBatch
};

/**
 * Adaptive write-concurrency controller for artifact writes.
 *
 * Concurrency scales up with backlog pressure and scales down when write stalls
 * are sustained, replacing fixed-cap behavior during long write tails.
 *
 * @param {object} input
 * @param {number} input.maxConcurrency
 * @param {number} [input.minConcurrency]
 * @param {number|null} [input.initialConcurrency]
 * @param {number} [input.scaleUpBacklogPerSlot]
 * @param {number} [input.scaleDownBacklogPerSlot]
 * @param {number} [input.stallScaleDownSeconds]
 * @param {number} [input.stallScaleUpGuardSeconds]
 * @param {number} [input.scaleUpCooldownMs]
 * @param {number} [input.scaleDownCooldownMs]
 * @param {number} [input.memoryPressureHighThreshold]
 * @param {number} [input.memoryPressureLowThreshold]
 * @param {number} [input.gcPressureHighThreshold]
 * @param {number} [input.gcPressureLowThreshold]
 * @param {number} [input.writeQueuePendingThreshold]
 * @param {number} [input.writeQueueOldestWaitMsThreshold]
 * @param {number} [input.writeQueueWaitP95MsThreshold]
 * @param {() => number} [input.now]
 * @param {(event:{reason:string,from:number,to:number,pendingWrites:number,activeWrites:number,longestStallSec:number,memoryPressure:number|null,gcPressure:number|null,rssUtilization:number|null,schedulerWritePending:number|null,schedulerWriteOldestWaitMs:number|null,schedulerWriteWaitP95Ms:number|null,stallAttribution:string}) => void} [input.onChange]
 * @returns {{observe:(snapshot?:{pendingWrites?:number,activeWrites?:number,longestStallSec?:number,memoryPressure?:number|null,gcPressure?:number|null,rssUtilization?:number|null,schedulerWritePending?:number|null,schedulerWriteOldestWaitMs?:number|null,schedulerWriteWaitP95Ms?:number|null})=>number,getCurrentConcurrency:()=>number,getLimits:()=>{min:number,max:number}}}
 */
/**
 * Write index artifacts and metrics.
 * @param {object} input
 */
export async function writeIndexArtifacts(input) {
  const normalizedInput = normalizeArtifactWriteInput(input);
  const {
    scheduler,
    outDir,
    buildRoot,
    mode,
    state,
    postings,
    postingsConfig,
    modelId,
    useStubEmbeddings,
    dictSummary,
    timing,
    root,
    userConfig,
    incrementalEnabled,
    fileCounts,
    perfProfile,
    indexState,
    graphRelations,
    stageCheckpoints,
    telemetry = null,
    riskInterproceduralEmitArtifacts = null,
    repoProvenance = null,
    tinyRepoFastPath = null
  } = normalizedInput;
  const { effectiveAbortSignal } = normalizedInput;
  const orderingStage = indexState?.stage || 'stage2';
  const { recordOrdering, measureVocabOrdering } = createArtifactOrderingRecorder({
    buildRoot,
    orderingStage,
    mode
  });
  const {
    indexingConfig,
    profileId,
    vectorOnlyProfile,
    sparseArtifactsEnabled,
    documentExtractionEnabled,
    resolvedTokenMode,
    tokenMaxFiles,
    tokenSampleSize,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressionMinBytes,
    compressionMaxBytes,
    compressibleArtifacts,
    compressionOverrides: tieredCompressionOverrides,
    artifactConfig,
    writeFsStrategy,
    writeJsonlShapeAware,
    writeJsonlLargeThresholdBytes,
    artifactMode,
    jsonArraySerializeShardThresholdMs,
    jsonArraySerializeShardMaxBytes,
    fileMetaFormatConfig,
    chunkMetaFormatConfig,
    chunkMetaBinaryColumnar,
    tokenPostingsBinaryColumnar,
    chunkMetaJsonlThreshold,
    chunkMetaJsonlEstimateThresholdBytes,
    chunkMetaShardSizeExplicit,
    chunkMetaShardSize,
    chunkMetaStreaming,
    symbolArtifactsFormatConfig,
    tokenPostingsFormatConfig,
    tokenPostingsPackedAutoThresholdBytes,
    tokenPostingsShardSize: initialTokenPostingsShardSize,
    tokenPostingsShardThreshold,
    fieldTokensShardThresholdBytes,
    fieldTokensShardMaxBytes,
    artifactWriteThroughputBytesPerSec,
    fieldPostingsShardsEnabled,
    fieldPostingsShardThresholdBytes,
    fieldPostingsShardCount,
    fieldPostingsShardMinCount,
    fieldPostingsShardMaxCount,
    fieldPostingsShardTargetBytes,
    fieldPostingsShardTargetSeconds,
    fieldPostingsBinaryColumnar,
    fieldPostingsBinaryColumnarThresholdBytes,
    fieldPostingsKeepLegacyJson,
    chunkMetaAdaptiveShardsEnabled,
    chunkMetaShardMinCount,
    chunkMetaShardMaxCount,
    chunkMetaShardTargetBytes,
    chunkMetaShardTargetSeconds,
    minhashJsonLargeThreshold,
    writeProgressHeartbeatMs,
    resolveArtifactTier,
    resolveShardCompression
  } = resolveArtifactWriteRuntime({
    userConfig,
    indexState,
    state,
    fileCounts,
    perfProfile
  });
  let tokenPostingsShardSize = initialTokenPostingsShardSize;
  const tinyRepoMinimalArtifacts = tinyRepoFastPath?.active === true
    && tinyRepoFastPath?.minimalArtifacts === true;

  const maxJsonBytes = MAX_JSON_BYTES;
  const byteBudgetState = resolveByteBudgetMap({ indexingConfig, maxJsonBytes });
  const byteBudgetPolicies = byteBudgetState.policies || {};
  /**
   * Resolve byte-budget policy row for an artifact.
   *
   * @param {string} name
   * @returns {object|null}
   */
  const resolveBudget = (name) => byteBudgetPolicies?.[name] || null;
  /**
   * Resolve max-bytes cap from budget policy with fallback.
   *
   * @param {string} name
   * @param {number} fallback
   * @returns {number}
   */
  const resolveBudgetMaxBytes = (name, fallback) => {
    const budget = resolveBudget(name);
    return Number.isFinite(budget?.maxBytes) ? budget.maxBytes : fallback;
  };
  const byteBudgetSnapshot = {
    generatedAt: new Date().toISOString(),
    maxJsonBytes,
    strict: !!byteBudgetState.strict,
    policies: byteBudgetPolicies
  };
  if (buildRoot) {
    const outcome = await updateBuildStateOutcome(
      buildRoot,
      { byteBudgets: byteBudgetSnapshot },
      { durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT }
    );
    if (outcome?.status === 'timed_out') {
      logLine(
        `[build_state] byte budget state write timed out for ${buildRoot}; continuing artifact writes.`,
        {
          kind: 'warning',
          buildState: {
            event: 'byte-budget-write-timeout',
            buildRoot,
            timeoutMs: outcome?.timeoutMs ?? null,
            elapsedMs: outcome?.elapsedMs ?? null
          }
        }
      );
    }
  }
  const maxJsonBytesSoft = maxJsonBytes * 0.9;
  const shardTargetBytes = maxJsonBytes * 0.75;
  const fileMetaBudget = resolveBudget('file_meta');
  const chunkMetaBudget = resolveBudget('chunk_meta');
  const tokenPostingsBudget = resolveBudget('token_postings');
  const repoMapBudget = resolveBudget('repo_map');
  const fileRelationsBudget = resolveBudget('file_relations');
  const vfsBudget = resolveBudget('vfs_manifest');
  const symbolEdgesBudget = resolveBudget('symbol_edges');
  const symbolOccurrencesBudget = resolveBudget('symbol_occurrences');
  const callSitesBudget = resolveBudget('call_sites');
  const chunkUidMapBudget = resolveBudget('chunk_uid_map');
  const graphRelationsBudget = resolveBudget('graph_relations');
  const fileMetaMaxBytes = resolveBudgetMaxBytes('file_meta', maxJsonBytes);
  const chunkMetaMaxBytes = resolveBudgetMaxBytes('chunk_meta', maxJsonBytes);
  const tokenPostingsMaxBytes = resolveBudgetMaxBytes('token_postings', maxJsonBytes);
  const repoMapMaxBytes = resolveBudgetMaxBytes('repo_map', maxJsonBytes);
  const fileRelationsMaxBytes = resolveBudgetMaxBytes('file_relations', maxJsonBytes);
  const vfsMaxBytes = resolveBudgetMaxBytes('vfs_manifest', maxJsonBytes);
  const symbolEdgesMaxBytes = resolveBudgetMaxBytes('symbol_edges', maxJsonBytes);
  const symbolOccurrencesMaxBytes = resolveBudgetMaxBytes('symbol_occurrences', maxJsonBytes);
  const callSitesMaxBytes = resolveBudgetMaxBytes('call_sites', maxJsonBytes);
  const chunkUidMapMaxBytes = resolveBudgetMaxBytes('chunk_uid_map', maxJsonBytes);
  const graphRelationsMaxBytes = resolveBudgetMaxBytes('graph_relations', maxJsonBytes);
  const tokenPostingsMaxBytesSoft = Number.isFinite(tokenPostingsMaxBytes) ? tokenPostingsMaxBytes * 0.9 : maxJsonBytesSoft;
  const tokenPostingsShardTargetBytes = Number.isFinite(tokenPostingsMaxBytes)
    ? tokenPostingsMaxBytes * 0.75
    : shardTargetBytes;
  const fileMetaColumnarThreshold = Number.isFinite(Number(artifactConfig.fileMetaColumnarThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaColumnarThresholdBytes)))
    : fileMetaMaxBytes;
  const fileMetaJsonlThreshold = Number.isFinite(Number(artifactConfig.fileMetaJsonlThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaJsonlThresholdBytes)))
    : Math.min(fileMetaMaxBytes, 1 * 1024 * 1024);
  const fileMetaShardedMaxBytes = Number.isFinite(Number(artifactConfig.fileMetaShardedMaxBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaShardedMaxBytes)))
    : Math.min(fileMetaMaxBytes, 8 * 1024 * 1024);
  const toolingConfig = getToolingConfig(root, userConfig);
  const vfsHashRouting = toolingConfig?.vfs?.hashRouting === true;
  // Keep file_meta fingerprint source deterministic: prefer discovery order when
  // available, otherwise fall back to sorted fileInfo keys.
  /**
   * Resolve deterministic file ordering for file_meta fingerprinting.
   *
   * @returns {string[]}
   */
  const resolveFileMetaFiles = () => {
    if (Array.isArray(state?.discoveredFiles) && state.discoveredFiles.length) {
      return state.discoveredFiles;
    }
    if (state?.fileInfoByPath && typeof state.fileInfoByPath.keys === 'function') {
      return Array.from(state.fileInfoByPath.keys()).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
    }
    return [];
  };
  const fileMetaFiles = resolveFileMetaFiles();
  let fileMetaFingerprint = fileMetaFiles.length
    ? computeFileMetaFingerprint({ files: fileMetaFiles, fileInfoByPath: state?.fileInfoByPath })
    : null;
  const fileMetaCacheFlags = [
    `format:${fileMetaFormatConfig || 'auto'}`,
    `columnarThreshold:${fileMetaColumnarThreshold}`,
    `jsonlThreshold:${fileMetaJsonlThreshold}`
  ];
  const fileMetaCacheKey = fileMetaFingerprint
    ? buildCacheKey({
      repoHash: indexState?.repoId || null,
      buildConfigHash: fileMetaFingerprint,
      mode,
      schemaVersion: 'file-meta-cache-v1',
      featureFlags: fileMetaCacheFlags,
      pathPolicy: 'posix'
    }).key
    : null;
  let fileMeta = null;
  let fileIdByPath = new Map();
  let fileMetaFromCache = false;
  let fileMetaMeta = null;
  if (incrementalEnabled && fileMetaFingerprint) {
    const metaPath = path.join(outDir, 'file_meta.meta.json');
    try {
      if (await pathExists(metaPath)) {
        const metaRaw = readJsonFile(metaPath, { maxBytes: fileMetaMaxBytes });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        const cachedFingerprint = meta?.fingerprint ?? meta?.extensions?.fingerprint ?? null;
        const cachedCacheKey = meta?.cacheKey ?? meta?.extensions?.cacheKey ?? null;
        const cacheKeyMatches = !!(cachedCacheKey && fileMetaCacheKey && cachedCacheKey === fileMetaCacheKey);
        const fingerprintMatches = !!(cachedFingerprint && fileMetaFingerprint && cachedFingerprint === fileMetaFingerprint);
        if (cacheKeyMatches || (!cachedCacheKey && fingerprintMatches)) {
          fileMetaMeta = meta;
          const cached = await loadJsonArrayArtifact(outDir, 'file_meta', {
            maxBytes: fileMetaMaxBytes,
            strict: false
          });
          if (Array.isArray(cached)) {
            fileMeta = cached;
            fileMetaFromCache = true;
            for (const entry of cached) {
              if (entry?.file && Number.isFinite(entry.id)) {
                fileIdByPath.set(entry.file, entry.id);
              }
            }
          }
        }
      }
    } catch {}
  }
  if (!fileMeta) {
    const built = buildFileMeta(state);
    fileMeta = built.fileMeta;
    fileIdByPath = built.fileIdByPath;
    fileMetaFingerprint = built.fingerprint || fileMetaFingerprint;
  }
  if (indexState && typeof indexState === 'object') {
    if (!indexState.extensions || typeof indexState.extensions !== 'object') {
      indexState.extensions = {};
    }
    if (state?.discoveryHash) {
      indexState.extensions.discoveryHash = state.discoveryHash;
    }
    if (fileMetaFingerprint) {
      indexState.extensions.fileMetaFingerprint = fileMetaFingerprint;
    }
    if (postings?.minhashGuard) {
      indexState.extensions.minhashGuard = postings.minhashGuard;
    }
  }
  const chunkUidToFileId = new Map();
  if (state?.chunkUidToFile && typeof state.chunkUidToFile.entries === 'function') {
    for (const [chunkUid, file] of state.chunkUidToFile.entries()) {
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  } else {
    for (const chunk of state?.chunks || []) {
      const file = chunk?.file || chunk?.metaV2?.file || null;
      const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
      if (!file || !chunkUid) continue;
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  }
  const repoMapIterator = createRepoMapIterator({
    chunks: state.chunks,
    fileRelations: state.fileRelations
  });

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const {
    filterIndex,
    filterIndexStats,
    filterIndexReused,
    filterIndexFallback
  } = resolveFilterIndexArtifactState({
    outDir,
    maxJsonBytes,
    maxJsonBytesSoft,
    state,
    resolvedConfig,
    userConfig,
    root,
    log
  });
  if (indexState && typeof indexState === 'object') {
    const filterIndexState = indexState.filterIndex && typeof indexState.filterIndex === 'object'
      && !Array.isArray(indexState.filterIndex)
      ? indexState.filterIndex
      : {};
    filterIndexState.ready = Boolean(filterIndex) || filterIndexReused;
    filterIndexState.reused = Boolean(filterIndexStats?.reused);
    filterIndexState.stats = filterIndexStats || null;
    indexState.filterIndex = filterIndexState;
  }
  const denseScale = 2 / 255;
  const chunkMetaHasIds = Array.isArray(state.chunks)
    && state.chunks.length > 0
    && state.chunks.every((chunk) => Number.isFinite(chunk?.id));
  const chunkMetaOrder = chunkMetaHasIds
    ? resolveChunkMetaOrderById(state.chunks)
    : resolveChunkMetaOrder(state.chunks);
  const chunkMetaIterator = createChunkMetaIterator({
    chunks: state.chunks,
    fileIdByPath,
    resolvedTokenMode,
    tokenSampleSize,
    maxJsonBytes: chunkMetaMaxBytes,
    order: chunkMetaOrder
  });
  const chunkMetaPlan = resolveChunkMetaPlan({
    chunks: state.chunks,
    chunkMetaIterator,
    artifactMode,
    chunkMetaFormatConfig,
    chunkMetaStreaming,
    chunkMetaBinaryColumnar,
    chunkMetaJsonlThreshold,
    chunkMetaJsonlEstimateThresholdBytes,
    chunkMetaShardSize,
    maxJsonBytes: chunkMetaMaxBytes
  });
  if (
    chunkMetaAdaptiveShardsEnabled
    && !chunkMetaShardSizeExplicit
    && chunkMetaPlan.chunkMetaUseJsonl
    && chunkMetaPlan.chunkMetaCount > 0
  ) {
    const chunkMetaEstimatedBytes = Number.isFinite(chunkMetaPlan.chunkMetaEstimatedJsonlBytes)
      && chunkMetaPlan.chunkMetaEstimatedJsonlBytes > 0
      ? chunkMetaPlan.chunkMetaEstimatedJsonlBytes
      : Math.max(chunkMetaPlan.chunkMetaCount * 256, chunkMetaPlan.chunkMetaCount);
    const adaptiveChunkMetaShardCount = resolveAdaptiveShardCount({
      estimatedBytes: chunkMetaEstimatedBytes,
      rowCount: chunkMetaPlan.chunkMetaCount,
      throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
      minShards: chunkMetaShardMinCount,
      maxShards: chunkMetaShardMaxCount,
      defaultShards: Math.max(1, Math.ceil(chunkMetaPlan.chunkMetaCount / Math.max(1, chunkMetaPlan.chunkMetaShardSize))),
      targetShardBytes: chunkMetaShardTargetBytes,
      targetShardSeconds: chunkMetaShardTargetSeconds
    });
    const adaptiveChunkMetaShardSize = Math.max(
      1,
      Math.ceil(chunkMetaPlan.chunkMetaCount / adaptiveChunkMetaShardCount)
    );
    chunkMetaPlan.chunkMetaShardSize = adaptiveChunkMetaShardSize;
    chunkMetaPlan.chunkMetaUseShards = chunkMetaPlan.chunkMetaCount > adaptiveChunkMetaShardSize;
    if (typeof log === 'function') {
      log(
        `[chunk_meta] adaptive shard plan: ${adaptiveChunkMetaShardCount} shards ` +
        `(rows=${chunkMetaPlan.chunkMetaCount.toLocaleString()}, target=${formatBytes(chunkMetaShardTargetBytes)}, ` +
        `throughput=${artifactWriteThroughputBytesPerSec ? `${formatBytes(artifactWriteThroughputBytesPerSec)}/s` : 'n/a'}).`
      );
    }
  }
  const {
    tokenPostingsFormat,
    tokenPostingsUseShards,
    tokenPostingsShardSize: resolvedTokenPostingsShardSize,
    tokenPostingsEstimate
  } = resolveTokenPostingsPlan({
    artifactMode,
    tokenPostingsFormatConfig,
    tokenPostingsShardSize,
    tokenPostingsShardThreshold,
    tokenPostingsBinaryColumnar,
    tokenPostingsPackedAutoThresholdBytes,
    postings,
    maxJsonBytes: tokenPostingsMaxBytes,
    maxJsonBytesSoft: tokenPostingsMaxBytesSoft,
    shardTargetBytes: tokenPostingsShardTargetBytes,
    log
  });
  if (sparseArtifactsEnabled && tokenPostingsEstimate?.estimatedBytes) {
    applyByteBudget({
      budget: tokenPostingsBudget,
      totalBytes: tokenPostingsEstimate.estimatedBytes,
      label: 'token_postings',
      stageCheckpoints,
      logger: log
    });
  }
  tokenPostingsShardSize = resolvedTokenPostingsShardSize;
  if (sparseArtifactsEnabled) {
    await ensureDiskSpace({
      targetPath: outDir,
      requiredBytes: tokenPostingsEstimate?.estimatedBytes,
      label: `${mode} token_postings`
    });
  }
  let dropCommittedPiece = () => {};
  const {
    cleanupActions,
    runCleanupBatch,
    removeArtifact
  } = await prepareArtifactCleanup({
    outDir,
    log,
    logLine,
    vectorOnlyProfile,
    tokenPostingsFormat,
    tokenPostingsUseShards,
    effectiveAbortSignal,
    indexState,
    profileId,
    removePieceFile: (targetPath) => dropCommittedPiece(targetPath)
  });
  const writeStart = Date.now();
  const writes = [];
  const executionState = createArtifactWriteExecutionState({
    artifactConfig,
    artifactWriteThroughputBytesPerSec,
    writeFsStrategy,
    mode
  });
  const {
    activeWrites,
    activeWriteBytes,
    activeWriteMeta,
    hugeWriteState,
    artifactMetrics,
    artifactQueueDelaySamples,
    writeLogIntervalMs,
    writeProgressMeta,
    normalizedWriteStallThresholds,
    heavyWriteThresholdBytes,
    forcedHeavyWritePatterns,
    ultraLightWriteThresholdBytes,
    forcedUltraLightWritePatterns,
    massiveWriteThresholdBytes,
    forcedMassiveWritePatterns,
    massiveWriteIoTokens,
    massiveWriteMemTokens,
    hugeWriteInFlightBudgetBytes,
    hugeWriteFamilySerializationEnabled,
    resolveHugeWriteFamily,
    workClassSmallConcurrencyOverride,
    workClassMediumConcurrencyOverride,
    workClassLargeConcurrencyOverride,
    adaptiveWriteConcurrencyEnabled,
    adaptiveWriteMinConcurrency,
    adaptiveWriteStartConcurrencyOverride,
    adaptiveWriteScaleUpBacklogPerSlot,
    adaptiveWriteScaleDownBacklogPerSlot,
    adaptiveWriteStallScaleDownSeconds,
    adaptiveWriteStallScaleUpGuardSeconds,
    adaptiveWriteScaleUpCooldownMs,
    adaptiveWriteScaleDownCooldownMs,
    adaptiveWriteObserveIntervalMs,
    adaptiveWriteQueuePendingThreshold,
    adaptiveWriteQueueOldestWaitMsThreshold,
    adaptiveWriteQueueWaitP95MsThreshold,
    writeTailRescueEnabled,
    writeTailRescueMaxPending,
    writeTailRescueStallSeconds,
    writeTailRescueBoostIoTokens,
    writeTailRescueBoostMemTokens,
    writeTailWorkerEnabled,
    writeTailWorkerMaxPending,
    getCompletedWrites,
    getTotalWrites,
    getLastWriteLabel,
    setLastWriteLabel,
    getLastWriteLog,
    setLastWriteLog,
    setCompletedWrites,
    setTotalWrites
  } = executionState;
  const telemetryContext = createArtifactWriteTelemetryContext({
    telemetry,
    activeWrites,
    activeWriteBytes,
    activeWriteMeta,
    formatBytes,
    writeProgressHeartbeatMs,
    normalizedWriteStallThresholds,
    stageCheckpoints,
    logLine,
    showProgress,
    writeProgressMeta,
    getCompletedWrites,
    getTotalWrites,
    getLastWriteLabel,
    setLastWriteLabel,
    getLastWriteLog,
    setLastWriteLog,
    writeLogIntervalMs
  });
  const {
    getActiveWriteTelemetrySnapshot,
    getLongestWriteStallSeconds,
    runTrackedArtifactCloseout,
    updateActiveWriteMeta,
    updateWriteInFlightTelemetry,
    writeHeartbeat
  } = telemetryContext;
  const logWriteProgress = (label) => {
    setCompletedWrites(telemetryContext.logWriteProgress(label));
  };
  const resolveEntryEstimatedBytes = (entry) => {
    return resolveArtifactEffectiveDispatchBytes(entry);
  };
  const resolveEntryHugeWriteFamily = (entry) => resolveHugeWriteFamily(entry?.label);
  const canDispatchEntryUnderHugeWritePolicy = (entry) => {
    const activeEntries = [...activeWriteBytes.entries()].map(([label, estimatedBytes]) => ({
      label,
      estimatedBytes,
      lane: activeWriteMeta.get(label)?.lane || null,
      phase: activeWriteMeta.get(label)?.phase || null
    }));
    const family = resolveEntryHugeWriteFamily(entry);
    const blockingState = resolveArtifactBlockingState(activeEntries).fromEntries(
      hugeWriteInFlightBudgetBytes
    );
    if (
      family
      && hugeWriteFamilySerializationEnabled
      && blockingState.blockingHugeFamilies.size > 0
      && !blockingState.blockingHugeFamilies.has(family)
    ) {
      return false;
    }
    return canDispatchArtifactWriteEntry({
      entry,
      activeEntries,
      maxBytesInFlight: hugeWriteInFlightBudgetBytes
    });
  };
  const pieceRegistry = createArtifactPieceRegistry({
    outDir,
    resolveArtifactTier
  });
  const {
    formatArtifactLabel,
    addPieceFile,
    removePieceFile,
    listPieceEntries,
    hasPieceFile,
    updatePieceMetadata
  } = pieceRegistry;
  dropCommittedPiece = removePieceFile;
  const writePlanner = createQueuedArtifactWritePlanner({
    writes,
    scheduler,
    effectiveAbortSignal,
    hugeWriteInFlightBudgetBytes,
    massiveWriteIoTokens,
    massiveWriteMemTokens,
    resolveArtifactWriteMemTokens,
    updateActiveWriteMeta,
    addPieceFile,
    forcedMassiveWritePatterns,
    forcedHeavyWritePatterns,
    forcedUltraLightWritePatterns,
    massiveWriteThresholdBytes,
    heavyWriteThresholdBytes,
    ultraLightWriteThresholdBytes
  });
  const { enqueueWrite } = writePlanner;
  const splitWriteLanes = (entries) => writePlanner.splitWriteLanes(entries);
  if (mode === 'extracted-prose' && documentExtractionEnabled && !tinyRepoMinimalArtifacts) {
    const extractionReportPath = path.join(outDir, 'extraction_report.json');
    const extractionReport = buildExtractionReport({
      state,
      root,
      mode,
      documentExtractionConfig: indexingConfig.documentExtraction || {}
    });
    enqueueWrite(
      formatArtifactLabel(extractionReportPath),
      async () => {
        await writeJsonObjectFile(extractionReportPath, {
          fields: extractionReport,
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'stats', name: 'extraction_report', format: 'json' },
          filePath: extractionReportPath
        }]
      }
    );
  }
  const lexiconRelationFilterReport = tinyRepoMinimalArtifacts
    ? { files: [] }
    : buildLexiconRelationFilterReport({ state, mode });
  if (Array.isArray(lexiconRelationFilterReport.files) && lexiconRelationFilterReport.files.length) {
    const lexiconReportPath = path.join(outDir, 'lexicon_relation_filter_report.json');
    enqueueWrite(
      formatArtifactLabel(lexiconReportPath),
      async () => {
        await writeJsonObjectFile(lexiconReportPath, {
          fields: lexiconRelationFilterReport,
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'stats', name: 'lexicon_relation_filter_report', format: 'json' },
          filePath: lexiconReportPath
        }]
      }
    );
    if (indexState && typeof indexState === 'object') {
      if (!indexState.extensions || typeof indexState.extensions !== 'object') {
        indexState.extensions = {};
      }
      indexState.extensions.lexiconRelationFilter = {
        schemaVersion: 1,
        totals: lexiconRelationFilterReport.totals
      };
    }
  }
  const boilerplateCatalog = tinyRepoMinimalArtifacts
    ? []
    : buildBoilerplateCatalog(state?.chunks);
  if (boilerplateCatalog.length) {
    const boilerplateCatalogPath = path.join(outDir, 'boilerplate_catalog.json');
    enqueueWrite(
      formatArtifactLabel(boilerplateCatalogPath),
      async () => {
        await writeJsonObjectFile(boilerplateCatalogPath, {
          fields: {
            schemaVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
            entries: boilerplateCatalog
          },
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'stats', name: 'boilerplate_catalog', format: 'json' },
          filePath: boilerplateCatalogPath
        }]
      }
    );
  }
  if (indexState && typeof indexState === 'object') {
    const indexStatePath = path.join(outDir, 'index_state.json');
    const indexStateMetaPath = path.join(outDir, 'index_state.meta.json');
    const determinismReportPath = path.join(outDir, 'determinism_report.json');
    const stableState = stripIndexStateNondeterministicFields(indexState, { forStableHash: true });
    const stableHash = sha1(stableStringifyForSignature(stableState));
    const determinismReport = buildDeterminismReport({
      mode,
      indexState
    });
    let canSkipIndexState = false;
    try {
      if (await pathExists(indexStateMetaPath) && await pathExists(indexStatePath)) {
        const metaRaw = readJsonFile(indexStateMetaPath, { maxBytes: maxJsonBytes });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        const onDiskStableHash = await readStableIndexStateHash(indexStatePath, {
          maxBytes: maxJsonBytes
        });
        if (meta?.stableHash === stableHash && onDiskStableHash === stableHash) {
          canSkipIndexState = true;
        }
      }
    } catch {}
    const indexStateWarnBytes = Math.max(1024 * 64, Math.floor(maxJsonBytes * 0.1));
    const indexStateCompressThreshold = Math.max(1024 * 128, Math.floor(maxJsonBytes * 0.2));
    /**
     * Persist compact metadata for index_state reuse checks.
     *
     * @param {number|null} bytes
     * @returns {Promise<void>}
     */
    const writeIndexStateMeta = async (bytes) => {
      await writeJsonObjectFile(indexStateMetaPath, {
        fields: {
          stableHash,
          generatedAt: indexState.generatedAt || null,
          updatedAt: new Date().toISOString(),
          bytes: Number.isFinite(bytes) ? bytes : null
        },
        atomic: true
      });
    };
    enqueueWrite(
      formatArtifactLabel(determinismReportPath),
      async () => {
        await writeJsonObjectFile(determinismReportPath, {
          fields: determinismReport,
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'stats', name: 'determinism_report', format: 'json' },
          filePath: determinismReportPath
        }]
      }
    );
    if (!canSkipIndexState) {
      enqueueWrite(
        formatArtifactLabel(indexStatePath),
        async () => {
          await writeJsonObjectFile(indexStatePath, { fields: indexState, atomic: true });
          let bytes = null;
          try {
            const stat = await fs.stat(indexStatePath);
            bytes = stat.size;
          } catch {}
          if (Number.isFinite(bytes) && bytes > indexStateWarnBytes) {
            log(
              `index_state ~${formatBytes(bytes)}; consider pruning volatile fields or enabling compression.`
            );
          }
          if (compressionEnabled && compressionMode && Number.isFinite(bytes) && bytes > indexStateCompressThreshold) {
            const compressedPath = path.join(
              outDir,
              `index_state.${compressionMode === 'zstd' ? 'json.zst' : 'json.gz'}`
            );
            await writeJsonObjectFile(compressedPath, {
              fields: indexState,
              compression: compressionMode,
              gzipOptions: compressionGzipOptions,
              atomic: true
            });
          }
          await writeIndexStateMeta(bytes);
        },
        {
          publishedPieces: [{
            entry: { type: 'stats', name: 'index_state', format: 'json' },
            filePath: indexStatePath
          }]
        }
      );
    } else {
      enqueueWrite(
        formatArtifactLabel(indexStateMetaPath),
        async () => {
          let bytes = null;
          try {
            const stat = await fs.stat(indexStatePath);
            bytes = stat.size;
          } catch {}
          await writeIndexStateMeta(bytes);
        }
      );
      if (await pathExists(indexStatePath)) {
        addPieceFile({ type: 'stats', name: 'index_state', format: 'json' }, indexStatePath);
      }
    }
  }
  const { enqueueJsonObject, enqueueJsonArray, enqueueJsonArraySharded } = createArtifactWriter({
    outDir,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressionMinBytes,
    compressionMaxBytes,
    compressibleArtifacts,
    compressionOverrides: tieredCompressionOverrides,
    jsonArraySerializeShardThresholdMs,
    jsonArraySerializeShardMaxBytes,
    jsonlShapeAware: writeJsonlShapeAware,
    jsonlLargeThresholdBytes: writeJsonlLargeThresholdBytes,
    jsonlPresizeEnabled: writeFsStrategy.presizeJsonl
  });
  if (state.importResolutionGraph) {
    const importGraphDir = path.join(outDir, 'artifacts');
    const importGraphPath = path.join(importGraphDir, 'import_resolution_graph.json');
    enqueueWrite(
      formatArtifactLabel(importGraphPath),
      async () => {
        await fs.mkdir(importGraphDir, { recursive: true });
        await writeJsonObjectFile(importGraphPath, {
          fields: state.importResolutionGraph,
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'debug', name: 'import_resolution_graph', format: 'json' },
          filePath: importGraphPath
        }]
      }
    );
  }
  /**
   * Emit binary dense-vector payload + metadata sidecar.
   *
   * Dense vectors are written as contiguous uint8 row-major bytes so readers can
   * mmap/read once and serve ANN/dot-product paths without parsing monolithic JSON.
   */
  const enqueueDenseBinaryArtifacts = ({
    artifactName,
    baseName,
    vectors,
    dims
  }) => {
    const binFile = `${baseName}.bin`;
    const binMetaFile = `${baseName}.bin.meta.json`;
    const binPath = path.join(outDir, binFile);
    const binMetaPath = path.join(outDir, binMetaFile);
    enqueueWrite(
      formatArtifactLabel(binPath),
      async () => {
        const binaryWrite = await writeDenseVectorBinaryFile({
          binPath,
          vectors,
          dims
        });
        // Publish metadata only after the binary payload is durable and renamed.
        await writeJsonObjectFile(binMetaPath, {
          fields: {
            schemaVersion: '1.0.0',
            artifact: baseName,
            format: 'uint8-row-major',
            generatedAt: new Date().toISOString(),
            path: binFile,
            model: modelId || null,
            dims: binaryWrite.rowWidth,
            count: binaryWrite.count,
            bytes: binaryWrite.totalBytes,
            scale: denseScale
          },
          atomic: true
        });
      },
      {
        publishedPieces: [
          {
            entry: {
              type: 'embeddings',
              name: artifactName,
              format: 'bin',
              count: Array.isArray(vectors) ? vectors.length : 0,
              dims: Number.isFinite(Number(dims)) ? Math.max(0, Math.floor(Number(dims))) : 0
            },
            filePath: binPath
          },
          {
            entry: {
              type: 'embeddings',
              name: `${artifactName}_binary_meta`,
              format: 'json',
              count: Array.isArray(vectors) ? vectors.length : 0,
              dims: Number.isFinite(Number(dims)) ? Math.max(0, Math.floor(Number(dims))) : 0
            },
            filePath: binMetaPath
          }
        ]
      }
    );
  };

  const denseVectorsEnabled = postings.dims > 0 && postings.quantizedVectors.length;
  if (!denseVectorsEnabled) {
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.bin'));
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.bin.meta.json'));
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_doc_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.bin'));
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.bin.meta.json'));
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_code_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.bin'));
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.bin.meta.json'));
  }
  if (denseVectorsEnabled) {
    enqueueDenseBinaryArtifacts({
      artifactName: 'dense_vectors',
      baseName: 'dense_vectors_uint8',
      vectors: postings.quantizedVectors,
      dims: postings.dims
    });
  }
  const fileMetaEstimatedBytes = estimateJsonBytes(fileMeta);
  const fileMetaFormat = fileMetaFormatConfig || 'auto';
  const fileMetaExceedsMax = Number.isFinite(fileMetaMaxBytes)
    ? fileMetaEstimatedBytes > fileMetaMaxBytes
    : false;
  const fileMetaAutoUseJsonl = fileMetaFormat === 'auto'
    && Number.isFinite(fileMetaJsonlThreshold)
    && fileMetaJsonlThreshold > 0
    && fileMetaEstimatedBytes >= fileMetaJsonlThreshold;
  const fileMetaUseColumnar = !fileMetaExceedsMax
    && fileMetaFormat === 'columnar'
    && fileMetaEstimatedBytes >= fileMetaColumnarThreshold;
  const fileMetaUseJsonl = fileMetaFormat === 'jsonl'
    || fileMetaAutoUseJsonl
    || fileMetaExceedsMax
    || (!fileMetaUseColumnar && Number.isFinite(fileMetaMaxBytes)
      && fileMetaEstimatedBytes > fileMetaMaxBytes);
  applyByteBudget({
    budget: fileMetaBudget,
    totalBytes: fileMetaEstimatedBytes,
    label: 'file_meta',
    stageCheckpoints,
    logger: log
  });
  const fileMetaMetaPath = path.join(outDir, 'file_meta.meta.json');
  if (!fileMetaFromCache) {
    if (fileMetaUseColumnar) {
      const columnarPath = path.join(outDir, 'file_meta.columnar.json');
      enqueueWrite(
        formatArtifactLabel(columnarPath),
        async () => {
          await removeArtifact(path.join(outDir, 'file_meta.json'));
          await removeCompressedArtifact({ outDir, base: 'file_meta', removeArtifact });
          await removeArtifact(path.join(outDir, 'file_meta.parts'));
          const payload = buildFileMetaColumnar(fileMeta);
          await writeJsonObjectFile(columnarPath, { fields: payload, atomic: true });
          await writeJsonObjectFile(fileMetaMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              artifact: 'file_meta',
              format: 'columnar',
              generatedAt: new Date().toISOString(),
              compression: 'none',
              totalRecords: fileMeta.length,
              totalBytes: fileMetaEstimatedBytes,
              maxPartRecords: fileMeta.length,
              maxPartBytes: fileMetaEstimatedBytes,
              targetMaxBytes: null,
              parts: [{ path: 'file_meta.columnar.json', records: fileMeta.length, bytes: fileMetaEstimatedBytes }],
              cacheKey: fileMetaCacheKey || null,
              extensions: {
                fingerprint: fileMetaFingerprint || null,
                cacheKey: fileMetaCacheKey || null
              }
            },
            atomic: true
          });
        },
        {
          publishedPieces: [
            {
              entry: { type: 'chunks', name: 'file_meta', format: 'columnar', count: fileMeta.length },
              filePath: columnarPath
            }
          ]
        }
      );
    } else if (fileMetaUseJsonl) {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'file_meta.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'file_meta.json'));
          await removeCompressedArtifact({ outDir, base: 'file_meta', removeArtifact });
        }
      );
      enqueueJsonArraySharded('file_meta', fileMeta, {
        maxBytes: fileMetaShardedMaxBytes || fileMetaMaxBytes,
        estimatedBytes: fileMetaEstimatedBytes,
        piece: { type: 'chunks', name: 'file_meta' },
        metaExtensions: { fingerprint: fileMetaFingerprint || null, cacheKey: fileMetaCacheKey || null },
        compression: null,
        gzipOptions: null,
        offsets: true
      });
    } else {
      enqueueJsonArray('file_meta', fileMeta, {
        compressible: false,
        piece: { type: 'chunks', name: 'file_meta', count: fileMeta.length }
      });
      enqueueWrite(
        formatArtifactLabel(fileMetaMetaPath),
        async () => {
          await writeJsonObjectFile(fileMetaMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              artifact: 'file_meta',
              format: 'json',
              generatedAt: new Date().toISOString(),
              compression: 'none',
              totalRecords: fileMeta.length,
              totalBytes: fileMetaEstimatedBytes,
              maxPartRecords: fileMeta.length,
              maxPartBytes: fileMetaEstimatedBytes,
              targetMaxBytes: null,
              parts: [{ path: 'file_meta.json', records: fileMeta.length, bytes: fileMetaEstimatedBytes }],
              cacheKey: fileMetaCacheKey || null,
              extensions: {
                fingerprint: fileMetaFingerprint || null,
                cacheKey: fileMetaCacheKey || null
              }
            },
            atomic: true
          });
        }
      );
    }
  } else {
    const cachedFormat = typeof fileMetaMeta?.format === 'string' ? fileMetaMeta.format : 'json';
    if (cachedFormat === 'jsonl-sharded' && Array.isArray(fileMetaMeta?.parts)) {
      for (const part of fileMetaMeta.parts) {
        const relPath = typeof part === 'string' ? part : part?.path;
        if (!relPath) continue;
        const absPath = path.join(outDir, relPath);
        addPieceFile({
          type: 'chunks',
          name: 'file_meta',
          format: 'jsonl',
          count: typeof part === 'object' && Number.isFinite(part.records) ? part.records : null,
          compression: fileMetaMeta?.compression || null
        }, absPath);
      }
    } else if (cachedFormat === 'columnar' && Array.isArray(fileMetaMeta?.parts)) {
      const part = fileMetaMeta.parts[0];
      const relPath = typeof part === 'string' ? part : part?.path;
      if (relPath) {
        const absPath = path.join(outDir, relPath);
        addPieceFile({
          type: 'chunks',
          name: 'file_meta',
          format: 'columnar',
          count: typeof part === 'object' && Number.isFinite(part.records) ? part.records : null
        }, absPath);
      }
    } else {
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'json', count: fileMeta.length }, path.join(outDir, 'file_meta.json'));
    }
  }
  if (denseVectorsEnabled) {
    enqueueDenseBinaryArtifacts({
      artifactName: 'dense_vectors_doc',
      baseName: 'dense_vectors_doc_uint8',
      vectors: postings.quantizedDocVectors,
      dims: postings.dims
    });
    enqueueDenseBinaryArtifacts({
      artifactName: 'dense_vectors_code',
      baseName: 'dense_vectors_code_uint8',
      vectors: postings.quantizedCodeVectors,
      dims: postings.dims
    });
  }
  const chunkMetaCompression = resolveShardCompression('chunk_meta');
  const chunkMetaOrdering = await enqueueChunkMetaArtifacts({
    state,
    outDir,
    mode,
    chunkMetaIterator,
    chunkMetaPlan,
    maxJsonBytes: chunkMetaMaxBytes,
    byteBudget: chunkMetaBudget,
    compression: chunkMetaCompression,
    gzipOptions: chunkMetaCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  await recordOrdering('chunk_meta', chunkMetaOrdering, 'chunk_meta:compareChunkMetaRows');
  const chunkUidMapCompression = resolveShardCompression('chunk_uid_map');
  await enqueueChunkUidMapArtifacts({
    outDir,
    mode,
    chunks: state.chunks,
    maxJsonBytes: chunkUidMapMaxBytes,
    byteBudget: chunkUidMapBudget,
    compression: chunkUidMapCompression,
    gzipOptions: chunkUidMapCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  const vfsManifestCompression = resolveShardCompression('vfs_manifest');
  await enqueueVfsManifestArtifacts({
    outDir,
    mode,
    rows: state.vfsManifestCollector || state.vfsManifestRows,
    maxJsonBytes: vfsMaxBytes,
    byteBudget: vfsBudget,
    compression: vfsManifestCompression,
    gzipOptions: vfsManifestCompression === 'gzip' ? compressionGzipOptions : null,
    hashRouting: vfsHashRouting,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  const repoMapMeasurement = measureRepoMap({ repoMapIterator, maxJsonBytes: repoMapMaxBytes });
  const useRepoMapJsonl = repoMapMeasurement.totalEntries
    && repoMapMaxBytes
    && repoMapMeasurement.totalBytes > repoMapMaxBytes;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: useRepoMapJsonl ? repoMapMeasurement.totalJsonlBytes : repoMapMeasurement.totalBytes,
    label: `${mode} repo_map`
  });
  const repoMapCompression = resolveShardCompression('repo_map');
  await enqueueRepoMapArtifacts({
    outDir,
    repoMapIterator,
    repoMapMeasurement,
    useRepoMapJsonl,
    maxJsonBytes: repoMapMaxBytes,
    byteBudget: repoMapBudget,
    repoMapCompression,
    compressionGzipOptions,
    log,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact,
    stageCheckpoints
  });
  await recordOrdering('repo_map', repoMapMeasurement, 'repo_map:file,name,kind,signature,startLine');
  if (filterIndex) {
    enqueueJsonObject('filter_index', { fields: filterIndex }, {
      compressible: false,
      piece: { type: 'chunks', name: 'filter_index' }
    });
  } else if (filterIndexFallback?.path) {
    const normalizedFilterIndexPath = formatArtifactLabel(filterIndexFallback.path);
    filterIndexFallback.piece.path = normalizedFilterIndexPath;
    addPieceFile(filterIndexFallback.piece, filterIndexFallback.path);
    if (indexState?.filterIndex && typeof indexState.filterIndex === 'object') {
      indexState.filterIndex.path = normalizedFilterIndexPath;
    }
  }
  const minhashFromPostings = Array.isArray(postings.minhashSigs) && postings.minhashSigs.length
    ? postings.minhashSigs
    : null;
  const minhashSamplingMeta = postings?.minhashGuard?.sampled === true
    ? {
      mode: typeof postings?.minhashGuard?.mode === 'string'
        ? postings.minhashGuard.mode
        : 'sampled-minified',
      maxDocs: Number.isFinite(Number(postings?.minhashGuard?.maxDocs))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.maxDocs)))
        : null,
      totalDocs: Number.isFinite(Number(postings?.minhashGuard?.totalDocs))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.totalDocs)))
        : null,
      signatureLength: Number.isFinite(Number(postings?.minhashGuard?.signatureLength))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.signatureLength)))
        : null,
      sampledSignatureLength: Number.isFinite(Number(postings?.minhashGuard?.sampledSignatureLength))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.sampledSignatureLength)))
        : null,
      hashStride: Number.isFinite(Number(postings?.minhashGuard?.hashStride))
        ? Math.max(1, Math.floor(Number(postings.minhashGuard.hashStride)))
        : null,
      density: Number.isFinite(Number(postings?.minhashGuard?.density))
        ? Number(postings.minhashGuard.density)
        : null
    }
    : null;
  const minhashStream = postings.minhashStream && Array.isArray(state?.chunks) && state.chunks.length;
  const minhashCount = minhashFromPostings
    ? postings.minhashSigs.length
    : (minhashStream ? state.chunks.length : (postings.minhashSigs?.length || 0));
  const minhashIterable = minhashFromPostings
    ? minhashFromPostings
    : (minhashStream
      ? (function* () {
        for (const chunk of state.chunks) {
          yield chunk?.minhashSig;
        }
      })()
      : (postings.minhashSigs || []));
  const packedMinhash = sparseArtifactsEnabled
    ? packMinhashSignatures({
      signatures: minhashFromPostings,
      chunks: minhashStream ? state.chunks : null
    })
    : null;
  if (packedMinhash?.coercedRows && typeof log === 'function') {
    log(
      `[minhash] packed signatures coerced ${packedMinhash.coercedRows} row(s) `
      + `to match dims=${packedMinhash.dims}.`
    );
  }
  const skipMinhashJsonForLarge = sparseArtifactsEnabled
    && packedMinhash
    && minhashCount >= minhashJsonLargeThreshold;
  if (skipMinhashJsonForLarge && typeof log === 'function') {
    log(
      `[minhash] skipping minhash_signatures.json for large index `
      + `(count=${minhashCount}, threshold=${minhashJsonLargeThreshold}); using packed artifact.`
    );
  }
  if (skipMinhashJsonForLarge) {
    await runCleanupBatch([
      () => removeArtifact(path.join(outDir, 'minhash_signatures.json'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.json.gz'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.json.zst'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.meta.json'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.parts'), {
        recursive: true,
        policy: 'format_cleanup'
      })
    ]);
  }
  if (sparseArtifactsEnabled && !skipMinhashJsonForLarge) {
    enqueueJsonObject('minhash_signatures', {
      fields: minhashSamplingMeta ? { sampling: minhashSamplingMeta } : undefined,
      arrays: { signatures: minhashIterable }
    }, {
      piece: {
        type: 'postings',
        name: 'minhash_signatures',
        count: minhashCount
      }
    });
  }
  if (packedMinhash) {
    const packedChecksum = computePackedChecksum(packedMinhash.buffer);
    const packedPath = path.join(outDir, 'minhash_signatures.packed.bin');
    const packedMetaPath = path.join(outDir, 'minhash_signatures.packed.meta.json');
    enqueueWrite(
      formatArtifactLabel(packedPath),
      async () => {
        await writeBinaryArtifactAtomically(packedPath, packedMinhash.buffer);
        await writeJsonObjectFile(packedMetaPath, {
          fields: {
            format: 'u32',
            endian: 'le',
            dims: packedMinhash.dims,
            count: packedMinhash.count,
            checksum: packedChecksum.hash,
            ...(minhashSamplingMeta ? { sampling: minhashSamplingMeta } : {})
          },
          atomic: true
        });
      },
      {
        publishedPieces: [
          {
            entry: {
              type: 'postings',
              name: 'minhash_signatures_packed',
              format: 'bin',
              count: packedMinhash.count
            },
            filePath: packedPath
          },
          {
            entry: { type: 'postings', name: 'minhash_signatures_packed_meta', format: 'json' },
            filePath: packedMetaPath
          }
        ]
      }
    );
  } else {
    await removePackedMinhash({ outDir, removeArtifact });
  }
  const tokenPostingsCompression = resolveShardCompression('token_postings');
  if (sparseArtifactsEnabled) {
    await enqueueTokenPostingsArtifacts({
      outDir,
      postings,
      state,
      tokenPostingsFormat,
      tokenPostingsUseShards,
      tokenPostingsShardSize,
      tokenPostingsBinaryColumnar,
      tokenPostingsCompression,
      writePriority: 210,
      tokenPostingsEstimatedBytes: tokenPostingsEstimate?.estimatedBytes || null,
      enqueueJsonObject,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
  }
  const vocabOrder = {};
  const tokenOrdering = measureVocabOrdering(postings.tokenVocab);
  await recordOrdering('token_vocab', tokenOrdering, 'token_vocab:token');
  if (tokenOrdering.orderingHash) {
    vocabOrder.token = {
      hash: tokenOrdering.orderingHash,
      count: tokenOrdering.orderingCount
    };
  }
  if (sparseArtifactsEnabled && postings.fieldPostings?.fields) {
    const fieldPostingsObject = postings.fieldPostings.fields;
    const fieldPostingsEstimatedBytes = estimateJsonBytes(fieldPostingsObject);
    const fieldNames = Object.keys(fieldPostingsObject);
    const shouldShardFieldPostings = fieldPostingsShardsEnabled
      && fieldPostingsShardThresholdBytes > 0
      && fieldPostingsEstimatedBytes >= fieldPostingsShardThresholdBytes
      && fieldNames.length > 1;
    if (shouldShardFieldPostings) {
      const shardsDirPath = path.join(outDir, 'field_postings.shards');
      const shardsMetaPath = path.join(outDir, 'field_postings.shards.meta.json');
      await removeArtifact(shardsDirPath, { recursive: true, policy: 'format_cleanup' });
      await fs.mkdir(shardsDirPath, { recursive: true });
      const resolvedFieldPostingsShardCount = resolveAdaptiveShardCount({
        estimatedBytes: fieldPostingsEstimatedBytes,
        rowCount: fieldNames.length,
        throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
        minShards: fieldPostingsShardMinCount,
        maxShards: fieldPostingsShardMaxCount,
        defaultShards: fieldPostingsShardCount,
        targetShardBytes: fieldPostingsShardTargetBytes,
        targetShardSeconds: fieldPostingsShardTargetSeconds
      });
      const shardSize = Math.max(1, Math.ceil(fieldNames.length / resolvedFieldPostingsShardCount));
      const partFiles = [];
      for (let shardIndex = 0; shardIndex < resolvedFieldPostingsShardCount; shardIndex += 1) {
        const start = shardIndex * shardSize;
        const end = Math.min(fieldNames.length, start + shardSize);
        if (start >= end) break;
        const relPath = `field_postings.shards/field_postings.part-${String(shardIndex).padStart(4, '0')}.json`;
        const absPath = path.join(outDir, relPath);
        partFiles.push({ relPath, count: end - start, absPath, start, end });
      }
      const partEstimatedBytes = Math.max(
        1,
        Math.floor(fieldPostingsEstimatedBytes / Math.max(1, partFiles.length))
      );
      /**
       * Write one field-postings shard and collect per-part metrics.
       *
       * @param {object} part
       * @returns {Promise<void>}
       */
      const writeFieldPostingsPartition = async (part) => {
        const startedAt = Date.now();
        let serializationMs = 0;
        let flushMs = 0;
        let backpressureWaitMs = 0;
        const {
          stream,
          done,
          getBytesWritten,
          getChecksum,
          checksumAlgo
        } = createJsonWriteStream(part.absPath, { atomic: true, checksumAlgo: 'sha1' });
        try {
          let chunkTiming = await writeChunkWithTiming(stream, '{"fields":{');
          flushMs += chunkTiming.flushMs;
          backpressureWaitMs += chunkTiming.backpressureWaitMs;
          let first = true;
          for (let index = part.start; index < part.end; index += 1) {
            const field = fieldNames[index];
            const value = fieldPostingsObject[field];
            const serializeStart = Date.now();
            const row = `${first ? '' : ','}${JSON.stringify(field)}:${JSON.stringify(value)}`;
            serializationMs += Math.max(0, Date.now() - serializeStart);
            chunkTiming = await writeChunkWithTiming(stream, row);
            flushMs += chunkTiming.flushMs;
            backpressureWaitMs += chunkTiming.backpressureWaitMs;
            first = false;
          }
          chunkTiming = await writeChunkWithTiming(stream, '}}\n');
          flushMs += chunkTiming.flushMs;
          backpressureWaitMs += chunkTiming.backpressureWaitMs;
          stream.end();
          const publishStartedAt = Date.now();
          await done;
          const publishMs = Math.max(0, Date.now() - publishStartedAt);
          return {
            bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : null,
            checksum: typeof getChecksum === 'function' ? getChecksum() : null,
            checksumAlgo: checksumAlgo || null,
            serializationMs,
            diskMs: flushMs + publishMs,
            phaseTimings: {
              computeMs: 0,
              serializationMs,
              compressionMs: 0,
              flushMs,
              fsyncMs: 0,
              publishMs,
              manifestWaitMs: 0,
              backpressureWaitMs
            },
            directFdStreaming: true,
            durationMs: Math.max(0, Date.now() - startedAt)
          };
        } catch (err) {
          try { stream.destroy(err); } catch {}
          try { await done; } catch {}
          throw err;
        }
      };
      for (const part of partFiles) {
        enqueueWrite(
          part.relPath,
          () => writeFieldPostingsPartition(part),
          {
            priority: 206,
            estimatedBytes: partEstimatedBytes,
            publishedPieces: [{
              entry: {
                type: 'postings',
                name: 'field_postings_shard',
                format: 'json',
                count: part.count
              },
              filePath: part.absPath
            }]
          }
        );
      }
      enqueueWrite(
        formatArtifactLabel(shardsMetaPath),
        async () => {
          await writeJsonObjectFile(shardsMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              generatedAt: new Date().toISOString(),
              shardCount: partFiles.length,
              estimatedBytes: fieldPostingsEstimatedBytes,
              fields: fieldNames.length,
              shardTargetBytes: fieldPostingsShardTargetBytes,
              throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
              parts: partFiles.map((part) => ({
                path: part.relPath,
                fields: part.count
              })),
              merge: {
                strategy: 'streaming-partition-merge',
                outputPath: 'field_postings.json'
              }
            },
            atomic: true
          });
        },
        {
          priority: 207,
          estimatedBytes: Math.max(1024, partFiles.length * 128),
          publishedPieces: [{
            entry: { type: 'postings', name: 'field_postings_shards_meta', format: 'json' },
            filePath: shardsMetaPath
          }]
        }
      );
      if (typeof log === 'function') {
        log(
          `field_postings estimate ~${formatBytes(fieldPostingsEstimatedBytes)}; ` +
          `emitting streamed shards (${partFiles.length} planned, target=${formatBytes(fieldPostingsShardTargetBytes)}).`
        );
      }
      if (!fieldPostingsKeepLegacyJson && typeof log === 'function') {
        log(
          '[warn] fieldPostingsKeepLegacyJson=false ignored while shard readers are unavailable; ' +
          'emitting field_postings.json for compatibility.'
        );
      }
      /**
       * Reconstruct legacy monolithic field-postings JSON from shard outputs.
       *
       * @returns {Promise<void>}
       */
      const writeLegacyFieldPostingsFromShards = async () => {
        const targetPath = path.join(outDir, 'field_postings.json');
        const startedAt = Date.now();
        let serializationMs = 0;
        let flushMs = 0;
        let backpressureWaitMs = 0;
        const {
          stream,
          done,
          getBytesWritten,
          getChecksum,
          checksumAlgo
        } = createJsonWriteStream(targetPath, { atomic: true, checksumAlgo: 'sha1' });
        try {
          let chunkTiming = await writeChunkWithTiming(stream, '{"fields":{');
          flushMs += chunkTiming.flushMs;
          backpressureWaitMs += chunkTiming.backpressureWaitMs;
          let first = true;
          for (const part of partFiles) {
            for (let index = part.start; index < part.end; index += 1) {
              const field = fieldNames[index];
              const value = fieldPostingsObject[field];
              const serializeStart = Date.now();
              const row = `${first ? '' : ','}${JSON.stringify(field)}:${JSON.stringify(value)}`;
              serializationMs += Math.max(0, Date.now() - serializeStart);
              chunkTiming = await writeChunkWithTiming(stream, row);
              flushMs += chunkTiming.flushMs;
              backpressureWaitMs += chunkTiming.backpressureWaitMs;
              first = false;
            }
          }
          chunkTiming = await writeChunkWithTiming(stream, '}}\n');
          flushMs += chunkTiming.flushMs;
          backpressureWaitMs += chunkTiming.backpressureWaitMs;
          stream.end();
          const publishStartedAt = Date.now();
          await done;
          const publishMs = Math.max(0, Date.now() - publishStartedAt);
          return {
            bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : null,
            checksum: typeof getChecksum === 'function' ? getChecksum() : null,
            checksumAlgo: checksumAlgo || null,
            serializationMs,
            diskMs: flushMs + publishMs,
            phaseTimings: {
              computeMs: 0,
              serializationMs,
              compressionMs: 0,
              flushMs,
              fsyncMs: 0,
              publishMs,
              manifestWaitMs: 0,
              backpressureWaitMs
            },
            directFdStreaming: true,
            durationMs: Math.max(0, Date.now() - startedAt)
          };
        } catch (err) {
          try { stream.destroy(err); } catch {}
          try { await done; } catch {}
          throw err;
        }
      };
      enqueueWrite(
        'field_postings.json',
        writeLegacyFieldPostingsFromShards,
        {
          priority: 204,
          estimatedBytes: fieldPostingsEstimatedBytes,
          publishedPieces: [{
            entry: { type: 'postings', name: 'field_postings' },
            filePath: path.join(outDir, 'field_postings.json')
          }]
        }
      );
    } else {
      enqueueJsonObject('field_postings', { fields: { fields: fieldPostingsObject } }, {
        piece: { type: 'postings', name: 'field_postings' },
        priority: 220,
        estimatedBytes: fieldPostingsEstimatedBytes
      });
    }
    const fieldPostingsBinaryDataPath = path.join(outDir, 'field_postings.binary-columnar.bin');
    const fieldPostingsBinaryOffsetsPath = path.join(outDir, 'field_postings.binary-columnar.offsets.bin');
    const fieldPostingsBinaryLengthsPath = path.join(outDir, 'field_postings.binary-columnar.lengths.varint');
    const fieldPostingsBinaryMetaPath = path.join(outDir, 'field_postings.binary-columnar.meta.json');
    const fieldPostingsBinaryTaskLabel = 'field_postings.binary-columnar.bundle';
    const shouldWriteFieldPostingsBinary = fieldPostingsBinaryColumnar
      && fieldPostingsEstimatedBytes >= fieldPostingsBinaryColumnarThresholdBytes
      && fieldNames.length > 0;
    if (shouldWriteFieldPostingsBinary) {
      enqueueWrite(
        fieldPostingsBinaryTaskLabel,
        async ({ setPhase } = {}) => {
          setPhase?.('materialize:field-postings-binary-columnar');
          let serializationMs = 0;
          const rowPayloads = (async function* binaryRows() {
            for (const field of fieldNames) {
              const serializationStartedAt = Date.now();
              const payload = JSON.stringify({
                field,
                postings: fieldPostingsObject[field]
              });
              serializationMs += Math.max(0, Date.now() - serializationStartedAt);
              yield payload;
            }
          })();
          const binaryWriteHints = resolveBinaryColumnarWriteHints({
            estimatedBytes: fieldPostingsEstimatedBytes,
            rowCount: fieldNames.length,
            presize: writeFsStrategy.presizeJsonl
          });
          const frames = await writeBinaryRowFrames({
            rowBuffers: rowPayloads,
            dataPath: fieldPostingsBinaryDataPath,
            offsetsPath: fieldPostingsBinaryOffsetsPath,
            lengthsPath: fieldPostingsBinaryLengthsPath,
            writeHints: binaryWriteHints
          });
          const framePhaseTimings = typeof frames?.phaseTimings === 'object' ? frames.phaseTimings : {};
          setPhase?.('publish:field-postings-binary-meta');
          const publishStartedAt = Date.now();
          const binaryMetaResult = await writeJsonObjectFile(fieldPostingsBinaryMetaPath, {
            fields: {
              format: 'binary-columnar-v1',
              rowEncoding: 'json-rows',
              count: frames.count,
              data: path.basename(fieldPostingsBinaryDataPath),
              offsets: path.basename(fieldPostingsBinaryOffsetsPath),
              lengths: path.basename(fieldPostingsBinaryLengthsPath),
              estimatedSourceBytes: fieldPostingsEstimatedBytes,
              preallocatedBytes: Number.isFinite(frames?.preallocatedBytes) ? frames.preallocatedBytes : 0
            },
            checksumAlgo: 'sha1',
            atomic: true
          });
          const publishMs = (Number(framePhaseTimings.publishMs) || 0) + Math.max(0, Date.now() - publishStartedAt);
          return {
            bytes: Number.isFinite(Number(binaryMetaResult?.bytes)) ? Number(binaryMetaResult.bytes) : null,
            checksum: typeof binaryMetaResult?.checksum === 'string' ? binaryMetaResult.checksum : null,
            checksumAlgo: typeof binaryMetaResult?.checksumAlgo === 'string' ? binaryMetaResult.checksumAlgo : null,
            serializationMs,
            diskMs: (Number(framePhaseTimings.flushMs) || 0)
              + (Number(framePhaseTimings.fsyncMs) || 0)
              + publishMs,
            phaseTimings: {
              computeMs: 0,
              serializationMs,
              compressionMs: Number(framePhaseTimings.compressionMs) || 0,
              flushMs: Number(framePhaseTimings.flushMs) || 0,
              fsyncMs: Number(framePhaseTimings.fsyncMs) || 0,
              publishMs,
              manifestWaitMs: Number(framePhaseTimings.manifestWaitMs) || 0,
              backpressureWaitMs: Number(framePhaseTimings.backpressureWaitMs) || 0
            },
            directFdStreaming: true
          };
        },
        {
          priority: 223,
          estimatedBytes: Math.max(fieldPostingsEstimatedBytes, fieldNames.length * 96),
          publishedPieces: [
            {
              entry: {
                type: 'postings',
                name: 'field_postings_binary_columnar',
                format: 'binary-columnar',
                count: fieldNames.length
              },
              filePath: fieldPostingsBinaryDataPath
            },
            {
              entry: {
                type: 'postings',
                name: 'field_postings_binary_columnar_offsets',
                format: 'binary',
                count: fieldNames.length
              },
              filePath: fieldPostingsBinaryOffsetsPath
            },
            {
              entry: {
                type: 'postings',
                name: 'field_postings_binary_columnar_lengths',
                format: 'varint',
                count: fieldNames.length
              },
              filePath: fieldPostingsBinaryLengthsPath
            },
            {
              entry: {
                type: 'postings',
                name: 'field_postings_binary_columnar_meta',
                format: 'json'
              },
              filePath: fieldPostingsBinaryMetaPath
            }
          ]
        }
      );
    } else {
      await runCleanupBatch([
        () => removeArtifact(fieldPostingsBinaryDataPath, { policy: 'format_cleanup' }),
        () => removeArtifact(fieldPostingsBinaryOffsetsPath, { policy: 'format_cleanup' }),
        () => removeArtifact(fieldPostingsBinaryLengthsPath, { policy: 'format_cleanup' }),
        () => removeArtifact(fieldPostingsBinaryMetaPath, { policy: 'format_cleanup' })
      ]);
    }
  }
  if (sparseArtifactsEnabled && resolvedConfig.fielded !== false && Array.isArray(state.fieldTokens)) {
    const fieldTokensEstimatedBytes = estimateJsonBytes(state.fieldTokens);
    const fieldTokensUseShards = fieldTokensShardThresholdBytes > 0
      && fieldTokensShardMaxBytes > 0
      && fieldTokensEstimatedBytes >= fieldTokensShardThresholdBytes;
    if (fieldTokensUseShards) {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'field_tokens.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'field_tokens.json'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.json.gz'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.json.zst'), { policy: 'format_cleanup' });
        }
      );
      if (typeof log === 'function') {
        log(
          `field_tokens estimate ~${formatBytes(fieldTokensEstimatedBytes)}; ` +
          `using jsonl-sharded output (target ${formatBytes(fieldTokensShardMaxBytes)}).`
        );
      }
      enqueueJsonArraySharded('field_tokens', state.fieldTokens, {
        maxBytes: fieldTokensShardMaxBytes,
        estimatedBytes: fieldTokensEstimatedBytes,
        piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length },
        compression: null,
        gzipOptions: null,
        offsets: true
      });
    } else {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'field_tokens.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'field_tokens.meta.json'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.parts'), {
            recursive: true,
            policy: 'format_cleanup'
          });
        }
      );
      enqueueJsonArray('field_tokens', state.fieldTokens, {
        piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length }
      });
    }
  }
  const fileRelationsCompression = resolveShardCompression('file_relations');
  const fileRelationsOrdering = enqueueFileRelationsArtifacts({
    state,
    outDir,
    maxJsonBytes: fileRelationsMaxBytes,
    byteBudget: fileRelationsBudget,
    log,
    compression: fileRelationsCompression,
    gzipOptions: fileRelationsCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  await recordOrdering('file_relations', fileRelationsOrdering, 'file_relations:file');
  const callSitesCompression = resolveShardCompression('call_sites');
  const riskStats = state?.riskInterproceduralStats || null;
  const riskConfig = riskStats?.effectiveConfig || null;
  const riskState = indexState?.riskInterprocedural || null;
  const emitArtifactsMode = riskInterproceduralEmitArtifacts
    || riskState?.emitArtifacts
    || riskConfig?.emitArtifacts
    || null;
  const allowCallSitesArtifacts = emitArtifactsMode !== 'none';
  const callSitesRequired = allowCallSitesArtifacts
    && riskState?.enabled === true
    && riskState?.summaryOnly !== true;
  const callSitesRef = allowCallSitesArtifacts
    ? enqueueCallSitesArtifacts({
      state,
      outDir,
      maxJsonBytes: callSitesMaxBytes,
      byteBudget: callSitesBudget,
      log,
      forceEmpty: callSitesRequired,
      compression: callSitesCompression,
      gzipOptions: callSitesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    })
    : null;
  const riskSummariesCompression = resolveShardCompression('risk_summaries');
  const riskFlowsCompression = resolveShardCompression('risk_flows');
  const riskPartialFlowsCompression = resolveShardCompression('risk_partial_flows');
  if (mode === 'code' && state?.riskInterproceduralStats) {
    enqueueRiskInterproceduralArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: riskSummariesCompression,
      flowsCompression: riskPartialFlowsCompression || riskFlowsCompression,
      gzipOptions: compressionGzipOptions,
      emitArtifacts: riskInterproceduralEmitArtifacts || 'jsonl',
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      callSitesRef
    });
  }
  if (mode === 'code') {
    const symbolsCompression = resolveShardCompression('symbols');
    await enqueueSymbolsArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: symbolsCompression,
      gzipOptions: symbolsCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
    const symbolOccurrencesCompression = resolveShardCompression('symbol_occurrences');
    await enqueueSymbolOccurrencesArtifacts({
      state,
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes: symbolOccurrencesMaxBytes,
      byteBudget: symbolOccurrencesBudget,
      log,
      format: symbolArtifactsFormatConfig,
      compression: symbolOccurrencesCompression,
      gzipOptions: symbolOccurrencesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
    const symbolEdgesCompression = resolveShardCompression('symbol_edges');
    await enqueueSymbolEdgesArtifacts({
      state,
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes: symbolEdgesMaxBytes,
      byteBudget: symbolEdgesBudget,
      log,
      format: symbolArtifactsFormatConfig,
      compression: symbolEdgesCompression,
      gzipOptions: symbolEdgesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
  }
  const scheduleRelations = scheduler?.schedule
    ? (fn) => scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2Relations,
      {
        cpu: 1,
        mem: 1,
        signal: effectiveAbortSignal
      },
      fn
    )
    : (fn) => fn();
  const scheduleRelationsIo = scheduler?.schedule
    ? (fn) => scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2RelationsIo,
      {
        io: 1,
        signal: effectiveAbortSignal
      },
      fn
    )
    : (fn) => fn();
  const graphRelationsOrdering = await scheduleRelations(() => enqueueGraphRelationsArtifacts({
    graphRelations,
    chunks: state?.chunks || [],
    fileRelations: state?.fileRelations || null,
    caps: indexingConfig?.graph?.caps || null,
    outDir,
    maxJsonBytes: graphRelationsMaxBytes,
    byteBudget: graphRelationsBudget,
    log,
    scheduleIo: scheduleRelationsIo,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact
  }));
  await recordOrdering('graph_relations', graphRelationsOrdering, 'graph_relations:graph,node');
  if (sparseArtifactsEnabled && resolvedConfig.enablePhraseNgrams !== false) {
    enqueueJsonObject('phrase_ngrams', {
      arrays: { vocab: postings.phraseVocab, postings: postings.phrasePostings }
    }, {
      piece: { type: 'postings', name: 'phrase_ngrams', count: postings.phraseVocab.length }
    });
    const phraseOrdering = measureVocabOrdering(postings.phraseVocab);
    await recordOrdering('phrase_ngrams', phraseOrdering, 'phrase_ngrams:ngram');
    if (phraseOrdering.orderingHash) {
      vocabOrder.phrase = {
        hash: phraseOrdering.orderingHash,
        count: phraseOrdering.orderingCount
      };
    }
  }
  if (sparseArtifactsEnabled && resolvedConfig.enableChargrams !== false) {
    enqueueJsonObject('chargram_postings', {
      fields: { hash: CHARGRAM_HASH_META },
      arrays: { vocab: postings.chargramVocab, postings: postings.chargramPostings }
    }, {
      piece: { type: 'postings', name: 'chargram_postings', count: postings.chargramVocab.length }
    });
    const chargramOrdering = measureVocabOrdering(postings.chargramVocab);
    await recordOrdering('chargram_postings', chargramOrdering, 'chargram_postings:gram');
    if (chargramOrdering.orderingHash) {
      vocabOrder.chargram = {
        hash: chargramOrdering.orderingHash,
        count: chargramOrdering.orderingCount
      };
    }
  }
  if (sparseArtifactsEnabled && Object.keys(vocabOrder).length) {
    enqueueJsonObject('vocab_order', {
      fields: {
        algo: 'sha1',
        generatedAt: new Date().toISOString(),
        vocab: vocabOrder
      }
    }, {
      piece: { type: 'postings', name: 'vocab_order' }
    });
  }
  const { laneQueues, totalWrites: plannedTotalWrites } = resolveQueuedWriteLanes({
    writes,
    splitWriteLanes
  });
  setTotalWrites(plannedTotalWrites);
  await dispatchPlannedArtifactWrites({
    laneQueues,
    totalWrites: getTotalWrites(),
    logLine,
    artifactConfig,
    writeFsStrategy,
    adaptiveWriteConcurrencyEnabled,
    adaptiveWriteMinConcurrency,
    adaptiveWriteStartConcurrencyOverride,
    adaptiveWriteScaleUpBacklogPerSlot,
    adaptiveWriteScaleDownBacklogPerSlot,
    adaptiveWriteStallScaleDownSeconds,
    adaptiveWriteStallScaleUpGuardSeconds,
    adaptiveWriteScaleUpCooldownMs,
    adaptiveWriteScaleDownCooldownMs,
    adaptiveWriteObserveIntervalMs,
    adaptiveWriteQueuePendingThreshold,
    adaptiveWriteQueueOldestWaitMsThreshold,
    adaptiveWriteQueueWaitP95MsThreshold,
    writeTailWorkerEnabled,
    writeTailWorkerMaxPending,
    writeTailRescueEnabled,
    writeTailRescueMaxPending,
    writeTailRescueStallSeconds,
    writeTailRescueBoostIoTokens,
    writeTailRescueBoostMemTokens,
    workClassSmallConcurrencyOverride,
    workClassMediumConcurrencyOverride,
    workClassLargeConcurrencyOverride,
    scheduler,
    effectiveAbortSignal,
    canDispatchEntryUnderHugeWritePolicy,
    activeWrites,
    activeWriteBytes,
    activeWriteMeta,
    hugeWriteState,
    updateWriteInFlightTelemetry,
    getLongestWriteStallSeconds,
    getActiveWriteTelemetrySnapshot,
    updateActiveWriteMeta,
    resolveEntryEstimatedBytes,
    resolveHugeWriteFamily,
    massiveWriteIoTokens,
    massiveWriteMemTokens,
    resolveArtifactWriteMemTokens,
    outDir,
    artifactMetrics,
    artifactQueueDelaySamples,
    updatePieceMetadata,
    formatBytes,
    logWriteProgress,
    writeHeartbeat,
    ultraLightWriteThresholdBytes
  });
  let pieceEntries = listPieceEntries();
  if (vectorOnlyProfile) {
    const deniedPieces = pieceEntries
      .filter((entry) => VECTOR_ONLY_SPARSE_PIECE_DENYLIST.has(String(entry?.name || '')))
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean);
    if (deniedPieces.length) {
      const uniqueDenied = Array.from(new Set(deniedPieces)).sort((a, b) => a.localeCompare(b));
      throw new Error(
        `[vector_only] sparse artifact emission detected: ${uniqueDenied.join(', ')}. ` +
        'Rebuild with sparse outputs disabled.'
      );
    }
    const lingeringSparse = getLingeringSparseArtifacts(outDir);
    if (lingeringSparse.length) {
      const sample = lingeringSparse.sort((a, b) => a.localeCompare(b)).slice(0, 8).join(', ');
      throw new Error(
        `[vector_only] sparse artifacts still present after cleanup: ${sample}. ` +
        'Delete stale sparse artifacts and rebuild.'
      );
    }
  }
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${state.chunks.length.toLocaleString()} chunks, ${postings.tokenVocab.length.toLocaleString()} tokens, dims=${postings.dims}`
  );
  if (filterIndexStats && typeof filterIndexStats === 'object') {
    const filterIndexPiece = pieceEntries.find((entry) => entry?.name === 'filter_index' && entry?.path);
    const filterIndexPath = filterIndexPiece?.path ? path.join(outDir, filterIndexPiece.path) : null;
    let filterIndexDiskBytes = null;
    if (filterIndexPiece?.path) {
      const metric = artifactMetrics.get(filterIndexPiece.path);
      if (Number.isFinite(metric?.bytes)) filterIndexDiskBytes = metric.bytes;
    }
    if (!Number.isFinite(filterIndexDiskBytes) && filterIndexPath) {
      try {
        const stat = await fs.stat(filterIndexPath);
        filterIndexDiskBytes = stat.size;
      } catch {}
    }
    if (Number.isFinite(filterIndexDiskBytes)) {
      filterIndexStats.diskBytes = filterIndexDiskBytes;
    }
    if (
      Number.isFinite(filterIndexDiskBytes)
      && Number.isFinite(filterIndexStats.jsonBytes)
      && filterIndexStats.jsonBytes > 0
    ) {
      filterIndexStats.compressionRatio = filterIndexDiskBytes / filterIndexStats.jsonBytes;
    }
  }

  for (const entry of pieceEntries) {
    if (!entry?.path) continue;
    const metric = artifactMetrics.get(entry.path) || { path: entry.path };
    if (Number.isFinite(entry.count)) metric.count = entry.count;
    if (Number.isFinite(entry.dims)) metric.dims = entry.dims;
    if (entry.compression) metric.compression = entry.compression;
    if (Number.isFinite(entry.bytes) && entry.bytes >= 0) metric.bytes = entry.bytes;
    if (typeof entry.checksum === 'string') {
      const separator = entry.checksum.indexOf(':');
      if (separator > 0 && separator < entry.checksum.length - 1) {
        const checksumAlgo = entry.checksum.slice(0, separator);
        const checksum = entry.checksum.slice(separator + 1);
        metric.checksumAlgo = checksumAlgo;
        metric.checksum = checksum;
      }
    }
    artifactMetrics.set(entry.path, metric);
  }
  for (const entry of pieceEntries) {
    if (!entry?.path) continue;
    const metric = artifactMetrics.get(entry.path);
    if (!metric || typeof metric !== 'object') continue;
    if (!Number.isFinite(entry.bytes) && Number.isFinite(metric.bytes)) {
      entry.bytes = metric.bytes;
    }
    if (
      typeof entry.checksum !== 'string'
      && typeof metric.checksumAlgo === 'string'
      && typeof metric.checksum === 'string'
      && metric.checksumAlgo
      && metric.checksum
    ) {
      entry.checksum = `${metric.checksumAlgo}:${metric.checksum}`;
    }
  }
  if (timing) {
    const artifactLatencyClasses = summarizeArtifactLatencyClasses(Array.from(artifactMetrics.values()));
    timing.cleanup = {
      profileId,
      actions: cleanupActions,
      writeFsStrategy,
      artifactLatencyClasses
    };
    timing.artifacts = Array.from(artifactMetrics.values()).sort((a, b) => {
      const aPath = String(a?.path || '');
      const bPath = String(b?.path || '');
      return aPath.localeCompare(bPath);
    });
  }

  pieceEntries.sort((a, b) => {
    const pathA = String(a?.path || '');
    const pathB = String(b?.path || '');
    if (pathA !== pathB) return pathA.localeCompare(pathB);
    const typeA = String(a?.type || '');
    const typeB = String(b?.type || '');
    if (typeA !== typeB) return typeA.localeCompare(typeB);
    const nameA = String(a?.name || '');
    const nameB = String(b?.name || '');
    return nameA.localeCompare(nameB);
  });
  pieceEntries = await runArtifactPublicationFinalizers({
    runTrackedArtifactCloseout,
    listPieceEntries,
    hasPieceFile,
    addPieceFile,
    outDir,
    state,
    userConfig,
    log,
    mode,
    indexState,
    effectiveAbortSignal,
    root,
    postings,
    dictSummary,
    useStubEmbeddings,
    modelId,
    denseVectorsEnabled,
    incrementalEnabled,
    fileCounts,
    timing,
    perfProfile,
    filterIndexStats,
    resolvedTokenMode,
    tokenSampleSize,
    tokenMaxFiles,
    chunkMetaPlan,
    tokenPostingsUseShards,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    documentExtractionEnabled,
    repoProvenance,
    buildRoot
  });
}


