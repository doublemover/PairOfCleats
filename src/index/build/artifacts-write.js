import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
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
  INDEX_PROFILE_VECTOR_ONLY,
  normalizeIndexProfileId
} from '../../contracts/index-profile.js';
import { resolveArtifactWriteConcurrency } from './artifacts/write-concurrency.js';
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
  createAdaptiveWriteConcurrencyController
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
 * Resolve write-lane concurrency for light/heavy artifact queues.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{heavyConcurrency:number,lightConcurrency:number}}
 */
const resolveArtifactLaneConcurrency = ({
  writeConcurrency,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  const availableHostConcurrency = Math.max(1, Math.floor(Number(hostConcurrency) || 1));
  const heavyOverride = Number(heavyWriteConcurrencyOverride);
  const dynamicHeavyTarget = Number.isFinite(heavyOverride) && heavyOverride > 0
    ? Math.max(1, Math.floor(heavyOverride))
    : (heavyWriteCount >= 8 && availableHostConcurrency >= 8
      ? Math.max(1, Math.ceil(totalWriteConcurrency * 0.66))
      : Math.max(1, Math.ceil(totalWriteConcurrency / 2)));

  const hasHeavy = heavyWriteCount > 0;
  const hasLight = lightWriteCount > 0;

  if (!hasHeavy && !hasLight) {
    return { heavyConcurrency: 0, lightConcurrency: 0 };
  }
  if (!hasHeavy) {
    return {
      heavyConcurrency: 0,
      lightConcurrency: Math.min(totalWriteConcurrency, lightWriteCount)
    };
  }
  if (!hasLight) {
    return {
      // Heavy-only queues should consume full writer concurrency; memory pressure
      // is already bounded by scheduler tokens and per-write mem costs.
      heavyConcurrency: Math.min(totalWriteConcurrency, heavyWriteCount),
      lightConcurrency: 0
    };
  }

  const heavySkewedBacklog = heavyWriteCount >= Math.max(4, lightWriteCount * 2);
  const lightReserveRatio = heavySkewedBacklog ? 0.2 : 0.33;
  const lightReserveFloor = heavySkewedBacklog ? 2 : 1;
  const lightReserveCap = Math.max(0, totalWriteConcurrency - 1);
  const effectiveLightReserveFloor = Math.min(lightReserveCap, lightReserveFloor);
  const lightReserve = lightReserveCap > 0
    ? Math.max(
      effectiveLightReserveFloor,
      Math.min(
        lightWriteCount,
        lightReserveCap,
        Math.ceil(totalWriteConcurrency * lightReserveRatio)
      )
    )
    : 0;
  const maxHeavyBudget = Math.max(1, totalWriteConcurrency - lightReserve);
  let heavyConcurrency = Math.max(
    1,
    Math.min(heavyWriteCount, dynamicHeavyTarget, maxHeavyBudget)
  );
  let lightConcurrencyBudget = Math.max(0, totalWriteConcurrency - heavyConcurrency);
  const minimumLightBudget = Math.min(lightWriteCount, lightReserve);
  if (lightConcurrencyBudget < minimumLightBudget && heavyConcurrency > 1) {
    const shift = Math.min(
      minimumLightBudget - lightConcurrencyBudget,
      heavyConcurrency - 1
    );
    heavyConcurrency -= shift;
    lightConcurrencyBudget += shift;
  }
  const lightConcurrency = Math.min(lightWriteCount, lightConcurrencyBudget);

  return {
    heavyConcurrency,
    lightConcurrency
  };
};

/**
 * Resolve write-lane concurrency when an ultra-light queue is present.
 *
 * Ultra-light artifacts reserve at least one slot (bounded) whenever mixed with
 * other lanes so tiny metadata writes never wait behind long heavy tails.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.ultraLightWrites
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{ultraLightConcurrency:number,lightConcurrency:number,heavyConcurrency:number}}
 */
const resolveArtifactLaneConcurrencyWithUltraLight = ({
  writeConcurrency,
  ultraLightWrites,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const ultraLightWriteCount = Math.max(0, Math.floor(Number(ultraLightWrites) || 0));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  if (!ultraLightWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: 0,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  if (!lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: Math.min(totalWriteConcurrency, ultraLightWriteCount),
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }

  const ultraLightReserveTarget = ultraLightWriteCount > 0
    ? Math.max(1, Math.min(2, Math.ceil(totalWriteConcurrency * 0.25)))
    : 0;
  const maxUltraReserve = Math.max(0, totalWriteConcurrency - 1);
  let ultraLightConcurrency = ultraLightWriteCount > 0
    ? Math.min(ultraLightWriteCount, ultraLightReserveTarget, maxUltraReserve)
    : 0;
  if (ultraLightWriteCount > 0 && ultraLightConcurrency < 1 && totalWriteConcurrency > 0) {
    ultraLightConcurrency = 1;
  }
  const remainingConcurrency = Math.max(0, totalWriteConcurrency - ultraLightConcurrency);
  if (remainingConcurrency <= 0) {
    return {
      ultraLightConcurrency,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  const base = resolveArtifactLaneConcurrency({
    writeConcurrency: remainingConcurrency,
    lightWrites: lightWriteCount,
    heavyWrites: heavyWriteCount,
    heavyWriteConcurrencyOverride,
    hostConcurrency
  });
  if (base.lightConcurrency === 0 && base.heavyConcurrency === 0 && ultraLightWriteCount > 0) {
    ultraLightConcurrency = Math.min(totalWriteConcurrency, ultraLightWriteCount);
  }
  return {
    ultraLightConcurrency,
    lightConcurrency: base.lightConcurrency,
    heavyConcurrency: base.heavyConcurrency
  };
};

const clampWriteConcurrency = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(1, Math.floor(Number(fallback) || 1));
  }
  return Math.max(1, Math.floor(parsed));
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
 * @param {() => number} [input.now]
 * @param {(event:{reason:string,from:number,to:number,pendingWrites:number,activeWrites:number,longestStallSec:number}) => void} [input.onChange]
 * @returns {{observe:(snapshot?:{pendingWrites?:number,activeWrites?:number,longestStallSec?:number})=>number,getCurrentConcurrency:()=>number,getLimits:()=>{min:number,max:number}}}
 */
const createAdaptiveWriteConcurrencyController = (input = {}) => {
  const maxConcurrency = clampWriteConcurrency(input.maxConcurrency, 1);
  const minConcurrency = Math.min(
    maxConcurrency,
    clampWriteConcurrency(input.minConcurrency, 1)
  );
  const initialFallback = Math.max(
    minConcurrency,
    Math.min(maxConcurrency, Math.ceil(maxConcurrency * 0.6))
  );
  let currentConcurrency = clampWriteConcurrency(input.initialConcurrency, initialFallback);
  currentConcurrency = Math.max(minConcurrency, Math.min(maxConcurrency, currentConcurrency));
  const scaleUpBacklogPerSlot = Number.isFinite(Number(input.scaleUpBacklogPerSlot))
    ? Math.max(1, Number(input.scaleUpBacklogPerSlot))
    : 1.75;
  const scaleDownBacklogPerSlot = Number.isFinite(Number(input.scaleDownBacklogPerSlot))
    ? Math.max(0, Number(input.scaleDownBacklogPerSlot))
    : 0.5;
  const stallScaleDownSeconds = Number.isFinite(Number(input.stallScaleDownSeconds))
    ? Math.max(1, Math.floor(Number(input.stallScaleDownSeconds)))
    : 20;
  const stallScaleUpGuardSeconds = Number.isFinite(Number(input.stallScaleUpGuardSeconds))
    ? Math.max(1, Math.floor(Number(input.stallScaleUpGuardSeconds)))
    : 8;
  const scaleUpCooldownMs = Number.isFinite(Number(input.scaleUpCooldownMs))
    ? Math.max(0, Math.floor(Number(input.scaleUpCooldownMs)))
    : 400;
  const scaleDownCooldownMs = Number.isFinite(Number(input.scaleDownCooldownMs))
    ? Math.max(0, Math.floor(Number(input.scaleDownCooldownMs)))
    : 1200;
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const onChange = typeof input.onChange === 'function' ? input.onChange : null;

  let lastScaleUpAt = Number.NEGATIVE_INFINITY;
  let lastScaleDownAt = Number.NEGATIVE_INFINITY;

  const emitChange = (reason, from, to, snapshot) => {
    if (!onChange || from === to) return;
    onChange({
      reason,
      from,
      to,
      pendingWrites: snapshot.pendingWrites,
      activeWrites: snapshot.activeWrites,
      longestStallSec: snapshot.longestStallSec
    });
  };

  const observe = (snapshot = {}) => {
    const pendingWrites = Math.max(0, Math.floor(Number(snapshot.pendingWrites) || 0));
    const activeWrites = Math.max(0, Math.floor(Number(snapshot.activeWrites) || 0));
    const longestStallSec = Number.isFinite(Number(snapshot.longestStallSec))
      ? Math.max(0, Number(snapshot.longestStallSec))
      : 0;
    const nowValue = now();
    const timestamp = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
    const backlogPerSlot = pendingWrites / Math.max(1, currentConcurrency);
    const from = currentConcurrency;

    const canScaleDown = currentConcurrency > minConcurrency
      && (timestamp - lastScaleDownAt) >= scaleDownCooldownMs;
    if (
      canScaleDown
      && pendingWrites > 0
      && longestStallSec >= stallScaleDownSeconds
      && backlogPerSlot <= Math.max(1, scaleUpBacklogPerSlot)
    ) {
      currentConcurrency -= 1;
      lastScaleDownAt = timestamp;
      emitChange('stall', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec
      });
      return currentConcurrency;
    }
    if (
      canScaleDown
      && pendingWrites <= 1
      && activeWrites < currentConcurrency
      && backlogPerSlot <= scaleDownBacklogPerSlot
    ) {
      currentConcurrency -= 1;
      lastScaleDownAt = timestamp;
      emitChange('drain', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec
      });
      return currentConcurrency;
    }

    const canScaleUp = currentConcurrency < maxConcurrency
      && (timestamp - lastScaleUpAt) >= scaleUpCooldownMs;
    if (
      canScaleUp
      && pendingWrites > 0
      && backlogPerSlot >= scaleUpBacklogPerSlot
      && longestStallSec <= stallScaleUpGuardSeconds
    ) {
      currentConcurrency += 1;
      lastScaleUpAt = timestamp;
      emitChange('backlog', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec
      });
    }
    return currentConcurrency;
  };

  return {
    observe,
    getCurrentConcurrency: () => currentConcurrency,
    getLimits: () => ({ min: minConcurrency, max: maxConcurrency })
  };
};

const LARGE_ARTIFACT_WRITE_BYTES = 256 * 1024 * 1024;
const HUGE_ARTIFACT_WRITE_BYTES = 768 * 1024 * 1024;
const ARTIFACT_QUEUE_DELAY_BUCKETS_MS = Object.freeze([
  0,
  1,
  2,
  4,
  8,
  16,
  32,
  64,
  128,
  256,
  512,
  1000,
  2000,
  5000,
  10000,
  30000,
  60000
]);
const VALIDATION_CRITICAL_ARTIFACT_PATTERNS = Object.freeze([
  /(^|\/)index_state\.json$/,
  /(^|\/)metrics\.json$/,
  /(^|\/)chunk_meta(?:\.|$)/,
  /(^|\/)file_meta(?:\.|$)/,
  /(^|\/)token_postings(?:\.|$)/,
  /(^|\/)field_postings(?:\.|$)/,
  /(^|\/)pieces\/manifest\.json$/
]);

/**
 * Estimate scheduler memory-token cost for a single artifact write.
 *
 * Small/medium writes are primarily IO-bound and should not be throttled by
 * memory tokens. Very large writes still consume explicit memory budget.
 *
 * @param {number|null|undefined} estimatedBytes
 * @returns {number}
 */
const resolveArtifactWriteMemTokens = (estimatedBytes) => {
  const bytes = Number(estimatedBytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  if (bytes >= HUGE_ARTIFACT_WRITE_BYTES) return 2;
  if (bytes >= LARGE_ARTIFACT_WRITE_BYTES) return 1;
  return 0;
};

const resolvePercentileMs = (samples, ratio) => {
  if (!Array.isArray(samples) || !samples.length) return 0;
  if (!Number.isFinite(ratio)) return samples[0];
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(clampedRatio * samples.length) - 1));
  return samples[index];
};

const summarizeQueueDelayHistogram = (samples) => {
  if (!Array.isArray(samples) || !samples.length) return null;
  const normalized = samples
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.round(entry))
    .sort((a, b) => a - b);
  if (!normalized.length) return null;
  const bucketCounts = new Array(ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length).fill(0);
  let overflowCount = 0;
  for (const value of normalized) {
    let bucketIndex = -1;
    for (let index = 0; index < ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length; index += 1) {
      if (value <= ARTIFACT_QUEUE_DELAY_BUCKETS_MS[index]) {
        bucketIndex = index;
        break;
      }
    }
    if (bucketIndex >= 0) bucketCounts[bucketIndex] += 1;
    else overflowCount += 1;
  }
  const buckets = [];
  for (let index = 0; index < ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length; index += 1) {
    const count = bucketCounts[index];
    if (!count) continue;
    buckets.push({
      leMs: ARTIFACT_QUEUE_DELAY_BUCKETS_MS[index],
      count
    });
  }
  return {
    unit: 'ms',
    sampleCount: normalized.length,
    minMs: normalized[0],
    maxMs: normalized[normalized.length - 1],
    p50Ms: resolvePercentileMs(normalized, 0.5),
    p95Ms: resolvePercentileMs(normalized, 0.95),
    buckets,
    overflowCount
  };
};

const isValidationCriticalArtifact = (label) => (
  typeof label === 'string' && VALIDATION_CRITICAL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(label))
);

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
    repoProvenance = null
  } = input;
  const orderingStage = indexState?.stage || 'stage2';
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
  const resolveCompressionOverride = (base) => (
    compressionOverrides && Object.prototype.hasOwnProperty.call(compressionOverrides, base)
      ? compressionOverrides[base]
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
  const artifactConfig = indexingConfig.artifacts || {};
  const artifactMode = typeof artifactConfig.mode === 'string'
    ? artifactConfig.mode.toLowerCase()
    : 'auto';
  const jsonArraySerializeShardThresholdMs = Number.isFinite(Number(artifactConfig.jsonArraySerializeShardThresholdMs))
    ? Math.max(0, Math.floor(Number(artifactConfig.jsonArraySerializeShardThresholdMs)))
    : 1500;
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
    : (8 * 1024 * 1024);
  const chunkMetaShardSize = Number.isFinite(Number(artifactConfig.chunkMetaShardSize))
    ? Math.max(0, Math.floor(Number(artifactConfig.chunkMetaShardSize)))
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
    : (8 * 1024 * 1024);
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
  const fieldPostingsShardsEnabled = artifactConfig.fieldPostingsShards === true;
  const fieldPostingsShardThresholdBytes = Number.isFinite(Number(artifactConfig.fieldPostingsShardThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldPostingsShardThresholdBytes)))
    : (64 * 1024 * 1024);
  const fieldPostingsShardCount = Number.isFinite(Number(artifactConfig.fieldPostingsShardCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.fieldPostingsShardCount)))
    : 8;
  const fieldPostingsKeepLegacyJson = artifactConfig.fieldPostingsKeepLegacyJson !== false;
  const minhashJsonLargeThreshold = Number.isFinite(Number(artifactConfig.minhashJsonLargeThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.minhashJsonLargeThreshold)))
    : 20000;
  const writeProgressHeartbeatMs = Number.isFinite(Number(artifactConfig.writeProgressHeartbeatMs))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeProgressHeartbeatMs)))
    : 15000;

  const maxJsonBytes = MAX_JSON_BYTES;
  const byteBudgetState = resolveByteBudgetMap({ indexingConfig, maxJsonBytes });
  const byteBudgetPolicies = byteBudgetState.policies || {};
  const resolveBudget = (name) => byteBudgetPolicies?.[name] || null;
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
    : Math.min(fileMetaMaxBytes, 8 * 1024 * 1024);
  const fileMetaShardedMaxBytes = Number.isFinite(Number(artifactConfig.fileMetaShardedMaxBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaShardedMaxBytes)))
    : Math.min(fileMetaMaxBytes, 8 * 1024 * 1024);
  const toolingConfig = getToolingConfig(root, userConfig);
  const vfsHashRouting = toolingConfig?.vfs?.hashRouting === true;
  // Keep file_meta fingerprint source deterministic: prefer discovery order when
  // available, otherwise fall back to sorted fileInfo keys.
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
  const recordCleanupAction = ({ targetPath, recursive = false, policy = 'legacy' }) => {
    if (!targetPath) return;
    cleanupActions.push({
      path: toPosix(path.relative(outDir, targetPath)),
      recursive: recursive === true,
      policy
    });
  };
  const removeArtifact = async (targetPath, options = {}) => {
    const { recursive = true, policy = 'legacy' } = options;
    try {
      if (fsSync.existsSync(targetPath)) {
        logLine(`[artifact-cleanup] remove ${targetPath}`, { kind: 'status' });
        recordCleanupAction({ targetPath, recursive, policy });
      }
      await fs.rm(targetPath, { recursive, force: true });
    } catch {}
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
  const writeStallAlerts = new Map();
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
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
  const pieceEntries = [];
  const addPieceFile = (entry, filePath) => {
    pieceEntries.push({ ...entry, path: formatArtifactLabel(filePath) });
  };
  addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, path.join(outDir, '.filelists.json'));
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
  const stopWriteHeartbeat = () => {
    if (!writeHeartbeatTimer) return;
    clearInterval(writeHeartbeatTimer);
    writeHeartbeatTimer = null;
  };
  const enqueueWrite = (label, job, meta = {}) => {
    const parsedPriority = Number(meta?.priority);
    const priority = Number.isFinite(parsedPriority) ? parsedPriority : 0;
    const parsedEstimatedBytes = Number(meta?.estimatedBytes);
    const estimatedBytes = Number.isFinite(parsedEstimatedBytes) && parsedEstimatedBytes >= 0
      ? parsedEstimatedBytes
      : null;
    writes.push({
      label,
      priority,
      estimatedBytes,
      seq: enqueueSeq,
      enqueuedAt: Date.now(),
      job
    });
    enqueueSeq += 1;
  };
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
  const splitWriteLanes = (entries) => {
    const ordered = scheduleWrites(entries);
    const lanes = { ultraLight: [], light: [], heavy: [] };
    for (const entry of ordered) {
      const estimated = Number(entry?.estimatedBytes);
      const label = typeof entry?.label === 'string' ? entry.label : '';
      const isForcedHeavy = forcedHeavyWritePatterns.some((pattern) => pattern.test(label));
      const isForcedUltraLight = forcedUltraLightWritePatterns.some((pattern) => pattern.test(label));
      const isHeavyBySize = Number.isFinite(estimated) && estimated >= heavyWriteThresholdBytes;
      const isHeavy = isForcedHeavy || isHeavyBySize;
      const isUltraLightBySize = Number.isFinite(estimated)
        && estimated > 0
        && estimated <= ultraLightWriteThresholdBytes;
      if (isHeavy) {
        lanes.heavy.push(entry);
      } else if (isForcedUltraLight || isUltraLightBySize) {
        lanes.ultraLight.push(entry);
      } else {
        lanes.light.push(entry);
      }
    }
    return lanes;
  };
  if (mode === 'extracted-prose' && documentExtractionEnabled) {
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
  const lexiconRelationFilterReport = buildLexiconRelationFilterReport({ state, mode });
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
  const boilerplateCatalog = buildBoilerplateCatalog(state?.chunks);
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
    compressionOverrides,
    jsonArraySerializeShardThresholdMs,
    jsonArraySerializeShardMaxBytes
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
    addPieceFile(filterIndexFallback.piece, filterIndexFallback.path);
  }
  const minhashFromPostings = Array.isArray(postings.minhashSigs) && postings.minhashSigs.length
    ? postings.minhashSigs
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
    enqueueJsonObject('minhash_signatures', { arrays: { signatures: minhashIterable } }, {
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
            checksum: packedChecksum.hash
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
    const fieldPostingsRows = Object.entries(fieldPostingsObject).map(([field, value]) => ({
      field,
      postings: value
    }));
    const shouldShardFieldPostings = fieldPostingsShardsEnabled
      && fieldPostingsShardThresholdBytes > 0
      && fieldPostingsEstimatedBytes >= fieldPostingsShardThresholdBytes
      && fieldPostingsRows.length > fieldPostingsShardCount;
    if (shouldShardFieldPostings) {
      const shardsDirPath = path.join(outDir, 'field_postings.shards');
      const shardsMetaPath = path.join(outDir, 'field_postings.shards.meta.json');
      await removeArtifact(shardsDirPath, { recursive: true, policy: 'format_cleanup' });
      await fs.mkdir(shardsDirPath, { recursive: true });
      const shardSize = Math.max(1, Math.ceil(fieldPostingsRows.length / fieldPostingsShardCount));
      const partFiles = [];
      for (let shardIndex = 0; shardIndex < fieldPostingsShardCount; shardIndex += 1) {
        const start = shardIndex * shardSize;
        const end = Math.min(fieldPostingsRows.length, start + shardSize);
        if (start >= end) break;
        const rows = fieldPostingsRows.slice(start, end);
        const relPath = `field_postings.shards/field_postings.part-${String(shardIndex).padStart(4, '0')}.json`;
        const absPath = path.join(outDir, relPath);
        partFiles.push({ relPath, count: rows.length, absPath, rows });
      }
      const partEstimatedBytes = Math.max(
        1,
        Math.floor(fieldPostingsEstimatedBytes / Math.max(1, partFiles.length))
      );
      for (const part of partFiles) {
        enqueueWrite(
          part.relPath,
          async () => {
            const fields = {};
            for (const row of part.rows) fields[row.field] = row.postings;
            await writeJsonObjectFile(part.absPath, {
              fields: { fields },
              atomic: true
            });
          },
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
              fields: fieldPostingsRows.length,
              parts: partFiles.map((part) => ({
                path: part.relPath,
                fields: part.count
              }))
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
          `emitting auxiliary shards (${fieldPostingsShardCount} target).`
        );
      }
      if (!fieldPostingsKeepLegacyJson && typeof log === 'function') {
        log(
          '[warn] fieldPostingsKeepLegacyJson=false ignored while shard readers are unavailable; ' +
          'emitting field_postings.json for compatibility.'
        );
      }
    }
    enqueueJsonObject('field_postings', { fields: { fields: fieldPostingsObject } }, {
      piece: { type: 'postings', name: 'field_postings' },
      priority: 220,
      estimatedBytes: fieldPostingsEstimatedBytes
    });
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
    light: lightWrites,
    heavy: heavyWrites
  } = splitWriteLanes(writes);
  totalWrites = ultraLightWrites.length + lightWrites.length + heavyWrites.length;
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
      onChange: ({ reason, from, to, pendingWrites, longestStallSec }) => {
        const stallSuffix = longestStallSec > 0 ? `, stall=${longestStallSec}s` : '';
        logLine(
          `[perf] adaptive artifact write concurrency ${from} -> ${to} (${reason}, pending=${pendingWrites}${stallSuffix})`,
          { kind: 'status' }
        );
      }
    });
    const hostConcurrency = typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (Array.isArray(os.cpus()) ? os.cpus().length : 1);
    const laneQueues = {
      ultraLight: ultraLightWrites.slice(),
      light: lightWrites.slice(),
      heavy: heavyWrites.slice()
    };
    const laneActive = {
      ultraLight: 0,
      light: 0,
      heavy: 0
    };
    let activeCount = 0;
    let laneTurn = 'heavy';
    let fatalWriteError = null;
    const inFlightWrites = new Set();
    const getActiveWriteConcurrency = () => (
      adaptiveWriteConcurrencyEnabled
        ? writeConcurrencyController.getCurrentConcurrency()
        : writeConcurrency
    );
    const observeAdaptiveWriteConcurrency = () => {
      if (!adaptiveWriteConcurrencyEnabled) return getActiveWriteConcurrency();
      return writeConcurrencyController.observe({
        pendingWrites: laneQueues.ultraLight.length + laneQueues.light.length + laneQueues.heavy.length,
        activeWrites: activeCount,
        longestStallSec: getLongestWriteStallSeconds()
      });
    };
    const resolveLaneBudgets = () => resolveArtifactLaneConcurrencyWithUltraLight({
      writeConcurrency: getActiveWriteConcurrency(),
      ultraLightWrites: laneQueues.ultraLight.length + laneActive.ultraLight,
      lightWrites: laneQueues.light.length + laneActive.light,
      heavyWrites: laneQueues.heavy.length + laneActive.heavy,
      heavyWriteConcurrencyOverride,
      hostConcurrency
    });
    const pickDispatchLane = (budgets) => {
      const ultraLightAvailable = laneQueues.ultraLight.length > 0
        && laneActive.ultraLight < Math.max(0, budgets.ultraLightConcurrency);
      const lightAvailable = laneQueues.light.length > 0
        && laneActive.light < Math.max(0, budgets.lightConcurrency);
      const heavyAvailable = laneQueues.heavy.length > 0
        && laneActive.heavy < Math.max(0, budgets.heavyConcurrency);
      if (ultraLightAvailable) return 'ultraLight';
      if (!lightAvailable && !heavyAvailable) return null;
      if (lightAvailable && !heavyAvailable) return 'light';
      if (heavyAvailable && !lightAvailable) return 'heavy';
      laneTurn = laneTurn === 'light' ? 'heavy' : 'light';
      return laneTurn;
    };
    const scheduleWriteJob = (fn, estimatedBytes) => {
      if (!scheduler?.schedule || typeof fn !== 'function') return fn();
      const memTokens = resolveArtifactWriteMemTokens(estimatedBytes);
      const tokens = memTokens > 0
        ? { io: 1, mem: memTokens }
        : { io: 1 };
      return scheduler.schedule(
        SCHEDULER_QUEUE_NAMES.stage2Write,
        tokens,
        fn
      );
    };
    const runSingleWrite = async ({ label, job, estimatedBytes, enqueuedAt }, laneName) => {
      const activeLabel = label || '(unnamed artifact)';
      const started = Date.now();
      const queueDelayMs = Math.max(0, started - (Number(enqueuedAt) || started));
      const startedConcurrency = getActiveWriteConcurrency();
      activeWrites.set(activeLabel, started);
      activeWriteBytes.set(activeLabel, Number.isFinite(estimatedBytes) ? estimatedBytes : 0);
      updateWriteInFlightTelemetry();
      try {
        await scheduleWriteJob(job, estimatedBytes);
        const durationMs = Date.now() - started;
        let bytes = null;
        if (label) {
          try {
            const stat = await fs.stat(path.join(outDir, label));
            bytes = stat.size;
          } catch {}
        }
        const throughputBytesPerSec = Number.isFinite(bytes) && durationMs > 0
          ? Math.round(bytes / (durationMs / 1000))
          : null;
        recordArtifactMetric(label, {
          queueDelayMs,
          waitMs: queueDelayMs,
          durationMs,
          bytes,
          estimatedBytes: Number.isFinite(estimatedBytes) ? estimatedBytes : null,
          throughputBytesPerSec,
          lane: laneName,
          writeConcurrencyAtStart: startedConcurrency
        });
      } finally {
        activeWrites.delete(activeLabel);
        activeWriteBytes.delete(activeLabel);
        updateWriteInFlightTelemetry();
        writeStallAlerts.delete(activeLabel);
        logWriteProgress(label);
      }
    };
    const dispatchWrites = () => {
      observeAdaptiveWriteConcurrency();
      while (!fatalWriteError) {
        const activeConcurrency = getActiveWriteConcurrency();
        if (activeCount >= activeConcurrency) break;
        const budgets = resolveLaneBudgets();
        const laneName = pickDispatchLane(budgets);
        if (!laneName) break;
        const entry = laneQueues[laneName].shift();
        if (!entry) continue;
        laneActive[laneName] += 1;
        activeCount += 1;
        const tracked = runSingleWrite(entry, laneName)
          .then(() => ({ ok: true }))
          .catch((error) => ({ ok: false, error }))
          .finally(() => {
            laneActive[laneName] = Math.max(0, laneActive[laneName] - 1);
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
    artifactMetrics.set(entry.path, metric);
  }
  if (timing) {
    timing.cleanup = {
      profileId,
      actions: cleanupActions
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
