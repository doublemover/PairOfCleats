import { getToolingConfig } from '../../shared/dict-utils.js';
import {
  buildCrossFileFingerprint,
  DEFAULT_CROSS_FILE_CACHE_MAX_BYTES,
  readCrossFileInferenceCache,
  resolveCrossFileCacheLocation,
  writeCrossFileInferenceCache
} from './cache.js';
import { runCrossFilePropagation } from './propagation.js';

const EMPTY_CROSS_FILE_STATS = Object.freeze({
  linkedCalls: 0,
  linkedUsages: 0,
  inferredReturns: 0,
  riskFlows: 0,
  toolingDegradedProviders: 0,
  toolingDegradedWarnings: 0,
  toolingDegradedErrors: 0,
  toolingProvidersExecuted: 0,
  toolingProvidersContributed: 0,
  toolingRequests: 0,
  toolingRequestFailures: 0,
  toolingRequestTimeouts: 0
});

/**
 * Parse integer config knobs with lower bound and fallback defaults.
 * @param {{value:unknown,fallback:number,min:number}} input
 * @returns {number}
 */
const normalizeConfigInteger = ({ value, fallback, min }) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

/**
 * Attach cache bookkeeping fields to inference stats.
 * @param {{stats:object,crossFileFingerprint:string,cacheHit:boolean}} input
 * @returns {object}
 */
const withCacheMetadata = ({ stats, crossFileFingerprint, cacheHit }) => ({
  ...stats,
  cacheHit,
  fingerprint: crossFileFingerprint
});

/**
 * Resolve optional tooling-assisted propagation options.
 *
 * When tooling is disabled this returns an empty object so downstream spreads
 * preserve existing defaults.
 *
 * @param {{rootDir:string,useTooling:boolean}} input
 * @returns {object}
 */
const resolveToolingPropagationOptions = ({ rootDir, useTooling }) => {
  if (!useTooling) return {};
  const toolingConfig = getToolingConfig(rootDir);
  const toolingLogDir = typeof toolingConfig?.logDir === 'string' && toolingConfig.logDir.trim()
    ? toolingConfig.logDir.trim()
    : null;
  return {
    toolingConfig,
    toolingTimeoutMs: normalizeConfigInteger({
      value: toolingConfig?.timeoutMs,
      fallback: 15000,
      min: 1000
    }),
    toolingRetries: normalizeConfigInteger({
      value: toolingConfig?.maxRetries,
      fallback: 2,
      min: 0
    }),
    toolingBreaker: normalizeConfigInteger({
      value: toolingConfig?.circuitBreakerThreshold,
      fallback: 3,
      min: 1
    }),
    toolingLogDir
  };
};

/**
 * Resolve cache paths and deterministic fingerprint inputs.
 * @param {object} input
 * @returns {{cacheDir:string|null,cachePath:string|null,crossFileFingerprint:string}}
 */
const resolveCacheContext = ({
  cacheRoot,
  cacheEnabled,
  rootDir,
  chunks,
  enableTypeInference,
  enableRiskCorrelation,
  useTooling,
  fileRelations
}) => {
  const { cacheDir, cachePath } = resolveCrossFileCacheLocation({
    cacheRoot,
    cacheEnabled,
    rootDir
  });
  return {
    cacheDir,
    cachePath,
    crossFileFingerprint: buildCrossFileFingerprint({
      chunks,
      enableTypeInference,
      enableRiskCorrelation,
      useTooling,
      fileRelations
    })
  };
};

/**
 * Run cross-file inference with cache reuse and optional tooling backends.
 *
 * Cache behavior:
 * 1. Compute deterministic fingerprint from chunk graph + inference knobs.
 * 2. Return cached stats when fingerprint and chunk identities match.
 * 3. Otherwise run propagation and write cache entry for future runs.
 *
 * @param {object} params
 * @param {string} params.rootDir
 * @param {string} params.buildRoot
 * @param {string|null} [params.cacheRoot]
 * @param {boolean} [params.cacheEnabled=true]
 * @param {Array<object>} params.chunks
 * @param {boolean} params.enabled
 * @param {(line:string)=>void} [params.log]
 * @param {boolean} [params.useTooling=false]
 * @param {boolean} [params.enableTypeInference=true]
 * @param {boolean} [params.enableRiskCorrelation=false]
 * @param {object|null} [params.fileRelations]
 * @param {number} [params.crossFileCacheMaxBytes=8388608]
 * @param {boolean} [params.inferenceLite=false]
 * @param {boolean} [params.inferenceLiteHighSignalOnly=true]
 * @param {AbortSignal|null} [params.abortSignal=null]
 * @returns {Promise<object>}
 */
export async function applyCrossFileInference({
  rootDir,
  buildRoot,
  cacheRoot = null,
  cacheEnabled = true,
  chunks,
  enabled,
  log = () => {},
  useTooling = false,
  enableTypeInference = true,
  enableRiskCorrelation = false,
  fileRelations = null,
  crossFileCacheMaxBytes = DEFAULT_CROSS_FILE_CACHE_MAX_BYTES,
  inferenceLite = false,
  inferenceLiteHighSignalOnly = true,
  abortSignal = null
}) {
  if (!enabled) {
    return { ...EMPTY_CROSS_FILE_STATS };
  }

  const cacheContext = resolveCacheContext({
    cacheRoot,
    cacheEnabled,
    rootDir,
    chunks,
    enableTypeInference,
    enableRiskCorrelation,
    useTooling,
    fileRelations
  });

  const cachedStats = await readCrossFileInferenceCache({
    cachePath: cacheContext.cachePath,
    chunks,
    crossFileFingerprint: cacheContext.crossFileFingerprint,
    log
  });
  if (cachedStats) {
    return withCacheMetadata({
      stats: cachedStats,
      crossFileFingerprint: cacheContext.crossFileFingerprint,
      cacheHit: true
    });
  }

  const toolingPropagationOptions = resolveToolingPropagationOptions({
    rootDir,
    useTooling
  });
  const stats = await runCrossFilePropagation({
    rootDir,
    buildRoot,
    chunks,
    log,
    useTooling,
    enableTypeInference,
    enableRiskCorrelation,
    fileRelations,
    inferenceLite,
    inferenceLiteHighSignalOnly,
    abortSignal,
    ...toolingPropagationOptions
  });

  await writeCrossFileInferenceCache({
    cacheDir: cacheContext.cacheDir,
    cachePath: cacheContext.cachePath,
    chunks,
    crossFileFingerprint: cacheContext.crossFileFingerprint,
    stats,
    maxBytes: crossFileCacheMaxBytes,
    log
  });

  return withCacheMetadata({
    stats,
    crossFileFingerprint: cacheContext.crossFileFingerprint,
    cacheHit: false
  });
}
