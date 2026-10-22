import { resolveEmbeddingsBatchTokenBudget } from '../../../src/shared/embedding-batch.js';
import { digestBundleMappingInventory, observeBundleCoverageFiles, checkBundleCoverageReceipt,
  createBundleCoverageReceipt } from './runner/bundle-coverage-receipt.js';
import { encodeIncrementalManifest, INCREMENTAL_MANIFEST_MAX_BYTES } from '../../../src/index/build/incremental/manifest-codec.js';
import { readEffectiveMemory, estimateRetainedBytes } from '../../../src/shared/effective-memory.js';
import { throwIfAborted, isAbortError } from '../../../src/shared/abort.js';
import { canonicalBundleSourceKey } from '../../../src/shared/bundle-source-key.js';
import { reusePriorChunkVectors } from './prior-chunk-reuse.js';
import { reuseNativeBackend } from './backend-reuse.js';
import { loadPiecesManifest } from '../../../src/shared/artifact-io/manifest.js';
import { readIncrementalBundleSnapshot, writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { embeddingArtifactReusable } from '../../../src/shared/embedding-artifact-identity.js';
import { resolveEmbeddingArtifactIdentityAsync } from '../../../src/shared/embedding-artifact-lease.js';
import { createStage3RuntimeReceipts } from './runtime-receipt.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbedder } from '../../../src/index/embedding.js';
import { resolveEmbeddingModelProfile, validateEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../../src/index/build/build-state.js';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { loadIncrementalManifest, writeIncrementalManifest } from '../../../src/storage/sqlite/incremental.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import {
  loadChunkMetaRows,
  loadFileMetaRows
} from '../../../src/shared/artifact-io/loaders.js';
import { readTextFile, readTextFileWithHash } from '../../../src/shared/encoding.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { createCrashEvidenceOwner } from '../../../src/index/build/crash-evidence.js';
import { resolveHnswPaths, resolveHnswTarget } from '../../../src/shared/hnsw.js';
import { normalizeLanceDbConfig, resolveLanceDbTarget } from '../../../src/shared/lancedb.js';
import { DEFAULT_STUB_DIMS, resolveStubDims } from '../../../src/shared/embedding.js';
import { sha1 } from '../../../src/shared/hash.js';
import {
  countNonEmptyVectors,
  clampQuantizedVectorsInPlace,
  isNonEmptyVector,
  isVectorLike
} from '../../../src/shared/embedding-utils.js';
import { resolveEmbeddingInputFormatting } from '../../../src/shared/embedding-input-format.js';
import { resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings.js';
import { fromPosix, isPathWithinRoot, toPosix } from '../../../src/shared/file-paths.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { isTestingEnv } from '../../../src/shared/env/testing.js';
import { createLruCache } from '../../../src/shared/cache/lru.js';
import { normalizeDenseVectorMode } from '../../../src/shared/dense-vector-mode.js';
import { createEmbeddingFileAdmission, resolveEmbeddingFdCap } from './file-admission.js';
import { createEmbeddingWriterAdmission } from './writer-admission.js';
import { createEmbeddingWorkEstimate } from './work-estimate.js';
import { formatEmbeddingsPerfLine } from './perf-progress.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { runWithConcurrency } from '../../../src/shared/concurrency/run-with-queue.js';
import { coercePositiveIntMinOne } from '../../../src/shared/number-coerce.js';
import { resolveFdConcurrencyCap } from '../../../src/index/build/workers/config.js';
import { formatEtaSeconds } from '../../../src/shared/perf/eta.js';
import {
  normalizeBundleFormat,
  resolveManifestBundleNames
} from '../../../src/shared/bundle-io-paths.js';
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
  encodeCacheEntryPayload,
  isCacheValid,
  isGlobalChunkCacheValid,
  readCacheIndex,
  readCacheMeta,
  createCacheBatchReader,
  readCacheEntries,
  writeReferencedCacheFile,
  withEmbeddingCacheReadLock,
  flushCacheIndex,
  resolveCacheDir,
  resolveLegacyCacheDir,
  resolveCacheRoot,
  resolveGlobalChunkCacheDir,
  shouldFastRejectCacheLookup,
  updateCacheIndexAccess,
  writeCacheMeta
} from './cache.js';
import { flushCacheIndexIfNeeded } from './cache-flush.js';
import { buildReferencedFileCache, hydrateReferencedFileCache } from './cache/file-references.js';
import { buildChunkSignature, buildChunksFromBundles } from './chunks.js';
import {
  assertVectorArrays,
  buildQuantizedVectors,
  createDimsValidator,
  ensureVectorArrays,
  fillMissingVectors,
  isDimsMismatch,
  runBatched,
  validateCachedDims
} from './embed.js';
import { writeHnswBackends, writeLanceDbBackends } from './backends.js';
import { updatePieceManifest } from './manifest.js';
import { publishEmbeddingGeneration } from './publication.js';
import { publishBackendGeneration } from './backend-publication.js';
import { buildEmbeddingGeneration } from '../../../src/shared/embedding-generation.js';
import { createFileEmbeddingsProcessor } from './pipeline.js';
import { createEmbeddingsScheduler } from './scheduler.js';
import { createBoundedWriterQueue } from './writer-queue.js';
import { runSqliteDenseWithBoundary } from './sqlite-dense-isolate.js';
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
  deriveEmbeddingsAutoTuneRecommendation,
  writeEmbeddingsAutoTuneRecommendation
} from './autotune-profile.js';
import { sortEntriesByOrderIndex } from '../../../src/index/build/indexer/steps/process-files/ordering.js';
import { summarizeBundleEmbeddingCoverage, stampBundleEmbeddingCoverage } from './runner/bundle-coverage.js';
import {
  createIncrementalChunkMappingIndex,
  createMappingFailureReasons,
  formatMappingFailureReasons,
  hasVectorPayload,
  recordMappingFailureReason,
  resolveBundleChunkVectorIndex,
  resolveChunkFileMapping,
  toChunkIndex,
  toUint8Vector,
  vectorsEqual
} from './runner/mapping.js';

const EMBEDDINGS_TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPACT_SQLITE_SCRIPT = path.join(EMBEDDINGS_TOOLS_DIR, '..', 'compact-sqlite-index.js');
const DEFAULT_EMBEDDINGS_CHUNK_META_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_EMBEDDINGS_PROGRESS_HEARTBEAT_MS = 1500;
const DEFAULT_EMBEDDINGS_FILE_PARALLELISM = 2;
const DEFAULT_EMBEDDINGS_BUNDLE_REFRESH_PARALLELISM = 2;
const DEFAULT_EMBEDDINGS_BUNDLE_REFRESH_MAX_PARALLELISM = 16;
const DEFAULT_EMBEDDINGS_CHUNK_META_RETRY_CEILING_BYTES = 1024 * 1024 * 1024;
const DEFAULT_EMBEDDINGS_CROSS_FILE_CHUNK_DEDUPE_MAX_ENTRIES = 200000;
const DEFAULT_EMBEDDINGS_SOURCE_HASH_CACHE_MAX_ENTRIES = 200000;
const DEFAULT_EMBEDDINGS_TEXT_REUSE_CACHE_ENTRIES = 50000;
const DEFAULT_EMBEDDINGS_TEXT_REUSE_MAX_TEXT_CHARS = 32768;
const DEFAULT_EMBEDDINGS_IN_FLIGHT_CLAIMS_MAX_ENTRIES = 200000;
const DEFAULT_EMBEDDINGS_SQLITE_DENSE_WRITE_BATCH_SIZE = 256;
const DEFAULT_EMBEDDINGS_ADAPTIVE_PARALLELISM_MULTIPLIER = 2;
const CHUNK_META_TOO_LARGE_BYTES_PATTERN = /\((\d+)\s*>\s*(\d+)\)/;

/**
 * @typedef {object} RefreshIncrementalBundlesResult
 * @property {number} attempted
 * @property {number} eligible
 * @property {number} rewritten
 * @property {number} covered
 * @property {number} scanned
 * @property {number} skippedNoMapping
 * @property {number} skippedNoMappingChunks
 * @property {{boundaryMismatch:number,missingParent:number,parserOmission:number}} mappingFailureReasons
 * @property {number} skippedInvalidBundle
 * @property {number} skippedEmptyBundle
 * @property {number} lowYieldBailoutSkipped
 * @property {object|null} lowYieldBailout
 * @property {boolean} manifestWritten
 * @property {boolean} completeCoverage
 * @property {object} coverage Counts for examined, unexamined and invalid manifest bundles.
 */
/**
 * Resolve max chunk-meta payload size used when loading chunk metadata for
 * embeddings generation.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
const resolveEmbeddingsChunkMetaMaxBytes = (indexingConfig) => {
  const configured = Number(indexingConfig?.embeddings?.chunkMetaMaxBytes);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(MAX_JSON_BYTES, Math.floor(configured));
  }
  return Math.max(MAX_JSON_BYTES, DEFAULT_EMBEDDINGS_CHUNK_META_MAX_BYTES);
};

/**
 * Resolve progress heartbeat interval for stage-3 progress reporting.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
const resolveEmbeddingsProgressHeartbeatMs = (indexingConfig) => {
  const configured = Number(indexingConfig?.embeddings?.progressHeartbeatMs);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1000, Math.floor(configured));
  }
  return DEFAULT_EMBEDDINGS_PROGRESS_HEARTBEAT_MS;
};

/**
 * Resolve per-file embedding compute concurrency.
 *
 * HNSW is built after vector fill in chunk-ID order; compute uses scheduler caps.
 *
 * @param {{
 *   indexingConfig:object,
 *   computeTokensTotal:number|null,
 *   cpuConcurrency?:number|null,
 *   fdConcurrencyCap?:number|null,
 * }} input
 * @returns {number}
 */
export const resolveEmbeddingsFileParallelism = ({
  indexingConfig,
  computeTokensTotal,
  cpuConcurrency = null,
  fdConcurrencyCap = null
}) => {
  const cpuCap = coercePositiveIntMinOne(cpuConcurrency);
  const configured = coercePositiveIntMinOne(indexingConfig?.embeddings?.fileParallelism);
  const tokenDriven = coercePositiveIntMinOne(computeTokensTotal);
  let resolved = configured || tokenDriven || cpuCap || DEFAULT_EMBEDDINGS_FILE_PARALLELISM;
  if (cpuCap) resolved = Math.min(resolved, cpuCap);
  const fileDescriptorCap = coercePositiveIntMinOne(fdConcurrencyCap);
  if (fileDescriptorCap) resolved = Math.min(resolved, fileDescriptorCap);
  return Math.max(1, resolved);
};

/**
 * Resolve adaptive file-level parallelism ceiling.
 *
 * The adaptive loop can increase or decrease instantaneous concurrency but
 * must never exceed hard scheduler/runtime limits.
 *
 * @param {{
 *   baseFileParallelism:number,
 *   maxMultiplier?:number,
 *   computeTokensTotal?:number|null,
 *   cpuConcurrency?:number|null,
 *   fdConcurrencyCap?:number|null
 * }} input
 * @returns {number}
 */
export const resolveEmbeddingsAdaptiveFileParallelismCeiling = ({
  baseFileParallelism,
  maxMultiplier = DEFAULT_EMBEDDINGS_ADAPTIVE_PARALLELISM_MULTIPLIER,
  computeTokensTotal = null,
  cpuConcurrency = null,
  fdConcurrencyCap = null
} = {}) => {
  const base = coercePositiveIntMinOne(baseFileParallelism) || 1;
  const multiplier = Number.isFinite(Number(maxMultiplier))
    ? Math.max(1, Math.floor(Number(maxMultiplier)))
    : DEFAULT_EMBEDDINGS_ADAPTIVE_PARALLELISM_MULTIPLIER;
  let ceiling = Math.max(base, base * multiplier);
  const tokenCap = coercePositiveIntMinOne(computeTokensTotal);
  if (tokenCap) ceiling = Math.min(ceiling, tokenCap);
  const cpuCap = coercePositiveIntMinOne(cpuConcurrency);
  if (cpuCap) ceiling = Math.min(ceiling, cpuCap);
  const fileDescriptorCap = coercePositiveIntMinOne(fdConcurrencyCap);
  if (fileDescriptorCap) ceiling = Math.min(ceiling, fileDescriptorCap);
  return Math.max(base, ceiling);
};

/**
 * Resolve persistent embeddings text-cache vector encoding.
 *
 * @param {object} indexingConfig
 * @returns {'float32'|'float16'}
 */
export const resolveEmbeddingsPersistentTextCacheVectorEncoding = (indexingConfig) => {
  const value = typeof indexingConfig?.embeddings?.persistentTextCacheVectorEncoding === 'string'
    ? indexingConfig.embeddings.persistentTextCacheVectorEncoding.trim().toLowerCase()
    : '';
  if (value === 'float16' || value === 'fp16') return 'float16';
  if (value === 'float32' || value === 'fp32') return 'float32';
  return 'float32';
};

/**
 * Resolve approximate characters-per-token ratio used for embedding token estimates.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveEmbeddingsCharsPerToken = (indexingConfig) => {
  const parsed = Number(indexingConfig?.embeddings?.charsPerToken);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, parsed);
  }
  return 4;
};

/**
 * Resolve embedding token budget per batch.
 *
 * Precedence:
 * 1) `indexing.embeddings.maxBatchTokens` when explicitly configured
 * 2) derived from `embeddingBatchSize * indexing.embeddings.batchTokenMultiplier`
 * 3) default multiplier of 256 tokens per item
 *
 * @param {{indexingConfig?:object,embeddingBatchSize?:number}} [input]
 * @returns {number}
 */
export { resolveEmbeddingsBatchTokenBudget };

/**
 * Resolve max entries for cross-file chunk dedupe map.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveCrossFileChunkDedupeMaxEntries = (indexingConfig) => (
  coercePositiveIntMinOne(indexingConfig?.embeddings?.crossFileChunkDedupeMaxEntries)
  || DEFAULT_EMBEDDINGS_CROSS_FILE_CHUNK_DEDUPE_MAX_ENTRIES
);

/**
 * Resolve max entries for source-hash cache.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveEmbeddingsSourceHashCacheMaxEntries = (indexingConfig) => (
  coercePositiveIntMinOne(indexingConfig?.embeddings?.sourceHashCacheMaxEntries)
  || DEFAULT_EMBEDDINGS_SOURCE_HASH_CACHE_MAX_ENTRIES
);

/**
 * Resolve in-memory embedding text reuse cache entry cap.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveEmbeddingsTextReuseCacheEntries = (indexingConfig) => (
  coercePositiveIntMinOne(indexingConfig?.embeddings?.textReuseCacheEntries)
  || DEFAULT_EMBEDDINGS_TEXT_REUSE_CACHE_ENTRIES
);

/**
 * Resolve maximum cacheable text length for embedding text reuse.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveEmbeddingsTextReuseMaxTextChars = (indexingConfig) => (
  coercePositiveIntMinOne(indexingConfig?.embeddings?.textReuseMaxTextChars)
  || DEFAULT_EMBEDDINGS_TEXT_REUSE_MAX_TEXT_CHARS
);

/**
 * Resolve sqlite dense-vector write batch size.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveEmbeddingsSqliteDenseWriteBatchSize = (indexingConfig) => (
  coercePositiveIntMinOne(indexingConfig?.embeddings?.sqliteDenseWriteBatchSize)
  || DEFAULT_EMBEDDINGS_SQLITE_DENSE_WRITE_BATCH_SIZE
);

/**
 * Build in-memory text->vector cache used by global micro-batching.
 *
 * @param {{maxEntries?:number,maxTextChars?:number,persistentStore?:object|null}} [input]
 * @returns {{
 *   get:(text:string)=>ArrayLike<number>|null,
 *   set:(text:string,vector:ArrayLike<number>)=>void,
 *   canCache:(text:string)=>boolean,
 *   size:()=>number,
 *   clear:()=>void
 * }}
 */
export const createEmbeddingTextReuseCache = ({
  maxEntries = DEFAULT_EMBEDDINGS_TEXT_REUSE_CACHE_ENTRIES,
  maxTextChars = DEFAULT_EMBEDDINGS_TEXT_REUSE_MAX_TEXT_CHARS,
  persistentStore = null,
  maxBytes = 64 * 1024 * 1024
} = {}) => {
  const cache = new Map();
  const sizes = new Map();
  let retainedBytes = 0;
  const byteCap = Math.max(1, Math.floor(Number(maxBytes) || 64 * 1024 * 1024));
  const cap = Math.max(1, coercePositiveIntMinOne(maxEntries) || DEFAULT_EMBEDDINGS_TEXT_REUSE_CACHE_ENTRIES);
  const maxChars = Math.max(
    1,
    coercePositiveIntMinOne(maxTextChars) || DEFAULT_EMBEDDINGS_TEXT_REUSE_MAX_TEXT_CHARS
  );
  const canCache = (text) => typeof text === 'string' && text.length > 0 && text.length <= maxChars;
  const promote = (text, value) => {
    if (cache.has(text)) retainedBytes -= sizes.get(text) || 0;
    cache.delete(text); sizes.delete(text);
    const bytes = estimateRetainedBytes(text) + estimateRetainedBytes(value) + 48;
    if (bytes > byteCap) return;
    cache.set(text, value); sizes.set(text, bytes); retainedBytes += bytes;
    while (cache.size > cap || retainedBytes > byteCap) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey == null) break;
      retainedBytes -= sizes.get(oldestKey) || 0;
      sizes.delete(oldestKey); cache.delete(oldestKey);
    }
  };
  return {
    get(text) {
      if (!canCache(text)) return null;
      if (cache.has(text)) {
        const value = cache.get(text) || null;
        if (value) promote(text, value);
        return value;
      }
      const persistentGet = typeof persistentStore?.get === 'function'
        ? persistentStore.get.bind(persistentStore)
        : null;
      if (!persistentGet) return null;
      const value = persistentGet(text);
      if (value) promote(text, value);
      return value || null;
    },
    set(text, vector) {
      if (!canCache(text)) return;
      if (!isVectorLike(vector) || vector.length <= 0) return;
      promote(text, vector);
      if (typeof persistentStore?.set === 'function') {
        try {
          persistentStore.set(text, vector);
        } catch {}
      }
    },
    promote(text, vector) {
      if (canCache(text) && isVectorLike(vector) && vector.length > 0) promote(text, vector);
    },
    canCache,
    size: () => cache.size,
    stats: () => ({ entries: cache.size, retainedBytes, maxBytes: byteCap, method: 'estimated-string-vector-map-storage' }),
    clear() {
      cache.clear(); sizes.clear(); retainedBytes = 0;
      if (typeof persistentStore?.clear === 'function') {
        try {
          persistentStore.clear();
        } catch {}
      }
    }
  };
};

/**
 * Create in-flight claim map so concurrent requests for identical payloads
 * join one embedding compute call.
 *
 * @param {{maxEntries?:number}} [input]
 * @returns {{
 *   claim:(text:string)=>{owner:boolean,promise:Promise<ArrayLike<number>>|null,resolve?:(value:ArrayLike<number>)=>void,reject?:(err:unknown)=>void},
 *   stats:()=>{size:number,joins:number,claims:number,bypassed:number,peakSize:number}
 * }}
 */
export const createEmbeddingInFlightCoalescer = ({
  maxEntries = DEFAULT_EMBEDDINGS_IN_FLIGHT_CLAIMS_MAX_ENTRIES
} = {}) => {
  const cap = Math.max(
    1,
    coercePositiveIntMinOne(maxEntries) || DEFAULT_EMBEDDINGS_IN_FLIGHT_CLAIMS_MAX_ENTRIES
  );
  const inFlight = new Map();
  const stats = {
    joins: 0,
    claims: 0,
    bypassed: 0,
    peakSize: 0
  };
  return {
    claim(text) {
      if (typeof text !== 'string' || !text.length) {
        stats.bypassed += 1;
        return { owner: true, promise: null };
      }
      const existing = inFlight.get(text);
      if (existing) {
        stats.joins += 1;
        return { owner: false, promise: existing.promise };
      }
      if (inFlight.size >= cap) {
        stats.bypassed += 1;
        return { owner: true, promise: null };
      }
      let resolveClaim;
      let rejectClaim;
      const promise = new Promise((resolve, reject) => {
        resolveClaim = resolve;
        rejectClaim = reject;
      });
      // The owner reports compute failure directly; zero followers is valid.
      // Observe rejection without changing the promise delivered to followers.
      promise.catch(() => {});
      const finalize = () => {
        inFlight.delete(text);
      };
      inFlight.set(text, { promise });
      stats.claims += 1;
      if (inFlight.size > stats.peakSize) stats.peakSize = inFlight.size;
      return {
        owner: true,
        promise,
        resolve(value) {
          finalize();
          resolveClaim?.(value);
        },
        reject(err) {
          finalize();
          rejectClaim?.(err);
        }
      };
    },
    stats() {
      return {
        size: inFlight.size,
        joins: stats.joins,
        claims: stats.claims,
        bypassed: stats.bypassed,
        peakSize: stats.peakSize
      };
    }
  };
};

/**
 * Set map key/value while enforcing insertion-order LRU cap.
 *
 * @template K,V
 * @param {Map<K,V>} map
 * @param {K} key
 * @param {V} value
 * @param {number} maxEntries
 * @returns {void}
 */
export const boundedMapSet = (map, key, value, maxEntries) => {
  if (!(map instanceof Map)) return;
  const limit = coercePositiveIntMinOne(maxEntries);
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (!limit) return;
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
};

/**
 * Execute file work with adaptive concurrency and drain owned work on failure.
 *
 * @template T
 * @param {{
 *   items:T[],
 *   initialConcurrency?:number,
 *   resolveConcurrency?:(state:{active:number,remaining:number,concurrency:number})=>number,
 *   worker:(item:T,index:number)=>Promise<void>|void
 * }} input
 * @returns {Promise<{peakConcurrency:number,adjustments:number,finalConcurrency:number}>}
 */
export const __runWithAdaptiveConcurrencyForTests = async ({
  items,
  initialConcurrency = 1,
  resolveConcurrency = null,
  worker
}) => {
  const list = Array.isArray(items) ? items : [];
  const workerFn = typeof worker === 'function' ? worker : (() => {});
  let concurrency = coercePositiveIntMinOne(initialConcurrency) || 1;
  const resolveLimit = typeof resolveConcurrency === 'function'
    ? resolveConcurrency
    : (() => concurrency);
  let nextIndex = 0;
  let active = 0;
  let peakConcurrency = 0;
  let adjustments = 0;

  return await new Promise((resolve, reject) => {
    let failed = false;
    let firstError;
    const fail = (error) => {
      if (!failed) { failed = true; firstError = error; }
    };
    const settleIfDrained = () => {
      if (active !== 0) return;
      if (failed) reject(firstError);
      else if (nextIndex >= list.length) resolve({
        peakConcurrency,
        adjustments,
        finalConcurrency: Math.max(1, concurrency)
      });
    };
    const pump = () => {
      if (failed || (nextIndex >= list.length && active === 0)) { settleIfDrained(); return; }
      try {
        const desired = coercePositiveIntMinOne(resolveLimit({
          active,
          remaining: list.length - nextIndex,
          concurrency
        })) || concurrency;
        if (desired !== concurrency) {
          concurrency = desired;
          adjustments += 1;
        }
      } catch (error) {
        fail(error);
        settleIfDrained();
        return;
      }
      while (!failed && active < concurrency && nextIndex < list.length) {
        const itemIndex = nextIndex;
        const item = list[nextIndex];
        nextIndex += 1;
        active += 1;
        peakConcurrency = Math.max(peakConcurrency, active);
        let result;
        try {
          result = workerFn(item, itemIndex);
        } catch (error) {
          active -= 1;
          fail(error);
          break;
        }
        Promise.resolve(result).then(() => {
          active -= 1;
          pump();
        }, (error) => {
          active -= 1;
          fail(error);
          // Retain ownership until every already-started sibling settles. The
          // caller must not start resource cleanup while siblings still use it.
          settleIfDrained();
        });
      }
      settleIfDrained();
    };
    pump();
  });
};

const runWithAdaptiveConcurrency = __runWithAdaptiveConcurrencyForTests;

/**
 * Resolve per-bundle concurrency used when refreshing incremental stage-3
 * embedding payloads.
 *
 * @param {{indexingConfig:object,ioTokensTotal:number|null}} input
 * @returns {number}
 */
const resolveEmbeddingsBundleRefreshParallelism = ({
  indexingConfig,
  ioTokensTotal
}) => {
  const configured = coercePositiveIntMinOne(indexingConfig?.embeddings?.bundleRefreshParallelism);
  if (configured) return configured;
  const tokenDriven = coercePositiveIntMinOne(ioTokensTotal);
  // Keep the default fanout when scheduler reports only one IO token.
  if (tokenDriven && tokenDriven > 1) {
    return Math.max(1, Math.min(DEFAULT_EMBEDDINGS_BUNDLE_REFRESH_MAX_PARALLELISM, tokenDriven));
  }
  return DEFAULT_EMBEDDINGS_BUNDLE_REFRESH_PARALLELISM;
};

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
 * Parse `(actual > max)` byte counters from chunk-meta max-bytes failures.
 *
 * @param {Error|object|string|null} err
 * @returns {{actualBytes:number,maxBytes:number}|null}
 */
export const parseChunkMetaTooLargeBytes = (err) => {
  const message = String(err?.message || err || '');
  const match = CHUNK_META_TOO_LARGE_BYTES_PATTERN.exec(message);
  if (!match) return null;
  const actualBytes = Number(match[1]);
  const maxBytes = Number(match[2]);
  if (!Number.isFinite(actualBytes) || !Number.isFinite(maxBytes)) return null;
  if (actualBytes <= 0 || maxBytes <= 0) return null;
  return {
    actualBytes: Math.floor(actualBytes),
    maxBytes: Math.floor(maxBytes)
  };
};

/**
 * Resolve the max retry ceiling for chunk-meta streaming fallback.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveEmbeddingsChunkMetaRetryCeilingBytes = (indexingConfig) => {
  const configured = Number(indexingConfig?.embeddings?.chunkMetaRetryCeilingBytes);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(MAX_JSON_BYTES, Math.floor(configured));
  }
  return DEFAULT_EMBEDDINGS_CHUNK_META_RETRY_CEILING_BYTES;
};

/**
 * Derive a larger retry max-bytes budget from a max-bytes overflow failure.
 *
 * @param {{
 *   err:Error|object|string|null,
 *   currentMaxBytes:number,
 *   retryCeilingBytes:number
 * }} input
 * @returns {number|null}
 */
export const resolveChunkMetaRetryMaxBytes = ({
  err,
  currentMaxBytes,
  retryCeilingBytes
}) => {
  const parsed = parseChunkMetaTooLargeBytes(err);
  if (!parsed) return null;
  const current = Number.isFinite(Number(currentMaxBytes))
    ? Math.max(1, Math.floor(Number(currentMaxBytes)))
    : MAX_JSON_BYTES;
  const ceiling = Number.isFinite(Number(retryCeilingBytes))
    ? Math.max(1, Math.floor(Number(retryCeilingBytes)))
    : DEFAULT_EMBEDDINGS_CHUNK_META_RETRY_CEILING_BYTES;
  if (ceiling <= current) return null;
  const observed = Math.max(parsed.actualBytes, parsed.maxBytes, current + 1);
  const growth = Math.max(
    Math.ceil(observed * 1.1),
    current * 2,
    observed + (8 * 1024 * 1024)
  );
  const next = Math.min(ceiling, growth);
  if (!Number.isFinite(next) || next <= current) return null;
  return Math.floor(next);
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
 * Strip non-essential `metaV2` fields before writing incremental bundles with
 * refreshed embedding vectors.
 *
 * @param {object|null} metaV2
 * @returns {object|null}
 */
const compactChunkMetaV2ForEmbeddings = (metaV2) => {
  if (!metaV2 || typeof metaV2 !== 'object') return null;
  const out = {};
  if (typeof metaV2.chunkId === 'string' && metaV2.chunkId) out.chunkId = metaV2.chunkId;
  if (typeof metaV2.file === 'string' && metaV2.file) out.file = metaV2.file;
  if (typeof metaV2.kind === 'string' && metaV2.kind) out.kind = metaV2.kind;
  if (typeof metaV2.name === 'string' && metaV2.name) out.name = metaV2.name;
  if (typeof metaV2.doc === 'string' && metaV2.doc) out.doc = metaV2.doc;
  const segment = metaV2.segment && typeof metaV2.segment === 'object'
    ? metaV2.segment
    : null;
  if (segment) {
    const compactSegment = {};
    if (typeof segment.anchor === 'string' && segment.anchor) {
      compactSegment.anchor = segment.anchor;
    }
    if (typeof segment.segmentUid === 'string' && segment.segmentUid) {
      compactSegment.segmentUid = segment.segmentUid;
    }
    if (Object.keys(compactSegment).length) {
      out.segment = compactSegment;
    }
  }
  return Object.keys(out).length ? out : null;
};

/**
 * Build a minimal chunk payload suitable for embedding artifact persistence.
 *
 * @param {object|null} chunk
 * @param {string|null} filePath
 * @returns {object|null}
 */
export const compactChunkForEmbeddings = (chunk, filePath) => {
  if (!chunk || typeof chunk !== 'object') return null;
  const start = Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : 0;
  const endRaw = Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : start;
  const end = endRaw >= start ? endRaw : start;
  const out = {
    start,
    end
  };
  const chunkId = toChunkIndex(chunk.id);
  if (chunkId != null) out.id = chunkId;
  if (typeof filePath === 'string' && filePath) {
    out.file = filePath;
  } else if (typeof chunk.file === 'string' && chunk.file) {
    out.file = chunk.file;
  }
  if (typeof chunk.kind === 'string' && chunk.kind) out.kind = chunk.kind;
  if (typeof chunk.name === 'string' && chunk.name) out.name = chunk.name;
  if (typeof chunk.chunkId === 'string' && chunk.chunkId) out.chunkId = chunk.chunkId;
  if (typeof chunk.text === 'string') out.text = chunk.text;
  const docText = typeof chunk?.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
  if (docText) {
    out.docmeta = { doc: docText };
  }
  const segment = chunk.segment && typeof chunk.segment === 'object' ? chunk.segment : null;
  if (segment) {
    const compactSegment = {};
    if (typeof segment.anchor === 'string' && segment.anchor) {
      compactSegment.anchor = segment.anchor;
    }
    if (typeof segment.segmentUid === 'string' && segment.segmentUid) {
      compactSegment.segmentUid = segment.segmentUid;
    }
    if (Object.keys(compactSegment).length) {
      out.segment = compactSegment;
    }
  }
  const compactMetaV2 = compactChunkMetaV2ForEmbeddings(chunk.metaV2);
  if (compactMetaV2) {
    out.metaV2 = compactMetaV2;
  }
  return out;
};

/**
 * Build stable lookup key for chunk-text hydration.
 *
 * @param {object|null|undefined} chunk
 * @returns {string}
 */
export const buildChunkTextLookupKey = (chunk) => {
  if (!chunk || typeof chunk !== 'object') return '';
  const id = toChunkIndex(chunk.id);
  const start = Number.isFinite(Number(chunk.start)) ? Math.floor(Number(chunk.start)) : '';
  const end = Number.isFinite(Number(chunk.end)) ? Math.floor(Number(chunk.end)) : '';
  const chunkId = typeof chunk.chunkId === 'string' ? chunk.chunkId : '';
  if (id == null && start === '' && end === '' && !chunkId) return '';
  return `${id ?? ''}:${start}:${end}:${chunkId}`;
};

/**
 * Build chunk-text lookup map from bundle chunk rows.
 *
 * @param {Array<object>|null|undefined} chunks
 * @returns {Map<string,string>|null}
 */
export const buildChunkTextLookupMap = (chunks) => {
  if (!Array.isArray(chunks) || !chunks.length) return null;
  const map = new Map();
  for (const chunk of chunks) {
    if (typeof chunk?.text !== 'string') continue;
    const key = buildChunkTextLookupKey(chunk);
    if (!key || map.has(key)) continue;
    map.set(key, chunk.text);
  }
  return map.size ? map : null;
};

/**
 * Fill missing chunk code text entries from incremental bundle rows.
 *
 * @param {{
 *   items:Array<{chunk?:object}>,
 *   chunkCodeTexts:string[],
 *   bundleChunks:Array<object>
 * }} input
 * @returns {number}
 */
export const hydrateMissingChunkTextsFromBundle = ({
  items,
  chunkCodeTexts,
  bundleChunks
}) => {
  const itemList = Array.isArray(items) ? items : [];
  const texts = Array.isArray(chunkCodeTexts) ? chunkCodeTexts : [];
  const chunks = Array.isArray(bundleChunks) ? bundleChunks : [];
  const lookup = buildChunkTextLookupMap(chunks);
  let unresolved = 0;
  for (let i = 0; i < itemList.length; i += 1) {
    if (typeof texts[i] === 'string') continue;
    const positional = chunks[i];
    if (typeof positional?.text === 'string') {
      texts[i] = positional.text;
      continue;
    }
    const key = buildChunkTextLookupKey(itemList[i]?.chunk || itemList[i]);
    const keyed = key && lookup ? lookup.get(key) : null;
    if (typeof keyed === 'string') {
      texts[i] = keyed;
      continue;
    }
    unresolved += 1;
  }
  return unresolved;
};

/**
 * Build line-ending-stable source payload hash for cache/dedupe checks.
 *
 * @param {{codeText?:string,docText?:string}} [input]
 * @returns {string}
 */
export const buildNormalizedChunkPayloadHash = ({ codeText = '', docText = '' } = {}) => {
  const normalizedCode = typeof codeText === 'string'
    ? codeText.replace(/\r\n/g, '\n')
    : '';
  const normalizedDoc = typeof docText === 'string'
    ? docText.replace(/\r\n/g, '\n')
    : '';
  return sha1(`${normalizedCode}\n${normalizedDoc}`);
};

/**
 * Resolve deterministic embeddings sampling config.
 *
 * Sampling is opt-in and intended for smoke/benchmark workflows where we need
 * representative model behavior without embedding every file.
 *
 * @param {{embeddingsConfig?:object,env?:object}} [input]
 * @returns {{maxFiles:number|null,seed:string}}
 */
const resolveEmbeddingSamplingConfig = ({ embeddingsConfig, env } = {}) => {
  const configRaw = Number(embeddingsConfig?.sampleFiles);
  const envRaw = Number(env?.embeddingsSampleFiles);
  const maxFiles = coercePositiveIntMinOne(Number.isFinite(envRaw) ? envRaw : configRaw);
  const configSeed = typeof embeddingsConfig?.sampleSeed === 'string'
    ? embeddingsConfig.sampleSeed.trim()
    : '';
  const envSeed = typeof env?.embeddingsSampleSeed === 'string'
    ? env.embeddingsSampleSeed.trim()
    : '';
  const seed = envSeed || configSeed || 'default';
  return { maxFiles, seed };
};

/**
 * Rewrite incremental bundle files with updated `embedding_u8` vectors produced
 * during stage 3, and stamp manifest metadata when coverage is complete.
 *
 * @param {{
 *   mode:string,
 *   incremental:{manifest?:object,bundleDir?:string,manifestPath?:string},
 *   chunksByFile:Map<string,Array<{index?:number,chunk?:object}>>,
 *   mergedVectors:Array<Uint8Array|number[]|ArrayBufferView|null>,
 *   embeddingMode:string,
 *   embeddingIdentityKey:string|null,
 *   parallelism?:number,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   log:(line:string)=>void,
 *   warn:(line:string)=>void
 * }} input
 * @returns {Promise<RefreshIncrementalBundlesResult|{attempted:number,rewritten:number,manifestWritten:boolean,completeCoverage:boolean}>}
 */
export const refreshIncrementalBundlesWithEmbeddings = async ({
  mode,
  repoRoot = process.cwd(),
  signal = null,
  incremental,
  chunksByFile,
  mergedVectors,
  embeddingMode,
  embeddingIdentityKey,
  parallelism = 1,
  scheduleIo,
  log,
  warn
}) => {
  if (!incremental?.manifest || !incremental?.bundleDir || !incremental?.manifestPath) {
    return { attempted: 0, rewritten: 0, manifestWritten: false, completeCoverage: false };
  }
  const manifest = structuredClone(incremental.manifest);
  let receiptBudget = Math.max(0, INCREMENTAL_MANIFEST_MAX_BYTES - Buffer.byteLength(encodeIncrementalManifest(manifest, { repoRoot,
    indexPath: incremental.manifestPath })) - 64 * 1024);
  const manifestFiles = manifest.files && typeof manifest.files === 'object'
    ? manifest.files
    : {};
  const orderedManifestEntries = sortEntriesByOrderIndex(
    Object.entries(manifestFiles).map(([filePath, entry], index) => {
      const normalizedFile = canonicalBundleSourceKey(filePath);
      return {
        filePath,
        normalizedFile,
        entry,
        rel: normalizedFile,
        ext: path.posix.extname(normalizedFile).toLowerCase(),
        orderIndex: Number.isFinite(Number(entry?.orderIndex))
          ? Math.floor(Number(entry.orderIndex))
          : index,
        canonicalOrderIndex: Number.isFinite(Number(entry?.canonicalOrderIndex))
          ? Math.floor(Number(entry.canonicalOrderIndex))
          : null
      };
    })
  );
  if (!orderedManifestEntries.length) {
    return { attempted: 0, rewritten: 0, manifestWritten: false, completeCoverage: false };
  }

  const mappingIndex = createIncrementalChunkMappingIndex(chunksByFile);
  const mappingDigest = digestBundleMappingInventory(mappingIndex);
  const work = { bundleSnapshotsRead: 0, bundleSnapshotsDecoded: 0, chunksCompared: 0, skippedByProof: 0, receiptsRejected: 0, invalidatedReasons: {} };
  const admittedReceipts = new Set();
  let manifestChanged = false;
  const admitReceipt = (entry, receipt) => {
    if (!receipt) return;
    const bytes = Buffer.byteLength(JSON.stringify(receipt)) + 64;
    if (bytes > receiptBudget) { work.receiptsRejected++; return; }
    receiptBudget -= bytes; entry.embeddingCoverageReceipt = receipt; admittedReceipts.add(entry); manifestChanged = true;
  };

  const resolvedBundleFormat = normalizeBundleFormat(manifest.bundleFormat);
  const scanned = orderedManifestEntries.length;
  let processedEntries = 0;
  let eligible = 0;
  let rewritten = 0;
  let covered = 0;
  let rewriteFailures = 0;
  let skippedNoMapping = 0;
  let skippedNoMappingChunks = 0;
  const mappingFailureReasons = createMappingFailureReasons();
  let skippedInvalidBundle = 0;
  let skippedEmptyBundle = 0;

  const refreshParallelism = coercePositiveIntMinOne(parallelism) || 1;

  /**
   * Refresh one manifest bundle entry against stage-3 vectors.
   *
   * @param {{filePath:string,normalizedFile:string,entry:any,orderIndex:number}} record
   * @returns {Promise<void>}
   */
  const processManifestEntry = async (record) => {
    const filePath = String(record?.filePath || '');
    const normalizedFile = canonicalBundleSourceKey(record?.normalizedFile || filePath);
    const entry = record?.entry;
    processedEntries += 1;
    const chunkMapping = resolveChunkFileMapping(mappingIndex, normalizedFile);
    const bundleNames = resolveManifestBundleNames(entry);
    if (!bundleNames.length) {
      skippedInvalidBundle += 1;
      return;
    }
    const selection = { normalizedFile, mappingDigest, embeddingIdentityKey, embeddingMode };
    const beforeFiles = await scheduleIo(() => observeBundleCoverageFiles({ bundleDir: incremental.bundleDir, entry,
      fallbackFormat: resolvedBundleFormat, signal }));
    const proof = checkBundleCoverageReceipt({ entry, observedFiles: beforeFiles, mergedVectors, ...selection });
    if (proof.reuse) {
      if (proof.chunkCount) { eligible++; covered++; } else skippedEmptyBundle++;
      work.skippedByProof++; return;
    }
    work.invalidatedReasons[proof.reason] = (work.invalidatedReasons[proof.reason] || 0) + 1;
    if (entry.embeddingCoverageReceipt) {
      receiptBudget += Buffer.byteLength(JSON.stringify(entry.embeddingCoverageReceipt)) + 64;
      delete entry.embeddingCoverageReceipt; manifestChanged = true;
    }
    work.bundleSnapshotsRead++;
    const snapshot = await scheduleIo(() => readIncrementalBundleSnapshot({
      repoRoot, bundleDir: incremental.bundleDir, relKey: normalizedFile, entry,
      fallbackFormat: resolvedBundleFormat, signal
    }));
    if (!snapshot) {
      skippedInvalidBundle += 1;
      return;
    }
    work.bundleSnapshotsDecoded++;
    const bundleShards = snapshot.shards;

    const totalChunks = bundleShards.reduce(
      (sum, shard) => sum + (Array.isArray(shard.bundle?.chunks) ? shard.bundle.chunks.length : 0),
      0
    );
    if (!totalChunks) {
      skippedEmptyBundle += 1;
      const afterFiles = await scheduleIo(() => observeBundleCoverageFiles({ bundleDir: incremental.bundleDir, entry,
        fallbackFormat: resolvedBundleFormat, signal }));
      admitReceipt(entry, createBundleCoverageReceipt({ entry, observedFiles: afterFiles, priorFiles: beforeFiles, vectorIndices: [], mergedVectors, ...selection }));
      return;
    }
    eligible += 1;
    const fallbackState = { cursor: 0 };
    let changed = false;
    let fileCovered = true;
    let fileNoMappingCounted = false;
    const vectorIndices = [];

    for (const shard of bundleShards) {
      const shardChunks = Array.isArray(shard.bundle?.chunks) ? shard.bundle.chunks : [];
      for (const chunk of shardChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        work.chunksCompared++;
        const mappingResult = resolveBundleChunkVectorIndex({
          chunk,
          normalizedFile,
          fileMapping: chunkMapping,
          mappingIndex,
          fallbackState,
          vectorCount: mergedVectors.length
        });
        const vectorIndex = mappingResult.vectorIndex;
        const vector = vectorIndex != null ? mergedVectors[vectorIndex] : null;
        const mappedButMissingVector = vectorIndex != null && !hasVectorPayload(vector);
        if (vectorIndex != null && hasVectorPayload(vector)) vectorIndices.push(vectorIndex);
        if (vectorIndex == null || mappedButMissingVector) {
          if (chunk.embedding_u8 !== undefined) {
            delete chunk.embedding_u8;
            changed = true;
          }
          if (chunk.embedding !== undefined) {
            delete chunk.embedding;
            changed = true;
          }
        }
        if (hasVectorPayload(vector)) {
          const quantized = toUint8Vector(vector);
          if (quantized && !vectorsEqual(chunk.embedding_u8, quantized)) {
            chunk.embedding_u8 = quantized;
            changed = true;
          }
        }
        if (vectorIndex != null && chunk.embedding !== undefined) {
          delete chunk.embedding;
          changed = true;
        }
        if (!hasVectorPayload(chunk.embedding_u8)) {
          fileCovered = false;
          if (vectorIndex == null || mappedButMissingVector) {
            skippedNoMappingChunks += 1;
            recordMappingFailureReason(mappingFailureReasons, mappingResult.reason);
            if (!fileNoMappingCounted) {
              skippedNoMapping += 1;
              fileNoMappingCounted = true;
            }
          }
        }
      }
    }

    if (!changed) {
      if (fileCovered) covered += 1;
      if (fileCovered && vectorIndices.length === totalChunks) {
        const afterFiles = await scheduleIo(() => observeBundleCoverageFiles({ bundleDir: incremental.bundleDir, entry,
          fallbackFormat: resolvedBundleFormat, signal }));
        const receipt = createBundleCoverageReceipt({ entry, observedFiles: afterFiles, priorFiles: beforeFiles, vectorIndices, mergedVectors, ...selection });
        admitReceipt(entry, receipt);
      }
      return;
    }
    try {
      const replacement = await scheduleIo(() => writeIncrementalBundleSnapshot({
        repoRoot, bundleDir: incremental.bundleDir, relKey: normalizedFile, entry,
        bundles: bundleShards.map((shard) => shard.bundle), format: entry.bundleFormat || resolvedBundleFormat,
        diskAccount: incremental.diskAccount || null, signal
      }));
      Object.assign(entry, replacement);
      manifestChanged = true;
      rewritten += 1;
      if (fileCovered) covered += 1;
      if (fileCovered && vectorIndices.length === totalChunks) {
        const priorFiles = await scheduleIo(() => observeBundleCoverageFiles({ bundleDir: incremental.bundleDir, entry,
          fallbackFormat: resolvedBundleFormat, signal }));
        // Validate a replacement after its immutable writer closes before
        // recording the opened-file identity used by future proof-only reads.
        work.bundleSnapshotsRead++;
        const verified = await scheduleIo(() => readIncrementalBundleSnapshot({ repoRoot, bundleDir: incremental.bundleDir,
          relKey: normalizedFile, entry, fallbackFormat: resolvedBundleFormat, signal }));
        if (verified) {
          work.bundleSnapshotsDecoded++;
          const observedFiles = await scheduleIo(() => observeBundleCoverageFiles({ bundleDir: incremental.bundleDir, entry,
            fallbackFormat: resolvedBundleFormat, signal }));
          const receipt = createBundleCoverageReceipt({ entry, observedFiles, priorFiles, vectorIndices, mergedVectors, ...selection });
          admitReceipt(entry, receipt);
        }
      }
    } catch (err) {
      rewriteFailures += 1;
      warn(`[embeddings] ${mode}: failed to refresh bundle ${filePath}: ${err?.message || err}`);
    }
  };

  // Extraction admission belongs to stage 1. Stage 3 synchronizes vectors that
  // already exist, so another yield sample must not leave late bundles stale.
  if (refreshParallelism > 1 && orderedManifestEntries.length > 1) {
    await runWithConcurrency(orderedManifestEntries, refreshParallelism,
      async (manifestEntry) => processManifestEntry(manifestEntry), { collectResults: false });
  } else {
    for (const manifestEntry of orderedManifestEntries) await processManifestEntry(manifestEntry);
  }

  const coverage = summarizeBundleEmbeddingCoverage({ totalFiles: scanned, processedFiles: processedEntries,
    eligibleFiles: eligible, coveredFiles: covered, missingChunks: skippedNoMappingChunks, invalidBundles: skippedInvalidBundle });
  const completeCoverage = coverage.complete;
  let manifestWritten = false;
  if (rewriteFailures === 0) {
    stampBundleEmbeddingCoverage(manifest, coverage);
    manifest.bundleEmbeddingMode = embeddingMode || null;
    manifest.bundleEmbeddingIdentityKey = embeddingIdentityKey || null;
    manifest.bundleEmbeddingStage = 'stage3';
    const metadataKeys = Object.keys(manifest).filter(key => key.startsWith('bundleEmbedding'));
    manifestChanged ||= metadataKeys.some(key => manifest[key] !== incremental.manifest[key]);
    // Coverage receipts are optional acceleration metadata. Required source and
    // coverage publication must not fail solely because these proofs fill the
    // bounded manifest after replacement metadata grows during this attempt.
    if (manifestChanged && admittedReceipts.size) {
      try { encodeIncrementalManifest(manifest, { repoRoot, indexPath: incremental.manifestPath }); }
      catch (error) {
        if (error.code !== 'ERR_INCREMENTAL_MANIFEST_CAPACITY') throw error;
        for (const entry of admittedReceipts) delete entry.embeddingCoverageReceipt;
        work.receiptsRejected += admittedReceipts.size;
        encodeIncrementalManifest(manifest, { repoRoot, indexPath: incremental.manifestPath });
      }
    }
    if (manifestChanged) manifestWritten = await scheduleIo(() => writeIncrementalManifest(incremental.manifestPath, manifest));
    if (manifestWritten) incremental.manifest = manifest;
    if (manifestChanged && !manifestWritten) {
      warn(`[embeddings] ${mode}: failed to persist incremental manifest embedding metadata.`);
    }
  } else {
    warn(
      `[embeddings] ${mode}: skipped manifest embedding coverage update after `
      + `${rewriteFailures} bundle refresh failure${rewriteFailures === 1 ? '' : 's'}.`
    );
  }

  if (scanned > 0) {
    const skippedNotes = [];
    if (skippedNoMapping > 0) skippedNotes.push(`noMapping=${skippedNoMapping}`);
    if (skippedNoMappingChunks > 0) skippedNotes.push(`noMappingChunks=${skippedNoMappingChunks}`);
    if (skippedNoMappingChunks > 0) {
      skippedNotes.push(`noMappingReasons=${formatMappingFailureReasons(mappingFailureReasons)}`);
    }
    if (skippedEmptyBundle > 0) skippedNotes.push(`empty=${skippedEmptyBundle}`);
    if (skippedInvalidBundle > 0) skippedNotes.push(`invalid=${skippedInvalidBundle}`);
    if (rewriteFailures > 0) skippedNotes.push(`rewriteFailures=${rewriteFailures}`);
    const skippedSuffix = skippedNotes.length ? ` (skipped ${skippedNotes.join(', ')})` : '';
    const coverageText = eligible > 0 ? `${covered}/${eligible}` : 'n/a';
    log(
      `[embeddings] ${mode}: refreshed ${rewritten}/${eligible} eligible incremental bundles; ` +
      `embedding coverage ${coverageText}${skippedSuffix}.`
    );
  }
  return {
    attempted: eligible,
    eligible,
    rewritten,
    covered,
    scanned,
    skippedNoMapping,
    skippedNoMappingChunks,
    mappingFailureReasons,
    skippedInvalidBundle,
    skippedEmptyBundle,
    lowYieldBailoutSkipped: 0,
    lowYieldBailout: null,
    manifestWritten,
    completeCoverage,
    coverage,
    rewriteFailures,
    work, manifestUnchanged: !manifestChanged
  };
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
  let receipts = null;
  let cleanup = null, primaryFailure = null;
  try { return await runBuildEmbeddingsImpl(config, value => { receipts = value; }, value => { cleanup = value; }); }
  catch (error) {
    primaryFailure = error;
    if (!error.diagnosticEvidence) {
      try {
        const context = receipts?.diagnosticContext?.(error.mode || null) || {};
        const evidence = createCrashEvidenceOwner({ repoCacheRoot: config.repoCacheRoot || getRepoCacheRoot(config.root, config.userConfig),
          buildId: config.executionPlan?.buildId || null, mode: error.mode || null, stage: 'stage3', ...context });
        error.diagnosticEvidence = evidence.writeTerminal({ message: error.message, stack: error.stack, code: error.code }, { phase: 'stage3:boundary' });
      } catch (evidenceError) {
        error.diagnosticEvidence = { written: false, evidencePath: null,
          writeError: { code: evidenceError.code || 'ERR_CRASH_EVIDENCE_WRITE', message: evidenceError.message } };
      }
    }
    try { await receipts?.fail(error); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    try { await cleanup?.(); }
    catch (error) {
      if (primaryFailure) {
        primaryFailure.cleanupError = error;
        primaryFailure.cacheOwnershipPending = true;
      } else {
        error.cacheOwnershipPending = true;
        throw error;
      }
    }
  }
}

async function runBuildEmbeddingsImpl(config, onRuntimeReceipts, onCleanup) {
  throwIfAborted(config.signal);
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
  const stubFastPathEnabled = useStubEmbeddings === true;
  const embeddingNormalize = embeddingsConfig.normalize !== false;
  const modelProfile = resolveEmbeddingModelProfile(modelId, embeddingsConfig.embeddinggemma2);
  validateEmbeddingModelProfile(modelProfile, { provider: embeddingProvider, normalize: embeddingNormalize });
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
   * @returns {Promise<object|null>}
   */
  const readJsonOptional = async (filePath) => {
    if (!filePath) return null;
    const candidates = [filePath, `${filePath}.bak`];
    for (const candidate of candidates) {
      try {
        const stats = await fs.stat(candidate);
        if (!stats?.isFile?.()) continue;
        if (Number.isFinite(Number(stats.size)) && Number(stats.size) > MAX_JSON_BYTES) continue;
        return JSON.parse(await fs.readFile(candidate, 'utf8'));
      } catch {}
    }
    return null;
  };
  const traceArtifactIo = (configEnv || getEnvConfig()).traceArtifactIo === true;
  /**
   * Check whether artifact file exists in raw/compressed/backup forms.
   *
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  const hasArtifactFile = async (filePath) => {
    if (!filePath) return false;
    const variants = [filePath, `${filePath}.gz`, `${filePath}.zst`, `${filePath}.bak`];
    for (const candidate of variants) {
      try {
        await fs.access(candidate);
        return true;
      } catch {}
    }
    return false;
  };
  /**
   * Emit trace-level artifact existence line when IO tracing is enabled.
   *
   * @param {string} mode
   * @param {string} label
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  const logArtifactLocation = async (mode, label, filePath) => {
    if (!traceArtifactIo) return;
    const exists = await hasArtifactFile(filePath);
    log(`[embeddings] ${mode}: artifact ${label} path=${filePath} exists=${exists}`);
  };
  /**
   * Log expected stage artifacts snapshot for debug traceability.
   *
   * @param {string} mode
   * @param {string} indexDir
   * @param {string} stageLabel
   * @returns {void}
   */
  const logExpectedArtifacts = (mode, indexDir, stageLabel) => {
    if (!traceArtifactIo) return;
    const expected = [
      { label: 'chunk_meta', path: path.join(indexDir, 'chunk_meta.json') },
      { label: 'chunk_meta_stream', path: path.join(indexDir, 'chunk_meta.jsonl') },
      { label: 'chunk_meta_meta', path: path.join(indexDir, 'chunk_meta.meta.json') },
      { label: 'token_postings', path: path.join(indexDir, 'token_postings.json') },
      { label: 'token_postings_stream', path: path.join(indexDir, 'token_postings.jsonl') },
      { label: 'token_postings_meta', path: path.join(indexDir, 'token_postings.meta.json') },
      { label: 'phrase_ngrams', path: path.join(indexDir, 'phrase_ngrams.json') },
      { label: 'chargram_postings', path: path.join(indexDir, 'chargram_postings.json') },
      { label: 'index_state', path: path.join(indexDir, 'index_state.json') },
      { label: 'filelists', path: path.join(indexDir, '.filelists.json') },
      { label: 'pieces_manifest', path: path.join(indexDir, 'pieces', 'manifest.json') }
    ];
    log(`[embeddings] ${mode}: expected artifact snapshot (${stageLabel})`);
    for (const entry of expected) {
      void logArtifactLocation(mode, `${stageLabel}:${entry.label}`, entry.path);
    }
  };
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
  let cacheDims = modelProfile?.dimensions ?? (useStubEmbeddings ? resolveStubDims(configuredDims) : configuredDims);
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
  let modelArtifact = await resolveEmbeddingArtifactIdentityAsync({ provider: embeddingProvider,
    modelId, modelsDir, rootDir: root, onnx: embeddingOnnx, modelProfile, stub: useStubEmbeddings });
  const buildCacheIdentityForProvider = (provider) => {
    const identityPayload = buildCacheIdentity({
      modelProfile,
      modelArtifact,
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
   * Best-effort existence check that never throws.
   *
   * Returns `false` for missing paths, denied access, and invalid/falsy inputs
   * so callers can use it in fallback probes without try/catch noise.
   *
   * @param {string|null|undefined} targetPath
   * @returns {Promise<boolean>}
   */
  const pathExists = async (targetPath) => {
    if (!targetPath) return false;
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  };
  /**
   * Detect whether an index root contains stage2 artifacts for a mode.
   *
   * @param {string} candidateRoot
   * @param {string|null} [mode]
   * @returns {Promise<boolean>}
   */
  const hasModeArtifacts = async (candidateRoot, mode = null) => {
    if (!candidateRoot || !(await pathExists(candidateRoot))) return false;
    const candidateModes = mode
      ? [mode]
      : (Array.isArray(modes) && modes.length ? modes : ['code', 'prose', 'extracted-prose', 'records']);
    const chunkMetaCandidates = [
      'chunk_meta.json',
      'chunk_meta.json.gz',
      'chunk_meta.json.zst',
      'chunk_meta.jsonl',
      'chunk_meta.jsonl.gz',
      'chunk_meta.jsonl.zst',
      'chunk_meta.meta.json',
      'chunk_meta.parts',
      'chunk_meta.columnar.json',
      'chunk_meta.binary-columnar.meta.json'
    ];
    for (const modeName of candidateModes) {
      if (typeof modeName !== 'string' || !modeName) continue;
      const indexDir = path.join(candidateRoot, `index-${modeName}`);
      if (!(await pathExists(indexDir))) continue;
      if (await pathExists(path.join(indexDir, 'pieces', 'manifest.json'))) return true;
      for (const relPath of chunkMetaCandidates) {
        if (await pathExists(path.join(indexDir, relPath))) return true;
      }
    }
    return false;
  };
  const primaryMode = typeof modes?.[0] === 'string' && modes[0] ? modes[0] : null;
  /**
   * Resolve newest build root containing artifacts for requested mode.
   *
   * @param {string|null} [mode]
   * @returns {Promise<string|null>}
   */
  const findLatestModeRoot = async (mode = primaryMode) => {
    const buildsRoot = path.join(repoCacheRootResolved, 'builds');
    if (!(await pathExists(buildsRoot))) return null;
    let entries = [];
    try {
      entries = await fs.readdir(buildsRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry?.isDirectory?.()) continue;
      const candidateRoot = path.join(buildsRoot, entry.name);
      if (!(await hasModeArtifacts(candidateRoot, mode))) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = Number((await fs.stat(candidateRoot)).mtimeMs) || 0;
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
   * @returns {Promise<string|null>}
   */
  const resolveModeIndexRoot = async (mode) => {
    if (await hasModeArtifacts(activeIndexRoot, mode)) return activeIndexRoot;
    if (explicitIndexRoot) return activeIndexRoot;
    const currentBuild = getCurrentBuildInfo(root, userConfig, { mode });
    const currentRoot = currentBuild?.activeRoot || currentBuild?.buildRoot || null;
    if (currentRoot && await hasModeArtifacts(currentRoot, mode)) return currentRoot;
    return (await findLatestModeRoot(mode)) || activeIndexRoot;
  };
  if (activeIndexRoot && !explicitIndexRoot) {
    const activeRootKey = normalizePath(activeIndexRoot);
    const underRepoCache = isPathWithinRoot(activeIndexRoot, repoCacheRootResolved);
    const needsCurrentBuildRoot = underRepoCache && (
      activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey
      || !(await hasModeArtifacts(activeIndexRoot, primaryMode))
    );
    if (needsCurrentBuildRoot) {
      const currentBuild = getCurrentBuildInfo(root, userConfig, { mode: modes[0] || null });
      const buildRootCandidate = currentBuild?.buildRoot || null;
      const activeRootCandidate = currentBuild?.activeRoot || null;
      const promotedRoot = await hasModeArtifacts(buildRootCandidate, primaryMode)
        ? buildRootCandidate
        : (await hasModeArtifacts(activeRootCandidate, primaryMode) ? activeRootCandidate : null);
      const promotedRootKey = normalizePath(promotedRoot);
      if (promotedRoot && promotedRootKey && promotedRootKey !== activeRootKey) {
        activeIndexRoot = promotedRoot;
        log(`[embeddings] using active build root from current.json: ${activeIndexRoot}`);
      }
    }
  }
  if (!explicitIndexRoot && activeIndexRoot && !(await hasModeArtifacts(activeIndexRoot, primaryMode))) {
    const activeRootKey = normalizePath(activeIndexRoot);
    const allowLatestFallback = !activeRootKey
      || !(await pathExists(activeIndexRoot))
      || activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey;
    if (allowLatestFallback) {
      const fallbackRoot = await findLatestModeRoot(primaryMode);
      if (fallbackRoot && normalizePath(fallbackRoot) !== normalizePath(activeIndexRoot)) {
        activeIndexRoot = fallbackRoot;
        log(`[embeddings] index root lacked mode artifacts; using latest build root: ${activeIndexRoot}`);
      }
    }
  }
  const receiptRoots = [];
  for (const mode of modes) receiptRoots.push([mode, await resolveModeIndexRoot(mode)]);
  const runtimeReceipts = await createStage3RuntimeReceipts({ config: { ...config, repoCacheRoot }, roots: receiptRoots, identity: cacheIdentity, identityKey: cacheIdentityKey, log });
  onRuntimeReceipts(runtimeReceipts);
  let activeReceiptMode = null;
  const metricsDir = getMetricsDir(root, userConfig);
  const envConfig = configEnv || getEnvConfig();
  const crashLogger = await createCrashLogger({
    repoCacheRoot,
    enabled: true,
    ...runtimeReceipts.diagnosticContext(),
    log
  });
  crashLogger.updatePhase('stage3:init');
  let embedder;
  let cleanupScheduler = null;
  onCleanup(async () => {
    try { await cleanupScheduler?.shutdown?.({ awaitRunning: true, timeoutMs: 5000 }); }
    finally {
      try { await embedder?.dispose?.(); }
      finally {
        try { await crashLogger.close?.(); }
        finally { finalize(); }
      }
    }
  });
  try {
    embedder = createEmbedder({
      rootDir: root,
      useStubEmbeddings,
      modelId,
      dims: argv.dims,
      modelsDir,
      provider: embeddingProvider,
      onnx: embeddingOnnx,
      normalize: embeddingNormalize,
      modelProfile,
      modelArtifact
    });
  } catch (err) {
    err.diagnosticEvidence = crashLogger.logError({
      phase: 'stage3:init',
      stage: 'embedder',
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    try { await runtimeReceipts.fail(err); } catch { /* Preserve adapter construction failure. */ }
    throw err;
  }
  const getChunkEmbeddings = async (texts) => {
    if (!Array.isArray(texts) || !texts.length) return [];
    await runtimeReceipts.loading(activeReceiptMode);
    try {
      const vectors = await embedder.getChunkEmbeddings(texts);
      assertVectorArrays(vectors, texts.length, 'runtime-observed-batch');
      await runtimeReceipts.observed(activeReceiptMode, embedder, vectors, activeReceiptMode ? 'successful-inference' : 'provider-probe');
      return vectors;
    } catch (failure) {
      try { await runtimeReceipts.fail(failure, activeReceiptMode); } catch { /* Keep the original provider failure. */ }
      throw failure;
    }
  };
  getChunkEmbeddings.supportsParallelDispatch = embedder.getChunkEmbeddings.supportsParallelDispatch;
  getChunkEmbeddings.estimateTokensBatch = embedder.getChunkEmbeddings.estimateTokensBatch;
  if (!useStubEmbeddings && (embeddingProvider === 'onnx' || !cacheDims || !embeddingArtifactReusable(modelArtifact))) {
    try {
      const probeVectors = await getChunkEmbeddings(['pairofcleats-provider-probe']);
      assertVectorArrays(probeVectors, 1, 'provider-probe');
      const probeDims = probeVectors[0].length;
      if (cacheDims && cacheDims !== probeDims) {
        throw new Error(`[embeddings] embedding dims mismatch (configured=${cacheDims}, observed=${probeDims}).`);
      }
      cacheDims = probeDims;
    } catch (err) {
      err.diagnosticEvidence = crashLogger.logError({
        phase: 'stage3:init',
        stage: 'embedder-probe',
        message: err?.message || String(err),
        stack: err?.stack || null
      });
      try { await runtimeReceipts.fail(err); } catch { /* Keep the original provider probe failure. */ }
      try { await embedder.dispose?.(); } catch { /* Best-effort cleanup must not replace the probe failure. */ }
      throw err;
    }
    const detectedProvider = typeof embedder.getActiveProvider === 'function'
      ? embedder.getActiveProvider()
      : runtimeEmbeddingProvider;
    if (typeof detectedProvider === 'string' && detectedProvider && detectedProvider !== runtimeEmbeddingProvider) {
      const priorProvider = runtimeEmbeddingProvider;
      runtimeEmbeddingProvider = detectedProvider;
      log(
        `[embeddings] provider fallback resolved before stage3 cache identity: ` +
        `${priorProvider} -> ${runtimeEmbeddingProvider}.`
      );
    }
    modelArtifact = await resolveEmbeddingArtifactIdentityAsync({ provider: runtimeEmbeddingProvider,
      modelId, modelsDir, rootDir: root, onnx: embeddingOnnx, modelProfile });
    // Resolve dimensions before any cache keys, pending state, or incremental
    // bundles are written; a ready identity must never carry unknown dims=0.
    ({ cacheIdentity, cacheIdentityKey, cacheKeyFlags } = buildCacheIdentityForProvider(runtimeEmbeddingProvider));
  }
  const effectiveMemory = config.memorySnapshot || readEffectiveMemory();
  const resolvedRawArgv = Array.isArray(rawArgv) ? rawArgv : [];
  const {
    scheduler,
    scheduleCompute,
    scheduleIo,
    scheduleNative,
    envelopeCpuConcurrency
  } = createEmbeddingsScheduler({
    argv,
    rawArgv: resolvedRawArgv,
    userConfig,
    rawEnv: config.rawEnv || process.env,
    envConfig,
    indexingConfig,
    signal: config.signal || null,
    memorySnapshot: effectiveMemory
  });
  cleanupScheduler = scheduler;
  await runtimeReceipts.resolved(cacheIdentity, cacheIdentityKey, scheduler);
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsDir = triageConfig.recordsDir;
  const buildStateTrackers = new Map();
  /**
   * Lazily initialize build-state tracking for each unique build root used by
   * stage3 so mixed-root mode runs emit accurate heartbeat/phase markers.
   *
   * @param {string|null} buildRoot
   * @returns {Promise<{
   *   root:string,
   *   hasBuildState:boolean,
   *   runningMarked:boolean,
   *   stopHeartbeat:() => void
   * }|null>}
   */
  const ensureBuildStateTracker = async (buildRoot) => {
    const key = normalizePath(buildRoot);
    if (!buildRoot || !key) return null;
    if (buildStateTrackers.has(key)) return buildStateTrackers.get(key);
    const buildStatePath = resolveBuildStatePath(buildRoot);
    const hasBuildState = Boolean(buildStatePath && await pathExists(buildStatePath));
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
  const persistentTextCacheStore = null;
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
   * @returns {Promise<void>}
   */
  const queueBackgroundSqliteMaintenance = async ({ mode, denseCount, modeIndexRoot, sqlitePathsForMode }) => {
    if (maintenanceConfig.background !== true || isTestingEnv()) return;
    if (mode !== 'code' && mode !== 'prose') return;
    /**
     * Return file size in bytes when target is a regular file.
     *
     * Missing/non-file/unreadable paths resolve to `null` so maintenance
     * eligibility checks stay fail-closed without surfacing transient errors.
     *
     * @param {string|null|undefined} targetPath
     * @returns {Promise<number|null>}
     */
    const safeStatSize = async (targetPath) => {
      if (!targetPath) return null;
      try {
        const stats = await fs.stat(targetPath);
        if (!stats?.isFile?.()) return null;
        return Number(stats.size) || 0;
      } catch {
        return null;
      }
    };
    const dbPath = mode === 'code' ? sqlitePathsForMode?.codePath : sqlitePathsForMode?.prosePath;
    const dbBytes = await safeStatSize(dbPath);
    if (!Number.isFinite(dbBytes)) return;
    const walPath = `${dbPath}-wal`;
    const walBytes = (await safeStatSize(walPath)) || 0;
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
  const validModes = new Set(['code', 'prose', 'extracted-prose', 'records']);
  const writerStatsByMode = {};
  const crossFileChunkDedupeEnabled = !stubFastPathEnabled
    && embeddingsConfig?.crossFileChunkDedupe !== false;
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
      activeReceiptMode = mode;
      if (!validModes.has(mode)) {
        fail(`Invalid mode: ${mode}`);
      }
      let stageCheckpoints = null;
      let modeWriterQueue = null;
      modeTask.set(completedModes, modes.length, { message: `building ${mode}` });
      /**
       * Mark one mode complete in top-level progress task.
       *
       * @param {string} message
       * @returns {void}
       */
      const finishMode = async (message) => {
        if (message.startsWith('skipped ')) {
          indexState.embeddings = { ...indexState.embeddings, ready: false, pending: false };
          indexState.extensions = { ...indexState.extensions, runtimeEmbeddingObservation: runtimeReceipts.observation(mode), runtimeOutcome: 'skipped-no-embedding-inputs' };
          await scheduleIo(() => writeIndexState(statePath, indexState));
        }
        await runtimeReceipts.complete(mode);
        completedModes += 1;
        modeTask.set(completedModes, modes.length, { message });
      };
      let cacheAttempts = 0;
      let cacheHits = 0;
      let cacheMisses = 0;
      let cacheRejected = 0;
      let cacheFastRejects = 0;
      const chunkMetaMaxBytes = resolveEmbeddingsChunkMetaMaxBytes(indexingConfig);
      const modeIndexRoot = receiptRoots.find(([selectedMode]) => selectedMode === mode)?.[1];
      const modeTracker = await ensureBuildStateTracker(modeIndexRoot);
      if (modeTracker?.hasBuildState && !modeTracker.runningMarked) {
        await markBuildPhase(modeIndexRoot, 'stage3', 'running');
        modeTracker.runningMarked = true;
      }
      if (explicitIndexRoot && !(await hasModeArtifacts(modeIndexRoot, mode))) {
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
      const priorBackendState = structuredClone(indexState.embeddings || {});
      let priorBackendManifest = null;
      if (priorBackendState.ready && !priorBackendState.pending) {
        try { priorBackendManifest = loadPiecesManifest(indexDir, { strict: true, repoRoot: root }); }
        catch (error) { warn(`[embeddings] ${mode}: prior backend reuse unavailable: ${error.message}`); }
      }
      indexState.extensions = { ...indexState.extensions, runtimeAttemptId: runtimeReceipts.reference(mode) };
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
      await scheduleIo(() => writeIndexState(statePath, indexState));

      let fileTask = null;
      let chunkTask = null;
      let cacheTask = null;
      let embedTask = null;
      let writerTask = null;
      let bundleTask = null;
      let backendTask = null;
      try {
        const incremental = loadIncrementalManifest(repoCacheRoot, mode, { repoRoot: root });
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
              const normalizedFilePath = canonicalBundleSourceKey(filePath);
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
          if (isChunkMetaTooLargeError(err)) {
            warn(
              `[embeddings] chunk_meta exceeded budget for ${mode} ` +
              `(${chunkMetaMaxBytes} bytes); using incremental bundles if available.`
            );
          } else if (!isMissingArtifactError(err, 'chunk_meta')) {
            warn(`[embeddings] Failed to load chunk_meta for ${mode}: ${err?.message || err}`);
          }
          loadedChunkMetaFromArtifacts = false;
        }
        if (!loadedChunkMetaFromArtifacts) {
          if (!manifestFiles || !Object.keys(manifestFiles).length) {
            warn(`[embeddings] Missing chunk_meta and no incremental bundles for ${mode}; skipping.`);
            await finishMode(`skipped ${mode}`);
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
            await finishMode(`skipped ${mode}`);
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
        const hnswResults = { merged: null, doc: null, code: null };

        const modePersistentCacheEnabled = !stubFastPathEnabled && embeddingArtifactReusable(modelArtifact);
        const modeGlobalChunkCacheEnabled = modePersistentCacheEnabled;
        if (stubFastPathEnabled) {
          log(`[embeddings] ${mode}: stub fast-path active; persistent/global chunk cache disabled.`);
        }
        const cacheDir = modePersistentCacheEnabled
          ? resolveCacheDir(cacheRoot, cacheIdentity, mode)
          : null;
        if (cacheDir) {
          await scheduleIo(() => fs.mkdir(cacheDir, { recursive: true }));
        }
        let cacheIndex = cacheDir
          ? await scheduleIo(() => readCacheIndex(cacheDir, cacheIdentityKey))
          : null;
        const legacyCacheDir = cacheDir ? resolveLegacyCacheDir(cacheRoot, cacheIdentity, mode) : null;
        const legacyCacheIndex = legacyCacheDir ? await scheduleIo(() => readCacheIndex(legacyCacheDir, cacheIdentityKey)) : null;
        const fileCacheFallbacks = legacyCacheDir ? [{ cacheDir: legacyCacheDir, cacheIndex: legacyCacheIndex, allowUnindexedStandalone: true }] : [];
        let cacheIndexDirty = false;
        const cacheMeta = modePersistentCacheEnabled
          ? await scheduleIo(() => readCacheMeta(cacheRoot, cacheIdentity, mode))
          : null;
        const cacheMetaMatches = cacheMeta?.identityKey === cacheIdentityKey;
        let cacheEligible = modePersistentCacheEnabled;
        if (cacheMeta?.identityKey && !cacheMetaMatches) {
          warn(`[embeddings] ${mode} cache identity mismatch; ignoring cached vectors.`);
          cacheEligible = false;
          cacheIndex = {
            ...cacheIndex,
            entries: {},
            files: {},
            shards: {},
            currentShard: null,
            nextShardId: 0
          };
          cacheIndexDirty = true;
        }

        const globalChunkCacheDir = modeGlobalChunkCacheEnabled
          ? resolveGlobalChunkCacheDir(cacheRoot, cacheIdentity)
          : null;
        if (globalChunkCacheDir) {
          await scheduleIo(() => fs.mkdir(globalChunkCacheDir, { recursive: true }));
        }
        const globalChunkCacheIndex = globalChunkCacheDir ? await scheduleIo(() => readCacheIndex(globalChunkCacheDir, cacheIdentityKey)) : null;
        const legacyGlobalChunkDir = globalChunkCacheDir ? resolveLegacyCacheDir(cacheRoot, cacheIdentity, 'global-chunks') : null;
        const legacyGlobalChunkIndex = legacyGlobalChunkDir ? await scheduleIo(() => readCacheIndex(legacyGlobalChunkDir, cacheIdentityKey)) : null;
        const globalCacheFallbacks = legacyGlobalChunkDir ? [{ cacheDir: legacyGlobalChunkDir, cacheIndex: legacyGlobalChunkIndex, allowUnindexedStandalone: true }] : [];
        const cacheBatchReader = createCacheBatchReader({cacheDir,cacheIndex,scheduleIo,fallbacks:fileCacheFallbacks,
          hydrateEntry: async entry => {
            if (!entry.chunkReferences) return entry;
            try { return await scheduleIo(() => withEmbeddingCacheReadLock(globalChunkCacheDir,
              () => hydrateReferencedFileCache({ entry, identityKey: cacheIdentityKey,
                readChunks: keys => readCacheEntries(globalChunkCacheDir, keys, globalChunkCacheIndex) }))); }
            catch (error) { if (isAbortError(error)) throw error; return null; }
          } });
        const globalChunkCacheMemo = new Map();
        let crossFileChunkDedupeHits = 0;
        let crossFileChunkDedupeStores = 0;
        let globalChunkCacheAttempts = 0;
        let globalChunkCacheHits = 0;
        let globalChunkCacheMisses = 0;
        let globalChunkCacheRejected = 0;
        let globalChunkCacheStores = 0;
        const resolveGlobalChunkVectors = async (chunkHash, prefetched = undefined) => {
          if (!modeGlobalChunkCacheEnabled || !globalChunkCacheDir) return null;
          globalChunkCacheAttempts += 1;
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
                const cachedResult = prefetched === undefined
                  ? (await scheduleIo(() => readCacheEntries(globalChunkCacheDir, [cacheKey], globalChunkCacheIndex, { fallbacks: globalCacheFallbacks })))[0] : prefetched;
                const cached = cachedResult?.entry || null;
                if (!cached) {
                  globalChunkCacheMisses += 1;
                  return { cacheKey, vectors: null, rejected: false };
                }
                if (!isGlobalChunkCacheValid({
                  cached,
                  identityKey: cacheIdentityKey,
                  chunkHash
                })) {
                  globalChunkCacheRejected += 1;
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
                  globalChunkCacheRejected += 1;
                  return { cacheKey, vectors: null, rejected: true };
                }
                globalChunkCacheHits += 1;
                return {
                  cacheKey,
                  vectors: { code: codeVec, doc: docVec, merged: mergedVec },
                  rejected: false
                };
              } catch (err) {
                if (isDimsMismatch(err)) throw err;
                globalChunkCacheRejected += 1;
                return { cacheKey, vectors: null, rejected: true };
              }
            })();
            globalChunkCacheMemo.set(cacheKey, pending);
          }
          return pending;
        };

        const dimsValidator = createDimsValidator({ mode, configuredDims: cacheDims });
        const assertDims = dimsValidator.assertDims;

        if (configuredDims && cacheEligible) {
          if (cacheMetaMatches && Number.isFinite(Number(cacheMeta?.dims))) {
            const cachedDims = Number(cacheMeta.dims);
            if (cachedDims !== configuredDims) {
              throw new Error(
                `[embeddings] ${mode} cache dims mismatch (configured=${configuredDims}, cached=${cachedDims}).`
              );
            }
          }
        }

        /**
         * Mark cache index dirty so background flush can persist updates.
         *
         * @returns {void}
         */
        const markCacheIndexDirty = () => {
          cacheIndexDirty = true;
        };
        let cacheIndexFlushInFlight = null;
        /**
         * Flush cache index opportunistically or forcefully at shutdown points.
         *
         * @param {{force?:boolean}} [input]
         * @returns {Promise<void>}
         */
        const flushCacheIndexMaybe = async ({ force = false } = {}) => {
          if (!cacheIndex || !cacheEligible) return;
          if (!force) return;
          if (cacheIndexFlushInFlight) {
            if (force) {
              await cacheIndexFlushInFlight;
            }
            return;
          }
          if (!cacheIndexDirty) {
            return;
          }
          cacheIndexFlushInFlight = (async () => {
            const flushState = await flushCacheIndexIfNeeded({
              cacheDir,
              cacheIndex,
              cacheEligible,
              cacheIndexDirty,
              cacheIdentityKey,
              cacheMaxBytes,
              cacheMaxAgeMs,
              scheduleIo
            });
            cacheIndexDirty = flushState.cacheIndexDirty;
            if (flushState.flushResult?.budgetExceeded) warn(`[embeddings-cache] Physical storage remains above ${cacheMaxBytes} bytes; protected metadata or open cache files remain.`);
          })();
          try {
            await cacheIndexFlushInFlight;
          } finally {
            cacheIndexFlushInFlight = null;
          }
        };

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
        const ioTokensTotal = Number.isFinite(Number(schedulerStatsForWriter?.tokens?.io?.total))
          ? Math.max(1, Math.floor(Number(schedulerStatsForWriter.tokens.io.total)))
          : 1;
        const computeTokensTotal = Number.isFinite(Number(schedulerStatsForWriter?.tokens?.cpu?.total))
          ? Math.max(1, Math.floor(Number(schedulerStatsForWriter.tokens.cpu.total)))
          : 1;
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
        const fdConcurrencyCap = resolveEmbeddingFdCap({
          schedulerStats: schedulerStatsForWriter, staticFdCap
        });
        const fileParallelism = resolveEmbeddingsFileParallelism({
          indexingConfig,
          computeTokensTotal,
          cpuConcurrency: envelopeCpuConcurrency,
          fdConcurrencyCap
        });
        const adaptiveFileParallelismEnabled = fileParallelism > 1
          && indexingConfig?.embeddings?.adaptiveFileParallelism !== false;
        const adaptiveFileParallelismCeiling = adaptiveFileParallelismEnabled
          ? resolveEmbeddingsAdaptiveFileParallelismCeiling({
            baseFileParallelism: fileParallelism,
            maxMultiplier: indexingConfig?.embeddings?.adaptiveFileParallelismMaxMultiplier,
            computeTokensTotal,
            cpuConcurrency: envelopeCpuConcurrency,
            fdConcurrencyCap
          })
          : fileParallelism;
        const fileAdmission = createEmbeddingFileAdmission({ scheduler, staticFdCap,
          baseConcurrency: fileParallelism, ceiling: adaptiveFileParallelismCeiling,
          adaptive: adaptiveFileParallelismEnabled, config: indexingConfig?.embeddings });
        let adaptiveFileParallelismCurrent = fileParallelism;
        let adaptiveFileParallelismAdjustments = 0;
        const resolveAdaptiveFileParallelism = () => {
          adaptiveFileParallelismCurrent = fileAdmission.resolve();
          adaptiveFileParallelismAdjustments = fileAdmission.stats().adjustments;
          return adaptiveFileParallelismCurrent;
        };
        const bundleRefreshParallelism = resolveEmbeddingsBundleRefreshParallelism({
          indexingConfig,
          ioTokensTotal
        });
        const backendParallelDispatch = getChunkEmbeddings?.supportsParallelDispatch === true;
        const parallelBatchDispatch = backendParallelDispatch && computeTokensTotal > 1;
        const mergeCodeDocBatches = indexingConfig?.embeddings?.mergeCodeDocBatches !== false;
        const globalMicroBatchingEnabled = !stubFastPathEnabled
          && indexingConfig?.embeddings?.globalMicroBatching !== false;
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
              const counts = estimated.map((value, index) => {
                const numeric = Math.floor(Number(value));
                return Number.isFinite(numeric) && numeric > 0
                  ? numeric
                  : estimateEmbeddingTokensFallback(texts[index]);
              });
              if (typeof estimated.release === 'function') Object.defineProperty(counts, 'release', { value: estimated.release });
              return counts;
            } catch {
              return null;
            }
          }
          : null;
        const estimateEmbeddingTokens = (text) => estimateEmbeddingTokensFallback(text);
        const textReuseCacheEntries = resolveEmbeddingsTextReuseCacheEntries(indexingConfig);
        const textReuseMaxTextChars = resolveEmbeddingsTextReuseMaxTextChars(indexingConfig);
        const inFlightClaimsMaxEntries = Math.max(
          textReuseCacheEntries,
          coercePositiveIntMinOne(indexingConfig?.embeddings?.inFlightTextCoalesceEntries)
            || DEFAULT_EMBEDDINGS_IN_FLIGHT_CLAIMS_MAX_ENTRIES
        );
        const sqliteDenseWriteBatchSize = resolveEmbeddingsSqliteDenseWriteBatchSize(indexingConfig);
        const embeddingTextCache = createEmbeddingTextReuseCache({
          maxBytes: Math.max(1, Math.min(64 * 1024 * 1024, Math.floor(effectiveMemory.freeBytes * 0.05))),
          maxEntries: textReuseCacheEntries,
          maxTextChars: textReuseMaxTextChars,
          persistentStore: persistentTextCacheStore
        });
        const embeddingInFlightCoalescer = stubFastPathEnabled
          ? null
          : createEmbeddingInFlightCoalescer({
            maxEntries: inFlightClaimsMaxEntries
          });
        if (stubFastPathEnabled) {
          log(`[embeddings] ${mode}: stub fast-path active; global micro-batching/in-flight coalescing disabled.`);
        }
        if (fileParallelism > 1) {
          log(`[embeddings] ${mode}: file parallelism enabled (${fileParallelism} workers).`);
        }
        if (bundleRefreshParallelism > 1) {
          log(
            `[embeddings] ${mode}: incremental bundle refresh parallelism enabled `
              + `(${bundleRefreshParallelism} workers).`
          );
        }
        const writerAdmission = createEmbeddingWriterAdmission({ scheduler, indexingConfig });
        const writerQueue = modeWriterQueue = createBoundedWriterQueue({
          scheduleIo,
          signal: config.signal || null,
          maxPendingBytes: Math.max(1, Math.min(256 * 1024 * 1024, Math.floor(effectiveMemory.freeBytes * 0.1))),
          maxPending: writerAdmission.initialLimit,
          resolveMaxPending: writerAdmission.resolve
        });
        const cacheShardHandlePool = createShardAppendHandlePool();
        const progressHeartbeatMs = resolveEmbeddingsProgressHeartbeatMs(indexingConfig);
        const progressStartedAtMs = Date.now();
        const workEstimate = createEmbeddingWorkEstimate({ entries: sampledFileEntries,
          charsPerToken: embeddingCharsPerToken });
        let embeddingTextsScheduled = 0;
        let embeddingTextsResolved = 0;
        let embeddingTextsEmbedded = 0;
        let embeddingBatchesCompleted = 0;
        let embeddingBatchTokensProcessed = 0;
        let embeddingBatchComputeMs = 0;
        let embeddingBatchPaddedTokens = 0;
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
        let getBatchingStats = () => ({});
        /**
         * Build combined files/chunks throughput snapshot for current mode.
         *
         * @param {number} nowMs
         * @returns {object}
         */
        const buildPerfSnapshot = (nowMs) => {
          const elapsedSec = Math.max(0.001, (nowMs - progressStartedAtMs) / 1000);
          const filesPerSec = processedFiles / elapsedSec;
          const chunksPerSec = processedChunks / elapsedSec;
          const work = workEstimate.snapshot();
          const etaSeconds = work.etaSeconds;
          const etaText = formatEtaSeconds(etaSeconds, { fallback: 'n/a' });
          const cacheHitRate = cacheAttempts > 0 ? ((cacheHits / cacheAttempts) * 100) : null;
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
          const embedEtaSeconds = work.etaSeconds;
          const batchingStats = getBatchingStats();
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
            queue_io_pending: Number(ioQueueStats.pending || 0),
            queue_compute_running: Number(computeQueueStats.running || 0),
            queue_io_running: Number(ioQueueStats.running || 0),
            writer_peak_pending: writerStats.peakPending,
            writer_pending_bytes: writerStats.pendingBytes,
            writer_cap_reason: writerAdmission.stats().reason,
            batch_pending_requests: batchingStats.pendingRequests,
            batch_pending_texts: batchingStats.pendingTexts,
            batch_pending_tokens: batchingStats.pendingTokens,
            provider_active: batchingStats.activeProviderCalls,
            provider_peak_active: batchingStats.peakProviderCalls,
            inflight_live: inFlightStats.size,
            tokens_padded: embeddingBatchPaddedTokens,
            work_remaining_tokens_estimate: work.remainingTokens,
            work_remaining_groups: work.remainingGroups,
            eta_sample_batches: work.samples,
            eta_compute_seconds: work.etaSeconds,
            eta_basis: work.samples ? 'recent-token-cost' : 'warming-up'
          };
          return {
            elapsedSec,
            filesPerSec,
            chunksPerSec,
            etaSeconds,
            etaText,
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
        let lastPerfStatusLine = '';
        const emitProgressSnapshot = ({ force = false, summary = false } = {}) => {
          const nowMs = Date.now();
          if (!force && (nowMs - lastProgressEmitMs) < progressHeartbeatMs) return;
          lastProgressEmitMs = nowMs;
          const {
            filesPerSec,
            chunksPerSec,
            etaSeconds,
            etaText,
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
            log(perfStatusLine, { kind: 'status', stage: 'embeddings', mode });
          }
          const filesMessage = [
            `${processedFiles}/${sampledFileEntries.length} files`,
            `${processedChunks}/${sampledChunkCount} chunks`,
            `${filesPerSec.toFixed(1)} files/s`,
            `${chunksPerSec.toFixed(1)} chunks/s`,
            `compute eta ${etaText}`,
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
              attempts: cacheAttempts,
              hits: cacheHits,
              misses: cacheMisses,
              rejected: cacheRejected,
              fastRejects: cacheFastRejects,
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
            message: `${processedChunks}/${sampledChunkCount} chunks | ${chunksPerSec.toFixed(1)} chunks/s | compute eta ${etaText}`,
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
                `eta ${formatEtaSeconds(embedEtaSeconds, { fallback: 'n/a' })}`,
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
              cachedCodeVectors.push(reusedCode);
              cachedDocVectors.push(reusedDoc);
              cachedMergedVectors.push(reusedMerged);
              continue;
            }
            const embedCode = isVectorLike(fileCodeEmbeds[i]) ? fileCodeEmbeds[i] : [];
            const embedDoc = isVectorLike(docVectorsRaw[i]) ? docVectorsRaw[i] : [];
            const quantized = buildQuantizedVectors({
              codeVector: embedCode,
              docVector: embedDoc,
              zeroVector: zeroVec,
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

          if (crossFileChunkDedupeEnabled && crossFileChunkDedupe && Array.isArray(entry.chunkHashes)) {
            for (let i = 0; i < entry.chunkHashes.length; i += 1) {
              const chunkHash = entry.chunkHashes[i];
              if (!chunkHash) continue;
              const codeVec = cachedCodeVectors[i] || null;
              const docVec = cachedDocVectors[i] || null;
              const mergedVec = cachedMergedVectors[i] || null;
              if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
                continue;
              }
              if (!crossFileChunkDedupe.has(chunkHash)) {
                crossFileChunkDedupeStores += 1;
              }
              boundedMapSet(
                crossFileChunkDedupe,
                chunkHash,
                { code: codeVec, doc: docVec, merged: mergedVec },
                crossFileChunkDedupeMaxEntries
              );
            }
          }

          if (modeGlobalChunkCacheEnabled && globalChunkCacheDir && Array.isArray(entry.chunkHashes)) {
            try {
              const filePayload = cacheEligible && entry.cacheKey && entry.cacheDir ? {
                key: entry.cacheKey, file: entry.normalizedRel, hash: entry.fileHash,
                chunkSignature: entry.chunkSignature, chunkHashes: entry.chunkHashes,
                chunkHashesFingerprint: entry.chunkHashesFingerprint || null,
                cacheMeta: { schemaVersion: 2, identityKey: cacheIdentityKey, identity: cacheIdentity, createdAt: new Date().toISOString() }
              } : null;
              const referenced = buildReferencedFileCache({ filePayload, chunkHashes: entry.chunkHashes,
                codeVectors: cachedCodeVectors, docVectors: cachedDocVectors, mergedVectors: cachedMergedVectors,
                identityKey: cacheIdentityKey, identity: cacheIdentity,
                buildInputKey: chunkHash => buildGlobalChunkCacheKey({ chunkHash, identityKey: cacheIdentityKey,
                  featureFlags: cacheKeyFlags, pathPolicy: 'posix' }) });
              if (referenced) await writerQueue.enqueuePrepared({
                estimateBytes: Math.max(256, estimateRetainedBytes(referenced) * 2),
                prepare: async () => [
                  ...await runWithConcurrency(referenced.chunks, Math.max(1, Math.min(8, referenced.chunks.length)),
                    async chunk => ({ ...chunk, encodedPayload: await encodeCacheEntryPayload(chunk.payload) })),
                  ...(referenced.filePayload ? [{ kind: 'file-reference', encodedPayload: await encodeCacheEntryPayload(referenced.filePayload) }] : [])
                ],
                write: async prepared => {
                  const chunks = prepared.filter(item => item.kind !== 'file-reference');
                  const persisted = await writeReferencedCacheFile({ globalDir: globalChunkCacheDir, globalIndex: globalChunkCacheIndex,
                    fileDir: entry.cacheDir, fileIndex: cacheIndex, filePayload: referenced.filePayload,
                    encodedFile: prepared.find(item => item.kind === 'file-reference')?.encodedPayload,
                    chunks, mode, options: { shardHandlePool: cacheShardHandlePool } });
                  if (!persisted) return;
                  if (referenced.filePayload) markCacheIndexDirty();
                  for (const chunk of chunks) {
                    globalChunkCacheMemo.set(chunk.inputKey, Promise.resolve({ cacheKey: chunk.inputKey, vectors: chunk.vectors, rejected: false }));
                  }
                  globalChunkCacheStores += persisted.storedChunks;
                }
              });
            } catch (error) {
              if (isAbortError(error)) throw error;
              // Cache admission is optional; missing references are rebuilt from
              // source. Required published vector artifacts retain their owner.
            }
          }
          await markFileProcessed({
            chunkCount: entry.items.length,
            source: 'computed'
          });
        };

        const computeFileEmbeddings = createFileEmbeddingsProcessor({
          globalMicroBatchingMaxPendingBytes: Math.max(1, Math.min(64 * 1024 * 1024, Math.floor(effectiveMemory.freeBytes * 0.1))),
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
          onEmbeddingScheduled: ({ requested }) => { embeddingTextsScheduled += requested; },
          onEmbeddingPrepared: ({ groupId, tokens, delta }) => {
            if (delta) workEstimate.adjust(groupId, tokens);
            else workEstimate.prepare(groupId, tokens);
          },
          onEmbeddingBatch: ({
            groupTokens,
            paddedTokens,
            durationMs,
            batchTokens,
            targetBatchTokens,
            underfilledTokens,
            batchFillRatio,
            queueWaitMs,
            mergedRequests,
            mergedLabels
          }) => {
            workEstimate.batch({ groupTokens, batchTokens, durationMs });
            embeddingBatchPaddedTokens += Math.max(0, Number(paddedTokens) || 0);
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
        getBatchingStats = computeFileEmbeddings.batchingStats;
        try {
          /**
           * Process one file's chunk items with cache lookup and fallback compute.
           *
           * @param {[string, object[]]} input
           * @returns {Promise<void>}
           */
          const processFileEntryInner = async ([relPath, items]) => {
            const normalizedRel = canonicalBundleSourceKey(relPath);
            const chunkSignature = buildChunkSignature(items);
            const manifestEntry = manifestFiles[normalizedRel] || null;
            const manifestHash = typeof manifestEntry?.hash === 'string' ? manifestEntry.hash : null;
            let fileHash = cacheEligible ? manifestHash : null;
            let cacheKey = cacheEligible
              ? buildCacheKey({
                file: normalizedRel,
                hash: fileHash,
                signature: chunkSignature,
                identityKey: cacheIdentityKey,
                repoId: cacheRepoId,
                mode,
                featureFlags: cacheKeyFlags,
                pathPolicy: 'posix'
              })
              : null;
            let cachedResult = null;
            const canLookupWithManifestHash = cacheEligible && cacheKey && !!fileHash;
            if (canLookupWithManifestHash) {
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
                cachedResult = await cacheBatchReader.read(cacheKey);
              }
            }
            const cached = cachedResult?.entry;
            if (!cached && canLookupWithManifestHash) {
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
                  }
                  if (hasEmptyCached) {
                    throw new Error(`[embeddings] ${mode} cached vectors incomplete; recomputing ${normalizedRel}.`);
                  }
                  if (cacheIndex && cacheKey) {
                    updateCacheIndexAccess(cacheIndex, cacheKey);
                    if (!cacheIndex.files || typeof cacheIndex.files !== 'object') {
                      cacheIndex.files = {};
                    }
                    cacheIndex.files[normalizedRel] = cacheKey;
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
                  const shouldReadWithHash = cacheEligible && !fileHash;
                  if (shouldReadWithHash) {
                    textInfo = await scheduleIo(() => readTextFileWithHash(candidate));
                  } else {
                    const decoded = await scheduleIo(() => readTextFile(candidate));
                    textInfo = {
                      ...decoded,
                      hash: fileHash
                    };
                  }
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
            if (cacheEligible && !fileHash) {
              fileHash = textInfo.hash;
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
                  cachedAfterHash = await cacheBatchReader.read(cacheKey);
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
                    }
                    if (hasEmptyCached) {
                      throw new Error(`[embeddings] ${mode} cached vectors incomplete; recomputing ${normalizedRel}.`);
                    }
                    if (cacheIndex && cacheKey) {
                      updateCacheIndexAccess(cacheIndex, cacheKey);
                      if (!cacheIndex.files || typeof cacheIndex.files !== 'object') {
                        cacheIndex.files = {};
                      }
                      cacheIndex.files[normalizedRel] = cacheKey;
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

            const codeTexts = [];
            const docTexts = [];
            const codeMapping = [];
            const docMapping = [];
            const shouldHashChunks = cacheEligible || crossFileChunkDedupeEnabled || modeGlobalChunkCacheEnabled;
            const chunkHashes = shouldHashChunks ? new Array(items.length) : null;
            const chunkCodeTexts = new Array(items.length);
            const chunkDocTexts = new Array(items.length);
            for (let i = 0; i < items.length; i += 1) {
              const { chunk } = items[i];
              const start = Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : 0;
              const end = Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : start;
              const codeText = text.slice(start, end);
              const docText = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
              const trimmedDoc = docText.trim() ? docText : '';
              chunkCodeTexts[i] = codeText;
              chunkDocTexts[i] = trimmedDoc;
              if (chunkHashes) {
                chunkHashes[i] = sha1(`${codeText}\n${trimmedDoc}`);
              }
            }
            const chunkHashesFingerprint = cacheEligible && chunkHashes
              ? buildChunkHashesFingerprint(chunkHashes)
              : null;
            const reuse = {
              code: new Array(items.length).fill(null),
              doc: new Array(items.length).fill(null),
              merged: new Array(items.length).fill(null)
            };
            if (cacheEligible) {
              const priorKey = cacheIndex?.files?.[normalizedRel] || legacyCacheIndex?.files?.[normalizedRel];
              if (priorKey && priorKey !== cacheKey) {
                const clearStalePriorFileKey = () => {
                  if (!cacheIndex?.files || typeof cacheIndex.files !== 'object') return;
                  if (cacheIndex.files[normalizedRel] !== priorKey) return;
                  delete cacheIndex.files[normalizedRel];
                  markCacheIndexDirty();
                };
                const priorIndexEntry = cacheIndex?.entries?.[priorKey] || legacyCacheIndex?.entries?.[priorKey] || null;
                if (!priorIndexEntry) {
                  clearStalePriorFileKey();
                } else {
                  // Changed aggregate hashes are expected after a local edit.
                  // The existing bounded reader and exact identity/chunk proof
                  // decide reuse; a changed fingerprint is never stale evidence.
                  const priorResult = await cacheBatchReader.read(priorKey);
                  const priorEntry = priorResult?.entry;
                  if (!priorEntry) {
                    clearStalePriorFileKey();
                  } else if (Array.isArray(priorEntry.chunkHashes) && Array.isArray(chunkHashes)) {
                    reusePriorChunkVectors({ prior: priorEntry, chunkHashes, docTexts: chunkDocTexts,
                      identityKey: cacheIdentityKey, expectedDims: configuredDims || priorEntry.cacheMeta?.identity?.dims,
                      reuse });
                    updateCacheIndexAccess(cacheIndex, priorKey);
                    markCacheIndexDirty();
                  }
                }
              }
            }
            const globalBatchResults = new Map();
            if (modeGlobalChunkCacheEnabled && Array.isArray(chunkHashes)) {
              const missing = [...new Set(chunkHashes.filter((hash, index) =>
                hash && !reuse.code[index] && !crossFileChunkDedupe?.get(hash)))];
              const keys = missing.map(chunkHash => buildGlobalChunkCacheKey({
                identityKey: cacheIdentityKey, chunkHash, featureFlags: cacheKeyFlags, pathPolicy: 'posix'
              }));
              const results = await scheduleIo(() => readCacheEntries(globalChunkCacheDir, keys, globalChunkCacheIndex, { fallbacks: globalCacheFallbacks }));
              missing.forEach((hash,index)=>globalBatchResults.set(hash,results[index]));
            }
            for (let i = 0; i < items.length; i += 1) {
              if (
                !reuse.code[i]
                && !reuse.doc[i]
                && !reuse.merged[i]
                && crossFileChunkDedupeEnabled
                && crossFileChunkDedupe
                && Array.isArray(chunkHashes)
              ) {
                const chunkHash = chunkHashes[i];
                const deduped = chunkHash ? crossFileChunkDedupe.get(chunkHash) : null;
                if (
                  deduped
                  && isNonEmptyVector(deduped.code)
                  && isNonEmptyVector(deduped.doc)
                  && isNonEmptyVector(deduped.merged)
                ) {
                  reuse.code[i] = deduped.code;
                  reuse.doc[i] = deduped.doc;
                  reuse.merged[i] = deduped.merged;
                  crossFileChunkDedupeHits += 1;
                }
              }
              if (
                !reuse.code[i]
                && !reuse.doc[i]
                && !reuse.merged[i]
                && modeGlobalChunkCacheEnabled
                && Array.isArray(chunkHashes)
              ) {
                const chunkHash = chunkHashes[i];
                if (chunkHash) {
                  const globalChunkCached = await resolveGlobalChunkVectors(chunkHash, globalBatchResults.get(chunkHash));
                  const vectors = globalChunkCached?.vectors || null;
                  if (
                    vectors
                    && isNonEmptyVector(vectors.code)
                    && isNonEmptyVector(vectors.doc)
                    && isNonEmptyVector(vectors.merged)
                  ) {
                    reuse.code[i] = vectors.code;
                    reuse.doc[i] = vectors.doc;
                    reuse.merged[i] = vectors.merged;
                  }
                }
              }
              if (reuse.code[i] && reuse.doc[i] && reuse.merged[i]) {
                continue;
              }
              codeMapping.push(i);
              codeTexts.push(chunkCodeTexts[i]);
              docMapping.push(i);
              docTexts.push(chunkDocTexts[i]);
            }
            await computeFileEmbeddings({
              normalizedRel,
              items,
              cacheKey,
              cacheDir,
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
          };
          const processFileEntry = async (entry) => {
            await processFileEntryInner(entry);
            workEstimate.complete(entry[0]);
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
              1,
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
          await cacheBatchReader.drain();
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
        if (globalChunkCacheIndex) {
          const globalFlush = await scheduleIo(() => flushCacheIndex(globalChunkCacheDir, globalChunkCacheIndex, {identityKey:cacheIdentityKey, maxBytes:cacheMaxBytes, maxAgeMs:cacheMaxAgeMs}));
          if (globalFlush.budgetExceeded) warn(`[embeddings-cache] Global physical storage remains above ${cacheMaxBytes} bytes; protected metadata or open cache files remain.`);
        }

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
        || cacheDims
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
          repoRoot: root,
          signal: config.signal || null,
          repoCacheRoot,
          incremental,
          chunksByFile,
          mergedVectors,
          embeddingMode: resolvedEmbeddingMode,
          embeddingIdentityKey: cacheIdentityKey,
          parallelism: bundleRefreshParallelism,
          scheduleIo,
          log,
          warn
        });
        bundleTask.done({
          message: `${refreshedBundles.rewritten || 0}/${refreshedBundles.eligible || 0} rewritten`
        });
        if (refreshedBundles.scanned > 0 && !refreshedBundles.completeCoverage) {
          warn(
            `[embeddings] ${mode}: incremental bundle embedding coverage incomplete; ` +
            'sqlite incremental builds may fall back to artifacts.'
          );
        }

        const mergedVectorsBasePath = path.join(indexDir, 'dense_vectors_uint8');
        const docVectorsBasePath = path.join(indexDir, 'dense_vectors_doc_uint8');
        const codeVectorsBasePath = path.join(indexDir, 'dense_vectors_code_uint8');
        backendTask.set(0, 5, { message: 'writing dense vector artifacts' });
        if (traceArtifactIo) {
          log(`[embeddings] ${mode}: writing vectors to ${mergedVectorsBasePath}.meta.json + parts`);
          log(`[embeddings] ${mode}: writing vectors to ${docVectorsBasePath}.meta.json + parts`);
          log(`[embeddings] ${mode}: writing vectors to ${codeVectorsBasePath}.meta.json + parts`);
        }
        const embeddingGeneration = buildEmbeddingGeneration({ embeddingIdentity: cacheIdentity,
          chunksByFile, vectors: { merged: mergedVectors, doc: docVectors, code: codeVectors } });
        const vectorFields = {
          embeddingIdentity: cacheIdentity,
          embeddingGeneration,
          model: modelId,
          dims: finalDims,
          scale: denseScale,
          minVal: quantization.minVal,
          maxVal: quantization.maxVal,
          levels: quantization.levels
        };
        await runWithConcurrency(
          [
            { baseName: 'dense_vectors_uint8', vectors: mergedVectors },
            { baseName: 'dense_vectors_doc_uint8', vectors: docVectors },
            { baseName: 'dense_vectors_code_uint8', vectors: codeVectors }
          ],
          2,
          async ({ baseName, vectors }) => scheduleIo(() => writeDenseVectorArtifacts({
            indexDir,
            baseName,
            vectorFields,
            vectors,
            writeBinary: binaryDenseVectors
          })),
          { collectResults: false }
        );
        backendTask.set(1, 5, { message: 'building ANN backends (hnsw/lancedb)' });
        // The existing pending state keeps readers off these inputs. Isolated
        // writers require their newly written vectors to be manifest-declared;
        // a prior generation's manifest cannot authorize this handoff.
        await scheduleIo(() => updatePieceManifest({ indexDir, mode, totalChunks, dims: finalDims,
          backendPieces: [], embeddingGeneration }));
        logArtifactLocation(mode, 'dense_vectors_uint8_meta', `${mergedVectorsBasePath}.meta.json`);
        logArtifactLocation(mode, 'dense_vectors_doc_uint8_meta', `${docVectorsBasePath}.meta.json`);
        logArtifactLocation(mode, 'dense_vectors_code_uint8_meta', `${codeVectorsBasePath}.meta.json`);
        if (binaryDenseVectors) {
          logArtifactLocation(mode, 'dense_vectors_uint8_bin', `${mergedVectorsBasePath}.bin`);
          logArtifactLocation(mode, 'dense_vectors_doc_uint8_bin', `${docVectorsBasePath}.bin`);
          logArtifactLocation(mode, 'dense_vectors_code_uint8_bin', `${codeVectorsBasePath}.bin`);
        }

        const backendStageRoot = path.join(modeIndexRoot || indexDir, '.embeddings-backend-staging');
        const backendStageDir = await scheduleIo(async () => {
          await fs.mkdir(backendStageRoot, { recursive: true });
          return fs.mkdtemp(path.join(backendStageRoot, `index-${mode}-`));
        });
        const stagedHnswPaths = {
          merged: resolveHnswPaths(backendStageDir, 'merged'),
          doc: resolveHnswPaths(backendStageDir, 'doc'),
          code: resolveHnswPaths(backendStageDir, 'code')
        };
        let backendPublication, backendFailure = null;
        const nativeBackendWork = { hnsw: null, lancedb: null };
        try {
          const nativeAdmissionBytes = totalChunks * (finalDims * 4 + Math.max(1, Number(hnswConfig.m) || 16) * 16 + 64);
          const recordBackendFailure = failure => crashLogger.logError({ phase: `embeddings:${mode}`,
            stage: 'ann-child', mode, ...failure });
          const reuseBackend = ({ backend, variant, config: nativeConfig }) => reuseNativeBackend({ backend, variant,
            indexDir, stageDir: backendStageDir, priorManifest: priorBackendManifest, priorState: priorBackendState,
            embeddingIdentity: cacheIdentity, embeddingGeneration, config: nativeConfig, normalize: embeddingNormalize,
            dims: finalDims, modelId, quantization, scale: denseScale, signal: config.signal || null });
          const hnswBackendResults = await scheduleNative(() => writeHnswBackends({
            mode,
            hnswConfig,
            hnswIsolate,
            isolateState: hnswIsolateState,
            hnswPaths: stagedHnswPaths,
            vectors: { merged: mergedVectors, doc: docVectors, code: codeVectors },
            vectorsPaths: {
              merged: mergedVectorsBasePath,
              doc: docVectorsBasePath,
              code: codeVectorsBasePath
            },
            modelId,
            dims: finalDims,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            logger,
            log,
            warn,
            signal: config.signal || null,
            recordFailure: recordBackendFailure,
            reuse: reuseBackend
          }), { estimatedBytes: nativeAdmissionBytes });
          Object.assign(hnswResults, hnswBackendResults);
          nativeBackendWork.hnsw = hnswBackendResults.work || { childStarts: 0 };

          const lanceResults = await scheduleNative(() => writeLanceDbBackends({
            mode,
            indexDir: backendStageDir,
            lanceConfig,
            vectors: { merged: mergedVectors, doc: docVectors, code: codeVectors },
            vectorsPaths: {
              merged: mergedVectorsBasePath,
              doc: docVectorsBasePath,
              code: codeVectorsBasePath
            },
            dims: finalDims,
            modelId,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            logger,
            warn,
            signal: config.signal || null,
            recordFailure: recordBackendFailure,
            reuse: reuseBackend
          }), { estimatedBytes: totalChunks * (finalDims * 4 + 64) });
          nativeBackendWork.lancedb = lanceResults.work || { childStarts: 0 };
          backendPublication = await scheduleIo(() => publishBackendGeneration({
            stageDir: backendStageDir, indexDir, embeddingIdentity: cacheIdentity, embeddingGeneration,
            results: { hnsw: hnswResults, lancedb: lanceResults },
            enabled: { hnsw: hnswConfig.enabled === true, lancedb: lanceConfig.enabled === true }, warn
          }));
          backendTask.set(2, 5, { message: 'updating sqlite dense vectors' });
        } catch (error) {
          backendFailure = error;
          if (error.cacheOwnershipPending) error.backendStagePath = backendStageDir;
          throw error;
        } finally {
          // An unreaped child still owns this exact attempt's staging paths.
          // Cancellation cannot return that ownership early or let the next
          // invocation reuse/delete its directory. Ordinary cleanup must not
          // enqueue through the already-aborted production scheduler.
          if (!backendFailure?.cacheOwnershipPending) {
            try { await fs.rm(backendStageDir, { recursive: true, force: true }); }
            catch (error) {
              if (backendFailure) throw new AggregateError([backendFailure, error],
                `ANN build failed; cleanup retained at ${backendStageDir}`, { cause: backendFailure });
              throw error;
            }
          }
        }

        let sqliteVecState = { enabled: false, available: false };
        if (mode === 'code' || mode === 'prose') {
          const sqlitePathsForMode = resolveSqlitePaths(root, userConfig, { indexRoot: modeIndexRoot });
          const sqliteSharedDbForMode = sqlitePathsForMode?.codePath
            && sqlitePathsForMode?.prosePath
            && path.resolve(sqlitePathsForMode.codePath) === path.resolve(sqlitePathsForMode.prosePath);
          let sqliteResult;
          try {
            sqliteResult = await scheduleIo(() => runSqliteDenseWithBoundary({
              root,
              userConfig,
              indexRoot: modeIndexRoot,
              repoCacheRoot,
              mode,
              vectorsPath: mergedVectorsBasePath,
              dims: finalDims,
              scale: denseScale,
              modelId,
              quantization,
              dbPath: mode === 'code' ? sqlitePathsForMode?.codePath : sqlitePathsForMode?.prosePath,
              sharedDb: sqliteSharedDbForMode,
              writeBatchSize: sqliteDenseWriteBatchSize,
              emitOutput: true,
              warnOnMissing: false,
              crashLogger,
              buildId: modeIndexRoot ? path.basename(modeIndexRoot) : null,
              workerIdentity: `stage3-sqlite:${mode}`,
              logger,
              enableWindowsCrashCapture: envConfig?.benchRun === true || isTestingEnv()
            }));
          } catch (err) {
            crashLogger.logError({
              phase: `embeddings:${mode}`,
              stage: 'sqlite-dense-isolate',
              tool: 'sqlite-dense',
              workerId: err?.workerId || `stage3-sqlite:${mode}`,
              buildId: err?.buildId || (modeIndexRoot ? path.basename(modeIndexRoot) : null),
              bundleId: err?.bundleId || (modeIndexRoot ? path.basename(modeIndexRoot) : null),
              message: err?.message || String(err),
              code: err?.code || null,
              failureClass: err?.failureClass || null,
              file: mergedVectorsBasePath,
              indexRoot: modeIndexRoot,
              dbPath: mode === 'code' ? sqlitePathsForMode?.codePath : sqlitePathsForMode?.prosePath,
              replayBundlePath: err?.replayBundlePath || null,
              nativeCrash: err?.nativeCrash === true,
              dumpDir: err?.dumpDir || null,
              dumpFiles: Array.isArray(err?.dumpFiles) ? err.dumpFiles : [],
              exitCode: Number.isFinite(Number(err?.result?.exitCode)) ? Number(err.result.exitCode) : null,
              signal: typeof err?.result?.signal === 'string' ? err.result.signal : null,
              stderrTail: err?.result?.stderr || null,
              stdoutTail: err?.result?.stdout || null
            });
            throw err;
          }
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
              embeddingIdentity: cacheIdentity,
              embeddingGeneration,
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
              void logArtifactLocation(mode, 'dense_vectors_sqlite_vec_meta', sqliteMetaPath);
            } catch {}
          }
          void queueBackgroundSqliteMaintenance({
            mode,
            denseCount: Number.isFinite(sqliteResult?.count) ? Number(sqliteResult.count) : totalChunks,
            modeIndexRoot,
            sqlitePathsForMode
          });
        }
        backendTask.set(3, 5, { message: 'validating backend metadata' });

        const hnswTarget = resolveHnswTarget(mode, denseVectorMode);
        const hnswState = backendPublication.backends.hnsw[hnswTarget];
        const lanceTarget = resolveLanceDbTarget(mode, denseVectorMode);
        const lancedbState = backendPublication.backends.lancedb[lanceTarget];

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
            , nativeBackendWork
          }
        });

        const now = new Date().toISOString();
        indexState.generatedAt = indexState.generatedAt || now;
        indexState.updatedAt = now;
        indexState.mode = indexState.mode || mode;
        if (!indexState.extensions || typeof indexState.extensions !== 'object') indexState.extensions = {};
        indexState.extensions.annBuildWork = { schemaVersion: 1, ...nativeBackendWork };
        indexState.extensions.bundleEmbeddingSynchronization = {
          schemaVersion: 1, stage: 'stage3-bundle-synchronization',
          observation: refreshedBundles.coverage ? 'observed' : 'unknown',
          coverage: refreshedBundles.coverage || null,
          rewrittenFiles: refreshedBundles.rewritten || 0,
          rewriteFailures: refreshedBundles.rewriteFailures || 0,
          manifestWritten: refreshedBundles.manifestWritten === true
        };
        writerStatsByMode[mode] = writerQueue.stats();
        indexState.extensions = { ...indexState.extensions, runtimeAttemptId: runtimeReceipts.reference(mode), runtimeEmbeddingObservation: runtimeReceipts.observation(mode) };
        indexState.embeddings = {
          ...(indexState.embeddings || {}),
          enabled: true,
          ready: false,
          pending: true,
          mode: indexState.embeddings?.mode || resolvedEmbeddingMode,
          service: indexState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
          embeddingIdentity: cacheIdentity || indexState.embeddings?.embeddingIdentity || null,
          embeddingIdentityKey: cacheIdentityKey || indexState.embeddings?.embeddingIdentityKey || null,
          embeddingGeneration,
          lastError: null,
          cacheStats: {
            attempts: cacheAttempts,
            hits: cacheHits,
            misses: cacheMisses,
            rejected: cacheRejected,
            fastRejects: cacheFastRejects
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
        const validation = await publishEmbeddingGeneration({
          statePath, indexState,
          publishManifest: async () => {
            try {
              await scheduleIo(() => updatePieceManifest({ indexDir, mode, totalChunks, dims: finalDims,
                backendPieces: backendPublication.pieces, embeddingGeneration }));
              void logArtifactLocation(mode, 'pieces_manifest', path.join(indexDir, 'pieces', 'manifest.json'));
            } catch (error) {
              throw new Error(`Embedding generation manifest publication failed: ${error.message}`, { cause: error });
            }
          },
          validate: () => {
            logExpectedArtifacts(mode, indexDir, 'pre-validate');
            return scheduleIo(() => validateIndexArtifacts({
              root, indexRoot: modeIndexRoot, modes: [mode], userConfig, sqliteEnabled: false
            }));
          },
          commitReceipt: async () => {
            await runtimeReceipts.ready(mode, { cacheHits, totalChunks, scheduler, writer: writerStatsByMode[mode], cacheRoot,
              providerMeasurement: { execution: embedder.executionInfo(), stage3: {
                batches: embeddingBatchesCompleted, paddedTokens: embeddingBatchPaddedTokens,
                sourceTokens: embeddingBatchTokensProcessed, computeMs: embeddingBatchComputeMs,
                textCache: embeddingTextCache.stats(), memory: effectiveMemory
              } } });
            indexState.extensions.runtimeEmbeddingObservation = runtimeReceipts.observation(mode);
          }
        });
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

        if (modePersistentCacheEnabled) {
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
        }

        {
          const vectorSummary = `[embeddings] ${mode}: wrote ${totalChunks} vectors (dims=${finalDims}).`;
          log(vectorSummary, { kind: 'status', stage: 'embeddings', mode });
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
            `underfilled_tokens=${embeddingBatchUnderfilledTokens} wait=${avgQueueWaitMs.toFixed(1)}ms ` +
            `mergedRequests=${avgMergedRequests.toFixed(2)} mergedLabels=${avgMergedLabels.toFixed(2)}).`
          );
        }
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
        await finishMode(`built ${mode}`);
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
          if (modeWriterQueue) {
            await modeWriterQueue.onIdle();
            writerStatsByMode[mode] = modeWriterQueue.stats();
          }
          await runtimeReceipts.fail(err, mode, { writer: writerStatsByMode[mode] });
        } catch { /* Preserve the original failure when a best-effort snapshot fails. */ }
        failureState.extensions = { ...failureState.extensions,
          runtimeAttemptId: runtimeReceipts.reference(mode),
          runtimeEmbeddingObservation: runtimeReceipts.observation(mode) };
        // Terminal cleanup must persist after the run's signal has cancelled normal admission.
        try { await writeIndexState(statePath, failureState); } catch { /* Preserve the original failure. */ }
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
    try { await runtimeReceipts.fail(err); } catch { /* Preserve the original failure. */ }
    err.diagnosticEvidence = crashLogger.logError({
      phase: 'stage3',
      stage: 'embeddings',
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    throw err;
  } finally {
    await persistentTextCacheStore?.close?.();
  }
}
