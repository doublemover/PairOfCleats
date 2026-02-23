import { MAX_JSON_BYTES } from '../../../../src/shared/artifact-io.js';
import { coercePositiveIntMinOne } from '../../../../src/shared/number-coerce.js';

const DEFAULT_EMBEDDINGS_CHUNK_META_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_EMBEDDINGS_PROGRESS_HEARTBEAT_MS = 1500;
const DEFAULT_EMBEDDINGS_FILE_PARALLELISM = 2;
const DEFAULT_EMBEDDINGS_BUNDLE_REFRESH_PARALLELISM = 2;

/**
 * Resolve max chunk-meta payload size used when loading chunk metadata for
 * embeddings generation.
 *
 * @param {object} indexingConfig
 * @returns {number}
 */
export const resolveEmbeddingsChunkMetaMaxBytes = (indexingConfig) => {
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
export const resolveEmbeddingsProgressHeartbeatMs = (indexingConfig) => {
  const configured = Number(indexingConfig?.embeddings?.progressHeartbeatMs);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1000, Math.floor(configured));
  }
  return DEFAULT_EMBEDDINGS_PROGRESS_HEARTBEAT_MS;
};

/**
 * Resolve per-file embedding compute concurrency.
 *
 * HNSW writes are forced single-threaded to preserve deterministic builder
 * behavior while non-HNSW runs can fan out by config or token budget.
 *
 * @param {{indexingConfig:object,computeTokensTotal:number|null,hnswEnabled:boolean}} input
 * @returns {number}
 */
export const resolveEmbeddingsFileParallelism = ({
  indexingConfig,
  computeTokensTotal,
  hnswEnabled
}) => {
  if (hnswEnabled) return 1;
  const configured = coercePositiveIntMinOne(indexingConfig?.embeddings?.fileParallelism);
  if (configured) return configured;
  const tokenDriven = coercePositiveIntMinOne(computeTokensTotal);
  return tokenDriven || DEFAULT_EMBEDDINGS_FILE_PARALLELISM;
};

/**
 * Resolve per-bundle concurrency used when refreshing incremental stage-3
 * embedding payloads.
 *
 * @param {{indexingConfig:object,ioTokensTotal:number|null}} input
 * @returns {number}
 */
export const resolveEmbeddingsBundleRefreshParallelism = ({
  indexingConfig,
  ioTokensTotal
}) => {
  const configured = coercePositiveIntMinOne(indexingConfig?.embeddings?.bundleRefreshParallelism);
  if (configured) return configured;
  const tokenDriven = coercePositiveIntMinOne(ioTokensTotal);
  if (tokenDriven) {
    return Math.max(1, Math.min(8, tokenDriven));
  }
  return DEFAULT_EMBEDDINGS_BUNDLE_REFRESH_PARALLELISM;
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
export const resolveEmbeddingSamplingConfig = ({ embeddingsConfig, env } = {}) => {
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
 * Inline HNSW builders are fed during per-file embedding compute and therefore
 * only observe processed files. When sampling is active we must defer HNSW
 * construction until after missing vectors are filled so backend counts remain
 * aligned with chunk_meta length for validation.
 *
 * @param {{enabled:boolean,hnswIsolate:boolean,samplingActive:boolean}} input
 * @returns {boolean}
 */
export const shouldUseInlineHnswBuilders = ({ enabled, hnswIsolate, samplingActive }) => (
  enabled === true && hnswIsolate !== true && samplingActive !== true
);
