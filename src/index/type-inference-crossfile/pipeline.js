import { getToolingConfig } from '../../shared/dict-utils.js';
import {
  buildCrossFileFingerprint,
  readCrossFileInferenceCache,
  resolveCrossFileCacheLocation,
  writeCrossFileInferenceCache
} from './cache.js';
import { runCrossFilePropagation } from './propagation.js';

const EMPTY_CROSS_FILE_STATS = Object.freeze({
  linkedCalls: 0,
  linkedUsages: 0,
  inferredReturns: 0,
  riskFlows: 0
});

const normalizeConfigInteger = ({ value, fallback, min }) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

const withCacheMetadata = ({ stats, crossFileFingerprint, cacheHit }) => ({
  ...stats,
  cacheHit,
  fingerprint: crossFileFingerprint
});

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
  inferenceLite = false,
  inferenceLiteHighSignalOnly = true
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
    ...toolingPropagationOptions
  });

  await writeCrossFileInferenceCache({
    cacheDir: cacheContext.cacheDir,
    cachePath: cacheContext.cachePath,
    chunks,
    crossFileFingerprint: cacheContext.crossFileFingerprint,
    stats
  });

  return withCacheMetadata({
    stats,
    crossFileFingerprint: cacheContext.crossFileFingerprint,
    cacheHit: false
  });
}
