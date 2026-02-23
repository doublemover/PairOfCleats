import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { MAX_JSON_BYTES, readJsonFile, loadJsonArrayArtifact } from '../../shared/artifact-io.js';
import { toPosix } from '../../shared/files.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { ensureDiskSpace } from '../../shared/disk-space.js';
import { estimateJsonBytes } from '../../shared/cache.js';
import { buildCacheKey } from '../../shared/cache-key.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { coerceIntAtLeast, coerceNumberAtLeast } from '../../shared/number-coerce.js';
import { resolveCompressionConfig } from './artifacts/compression.js';
import { buildBoilerplateCatalog } from './artifacts/boilerplate-catalog.js';
import { buildTieredCompressionPolicy } from './artifacts/compression-tier-policy.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { writePiecesManifest } from './artifacts/checksums.js';
import { writeFileLists } from './artifacts/file-lists.js';
import { buildFileMeta, buildFileMetaColumnar, computeFileMetaFingerprint } from './artifacts/file-meta.js';
import { enqueueGraphRelationsArtifacts } from './artifacts/graph-relations.js';
import { writeIndexMetrics } from './artifacts/metrics.js';
import { enqueueRepoMapArtifacts, measureRepoMap } from './artifacts/repo-map.js';
import { SCHEDULER_QUEUE_NAMES } from './runtime/scheduler.js';
import {
  enqueueTokenPostingsArtifacts,
  resolveTokenPostingsPlan
} from './artifacts/token-postings.js';
import { resolveTokenMode } from './artifacts/token-mode.js';
import { createArtifactWriter } from './artifacts/writer.js';
import { formatBytes } from './artifacts/helpers.js';
import { resolveFilterIndexArtifactState } from './artifacts/filter-index-reuse.js';
import {
  createWriteHeartbeatController,
  finalizeArtifactWriteTelemetry
} from './artifacts/write-telemetry.js';
import {
  resolveEagerWriteSchedulerTokens
} from './artifacts/write-scheduler-tokens.js';
import { enqueueFileRelationsArtifacts } from './artifacts/writers/file-relations.js';
import { enqueueCallSitesArtifacts } from './artifacts/writers/call-sites.js';
import { enqueueRiskInterproceduralArtifacts } from './artifacts/writers/risk-interprocedural.js';
import { enqueueSymbolsArtifacts } from './artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from './artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from './artifacts/writers/symbol-edges.js';
import { createRepoMapIterator } from './artifacts/writers/repo-map.js';
import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts,
  resolveChunkMetaPlan,
  resolveChunkMetaOrder,
  resolveChunkMetaOrderById
} from './artifacts/writers/chunk-meta.js';
import { enqueueChunkUidMapArtifacts } from './artifacts/writers/chunk-uid-map.js';
import { enqueueVfsManifestArtifacts } from './artifacts/writers/vfs-manifest.js';
import { recordOrderingHash, updateBuildState } from './build-state.js';
import { applyByteBudget, resolveByteBudgetMap } from './byte-budget.js';
import { CHARGRAM_HASH_META } from '../../shared/chargram-hash.js';
import { createOrderingHasher } from '../../shared/order.js';
import { computePackedChecksum } from '../../shared/artifact-io/checksum.js';
import {
  INDEX_PROFILE_VECTOR_ONLY,
  normalizeIndexProfileId
} from '../../contracts/index-profile.js';
import { resolveArtifactWriteConcurrency } from './artifacts/write-concurrency.js';
import {
  resolveArtifactLaneConcurrency,
  resolveArtifactLaneConcurrencyWithMassive,
  resolveArtifactLaneConcurrencyWithUltraLight,
  resolveArtifactWorkClassConcurrency,
  resolveWriteStartTimestampMs
} from './artifacts/lane-policy.js';
import {
  createAdaptiveWriteConcurrencyController,
  resolveAdaptiveShardCount,
  resolveArtifactWriteFsStrategy,
  resolveArtifactWriteLatencyClass,
  resolveArtifactWriteMemTokens,
  resolveArtifactWriteThroughputProfile,
  selectMicroWriteBatch,
  selectTailWorkerWriteEntry
} from './artifacts/write-strategy.js';
import { dispatchScheduledArtifactWrites } from './artifacts/write-dispatch.js';
import { createPieceManifestRegistry } from './artifacts/piece-manifest-registry.js';
import { createArtifactWriteProgressTracker } from './artifacts/write-progress.js';
import { resolveArtifactWriteDispatchConfig } from './artifacts/write-dispatch-config.js';
import {
  buildDeterminismReport,
  buildExtractionReport,
  buildLexiconRelationFilterReport,
  stripIndexStateNondeterministicFields
} from './artifacts/reporting.js';
import {
  cleanupVectorOnlySparseArtifacts,
  getLingeringSparseArtifacts,
  removeCompressedArtifact,
  removePackedMinhash,
  removePackedPostings,
  VECTOR_ONLY_SPARSE_PIECE_DENYLIST
} from './artifacts/sparse-cleanup.js';
import { packMinhashSignatures } from './artifacts/minhash-packed.js';
import { enqueueFieldPostingsArtifacts } from './artifacts/field-postings.js';

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
 * @param {() => number} [input.now]
 * @param {(event:{reason:string,from:number,to:number,pendingWrites:number,activeWrites:number,longestStallSec:number,memoryPressure:number|null,gcPressure:number|null,rssUtilization:number|null}) => void} [input.onChange]
 * @returns {{observe:(snapshot?:{pendingWrites?:number,activeWrites?:number,longestStallSec?:number,memoryPressure?:number|null,gcPressure?:number|null,rssUtilization?:number|null})=>number,getCurrentConcurrency:()=>number,getLimits:()=>{min:number,max:number}}}
 */
/**
 * Write index artifacts and metrics.
 * @param {object} input
 */
export async function writeIndexArtifacts(input) {
  const {
    scheduler = null,
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
  } = input;
  const orderingStage = indexState?.stage || 'stage2';
  /**
   * Persist deterministic ordering hash metadata for one artifact.
   *
   * @param {string} artifact
   * @param {{orderingHash?:string,orderingCount?:number}|null} ordering
   * @param {string} rule
   * @returns {Promise<void>}
   */
  const recordOrdering = async (artifact, ordering, rule) => {
    if (!buildRoot || !ordering?.orderingHash) return;
    await recordOrderingHash(buildRoot, {
      stage: orderingStage,
      mode,
      artifact,
      hash: ordering.orderingHash,
      rule,
      count: ordering.orderingCount
    });
  };
  /**
   * Hash vocabulary iteration order for determinism diagnostics.
   *
   * @param {string[]} [vocab]
   * @returns {{orderingHash:string|null,orderingCount:number}}
   */
  const measureVocabOrdering = (vocab = []) => {
    if (!Array.isArray(vocab) || !vocab.length) {
      return { orderingHash: null, orderingCount: 0 };
    }
    const orderingHasher = createOrderingHasher();
    for (const entry of vocab) {
      orderingHasher.update(entry);
    }
    const result = orderingHasher.digest();
    return {
      orderingHash: result?.hash || null,
      orderingCount: result?.count || 0
    };
  };
  const indexingConfig = userConfig?.indexing || {};
  const tinyRepoMinimalArtifacts = tinyRepoFastPath?.active === true
    && tinyRepoFastPath?.minimalArtifacts === true;
  const profileId = normalizeIndexProfileId(indexState?.profile?.id || indexingConfig.profile);
  const vectorOnlyProfile = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const sparseArtifactsEnabled = !vectorOnlyProfile;
  const documentExtractionEnabled = indexingConfig.documentExtraction?.enabled === true;
  const {
    resolvedTokenMode,
    tokenMaxFiles,
    tokenSampleSize
  } = resolveTokenMode({ indexingConfig, state, fileCounts, profileId });
  const {
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressionMinBytes,
    compressionMaxBytes,
    compressibleArtifacts,
    compressionOverrides
  } = resolveCompressionConfig(indexingConfig);
  const artifactConfig = indexingConfig.artifacts || {};
  const {
    tieredCompressionOverrides,
    resolveArtifactTier,
    resolveShardCompression
  } = buildTieredCompressionPolicy({
    artifactConfig,
    compressionOverrides,
    compressibleArtifacts,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw
  });
  const writeFsStrategy = resolveArtifactWriteFsStrategy({ artifactConfig });
  const writeJsonlShapeAware = artifactConfig.writeJsonlShapeAware !== false;
  const writeJsonlLargeThresholdBytes = coerceIntAtLeast(
    artifactConfig.writeJsonlLargeThresholdBytes,
    1024 * 1024
  ) ?? (32 * 1024 * 1024);
  const artifactMode = typeof artifactConfig.mode === 'string'
    ? artifactConfig.mode.toLowerCase()
    : 'auto';
  const jsonArraySerializeShardThresholdMs = coerceIntAtLeast(
    artifactConfig.jsonArraySerializeShardThresholdMs,
    0
  ) ?? 10;
  const jsonArraySerializeShardMaxBytes = coerceIntAtLeast(
    artifactConfig.jsonArraySerializeShardMaxBytes,
    1024 * 1024
  ) ?? (64 * 1024 * 1024);
  const fileMetaFormatConfig = typeof artifactConfig.fileMetaFormat === 'string'
    ? artifactConfig.fileMetaFormat.toLowerCase()
    : null;
  const chunkMetaFormatConfig = typeof artifactConfig.chunkMetaFormat === 'string'
    ? artifactConfig.chunkMetaFormat.toLowerCase()
    : null;
  const binaryColumnarEnabled = artifactConfig.binaryColumnar !== false;
  const chunkMetaBinaryColumnar = artifactConfig.chunkMetaBinaryColumnar === true
    || (binaryColumnarEnabled && artifactConfig.chunkMetaBinaryColumnar !== false);
  const tokenPostingsBinaryColumnar = artifactConfig.tokenPostingsBinaryColumnar === true
    || (binaryColumnarEnabled && artifactConfig.tokenPostingsBinaryColumnar !== false);
  const chunkMetaJsonlThreshold = coerceIntAtLeast(
    artifactConfig.chunkMetaJsonlThreshold,
    0
  ) ?? 200000;
  const chunkMetaJsonlEstimateThresholdBytes = coerceIntAtLeast(
    artifactConfig.chunkMetaJsonlEstimateThresholdBytes,
    1
  ) ?? (1 * 1024 * 1024);
  const chunkMetaShardSizeRaw = coerceIntAtLeast(artifactConfig.chunkMetaShardSize, 0);
  const chunkMetaShardSizeExplicit = chunkMetaShardSizeRaw != null;
  const chunkMetaShardSize = chunkMetaShardSizeExplicit
    ? chunkMetaShardSizeRaw
    : 100000;
  const indexerConfig = indexingConfig.indexer && typeof indexingConfig.indexer === 'object'
    ? indexingConfig.indexer
    : {};
  const chunkMetaStreaming = indexerConfig.streamingChunks !== false;
  const symbolArtifactsFormatConfig = typeof artifactConfig.symbolArtifactsFormat === 'string'
    ? artifactConfig.symbolArtifactsFormat.toLowerCase()
    : null;
  const tokenPostingsFormatConfig = typeof artifactConfig.tokenPostingsFormat === 'string'
    ? artifactConfig.tokenPostingsFormat.toLowerCase()
    : null;
  const tokenPostingsPackedAutoThresholdBytes = coerceIntAtLeast(
    artifactConfig.tokenPostingsPackedAutoThresholdBytes,
    0
  ) ?? (1 * 1024 * 1024);
  let tokenPostingsShardSize = coerceIntAtLeast(artifactConfig.tokenPostingsShardSize, 1000) ?? 50000;
  const tokenPostingsShardThreshold = coerceIntAtLeast(
    artifactConfig.tokenPostingsShardThreshold,
    0
  ) ?? 200000;
  const fieldTokensShardThresholdBytes = coerceIntAtLeast(
    artifactConfig.fieldTokensShardThresholdBytes,
    0
  ) ?? (8 * 1024 * 1024);
  const fieldTokensShardMaxBytes = coerceIntAtLeast(
    artifactConfig.fieldTokensShardMaxBytes,
    0
  ) ?? (8 * 1024 * 1024);
  const artifactWriteThroughputBytesPerSec = resolveArtifactWriteThroughputProfile(perfProfile);
  const fieldPostingsShardsEnabled = artifactConfig.fieldPostingsShards === true;
  const fieldPostingsShardThresholdBytes = coerceIntAtLeast(
    artifactConfig.fieldPostingsShardThresholdBytes,
    0
  ) ?? (64 * 1024 * 1024);
  const fieldPostingsShardCount = coerceIntAtLeast(artifactConfig.fieldPostingsShardCount, 2) ?? 8;
  const fieldPostingsShardMinCount = coerceIntAtLeast(artifactConfig.fieldPostingsShardMinCount, 2) ?? 8;
  const fieldPostingsShardMaxCount = coerceIntAtLeast(
    artifactConfig.fieldPostingsShardMaxCount,
    fieldPostingsShardMinCount
  ) ?? 16;
  const fieldPostingsShardTargetBytes = coerceIntAtLeast(
    artifactConfig.fieldPostingsShardTargetBytes,
    1024 * 1024
  ) ?? (32 * 1024 * 1024);
  const fieldPostingsShardTargetSeconds = coerceNumberAtLeast(
    artifactConfig.fieldPostingsShardTargetSeconds,
    1
  ) ?? 6;
  const fieldPostingsBinaryColumnar = artifactConfig.fieldPostingsBinaryColumnar === true;
  const fieldPostingsBinaryColumnarThresholdBytes = coerceIntAtLeast(
    artifactConfig.fieldPostingsBinaryColumnarThresholdBytes,
    0
  ) ?? (96 * 1024 * 1024);
  const fieldPostingsKeepLegacyJson = artifactConfig.fieldPostingsKeepLegacyJson !== false;
  const chunkMetaAdaptiveShardsEnabled = artifactConfig.chunkMetaAdaptiveShards !== false;
  const chunkMetaShardMinCount = coerceIntAtLeast(artifactConfig.chunkMetaShardMinCount, 2) ?? 4;
  const chunkMetaShardMaxCount = coerceIntAtLeast(
    artifactConfig.chunkMetaShardMaxCount,
    chunkMetaShardMinCount
  ) ?? 32;
  const chunkMetaShardTargetBytes = coerceIntAtLeast(
    artifactConfig.chunkMetaShardTargetBytes,
    1024 * 1024
  ) ?? (16 * 1024 * 1024);
  const chunkMetaShardTargetSeconds = coerceNumberAtLeast(
    artifactConfig.chunkMetaShardTargetSeconds,
    1
  ) ?? 6;
  const minhashJsonLargeThreshold = coerceIntAtLeast(
    artifactConfig.minhashJsonLargeThreshold,
    0
  ) ?? 5000;
  const writeProgressHeartbeatMs = coerceIntAtLeast(
    artifactConfig.writeProgressHeartbeatMs,
    0
  ) ?? 15000;

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
    await updateBuildState(buildRoot, { byteBudgets: byteBudgetSnapshot });
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
      return state.discoveredFiles.slice();
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
      if (fsSync.existsSync(metaPath)) {
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

  const { fileListPath } = await writeFileLists({
    outDir,
    state,
    userConfig,
    log
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
  const cleanupActions = [];
  /**
   * Record artifact cleanup action for manifest/debug reporting.
   *
   * @param {{targetPath:string,recursive?:boolean,policy?:string}} input
   * @returns {void}
   */
  const recordCleanupAction = ({ targetPath, recursive = false, policy = 'legacy' }) => {
    if (!targetPath) return;
    cleanupActions.push({
      path: toPosix(path.relative(outDir, targetPath)),
      recursive: recursive === true,
      policy
    });
  };
  /**
   * Remove artifact file or directory according to cleanup policy.
   *
   * @param {string} targetPath
   * @param {{recursive?:boolean,policy?:string}} [options]
   * @returns {Promise<void>}
   */
  const removeArtifact = async (targetPath, options = {}) => {
    const { recursive = true, policy = 'legacy' } = options;
    try {
      const exists = fsSync.existsSync(targetPath);
      if (exists) {
        logLine(`[artifact-cleanup] remove ${targetPath}`, { kind: 'status' });
        recordCleanupAction({ targetPath, recursive, policy });
      }
      const removed = await removePathWithRetry(targetPath, { recursive, force: true });
      if (!removed.ok && exists) {
        log(`[warn] [artifact-cleanup] failed to remove ${targetPath}: ${removed.error?.message || removed.error}`);
      }
    } catch (err) {
      log(`[warn] [artifact-cleanup] exception removing ${targetPath}: ${err?.message || err}`);
    }
  };
  if (vectorOnlyProfile) {
    await cleanupVectorOnlySparseArtifacts({ outDir, removeArtifact });
  } else {
    if (tokenPostingsFormat === 'packed') {
      await Promise.all([
        removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await removePackedPostings({ outDir, removeArtifact });
    }
    if (tokenPostingsUseShards) {
      await Promise.all([
        removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await Promise.all([
        removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    }
  }
  if (indexState && typeof indexState === 'object') {
    if (!indexState.extensions || typeof indexState.extensions !== 'object') {
      indexState.extensions = {};
    }
    indexState.extensions.artifactCleanup = {
      schemaVersion: 1,
      profileId,
      allowlistOnly: vectorOnlyProfile,
      actions: cleanupActions
    };
  }
  const writeStart = Date.now();
  const writes = [];
  const activeWrites = new Map();
  const activeWriteBytes = new Map();
  const artifactMetrics = new Map();
  const artifactQueueDelaySamples = new Map();
  const writeLogIntervalMs = 1000;
  const writeProgressMeta = { stage: 'write', mode, taskId: `write:${mode}:artifacts` };
  const configuredWriteStallThresholds = Array.isArray(artifactConfig.writeStallThresholdsSeconds)
    ? artifactConfig.writeStallThresholdsSeconds
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
      .map((entry) => Math.floor(entry))
      .sort((a, b) => a - b)
    : [];
  const legacyWarnThreshold = coerceIntAtLeast(artifactConfig.writeStallWarnSeconds, 1);
  const legacyCriticalThreshold = coerceIntAtLeast(artifactConfig.writeStallCriticalSeconds, 1);
  const writeStallThresholdsSeconds = Array.from(new Set(
    configuredWriteStallThresholds.length
      ? configuredWriteStallThresholds
      : [10, 30, 60]
  ));
  if (!configuredWriteStallThresholds.length && legacyWarnThreshold != null) {
    writeStallThresholdsSeconds.push(legacyWarnThreshold);
  }
  if (!configuredWriteStallThresholds.length && legacyCriticalThreshold != null) {
    writeStallThresholdsSeconds.push(legacyCriticalThreshold);
  }
  const normalizedWriteStallThresholds = Array.from(new Set(writeStallThresholdsSeconds)).sort((a, b) => a - b);
  const {
    heavyWriteThresholdBytes,
    forcedHeavyWritePatterns,
    ultraLightWriteThresholdBytes,
    forcedUltraLightWritePatterns,
    massiveWriteThresholdBytes,
    forcedMassiveWritePatterns,
    massiveWriteIoTokens,
    massiveWriteMemTokens,
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
    writeTailRescueEnabled,
    writeTailRescueMaxPending,
    writeTailRescueStallSeconds,
    writeTailRescueBoostIoTokens,
    writeTailRescueBoostMemTokens,
    writeTailWorkerEnabled,
    writeTailWorkerMaxPending
  } = resolveArtifactWriteDispatchConfig({
    artifactConfig,
    writeFsStrategy
  });
  const writeProgress = createArtifactWriteProgressTracker({
    telemetry,
    activeWrites,
    activeWriteBytes,
    writeProgressMeta,
    writeLogIntervalMs,
    showProgress,
    logLine
  });
  const {
    getLongestWriteStallSeconds,
    updateWriteInFlightTelemetry,
    logWriteProgress
  } = writeProgress;
  let enqueueSeq = 0;
  const {
    pieceEntries,
    formatArtifactLabel,
    addPieceFile,
    updatePieceMetadata
  } = createPieceManifestRegistry({
    outDir,
    resolveArtifactTier
  });
  addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, path.join(outDir, '.filelists.json'));
  const writeHeartbeat = createWriteHeartbeatController({
    writeProgressHeartbeatMs,
    activeWrites,
    activeWriteBytes,
    getCompletedWrites: writeProgress.getCompletedWrites,
    getTotalWrites: writeProgress.getTotalWrites,
    normalizedWriteStallThresholds,
    stageCheckpoints,
    logLine,
    formatBytes
  });
  /**
   * Enqueue one artifact write task with optional eager scheduler prefetch.
   *
   * @param {string} label
   * @param {() => Promise<object|void>} job
   * @param {object} [meta]
   * @returns {void}
   */
  const enqueueWrite = (label, job, meta = {}) => {
    const parsedPriority = Number(meta?.priority);
    const priority = Number.isFinite(parsedPriority) ? parsedPriority : 0;
    const parsedEstimatedBytes = Number(meta?.estimatedBytes);
    const estimatedBytes = Number.isFinite(parsedEstimatedBytes) && parsedEstimatedBytes >= 0
      ? parsedEstimatedBytes
      : null;
    const laneHint = typeof meta?.laneHint === 'string' ? meta.laneHint : null;
    const eagerStart = meta?.eagerStart === true;
    let prefetched = null;
    let prefetchStartedAt = null;
    if (eagerStart && typeof job === 'function') {
      prefetchStartedAt = Date.now();
      const tokens = resolveEagerWriteSchedulerTokens({
        estimatedBytes,
        laneHint,
        massiveWriteIoTokens,
        massiveWriteMemTokens,
        resolveArtifactWriteMemTokens
      });
      prefetched = scheduler?.schedule
        ? scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2Write, tokens, job)
        : job();
      Promise.resolve(prefetched).catch(() => {});
    }
    writes.push({
      label,
      priority,
      estimatedBytes,
      laneHint,
      eagerStart,
      prefetched,
      prefetchStartedAt,
      seq: enqueueSeq,
      enqueuedAt: Date.now(),
      job
    });
    enqueueSeq += 1;
  };
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
      }
    );
    addPieceFile({ type: 'stats', name: 'extraction_report', format: 'json' }, extractionReportPath);
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
      }
    );
    addPieceFile({ type: 'stats', name: 'lexicon_relation_filter_report', format: 'json' }, lexiconReportPath);
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
      }
    );
    addPieceFile({ type: 'stats', name: 'boilerplate_catalog', format: 'json' }, boilerplateCatalogPath);
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
      if (fsSync.existsSync(indexStateMetaPath) && fsSync.existsSync(indexStatePath)) {
        const metaRaw = readJsonFile(indexStateMetaPath, { maxBytes: maxJsonBytes });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        if (meta?.stableHash === stableHash) {
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
    }
    addPieceFile({ type: 'stats', name: 'index_state', format: 'json' }, indexStatePath);
    addPieceFile({ type: 'stats', name: 'determinism_report', format: 'json' }, determinismReportPath);
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
      }
    );
    addPieceFile(
      { type: 'debug', name: 'import_resolution_graph', format: 'json' },
      importGraphPath
    );
  }

  const denseVectorsEnabled = postings.dims > 0 && postings.quantizedVectors.length;
  if (!denseVectorsEnabled) {
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_doc_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_code_uint8', removeArtifact });
  }
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors',
        count: postings.quantizedVectors.length,
        dims: postings.dims
      }
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
        }
      );
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'columnar', count: fileMeta.length }, columnarPath);
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
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
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
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
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
    } else {
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'json', count: fileMeta.length }, path.join(outDir, 'file_meta.json'));
      if (fsSync.existsSync(fileMetaMetaPath)) {
        addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
      }
    }
  }
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_doc_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedDocVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_doc',
        count: postings.quantizedDocVectors.length,
        dims: postings.dims
      }
    });
    enqueueJsonObject('dense_vectors_code_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedCodeVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_code',
        count: postings.quantizedCodeVectors.length,
        dims: postings.dims
      }
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
    await Promise.all([
      removeArtifact(path.join(outDir, 'minhash_signatures.json'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.json.gz'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.json.zst'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.meta.json'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.parts'), {
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
        await fs.writeFile(packedPath, packedMinhash.buffer);
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
      }
    );
    addPieceFile({
      type: 'postings',
      name: 'minhash_signatures_packed',
      format: 'bin',
      count: packedMinhash.count
    }, packedPath);
    addPieceFile({ type: 'postings', name: 'minhash_signatures_packed_meta', format: 'json' }, packedMetaPath);
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
  await enqueueFieldPostingsArtifacts({
    sparseArtifactsEnabled,
    postings,
    outDir,
    enqueueWrite,
    enqueueJsonObject,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact,
    log,
    artifactWriteThroughputBytesPerSec,
    writeFsStrategy,
    fieldPostingsShardsEnabled,
    fieldPostingsShardThresholdBytes,
    fieldPostingsShardCount,
    fieldPostingsShardMinCount,
    fieldPostingsShardMaxCount,
    fieldPostingsShardTargetBytes,
    fieldPostingsShardTargetSeconds,
    fieldPostingsKeepLegacyJson,
    fieldPostingsBinaryColumnar,
    fieldPostingsBinaryColumnarThresholdBytes
  });
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
  if (mode === 'code' && state?.riskInterproceduralStats) {
    enqueueRiskInterproceduralArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: riskSummariesCompression,
      flowsCompression: riskFlowsCompression,
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
      { cpu: 1, mem: 1 },
      fn
    )
    : (fn) => fn();
  const scheduleRelationsIo = scheduler?.schedule
    ? (fn) => scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2RelationsIo, { io: 1 }, fn)
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
  const writeDispatch = await dispatchScheduledArtifactWrites({
    writes,
    artifactConfig,
    heavyWriteThresholdBytes,
    ultraLightWriteThresholdBytes,
    massiveWriteThresholdBytes,
    forcedHeavyWritePatterns,
    forcedUltraLightWritePatterns,
    forcedMassiveWritePatterns,
    adaptiveWriteConcurrencyEnabled,
    adaptiveWriteMinConcurrency,
    adaptiveWriteStartConcurrencyOverride,
    adaptiveWriteScaleUpBacklogPerSlot,
    adaptiveWriteScaleDownBacklogPerSlot,
    adaptiveWriteStallScaleDownSeconds,
    adaptiveWriteStallScaleUpGuardSeconds,
    adaptiveWriteScaleUpCooldownMs,
    adaptiveWriteScaleDownCooldownMs,
    scheduler,
    outDir,
    writeFsStrategy,
    workClassSmallConcurrencyOverride,
    workClassMediumConcurrencyOverride,
    workClassLargeConcurrencyOverride,
    writeTailRescueEnabled,
    writeTailRescueMaxPending,
    writeTailRescueStallSeconds,
    writeTailRescueBoostIoTokens,
    writeTailRescueBoostMemTokens,
    writeTailWorkerEnabled,
    writeTailWorkerMaxPending,
    massiveWriteIoTokens,
    massiveWriteMemTokens,
    resolveArtifactWriteMemTokens,
    getLongestWriteStallSeconds,
    activeWrites,
    activeWriteBytes,
    writeHeartbeat,
    updateWriteInFlightTelemetry,
    updatePieceMetadata,
    logWriteProgress,
    artifactMetrics,
    artifactQueueDelaySamples,
    logLine
  });
  writeProgress.setTotalWrites(writeDispatch.totalWrites);
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

  finalizeArtifactWriteTelemetry({
    pieceEntries,
    artifactMetrics,
    timing,
    cleanupActions,
    writeFsStrategy,
    profileId
  });
  await writePiecesManifest({
    pieceEntries,
    outDir,
    mode,
    indexState
  });
  await writeIndexMetrics({
    root,
    userConfig,
    mode,
    outDir,
    state,
    postings,
    dictSummary,
    useStubEmbeddings,
    modelId,
    denseVectorsEnabled,
    incrementalEnabled,
    fileCounts,
    timing,
    perfProfile,
    indexState,
    filterIndexStats,
    resolvedTokenMode,
    tokenSampleSize,
    tokenMaxFiles,
    chunkMetaUseJsonl: chunkMetaPlan.chunkMetaUseJsonl,
    chunkMetaUseShards: chunkMetaPlan.chunkMetaUseShards,
    tokenPostingsUseShards,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    documentExtractionEnabled,
    repoProvenance
  });
}
