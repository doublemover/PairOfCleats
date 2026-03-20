import os from 'node:os';
import fs from 'node:fs/promises';

import { coerceAbortSignal } from '../../../shared/abort.js';
import { resolveArtifactCompressionTier } from '../../../shared/artifact-io/compression.js';
import { coerceIntAtLeast, coerceNumberAtLeast } from '../../../shared/number-coerce.js';
import { resolveCompressionConfig } from '../artifacts/compression.js';
import { resolveTokenMode } from '../artifacts/token-mode.js';
import {
  INDEX_PROFILE_VECTOR_ONLY,
  normalizeIndexProfileId
} from '../../../contracts/index-profile.js';
import {
  resolveArtifactExclusivePublisherFamily,
  resolveArtifactWriteBytesInFlightLimit,
  resolveArtifactWriteFsStrategy,
  resolveArtifactWriteThroughputProfile
} from '../artifacts/write-strategy.js';

export const normalizeArtifactWriteInput = (input = {}) => {
  const {
    scheduler = null,
    abortSignal = null,
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

  return {
    scheduler,
    abortSignal,
    effectiveAbortSignal: coerceAbortSignal(abortSignal),
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
    telemetry,
    riskInterproceduralEmitArtifacts,
    repoProvenance,
    tinyRepoFastPath
  };
};

const normalizeTierArtifactList = (value) => (
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim())
    : []
);

const resolveWorkClassOverride = (...values) => {
  for (const candidate of values) {
    const parsed = coerceIntAtLeast(candidate, 1);
    if (parsed != null) return parsed;
  }
  return null;
};

export const pathExists = async (targetPath) => {
  if (!targetPath) return false;
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const resolveArtifactWriteRuntime = ({
  userConfig,
  indexState,
  state,
  fileCounts,
  perfProfile
} = {}) => {
  const indexingConfig = userConfig?.indexing || {};
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
    'risk_partial_flows',
    'call_sites',
    'graph_relations',
    'graph_relations_meta',
    'determinism_report',
    'extraction_report',
    'vocab_order'
  ];
  const tierHotArtifacts = normalizeTierArtifactList(compressionTierConfig.hotArtifacts);
  const tierColdArtifacts = normalizeTierArtifactList(compressionTierConfig.coldArtifacts);
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
  const resolveCompressionOverride = (base) => (
    tieredCompressionOverrides && Object.prototype.hasOwnProperty.call(tieredCompressionOverrides, base)
      ? tieredCompressionOverrides[base]
      : null
  );
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
  const tokenPostingsShardSize = coerceIntAtLeast(artifactConfig.tokenPostingsShardSize, 1000) ?? 50000;
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

  return {
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
    tokenPostingsShardSize,
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
    resolveCompressionOverride,
    resolveShardCompression
  };
};

export const createArtifactWriteExecutionState = ({
  artifactConfig,
  artifactWriteThroughputBytesPerSec,
  writeFsStrategy,
  mode
} = {}) => {
  let totalWrites = 0;
  let completedWrites = 0;
  let lastWriteLog = 0;
  let lastWriteLabel = '';
  const activeWrites = new Map();
  const activeWriteBytes = new Map();
  const activeWriteMeta = new Map();
  const hugeWriteState = {
    bytes: 0,
    families: new Set()
  };
  const artifactMetrics = new Map();
  const artifactQueueDelaySamples = new Map();
  const writeLogIntervalMs = 1000;
  const writeProgressMeta = { stage: 'write', mode, taskId: `write:${mode}:artifacts` };
  const configuredWriteStallThresholds = [];
  if (Array.isArray(artifactConfig.writeStallThresholdsSeconds)) {
    for (const entry of artifactConfig.writeStallThresholdsSeconds) {
      const numeric = Math.floor(Number(entry));
      if (Number.isFinite(numeric) && numeric > 0) {
        configuredWriteStallThresholds.push(numeric);
      }
    }
  }
  const legacyWarnThreshold = coerceIntAtLeast(artifactConfig.writeStallWarnSeconds, 1);
  const legacyCriticalThreshold = coerceIntAtLeast(artifactConfig.writeStallCriticalSeconds, 1);
  const writeStallThresholdsSet = new Set(
    configuredWriteStallThresholds.length
      ? configuredWriteStallThresholds
      : [10, 30, 60]
  );
  if (!configuredWriteStallThresholds.length && legacyWarnThreshold != null) {
    writeStallThresholdsSet.add(legacyWarnThreshold);
  }
  if (!configuredWriteStallThresholds.length && legacyCriticalThreshold != null) {
    writeStallThresholdsSet.add(legacyCriticalThreshold);
  }
  const normalizedWriteStallThresholds = Array.from(writeStallThresholdsSet).sort((a, b) => a - b);
  const heavyWriteThresholdBytes = coerceIntAtLeast(
    artifactConfig.writeHeavyThresholdBytes,
    1024 * 1024
  ) ?? (16 * 1024 * 1024);
  const forcedHeavyWritePatterns = Array.isArray(artifactConfig.writeHeavyLabelPatterns)
    ? artifactConfig.writeHeavyLabelPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : [
      /(^|\/)field_postings(?:\.|$)/,
      /(^|\/)token_postings(?:\.|$)/,
      /(^|\/)chunk_meta(?:\.|$)/
    ];
  const heavyWriteConcurrencyOverride = coerceIntAtLeast(artifactConfig.writeHeavyConcurrency, 1);
  const ultraLightWriteThresholdBytes = coerceIntAtLeast(
    artifactConfig.writeUltraLightThresholdBytes,
    1024
  ) ?? (64 * 1024);
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
  const massiveWriteThresholdBytes = coerceIntAtLeast(
    artifactConfig.writeMassiveThresholdBytes,
    8 * 1024 * 1024
  ) ?? (128 * 1024 * 1024);
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
  const massiveWriteIoTokens = coerceIntAtLeast(artifactConfig.writeMassiveIoTokens, 1) ?? 2;
  const massiveWriteMemTokens = coerceIntAtLeast(artifactConfig.writeMassiveMemTokens, 0) ?? 2;
  const hugeWriteInFlightBudgetBytes = coerceIntAtLeast(
    artifactConfig.writeHugeInFlightBudgetBytes,
    massiveWriteThresholdBytes
  ) ?? resolveArtifactWriteBytesInFlightLimit({
    throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
    writeConcurrency: typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (Array.isArray(os.cpus()) ? os.cpus().length : 1)
  });
  const hugeWriteFamilySerializationEnabled = artifactConfig.writeHugeFamilySerialization !== false;
  const resolveHugeWriteFamily = (label) => resolveArtifactExclusivePublisherFamily(label);
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
  const adaptiveWriteObserveIntervalMs = Number.isFinite(
    Number(artifactConfig.writeAdaptiveObserveIntervalMs)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.writeAdaptiveObserveIntervalMs)))
    : 1000;
  const adaptiveWriteQueuePendingThreshold = Number.isFinite(
    Number(artifactConfig.writeAdaptiveQueuePendingThreshold)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveQueuePendingThreshold)))
    : 1;
  const adaptiveWriteQueueOldestWaitMsThreshold = Number.isFinite(
    Number(artifactConfig.writeAdaptiveQueueOldestWaitMsThreshold)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveQueueOldestWaitMsThreshold)))
    : 1200;
  const adaptiveWriteQueueWaitP95MsThreshold = Number.isFinite(
    Number(artifactConfig.writeAdaptiveQueueWaitP95MsThreshold)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveQueueWaitP95MsThreshold)))
    : 750;
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

  return {
    totalWrites,
    setTotalWrites: (value) => {
      totalWrites = value;
    },
    getTotalWrites: () => totalWrites,
    completedWrites,
    setCompletedWrites: (value) => {
      completedWrites = value;
    },
    getCompletedWrites: () => completedWrites,
    getLastWriteLog: () => lastWriteLog,
    setLastWriteLog: (value) => {
      lastWriteLog = value;
    },
    getLastWriteLabel: () => lastWriteLabel,
    setLastWriteLabel: (value) => {
      lastWriteLabel = value;
    },
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
    heavyWriteConcurrencyOverride,
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
    writeTailWorkerMaxPending
  };
};
