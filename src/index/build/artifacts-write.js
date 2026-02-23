import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { MAX_JSON_BYTES, readJsonFile, loadJsonArrayArtifact } from '../../shared/artifact-io.js';
import { resolveArtifactCompressionTier } from '../../shared/artifact-io/compression.js';
import { toPosix } from '../../shared/files.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { createJsonWriteStream, writeChunk } from '../../shared/json-stream/streams.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { ensureDiskSpace } from '../../shared/disk-space.js';
import { estimateJsonBytes } from '../../shared/cache.js';
import { buildCacheKey } from '../../shared/cache-key.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { removePathWithRetry } from '../../shared/io/remove-path-with-retry.js';
import { resolveCompressionConfig } from './artifacts/compression.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { writePiecesManifest } from './artifacts/checksums.js';
import { writeFileLists } from './artifacts/file-lists.js';
import { buildFileMeta, buildFileMetaColumnar, computeFileMetaFingerprint } from './artifacts/file-meta.js';
import { buildSerializedFilterIndex } from './artifacts/filter-index.js';
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
import { formatBytes, summarizeFilterIndex } from './artifacts/helpers.js';
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
  resolveBinaryColumnarWriteHints,
  writeBinaryRowFrames
} from '../../shared/artifact-io/binary-columnar.js';
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
  isValidationCriticalArtifact,
  resolveAdaptiveShardCount,
  resolveArtifactWriteFsStrategy,
  resolveArtifactWriteLatencyClass,
  resolveArtifactWriteMemTokens,
  resolveArtifactWriteThroughputProfile,
  selectMicroWriteBatch,
  selectTailWorkerWriteEntry,
  summarizeArtifactLatencyClasses,
  summarizeQueueDelayHistogram
} from './artifacts/write-strategy.js';
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
 * Aggregate per-chunk boilerplate metadata into a compact reference catalog.
 *
 * @param {Array<object>} chunks
 * @returns {Array<{ref:string,count:number,positions:Record<string,number>,tags:Array<string>,sampleFiles:Array<string>}>}
 */
const buildBoilerplateCatalog = (chunks) => {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  const byRef = new Map();
  for (const chunk of chunks) {
    const docmeta = chunk?.docmeta;
    const ref = typeof docmeta?.boilerplateRef === 'string' ? docmeta.boilerplateRef : null;
    if (!ref) continue;
    const row = byRef.get(ref) || {
      ref,
      count: 0,
      positions: {},
      tags: new Set(),
      sampleFiles: []
    };
    row.count += 1;
    const position = typeof docmeta?.boilerplatePosition === 'string'
      ? docmeta.boilerplatePosition
      : 'unknown';
    row.positions[position] = (row.positions[position] || 0) + 1;
    const tags = Array.isArray(docmeta?.boilerplateTags) ? docmeta.boilerplateTags : [];
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.trim()) row.tags.add(tag.trim());
    }
    const file = typeof chunk?.file === 'string' ? chunk.file : null;
    if (file && row.sampleFiles.length < 8 && !row.sampleFiles.includes(file)) {
      row.sampleFiles.push(file);
    }
    byRef.set(ref, row);
  }
  return Array.from(byRef.values())
    .map((row) => ({
      ref: row.ref,
      count: row.count,
      positions: row.positions,
      tags: Array.from(row.tags).sort(),
      sampleFiles: row.sampleFiles
    }))
    .sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref));
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
  const compressionTierConfig = (
    artifactConfig.compressionTiers && typeof artifactConfig.compressionTiers === 'object'
      ? artifactConfig.compressionTiers
      : {}
  );
  const compressionTiersEnabled = compressionTierConfig.enabled !== false;
  const compressionTierHotNoCompression = compressionTierConfig.hotNoCompression !== false;
  const compressionTierColdForceCompression = compressionTierConfig.coldForceCompression !== false;
  /**
   * Normalize user-provided tier artifact names into a clean list.
   *
   * @param {unknown} value
   * @returns {string[]}
   */
  const normalizeTierArtifactList = (value) => (
    Array.isArray(value)
      ? value.filter((entry) => typeof entry === 'string' && entry.trim())
      : []
  );
  const defaultHotTierArtifacts = [
    'chunk_meta',
    'chunk_uid_map',
    'file_meta',
    'token_postings',
    'token_postings_packed',
    'token_postings_binary-columnar',
    'dense_vectors_uint8',
    'dense_vectors_doc_uint8',
    'dense_vectors_code_uint8',
    'dense_meta',
    'index_state',
    'pieces_manifest'
  ];
  const defaultColdTierArtifacts = [
    'repo_map',
    'risk_summaries',
    'risk_flows',
    'call_sites',
    'graph_relations',
    'graph_relations_meta',
    'determinism_report',
    'extraction_report',
    'vocab_order'
  ];
  const tierHotArtifacts = normalizeTierArtifactList(compressionTierConfig.hotArtifacts);
  const tierColdArtifacts = normalizeTierArtifactList(compressionTierConfig.coldArtifacts);
  /**
   * Resolve compression tier assignment for one artifact name.
   *
   * @param {string} artifactName
   * @returns {'hot'|'warm'|'cold'}
   */
  const resolveArtifactTier = (artifactName) => resolveArtifactCompressionTier(artifactName, {
    hotArtifacts: tierHotArtifacts.length ? tierHotArtifacts : defaultHotTierArtifacts,
    coldArtifacts: tierColdArtifacts.length ? tierColdArtifacts : defaultColdTierArtifacts,
    defaultTier: 'warm'
  });
  const tieredCompressionOverrides = {
    ...(compressionOverrides && typeof compressionOverrides === 'object'
      ? compressionOverrides
      : {})
  };
  if (compressionTiersEnabled) {
    for (const artifactName of compressibleArtifacts) {
      if (Object.prototype.hasOwnProperty.call(tieredCompressionOverrides, artifactName)) continue;
      const tier = resolveArtifactTier(artifactName);
      if (tier === 'hot' && compressionTierHotNoCompression) {
        tieredCompressionOverrides[artifactName] = {
          enabled: false,
          mode: compressionMode,
          keepRaw: true
        };
        continue;
      }
      if (tier === 'cold' && compressionTierColdForceCompression && compressionEnabled && compressionMode) {
        tieredCompressionOverrides[artifactName] = {
          enabled: true,
          mode: compressionMode,
          keepRaw: compressionKeepRaw
        };
      }
    }
  }
  /**
   * Resolve explicit compression override for an artifact base name.
   *
   * @param {string} base
   * @returns {object|null}
   */
  const resolveCompressionOverride = (base) => (
    tieredCompressionOverrides && Object.prototype.hasOwnProperty.call(tieredCompressionOverrides, base)
      ? tieredCompressionOverrides[base]
      : null
  );
  /**
   * Resolve effective shard compression mode after override/tier policy.
   *
   * @param {string} base
   * @returns {string|null}
   */
  const resolveShardCompression = (base) => {
    const override = resolveCompressionOverride(base);
    if (override) {
      return override.enabled ? override.mode : null;
    }
    return compressionEnabled && !compressionKeepRaw && compressibleArtifacts.has(base)
      ? compressionMode
      : null;
  };
  const writeFsStrategy = resolveArtifactWriteFsStrategy({ artifactConfig });
  const writeJsonlShapeAware = artifactConfig.writeJsonlShapeAware !== false;
  const writeJsonlLargeThresholdBytes = Number.isFinite(Number(artifactConfig.writeJsonlLargeThresholdBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.writeJsonlLargeThresholdBytes)))
    : (32 * 1024 * 1024);
  const artifactMode = typeof artifactConfig.mode === 'string'
    ? artifactConfig.mode.toLowerCase()
    : 'auto';
  const jsonArraySerializeShardThresholdMs = Number.isFinite(Number(artifactConfig.jsonArraySerializeShardThresholdMs))
    ? Math.max(0, Math.floor(Number(artifactConfig.jsonArraySerializeShardThresholdMs)))
    : 10;
  const jsonArraySerializeShardMaxBytes = Number.isFinite(Number(artifactConfig.jsonArraySerializeShardMaxBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.jsonArraySerializeShardMaxBytes)))
    : (64 * 1024 * 1024);
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
  const chunkMetaJsonlThreshold = Number.isFinite(Number(artifactConfig.chunkMetaJsonlThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.chunkMetaJsonlThreshold)))
    : 200000;
  const chunkMetaJsonlEstimateThresholdBytes = Number.isFinite(
    Number(artifactConfig.chunkMetaJsonlEstimateThresholdBytes)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.chunkMetaJsonlEstimateThresholdBytes)))
    : (1 * 1024 * 1024);
  const chunkMetaShardSizeRaw = Number(artifactConfig.chunkMetaShardSize);
  const chunkMetaShardSizeExplicit = Number.isFinite(chunkMetaShardSizeRaw);
  const chunkMetaShardSize = chunkMetaShardSizeExplicit
    ? Math.max(0, Math.floor(chunkMetaShardSizeRaw))
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
  const tokenPostingsPackedAutoThresholdBytes = Number.isFinite(
    Number(artifactConfig.tokenPostingsPackedAutoThresholdBytes)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.tokenPostingsPackedAutoThresholdBytes)))
    : (1 * 1024 * 1024);
  let tokenPostingsShardSize = Number.isFinite(Number(artifactConfig.tokenPostingsShardSize))
    ? Math.max(1000, Math.floor(Number(artifactConfig.tokenPostingsShardSize)))
    : 50000;
  const tokenPostingsShardThreshold = Number.isFinite(Number(artifactConfig.tokenPostingsShardThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.tokenPostingsShardThreshold)))
    : 200000;
  const fieldTokensShardThresholdBytes = Number.isFinite(Number(artifactConfig.fieldTokensShardThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldTokensShardThresholdBytes)))
    : (8 * 1024 * 1024);
  const fieldTokensShardMaxBytes = Number.isFinite(Number(artifactConfig.fieldTokensShardMaxBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldTokensShardMaxBytes)))
    : (8 * 1024 * 1024);
  const artifactWriteThroughputBytesPerSec = resolveArtifactWriteThroughputProfile(perfProfile);
  const fieldPostingsShardsEnabled = artifactConfig.fieldPostingsShards === true;
  const fieldPostingsShardThresholdBytes = Number.isFinite(Number(artifactConfig.fieldPostingsShardThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldPostingsShardThresholdBytes)))
    : (64 * 1024 * 1024);
  const fieldPostingsShardCount = Number.isFinite(Number(artifactConfig.fieldPostingsShardCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.fieldPostingsShardCount)))
    : 8;
  const fieldPostingsShardMinCount = Number.isFinite(Number(artifactConfig.fieldPostingsShardMinCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.fieldPostingsShardMinCount)))
    : 8;
  const fieldPostingsShardMaxCount = Number.isFinite(Number(artifactConfig.fieldPostingsShardMaxCount))
    ? Math.max(fieldPostingsShardMinCount, Math.floor(Number(artifactConfig.fieldPostingsShardMaxCount)))
    : 16;
  const fieldPostingsShardTargetBytes = Number.isFinite(Number(artifactConfig.fieldPostingsShardTargetBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.fieldPostingsShardTargetBytes)))
    : (32 * 1024 * 1024);
  const fieldPostingsShardTargetSeconds = Number.isFinite(Number(artifactConfig.fieldPostingsShardTargetSeconds))
    ? Math.max(1, Number(artifactConfig.fieldPostingsShardTargetSeconds))
    : 6;
  const fieldPostingsBinaryColumnar = artifactConfig.fieldPostingsBinaryColumnar === true;
  const fieldPostingsBinaryColumnarThresholdBytes = Number.isFinite(
    Number(artifactConfig.fieldPostingsBinaryColumnarThresholdBytes)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldPostingsBinaryColumnarThresholdBytes)))
    : (96 * 1024 * 1024);
  const fieldPostingsKeepLegacyJson = artifactConfig.fieldPostingsKeepLegacyJson !== false;
  const chunkMetaAdaptiveShardsEnabled = artifactConfig.chunkMetaAdaptiveShards !== false;
  const chunkMetaShardMinCount = Number.isFinite(Number(artifactConfig.chunkMetaShardMinCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.chunkMetaShardMinCount)))
    : 4;
  const chunkMetaShardMaxCount = Number.isFinite(Number(artifactConfig.chunkMetaShardMaxCount))
    ? Math.max(chunkMetaShardMinCount, Math.floor(Number(artifactConfig.chunkMetaShardMaxCount)))
    : 32;
  const chunkMetaShardTargetBytes = Number.isFinite(Number(artifactConfig.chunkMetaShardTargetBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.chunkMetaShardTargetBytes)))
    : (16 * 1024 * 1024);
  const chunkMetaShardTargetSeconds = Number.isFinite(Number(artifactConfig.chunkMetaShardTargetSeconds))
    ? Math.max(1, Number(artifactConfig.chunkMetaShardTargetSeconds))
    : 6;
  const minhashJsonLargeThreshold = Number.isFinite(Number(artifactConfig.minhashJsonLargeThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.minhashJsonLargeThreshold)))
    : 5000;
  const writeProgressHeartbeatMs = Number.isFinite(Number(artifactConfig.writeProgressHeartbeatMs))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeProgressHeartbeatMs)))
    : 15000;

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
  /**
   * Resolve existing artifact path, falling back to `.bak` sibling when present.
   *
   * @param {string} targetPath
   * @returns {string|null}
   */
  const resolveExistingOrBakPath = (targetPath) => {
    if (!targetPath) return null;
    if (fsSync.existsSync(targetPath)) return targetPath;
    const bakPath = `${targetPath}.bak`;
    if (fsSync.existsSync(bakPath)) return bakPath;
    return null;
  };
  let previousFilterIndexResolved = false;
  let previousFilterIndex = null;
  /**
   * Resolve the previous filter-index artifact (or its `.bak` fallback) once
   * so retry/fallback paths can reuse a validated prior output.
   *
   * @returns {{piece:object|null,source:string|null}}
   */
  const resolvePreviousFilterIndex = () => {
    if (previousFilterIndexResolved) return previousFilterIndex;
    previousFilterIndexResolved = true;
    const previousPiecesManifestPath = path.join(outDir, 'pieces', 'manifest.json');
    let previousPiecesManifest = null;
    try {
      const source = resolveExistingOrBakPath(previousPiecesManifestPath);
      if (source) {
        previousPiecesManifest = readJsonFile(source, { maxBytes: maxJsonBytes });
      }
    } catch {}
    const previousPieces = Array.isArray(previousPiecesManifest?.pieces) ? previousPiecesManifest.pieces : [];
    const previousFilterIndexPiece = previousPieces.find((piece) => piece?.name === 'filter_index' && piece?.path);
    const previousFilterIndexPath = previousFilterIndexPiece?.path
      ? path.join(outDir, ...String(previousFilterIndexPiece.path).split('/'))
      : null;
    const previousFilterIndexSource = resolveExistingOrBakPath(previousFilterIndexPath);
    previousFilterIndex = {
      piece: previousFilterIndexPiece,
      source: previousFilterIndexSource
    };
    return previousFilterIndex;
  };
  let filterIndex = null;
  let filterIndexStats = null;
  let filterIndexReused = false;
  let filterIndexFallback = null;
  /**
   * Register reuse of previously persisted filter index metadata.
   *
   * @param {string} reason
   * @returns {void}
   */
  const reusePreviousFilterIndex = (reason) => {
    const previous = resolvePreviousFilterIndex();
    const previousFilterIndexSource = previous?.source || null;
    const previousFilterIndexPiece = previous?.piece || null;
    if (!previousFilterIndexSource) return false;
    const note = reason ? ` (${reason})` : '';
    log(`[warn] [filter_index] build skipped; reusing previous artifact.${note}`);
    let previousRaw = null;
    try {
      previousRaw = readJsonFile(previousFilterIndexSource, { maxBytes: maxJsonBytes });
      validateSerializedFilterIndex(previousRaw);
    } catch (err) {
      const message = err?.message || String(err);
      log(`[warn] [filter_index] failed to reuse previous artifact; validation failed. (${message})`);
      return false;
    }
    filterIndexReused = true;
    filterIndexFallback = {
      piece: {
        type: previousFilterIndexPiece?.type || 'chunks',
        name: 'filter_index',
        format: previousFilterIndexPiece?.format || 'json'
      },
      path: previousFilterIndexSource
    };
    try {
      filterIndexStats = summarizeFilterIndex(previousRaw);
    } catch {
      filterIndexStats = { reused: true };
    }
    if (filterIndexStats && typeof filterIndexStats === 'object') {
      filterIndexStats.reused = true;
    }
    return true;
  };
  /**
   * Validate serialized filter-index shape before reuse.
   *
   * @param {object} candidate
   * @returns {boolean}
   */
  const validateSerializedFilterIndex = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('expected object');
    }
    if (!Number.isFinite(Number(candidate.schemaVersion))) {
      throw new Error('missing schemaVersion');
    }
    if (!Number.isFinite(Number(candidate.fileChargramN))) {
      throw new Error('missing fileChargramN');
    }
    if (!Array.isArray(candidate.fileById)) {
      throw new Error('missing fileById');
    }
    if (!Array.isArray(candidate.fileChunksById)) {
      throw new Error('missing fileChunksById');
    }
    if (candidate.fileById.length !== candidate.fileChunksById.length) {
      throw new Error('fileById/fileChunksById length mismatch');
    }
    if (candidate.byLang == null || typeof candidate.byLang !== 'object') {
      throw new Error('missing byLang');
    }
    return true;
  };
  try {
    filterIndex = buildSerializedFilterIndex({
      chunks: state.chunks,
      resolvedConfig,
      userConfig,
      root
    });
    validateSerializedFilterIndex(filterIndex);
    filterIndexStats = summarizeFilterIndex(filterIndex);
    if (filterIndexStats && typeof filterIndexStats === 'object' && Number.isFinite(filterIndexStats.jsonBytes)) {
      // filter_index is currently written uncompressed (compressible=false); keep a stable estimate
      // in case later phases make it compressible.
      filterIndexStats.diskBytesEstimate = filterIndexStats.jsonBytes;
      filterIndexStats.compressionRatioEstimate = 1;
    }
    if (filterIndexStats?.jsonBytes && filterIndexStats.jsonBytes > maxJsonBytesSoft) {
      log(
        `filter_index ~${formatBytes(filterIndexStats.jsonBytes)}; ` +
        'large filter indexes increase memory usage (consider sqlite for large repos).'
      );
    }
  } catch (err) {
    const message = err?.message || String(err);
    log(`[warn] [filter_index] build failed; skipping. (${message})`);
    filterIndex = null;
    filterIndexStats = null;
    reusePreviousFilterIndex(message);
  }
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
  let totalWrites = 0;
  let completedWrites = 0;
  let lastWriteLog = 0;
  let lastWriteLabel = '';
  const activeWrites = new Map();
  const activeWriteBytes = new Map();
  let writeHeartbeatTimer = null;
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
  const legacyWarnThreshold = Number.isFinite(Number(artifactConfig.writeStallWarnSeconds))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeStallWarnSeconds)))
    : null;
  const legacyCriticalThreshold = Number.isFinite(Number(artifactConfig.writeStallCriticalSeconds))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeStallCriticalSeconds)))
    : null;
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
  /**
   * Resolve readable stall-threshold level label for telemetry.
   *
   * @param {number} thresholdSec
   * @param {number} index
   * @returns {string}
   */
  const stallThresholdLevelName = (thresholdSec, index) => {
    if (thresholdSec >= 60) return 'severe';
    if (thresholdSec >= 30) return 'critical';
    if (thresholdSec >= 10) return 'warning';
    return `level-${index + 1}`;
  };
  const heavyWriteThresholdBytes = Number.isFinite(Number(artifactConfig.writeHeavyThresholdBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.writeHeavyThresholdBytes)))
    : (16 * 1024 * 1024);
  const forcedHeavyWritePatterns = Array.isArray(artifactConfig.writeHeavyLabelPatterns)
    ? artifactConfig.writeHeavyLabelPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : [
      /(^|\/)field_postings(?:\.|$)/,
      /(^|\/)token_postings(?:\.|$)/,
      /(^|\/)chunk_meta(?:\.|$)/
    ];
  const heavyWriteConcurrencyOverride = Number.isFinite(Number(artifactConfig.writeHeavyConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeHeavyConcurrency)))
    : null;
  const ultraLightWriteThresholdBytes = Number.isFinite(Number(artifactConfig.writeUltraLightThresholdBytes))
    ? Math.max(1024, Math.floor(Number(artifactConfig.writeUltraLightThresholdBytes)))
    : (64 * 1024);
  const forcedUltraLightWritePatterns = Array.isArray(artifactConfig.writeUltraLightLabelPatterns)
    ? artifactConfig.writeUltraLightLabelPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : [
      /(^|\/)\.filelists\.json$/,
      /(^|\/).*\.meta\.json$/,
      /(^|\/)determinism_report\.json$/,
      /(^|\/)vocab_order\.json$/,
      /(^|\/)pieces\/manifest\.json$/
    ];
  const massiveWriteThresholdBytes = Number.isFinite(Number(artifactConfig.writeMassiveThresholdBytes))
    ? Math.max(8 * 1024 * 1024, Math.floor(Number(artifactConfig.writeMassiveThresholdBytes)))
    : (128 * 1024 * 1024);
  const forcedMassiveWritePatterns = Array.isArray(artifactConfig.writeMassiveLabelPatterns)
    ? artifactConfig.writeMassiveLabelPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : [
      /(^|\/)field_postings(?:\.|$)/,
      /(^|\/)field_postings\.binary-columnar(?:\.|$)/,
      /(^|\/)token_postings\.packed(?:\.|$)/,
      /(^|\/)token_postings\.binary-columnar(?:\.|$)/,
      /(^|\/)chunk_meta\.binary-columnar(?:\.|$)/
    ];
  const massiveWriteIoTokens = Number.isFinite(Number(artifactConfig.writeMassiveIoTokens))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeMassiveIoTokens)))
    : 2;
  const massiveWriteMemTokens = Number.isFinite(Number(artifactConfig.writeMassiveMemTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeMassiveMemTokens)))
    : 2;
  /**
   * Resolve first non-negative numeric work-class concurrency override.
   *
   * @param {...unknown} values
   * @returns {number|null}
   */
  const resolveWorkClassOverride = (...values) => {
    for (const candidate of values) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.max(1, Math.floor(parsed));
      }
    }
    return null;
  };
  const workClassSmallConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeSmallConcurrency,
    artifactConfig.writeWorkClassSmallConcurrency
  );
  const workClassMediumConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeMediumConcurrency,
    artifactConfig.writeWorkClassMediumConcurrency,
    artifactConfig.writeHeavyConcurrency
  );
  const workClassLargeConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeLargeConcurrency,
    artifactConfig.writeWorkClassLargeConcurrency,
    artifactConfig.writeMassiveConcurrency
  );
  const adaptiveWriteConcurrencyEnabled = artifactConfig.writeAdaptiveConcurrency !== false;
  const adaptiveWriteMinConcurrency = Number.isFinite(Number(artifactConfig.writeAdaptiveMinConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveMinConcurrency)))
    : 1;
  const adaptiveWriteStartConcurrencyOverride = Number.isFinite(Number(artifactConfig.writeAdaptiveStartConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStartConcurrency)))
    : null;
  const adaptiveWriteScaleUpBacklogPerSlot = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleUpBacklogPerSlot)
  )
    ? Math.max(1, Number(artifactConfig.writeAdaptiveScaleUpBacklogPerSlot))
    : 1.75;
  const adaptiveWriteScaleDownBacklogPerSlot = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleDownBacklogPerSlot)
  )
    ? Math.max(0, Number(artifactConfig.writeAdaptiveScaleDownBacklogPerSlot))
    : 0.5;
  const adaptiveWriteStallScaleDownSeconds = Number.isFinite(
    Number(artifactConfig.writeAdaptiveStallScaleDownSeconds)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStallScaleDownSeconds)))
    : 20;
  const adaptiveWriteStallScaleUpGuardSeconds = Number.isFinite(
    Number(artifactConfig.writeAdaptiveStallScaleUpGuardSeconds)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStallScaleUpGuardSeconds)))
    : 8;
  const adaptiveWriteScaleUpCooldownMs = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleUpCooldownMs)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.writeAdaptiveScaleUpCooldownMs)))
    : 400;
  const adaptiveWriteScaleDownCooldownMs = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleDownCooldownMs)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.writeAdaptiveScaleDownCooldownMs)))
    : 1200;
  const writeTailRescueEnabled = artifactConfig.writeTailRescue !== false;
  const writeTailRescueMaxPending = Number.isFinite(Number(artifactConfig.writeTailRescueMaxPending))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailRescueMaxPending)))
    : 3;
  const writeTailRescueStallSeconds = Number.isFinite(Number(artifactConfig.writeTailRescueStallSeconds))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailRescueStallSeconds)))
    : 15;
  const writeTailRescueBoostIoTokens = Number.isFinite(Number(artifactConfig.writeTailRescueBoostIoTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeTailRescueBoostIoTokens)))
    : 1;
  const writeTailRescueBoostMemTokens = Number.isFinite(Number(artifactConfig.writeTailRescueBoostMemTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeTailRescueBoostMemTokens)))
    : 1;
  const writeTailWorkerEnabled = writeFsStrategy.tailWorker;
  const writeTailWorkerMaxPending = Number.isFinite(Number(artifactConfig.writeTailWorkerMaxPending))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailWorkerMaxPending)))
    : Math.max(2, writeTailRescueMaxPending + 1);
  const writeStallAlerts = new Map();
  /**
   * Publish current write in-flight bytes/count into runtime telemetry.
   *
   * @returns {void}
   */
  const updateWriteInFlightTelemetry = () => {
    if (!telemetry || typeof telemetry.setInFlightBytes !== 'function') return;
    let bytes = 0;
    for (const value of activeWriteBytes.values()) {
      if (Number.isFinite(value) && value > 0) bytes += value;
    }
    telemetry.setInFlightBytes('artifacts.write', {
      bytes,
      count: activeWrites.size
    });
  };
  /**
   * Compute longest active write runtime in seconds.
   *
   * @returns {number}
   */
  const getLongestWriteStallSeconds = () => {
    if (!activeWrites.size) return 0;
    const now = Date.now();
    let longest = 0;
    for (const startedAt of activeWrites.values()) {
      const elapsed = Math.max(0, now - (Number(startedAt) || now));
      if (elapsed > longest) longest = elapsed;
    }
    return Math.max(0, Math.round(longest / 1000));
  };
  let enqueueSeq = 0;
  /**
   * Convert artifact path to normalized output-root relative label.
   *
   * @param {string} filePath
   * @returns {string}
   */
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
  const pieceEntries = [];
  const pieceEntriesByPath = new Map();
  let mmapHotLayoutOrder = 0;
  /**
   * Resolve piece tier (`hot`/`cold`/`warm`) from metadata or artifact policy.
   *
   * @param {object} entry
   * @param {string} normalizedPath
   * @returns {string}
   */
  const resolvePieceTier = (entry, normalizedPath) => {
    const explicitTier = typeof entry?.tier === 'string' ? entry.tier.trim().toLowerCase() : null;
    if (explicitTier === 'hot' || explicitTier === 'warm' || explicitTier === 'cold') {
      return explicitTier;
    }
    const candidateName = typeof entry?.name === 'string' && entry.name
      ? entry.name
      : normalizedPath;
    return resolveArtifactTier(candidateName);
  };
  /**
   * Register one written artifact file in the pieces manifest.
   *
   * @param {object} entry
   * @param {string} filePath
   * @returns {void}
   */
  const addPieceFile = (entry, filePath) => {
    const normalizedPath = formatArtifactLabel(filePath);
    const tier = resolvePieceTier(entry, normalizedPath);
    const existingLayout = entry?.layout && typeof entry.layout === 'object'
      ? { ...entry.layout }
      : {};
    if (tier === 'hot') {
      if (!Number.isFinite(Number(existingLayout.order))) {
        existingLayout.order = mmapHotLayoutOrder;
        mmapHotLayoutOrder += 1;
      }
      existingLayout.group = typeof existingLayout.group === 'string' && existingLayout.group
        ? existingLayout.group
        : 'mmap-hot';
      if (typeof existingLayout.contiguous !== 'boolean') {
        existingLayout.contiguous = true;
      }
    } else {
      existingLayout.group = typeof existingLayout.group === 'string' && existingLayout.group
        ? existingLayout.group
        : (tier === 'cold' ? 'cold-storage' : 'warm-storage');
      if (typeof existingLayout.contiguous !== 'boolean') {
        existingLayout.contiguous = false;
      }
    }
    const normalizedEntry = {
      ...entry,
      tier,
      layout: existingLayout,
      path: normalizedPath
    };
    pieceEntries.push(normalizedEntry);
    if (!pieceEntriesByPath.has(normalizedPath)) {
      pieceEntriesByPath.set(normalizedPath, []);
    }
    pieceEntriesByPath.get(normalizedPath).push(normalizedEntry);
  };
  /**
   * Attach incremental metadata updates to a tracked piece-manifest file row.
   *
   * @param {string} piecePath
   * @param {object} [meta]
   * @returns {void}
   */
  const updatePieceMetadata = (piecePath, meta = {}) => {
    if (typeof piecePath !== 'string' || !piecePath) return;
    const targets = pieceEntriesByPath.get(piecePath);
    if (!Array.isArray(targets) || !targets.length) return;
    const bytes = Number(meta?.bytes);
    const checksumValue = typeof meta?.checksum === 'string' ? meta.checksum.trim().toLowerCase() : null;
    const checksumAlgo = typeof meta?.checksumAlgo === 'string' ? meta.checksumAlgo.trim().toLowerCase() : null;
    for (const entry of targets) {
      if (Number.isFinite(bytes) && bytes >= 0) entry.bytes = bytes;
      if (checksumValue && checksumAlgo) {
        entry.checksum = `${checksumAlgo}:${checksumValue}`;
      } else if (typeof meta?.checksumHash === 'string' && meta.checksumHash.includes(':')) {
        entry.checksum = meta.checksumHash.trim().toLowerCase();
      }
    }
  };
  addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, path.join(outDir, '.filelists.json'));
  /**
   * Emit periodic write-progress summary and stall diagnostics.
   *
   * @param {string} label
   * @returns {void}
   */
  const logWriteProgress = (label) => {
    completedWrites += 1;
    if (label) lastWriteLabel = label;
    showProgress('Artifacts', completedWrites, totalWrites, {
      ...writeProgressMeta,
      message: label || null
    });
    const now = Date.now();
    if (completedWrites === totalWrites || completedWrites === 1 || (now - lastWriteLog) >= writeLogIntervalMs) {
      lastWriteLog = now;
      const percent = totalWrites > 0
        ? (completedWrites / totalWrites * 100).toFixed(1)
        : '100.0';
      const suffix = lastWriteLabel ? ` | ${lastWriteLabel}` : '';
      logLine(`Writing index files ${completedWrites}/${totalWrites} (${percent}%)${suffix}`, { kind: 'status' });
    }
  };
  /**
   * Record one artifact write metric row and update latency histograms.
   *
   * @param {string} label
   * @param {object} metric
   * @returns {void}
   */
  const recordArtifactMetric = (label, metric) => {
    if (!label) return;
    const existing = artifactMetrics.get(label) || { path: label };
    const nextMetric = { ...existing, ...metric };
    const queueDelayMs = Number(metric?.queueDelayMs);
    if (Number.isFinite(queueDelayMs) && queueDelayMs >= 0) {
      const samples = artifactQueueDelaySamples.get(label) || [];
      samples.push(Math.round(queueDelayMs));
      artifactQueueDelaySamples.set(label, samples);
      const queueDelayHistogram = summarizeQueueDelayHistogram(samples);
      if (queueDelayHistogram) {
        nextMetric.queueDelayHistogram = queueDelayHistogram;
        nextMetric.queueDelayP50Ms = queueDelayHistogram.p50Ms;
        nextMetric.queueDelayP95Ms = queueDelayHistogram.p95Ms;
      }
    }
    artifactMetrics.set(label, nextMetric);
  };
  /**
   * Start periodic write-heartbeat timer when enabled.
   *
   * @returns {void}
   */
  const startWriteHeartbeat = () => {
    if (writeProgressHeartbeatMs <= 0 || writeHeartbeatTimer) return;
    writeHeartbeatTimer = setInterval(() => {
      if (!activeWrites.size || completedWrites >= totalWrites) return;
      const now = Date.now();
      const inflight = Array.from(activeWrites.entries())
        .map(([label, startedAt]) => ({
          label,
          elapsedSec: Math.max(1, Math.round((now - startedAt) / 1000)),
          estimatedBytes: Number(activeWriteBytes.get(label)) || null
        }))
        .sort((a, b) => b.elapsedSec - a.elapsedSec);
      for (const { label, elapsedSec, estimatedBytes } of inflight) {
        const alerts = writeStallAlerts.get(label) || new Set();
        for (let thresholdIndex = 0; thresholdIndex < normalizedWriteStallThresholds.length; thresholdIndex += 1) {
          const thresholdSec = normalizedWriteStallThresholds[thresholdIndex];
          if (alerts.has(thresholdSec) || elapsedSec < thresholdSec) continue;
          alerts.add(thresholdSec);
          writeStallAlerts.set(label, alerts);
          const levelName = stallThresholdLevelName(thresholdSec, thresholdIndex);
          logLine(
            `[perf] artifact write stall ${levelName}: ${label} in-flight for ${elapsedSec}s ` +
            `(threshold=${thresholdSec}s)`,
            { kind: thresholdSec >= 30 ? 'error' : 'warning' }
          );
          if (stageCheckpoints?.record) {
            stageCheckpoints.record({
              stage: 'artifacts',
              step: `write-stall-${thresholdSec}s`,
              label,
              extra: {
                elapsedSec,
                thresholdSec,
                level: levelName,
                estimatedBytes
              }
            });
          }
        }
      }
      const preview = inflight.slice(0, 3)
        .map(({ label, elapsedSec, estimatedBytes }) => (
          `${label} (${elapsedSec}s${Number.isFinite(estimatedBytes) ? `, ~${formatBytes(estimatedBytes)}` : ''})`
        ))
        .join(', ');
      const suffix = inflight.length > 3 ? ` (+${inflight.length - 3} more)` : '';
      logLine(
        `Writing index files ${completedWrites}/${totalWrites} | in-flight: ${preview}${suffix}`,
        { kind: 'status' }
      );
    }, writeProgressHeartbeatMs);
    if (typeof writeHeartbeatTimer?.unref === 'function') {
      writeHeartbeatTimer.unref();
    }
  };
  /**
   * Stop and clear the active write-heartbeat timer.
   *
   * @returns {void}
   */
  const stopWriteHeartbeat = () => {
    if (!writeHeartbeatTimer) return;
    clearInterval(writeHeartbeatTimer);
    writeHeartbeatTimer = null;
  };
  /**
   * Resolve scheduler token envelope for eager prefetch scheduling.
   *
   * @param {number} estimatedBytes
   * @param {string} laneHint
   * @returns {{io:number,mem?:number}}
   */
  const resolveEagerSchedulerTokens = (estimatedBytes, laneHint) => {
    const memTokens = resolveArtifactWriteMemTokens(estimatedBytes);
    if (laneHint === 'massive') {
      const massiveMem = Math.max(memTokens, massiveWriteMemTokens);
      return massiveMem > 0
        ? { io: massiveWriteIoTokens, mem: massiveMem }
        : { io: massiveWriteIoTokens };
    }
    return memTokens > 0 ? { io: 1, mem: memTokens } : { io: 1 };
  };
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
      const tokens = resolveEagerSchedulerTokens(estimatedBytes, laneHint);
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
  /**
   * Resolve deterministic write ordering weight for batch scheduling.
   *
   * @param {object} entry
   * @returns {number}
   */
  const resolveWriteWeight = (entry) => {
    if (!entry || typeof entry !== 'object') return 0;
    let weight = Number.isFinite(entry.priority) ? entry.priority : 0;
    if (isValidationCriticalArtifact(entry.label)) {
      // Keep strict-validation-critical artifacts ahead of optional debug/derived
      // outputs when the write queue is saturated.
      weight += 500;
    }
    // Keep FIFO ordering unless a write has explicit priority.
    if (weight > 0 && Number.isFinite(entry.estimatedBytes) && entry.estimatedBytes > 0) {
      weight += Math.log2(entry.estimatedBytes + 1);
    }
    return weight;
  };
  /**
   * Return write entries ordered by scheduler weight then label.
   *
   * @param {object[]} entries
   * @returns {object[]}
   */
  const scheduleWrites = (entries) => (
    Array.isArray(entries)
      ? entries.slice().sort((a, b) => {
        const delta = resolveWriteWeight(b) - resolveWriteWeight(a);
        if (delta !== 0) return delta;
        const aSeq = Number.isFinite(a?.seq) ? a.seq : 0;
        const bSeq = Number.isFinite(b?.seq) ? b.seq : 0;
        return aSeq - bSeq;
      })
      : []
  );
  /**
   * Partition writes into lane classes used by adaptive dispatcher.
   *
   * @param {object[]} entries
   * @returns {{ultraLight:object[],massive:object[],light:object[],heavy:object[]}}
   */
  const splitWriteLanes = (entries) => {
    const ordered = scheduleWrites(entries);
    const lanes = {
      ultraLight: [],
      light: [],
      heavy: [],
      massive: []
    };
    for (const entry of ordered) {
      const estimated = Number(entry?.estimatedBytes);
      const label = typeof entry?.label === 'string' ? entry.label : '';
      const isForcedMassive = forcedMassiveWritePatterns.some((pattern) => pattern.test(label));
      const isForcedHeavy = forcedHeavyWritePatterns.some((pattern) => pattern.test(label));
      const isForcedUltraLight = forcedUltraLightWritePatterns.some((pattern) => pattern.test(label));
      const isMassiveBySize = Number.isFinite(estimated) && estimated >= massiveWriteThresholdBytes;
      const isMassive = isForcedMassive || isMassiveBySize;
      const isHeavyBySize = Number.isFinite(estimated) && estimated >= heavyWriteThresholdBytes;
      const isHeavy = isForcedHeavy || isHeavyBySize;
      const isUltraLightBySize = Number.isFinite(estimated)
        && estimated > 0
        && estimated <= ultraLightWriteThresholdBytes;
      if (isMassive) {
        lanes.massive.push(entry);
      } else if (isHeavy) {
        lanes.heavy.push(entry);
      } else if (isForcedUltraLight || isUltraLightBySize) {
        lanes.ultraLight.push(entry);
      } else {
        lanes.light.push(entry);
      }
    }
    return lanes;
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
        let diskMs = 0;
        const {
          stream,
          done,
          getBytesWritten,
          getChecksum,
          checksumAlgo
        } = createJsonWriteStream(part.absPath, { atomic: true, checksumAlgo: 'sha1' });
        try {
          let writeStart = Date.now();
          await writeChunk(stream, '{"fields":{');
          diskMs += Math.max(0, Date.now() - writeStart);
          let first = true;
          for (let index = part.start; index < part.end; index += 1) {
            const field = fieldNames[index];
            const value = fieldPostingsObject[field];
            const serializeStart = Date.now();
            const row = `${first ? '' : ','}${JSON.stringify(field)}:${JSON.stringify(value)}`;
            serializationMs += Math.max(0, Date.now() - serializeStart);
            writeStart = Date.now();
            await writeChunk(stream, row);
            diskMs += Math.max(0, Date.now() - writeStart);
            first = false;
          }
          writeStart = Date.now();
          await writeChunk(stream, '}}\n');
          stream.end();
          await done;
          diskMs += Math.max(0, Date.now() - writeStart);
          return {
            bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : null,
            checksum: typeof getChecksum === 'function' ? getChecksum() : null,
            checksumAlgo: checksumAlgo || null,
            serializationMs,
            diskMs,
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
          { priority: 206, estimatedBytes: partEstimatedBytes }
        );
        addPieceFile({
          type: 'postings',
          name: 'field_postings_shard',
          format: 'json',
          count: part.count
        }, part.absPath);
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
        { priority: 207, estimatedBytes: Math.max(1024, partFiles.length * 128) }
      );
      addPieceFile({ type: 'postings', name: 'field_postings_shards_meta', format: 'json' }, shardsMetaPath);
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
        let diskMs = 0;
        const {
          stream,
          done,
          getBytesWritten,
          getChecksum,
          checksumAlgo
        } = createJsonWriteStream(targetPath, { atomic: true, checksumAlgo: 'sha1' });
        try {
          let writeStart = Date.now();
          await writeChunk(stream, '{"fields":{');
          diskMs += Math.max(0, Date.now() - writeStart);
          let first = true;
          for (const part of partFiles) {
            for (let index = part.start; index < part.end; index += 1) {
              const field = fieldNames[index];
              const value = fieldPostingsObject[field];
              const serializeStart = Date.now();
              const row = `${first ? '' : ','}${JSON.stringify(field)}:${JSON.stringify(value)}`;
              serializationMs += Math.max(0, Date.now() - serializeStart);
              writeStart = Date.now();
              await writeChunk(stream, row);
              diskMs += Math.max(0, Date.now() - writeStart);
              first = false;
            }
          }
          writeStart = Date.now();
          await writeChunk(stream, '}}\n');
          stream.end();
          await done;
          diskMs += Math.max(0, Date.now() - writeStart);
          return {
            bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : null,
            checksum: typeof getChecksum === 'function' ? getChecksum() : null,
            checksumAlgo: checksumAlgo || null,
            serializationMs,
            diskMs,
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
          estimatedBytes: fieldPostingsEstimatedBytes
        }
      );
      addPieceFile({ type: 'postings', name: 'field_postings' }, path.join(outDir, 'field_postings.json'));
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
    const shouldWriteFieldPostingsBinary = fieldPostingsBinaryColumnar
      && fieldPostingsEstimatedBytes >= fieldPostingsBinaryColumnarThresholdBytes
      && fieldNames.length > 0;
    if (shouldWriteFieldPostingsBinary) {
      enqueueWrite(
        formatArtifactLabel(fieldPostingsBinaryMetaPath),
        async () => {
          const serializationStartedAt = Date.now();
          const rowPayloads = (async function* binaryRows() {
            for (const field of fieldNames) {
              yield JSON.stringify({
                field,
                postings: fieldPostingsObject[field]
              });
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
          const serializationMs = Math.max(0, Date.now() - serializationStartedAt);
          const diskStartedAt = Date.now();
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
          return {
            bytes: Number.isFinite(Number(binaryMetaResult?.bytes)) ? Number(binaryMetaResult.bytes) : null,
            checksum: typeof binaryMetaResult?.checksum === 'string' ? binaryMetaResult.checksum : null,
            checksumAlgo: typeof binaryMetaResult?.checksumAlgo === 'string' ? binaryMetaResult.checksumAlgo : null,
            serializationMs,
            diskMs: Math.max(0, Date.now() - diskStartedAt),
            directFdStreaming: true
          };
        },
        {
          priority: 223,
          estimatedBytes: Math.max(fieldPostingsEstimatedBytes, fieldNames.length * 96)
        }
      );
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar',
        format: 'binary-columnar',
        count: fieldNames.length
      }, fieldPostingsBinaryDataPath);
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar_offsets',
        format: 'binary',
        count: fieldNames.length
      }, fieldPostingsBinaryOffsetsPath);
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar_lengths',
        format: 'varint',
        count: fieldNames.length
      }, fieldPostingsBinaryLengthsPath);
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar_meta',
        format: 'json'
      }, fieldPostingsBinaryMetaPath);
    } else {
      await Promise.all([
        removeArtifact(fieldPostingsBinaryDataPath, { policy: 'format_cleanup' }),
        removeArtifact(fieldPostingsBinaryOffsetsPath, { policy: 'format_cleanup' }),
        removeArtifact(fieldPostingsBinaryLengthsPath, { policy: 'format_cleanup' }),
        removeArtifact(fieldPostingsBinaryMetaPath, { policy: 'format_cleanup' })
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
  const {
    ultraLight: ultraLightWrites,
    massive: massiveWrites,
    light: lightWrites,
    heavy: heavyWrites
  } = splitWriteLanes(writes);
  totalWrites = ultraLightWrites.length + massiveWrites.length + lightWrites.length + heavyWrites.length;
  if (totalWrites) {
    const artifactLabel = totalWrites === 1 ? 'artifact' : 'artifacts';
    logLine(`Writing index files (${totalWrites} ${artifactLabel})...`, { kind: 'status' });
    const { cap: writeConcurrencyCap, override: writeConcurrencyOverride } = resolveArtifactWriteConcurrency({
      artifactConfig,
      totalWrites
    });
    const writeConcurrency = Math.max(1, Math.min(totalWrites, writeConcurrencyCap));
    const adaptiveWriteInitialConcurrency = adaptiveWriteConcurrencyEnabled
      ? (
        adaptiveWriteStartConcurrencyOverride
        || (writeConcurrencyOverride
          ? writeConcurrency
          : Math.max(adaptiveWriteMinConcurrency, Math.ceil(writeConcurrency * 0.6)))
      )
      : writeConcurrency;
    const writeConcurrencyController = createAdaptiveWriteConcurrencyController({
      maxConcurrency: writeConcurrency,
      minConcurrency: adaptiveWriteMinConcurrency,
      initialConcurrency: adaptiveWriteInitialConcurrency,
      scaleUpBacklogPerSlot: adaptiveWriteScaleUpBacklogPerSlot,
      scaleDownBacklogPerSlot: adaptiveWriteScaleDownBacklogPerSlot,
      stallScaleDownSeconds: adaptiveWriteStallScaleDownSeconds,
      stallScaleUpGuardSeconds: adaptiveWriteStallScaleUpGuardSeconds,
      scaleUpCooldownMs: adaptiveWriteScaleUpCooldownMs,
      scaleDownCooldownMs: adaptiveWriteScaleDownCooldownMs,
      onChange: ({
        reason,
        from,
        to,
        pendingWrites,
        longestStallSec,
        memoryPressure,
        gcPressure,
        rssUtilization
      }) => {
        const stallSuffix = longestStallSec > 0 ? `, stall=${longestStallSec}s` : '';
        const memorySuffix = (
          Number.isFinite(memoryPressure) || Number.isFinite(gcPressure) || Number.isFinite(rssUtilization)
        )
          ? `, mem=${Number.isFinite(memoryPressure) ? memoryPressure.toFixed(2) : 'n/a'},` +
            ` gc=${Number.isFinite(gcPressure) ? gcPressure.toFixed(2) : 'n/a'},` +
            ` rss=${Number.isFinite(rssUtilization) ? rssUtilization.toFixed(2) : 'n/a'}`
          : '';
        logLine(
          `[perf] adaptive artifact write concurrency ${from} -> ${to} ` +
          `(${reason}, pending=${pendingWrites}${stallSuffix}${memorySuffix})`,
          { kind: 'status' }
        );
      }
    });
    const hostConcurrency = typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (Array.isArray(os.cpus()) ? os.cpus().length : 1);
    const laneQueues = {
      ultraLight: ultraLightWrites.slice(),
      massive: massiveWrites.slice(),
      light: lightWrites.slice(),
      heavy: heavyWrites.slice()
    };
    const laneActive = {
      ultraLight: 0,
      massive: 0,
      light: 0,
      heavy: 0
    };
    let activeCount = 0;
    let fatalWriteError = null;
    const inFlightWrites = new Set();
    let forcedTailRescueConcurrency = null;
    let tailRescueActive = false;
    let tailWorkerActive = 0;
    /**
     * Count queued write entries across all dispatch lanes.
     *
     * @returns {number}
     */
    const pendingWriteCount = () => (
      laneQueues.ultraLight.length
      + laneQueues.massive.length
      + laneQueues.light.length
      + laneQueues.heavy.length
    );
    /**
     * Resolve current effective write concurrency with optional tail-rescue boost.
     *
     * @returns {number}
     */
    const getActiveWriteConcurrency = () => (
      forcedTailRescueConcurrency != null
        ? Math.max(
          forcedTailRescueConcurrency,
          adaptiveWriteConcurrencyEnabled
            ? writeConcurrencyController.getCurrentConcurrency()
            : writeConcurrency
        )
        : (
          adaptiveWriteConcurrencyEnabled
            ? writeConcurrencyController.getCurrentConcurrency()
            : writeConcurrency
        )
    );
    /**
     * Compute whether tail-rescue mode should be active for stalled tail writes.
     *
     * @returns {{active:boolean,remainingWrites:number,longestStallSec:number}}
     */
    const resolveTailRescueState = () => {
      const pendingWrites = pendingWriteCount();
      const remainingWrites = pendingWrites + activeCount;
      const longestStallSec = getLongestWriteStallSeconds();
      const active = writeTailRescueEnabled
        && remainingWrites > 0
        && remainingWrites <= writeTailRescueMaxPending
        && longestStallSec >= writeTailRescueStallSeconds;
      return {
        active,
        remainingWrites,
        longestStallSec
      };
    };
    /**
     * Update adaptive write concurrency controller from runtime signals.
     *
     * @returns {number}
     */
    const observeAdaptiveWriteConcurrency = () => {
      const rescueState = resolveTailRescueState();
      if (rescueState.active !== tailRescueActive) {
        tailRescueActive = rescueState.active;
        if (tailRescueActive) {
          logLine(
            `[perf] write tail rescue active: remaining=${rescueState.remainingWrites}, ` +
            `stall=${rescueState.longestStallSec}s, boost=+${writeTailRescueBoostIoTokens}io/+${writeTailRescueBoostMemTokens}mem`,
            { kind: 'warning' }
          );
        } else {
          logLine('[perf] write tail rescue cleared', { kind: 'status' });
        }
      }
      forcedTailRescueConcurrency = rescueState.active ? writeConcurrency : null;
      if (!adaptiveWriteConcurrencyEnabled) return getActiveWriteConcurrency();
      const schedulerStats = scheduler?.stats ? scheduler.stats() : null;
      const memorySignals = schedulerStats?.adaptive?.signals?.memory || null;
      return writeConcurrencyController.observe({
        pendingWrites: pendingWriteCount(),
        activeWrites: activeCount,
        longestStallSec: rescueState.longestStallSec,
        memoryPressure: Number(memorySignals?.pressureScore),
        gcPressure: Number(memorySignals?.gcPressureScore),
        rssUtilization: Number(memorySignals?.rssUtilization)
      });
    };
    /**
     * Compute per-lane concurrency budgets from work-class policy.
     *
     * @returns {{ultraLightConcurrency:number,massiveConcurrency:number,lightConcurrency:number,heavyConcurrency:number,workClass:object}}
     */
    const resolveLaneBudgets = () => {
      const ultraLightWritesTotal = laneQueues.ultraLight.length + laneActive.ultraLight;
      const lightWritesTotal = laneQueues.light.length + laneActive.light;
      const mediumWritesTotal = laneQueues.heavy.length + laneActive.heavy;
      const largeWritesTotal = laneQueues.massive.length + laneActive.massive;
      const workClass = resolveArtifactWorkClassConcurrency({
        writeConcurrency: getActiveWriteConcurrency(),
        smallWrites: ultraLightWritesTotal + lightWritesTotal,
        mediumWrites: mediumWritesTotal,
        largeWrites: largeWritesTotal,
        smallConcurrencyOverride: workClassSmallConcurrencyOverride,
        mediumConcurrencyOverride: workClassMediumConcurrencyOverride,
        largeConcurrencyOverride: workClassLargeConcurrencyOverride,
        hostConcurrency
      });
      const smallBudget = Math.max(0, workClass.smallConcurrency);
      let ultraLightConcurrency = 0;
      let lightConcurrency = 0;
      if (smallBudget > 0) {
        if (ultraLightWritesTotal > 0) {
          const ultraReserve = Math.max(1, Math.min(2, smallBudget));
          ultraLightConcurrency = Math.min(ultraLightWritesTotal, ultraReserve);
        }
        const remainingAfterUltra = Math.max(0, smallBudget - ultraLightConcurrency);
        lightConcurrency = Math.min(lightWritesTotal, remainingAfterUltra);
        let remainingAfterLight = Math.max(0, smallBudget - ultraLightConcurrency - lightConcurrency);
        if (remainingAfterLight > 0 && lightWritesTotal > lightConcurrency) {
          const growLight = Math.min(remainingAfterLight, lightWritesTotal - lightConcurrency);
          lightConcurrency += growLight;
          remainingAfterLight -= growLight;
        }
        if (remainingAfterLight > 0 && ultraLightWritesTotal > ultraLightConcurrency) {
          ultraLightConcurrency += Math.min(remainingAfterLight, ultraLightWritesTotal - ultraLightConcurrency);
        }
      }
      return {
        ultraLightConcurrency,
        massiveConcurrency: workClass.largeConcurrency,
        lightConcurrency,
        heavyConcurrency: workClass.mediumConcurrency,
        workClass
      };
    };
    /**
     * Select next lane eligible for dispatch under current budgets.
     *
     * @param {object} budgets
     * @returns {'ultraLight'|'massive'|'light'|'heavy'|null}
     */
    const pickDispatchLane = (budgets) => {
      const ultraLightAvailable = laneQueues.ultraLight.length > 0
        && laneActive.ultraLight < Math.max(0, budgets.ultraLightConcurrency);
      const massiveAvailable = laneQueues.massive.length > 0
        && laneActive.massive < Math.max(0, budgets.massiveConcurrency);
      const lightAvailable = laneQueues.light.length > 0
        && laneActive.light < Math.max(0, budgets.lightConcurrency);
      const heavyAvailable = laneQueues.heavy.length > 0
        && laneActive.heavy < Math.max(0, budgets.heavyConcurrency);
      if (ultraLightAvailable) return 'ultraLight';
      if (massiveAvailable) return 'massive';
      if (heavyAvailable) return 'heavy';
      if (lightAvailable) return 'light';
      return null;
    };
    /**
     * Dequeue one dispatch unit from a lane (or micro-batch for ultra-light).
     *
     * @param {'ultraLight'|'massive'|'light'|'heavy'} laneName
     * @returns {object[]}
     */
    const takeLaneDispatchEntries = (laneName) => {
      const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
      if (!queue || !queue.length) return [];
      if (laneName === 'ultraLight' && writeFsStrategy.microCoalescing) {
        const batch = selectMicroWriteBatch(queue, {
          maxEntries: writeFsStrategy.microBatchMaxCount,
          maxBytes: writeFsStrategy.microBatchMaxBytes,
          maxEntryBytes: ultraLightWriteThresholdBytes
        });
        return Array.isArray(batch?.entries) ? batch.entries.filter(Boolean) : [];
      }
      const entry = queue.shift();
      return entry ? [entry] : [];
    };
    /**
     * Resolve scheduler io/mem tokens for one write dispatch unit.
     *
     * @param {number} estimatedBytes
     * @param {string} laneName
     * @param {boolean} [rescueBoost=false]
     * @returns {{io:number,mem?:number}}
     */
    const resolveWriteSchedulerTokens = (estimatedBytes, laneName, rescueBoost = false) => {
      const memTokens = resolveArtifactWriteMemTokens(estimatedBytes);
      if (laneName === 'massive') {
        const massiveMem = Math.max(memTokens, massiveWriteMemTokens);
        const ioTokens = massiveWriteIoTokens + (rescueBoost ? writeTailRescueBoostIoTokens : 0);
        const memBudget = massiveMem + (rescueBoost ? writeTailRescueBoostMemTokens : 0);
        return memBudget > 0
          ? { io: ioTokens, mem: memBudget }
          : { io: ioTokens };
      }
      const ioTokens = 1 + (rescueBoost ? writeTailRescueBoostIoTokens : 0);
      const memBudget = memTokens + (rescueBoost ? writeTailRescueBoostMemTokens : 0);
      return memBudget > 0 ? { io: ioTokens, mem: memBudget } : { io: ioTokens };
    };
    /**
     * Schedule a write job through scheduler queue when available.
     *
     * @param {Function} fn
     * @param {{io:number,mem?:number}} tokens
     * @returns {Promise<unknown>|unknown}
     */
    const scheduleWriteJob = (fn, tokens) => {
      if (!scheduler?.schedule || typeof fn !== 'function') return fn();
      return scheduler.schedule(
        SCHEDULER_QUEUE_NAMES.stage2Write,
        tokens,
        fn
      );
    };
    const runSingleWrite = async (
      { label, job, estimatedBytes, enqueuedAt, prefetched, prefetchStartedAt },
      laneName,
      { rescueBoost = false, tailWorker = false, batchSize = 1, batchIndex = 0 } = {}
    ) => {
      const activeLabel = label || '(unnamed artifact)';
      const dispatchStartedAt = Date.now();
      const started = resolveWriteStartTimestampMs(prefetchStartedAt, dispatchStartedAt);
      const queueDelayMs = Math.max(0, started - (Number(enqueuedAt) || started));
      const startedConcurrency = getActiveWriteConcurrency();
      activeWrites.set(activeLabel, started);
      activeWriteBytes.set(activeLabel, Number.isFinite(estimatedBytes) ? estimatedBytes : 0);
      updateWriteInFlightTelemetry();
      try {
        const schedulerTokens = resolveWriteSchedulerTokens(estimatedBytes, laneName, rescueBoost);
        const writeResult = prefetched
          ? await prefetched
          : await scheduleWriteJob(job, schedulerTokens);
        const durationMs = Math.max(0, Date.now() - started);
        const serializationMs = Number.isFinite(Number(writeResult?.serializationMs))
          ? Math.max(0, Number(writeResult.serializationMs))
          : null;
        const diskMs = Number.isFinite(Number(writeResult?.diskMs))
          ? Math.max(0, Number(writeResult.diskMs))
          : (serializationMs != null ? Math.max(0, durationMs - serializationMs) : null);
        let bytes = null;
        if (Number.isFinite(Number(writeResult?.bytes))) {
          bytes = Number(writeResult.bytes);
        }
        if (!Number.isFinite(bytes) && label) {
          try {
            const stat = await fs.stat(path.join(outDir, label));
            bytes = stat.size;
          } catch {}
        }
        const throughputBytesPerSec = Number.isFinite(bytes) && durationMs > 0
          ? Math.round(bytes / (durationMs / 1000))
          : null;
        const latencyClass = resolveArtifactWriteLatencyClass({
          queueDelayMs,
          durationMs,
          bytes,
          estimatedBytes
        });
        recordArtifactMetric(label, {
          queueDelayMs,
          waitMs: queueDelayMs,
          durationMs,
          bytes,
          estimatedBytes: Number.isFinite(estimatedBytes) ? estimatedBytes : null,
          throughputBytesPerSec,
          serializationMs,
          diskMs,
          directFdStreaming: writeResult?.directFdStreaming === true,
          tailRescueBoosted: rescueBoost === true,
          tailWorker: tailWorker === true,
          batchSize: batchSize > 1 ? batchSize : null,
          batchIndex: batchSize > 1 ? batchIndex + 1 : null,
          latencyClass,
          fsStrategyMode: writeFsStrategy.mode,
          checksum: typeof writeResult?.checksum === 'string' ? writeResult.checksum : null,
          checksumAlgo: typeof writeResult?.checksumAlgo === 'string' ? writeResult.checksumAlgo : null,
          lane: laneName,
          schedulerIoTokens: schedulerTokens.io || 0,
          schedulerMemTokens: schedulerTokens.mem || 0,
          writeConcurrencyAtStart: startedConcurrency
        });
        updatePieceMetadata(label, {
          bytes,
          checksum: typeof writeResult?.checksum === 'string' ? writeResult.checksum : null,
          checksumAlgo: typeof writeResult?.checksumAlgo === 'string' ? writeResult.checksumAlgo : null,
          checksumHash: typeof writeResult?.checksumHash === 'string' ? writeResult.checksumHash : null
        });
      } finally {
        activeWrites.delete(activeLabel);
        activeWriteBytes.delete(activeLabel);
        updateWriteInFlightTelemetry();
        writeStallAlerts.delete(activeLabel);
        logWriteProgress(label);
      }
    };
    /**
     * Execute one dispatch batch serially while preserving per-entry telemetry.
     *
     * @param {object[]} entries
     * @param {string} laneName
     * @param {object} [options]
     * @returns {Promise<void>}
     */
    const runWriteBatch = async (entries, laneName, options = {}) => {
      const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
      if (!list.length) return;
      if (list.length === 1) {
        await runSingleWrite(list[0], laneName, options);
        return;
      }
      for (let index = 0; index < list.length; index += 1) {
        await runSingleWrite(list[index], laneName, {
          ...options,
          batchSize: list.length,
          batchIndex: index
        });
      }
    };
    /**
     * Drive lane dispatch loop until all writes settle or a fatal write error occurs.
     *
     * @returns {void}
     */
    const dispatchWrites = () => {
      observeAdaptiveWriteConcurrency();
      while (!fatalWriteError) {
        const activeConcurrency = getActiveWriteConcurrency();
        const remainingWrites = pendingWriteCount() + activeCount;
        const tailWorkerEligible = writeTailWorkerEnabled
          && tailWorkerActive < 1
          && remainingWrites > 0
          && remainingWrites <= writeTailWorkerMaxPending;
        const concurrencyLimit = activeConcurrency + (tailWorkerEligible ? 1 : 0);
        if (activeCount >= concurrencyLimit) break;
        const rescueState = resolveTailRescueState();
        const budgets = resolveLaneBudgets();
        let laneName = pickDispatchLane(budgets);
        let dispatchEntries = laneName ? takeLaneDispatchEntries(laneName) : [];
        let usedTailWorker = false;
        if (
          (!laneName || dispatchEntries.length === 0)
          && tailWorkerEligible
          && activeCount >= activeConcurrency
        ) {
          const tailSelection = selectTailWorkerWriteEntry(laneQueues, {
            laneOrder: ['massive', 'heavy', 'light', 'ultraLight']
          });
          if (tailSelection?.entry) {
            laneName = tailSelection.laneName;
            dispatchEntries = [tailSelection.entry];
            usedTailWorker = true;
          }
        }
        if (!laneName || dispatchEntries.length === 0) break;
        if (usedTailWorker) {
          tailWorkerActive += 1;
        } else {
          laneActive[laneName] += 1;
        }
        activeCount += 1;
        const tracked = runWriteBatch(
          dispatchEntries,
          laneName,
          {
            rescueBoost: rescueState.active && laneName !== 'ultraLight',
            tailWorker: usedTailWorker
          }
        )
          .then(() => ({ ok: true }))
          .catch((error) => ({ ok: false, error }))
          .finally(() => {
            if (usedTailWorker) {
              tailWorkerActive = Math.max(0, tailWorkerActive - 1);
            } else {
              laneActive[laneName] = Math.max(0, laneActive[laneName] - 1);
            }
            activeCount = Math.max(0, activeCount - 1);
          });
        inFlightWrites.add(tracked);
        tracked
          .finally(() => {
            inFlightWrites.delete(tracked);
          })
          .catch(() => {});
      }
    };
    startWriteHeartbeat();
    try {
      dispatchWrites();
      while (
        inFlightWrites.size > 0
        || laneQueues.ultraLight.length > 0
        || laneQueues.massive.length > 0
        || laneQueues.light.length > 0
        || laneQueues.heavy.length > 0
      ) {
        if (fatalWriteError) break;
        if (!inFlightWrites.size) {
          dispatchWrites();
          if (!inFlightWrites.size) break;
        }
        const settled = await Promise.race(inFlightWrites);
        if (!settled?.ok) {
          fatalWriteError = settled?.error || new Error('artifact write failed');
          break;
        }
        dispatchWrites();
      }
      if (fatalWriteError) {
        throw fatalWriteError;
      }
    } finally {
      stopWriteHeartbeat();
      activeWriteBytes.clear();
      updateWriteInFlightTelemetry();
    }
    logLine('', { kind: 'status' });
  } else {
    logLine('Writing index files (0 artifacts)...', { kind: 'status' });
    logLine('', { kind: 'status' });
  }
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
    if (typeof entry.checksum === 'string' && entry.checksum.includes(':')) {
      const [checksumAlgo, checksum] = entry.checksum.split(':');
      if (checksumAlgo && checksum) {
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
