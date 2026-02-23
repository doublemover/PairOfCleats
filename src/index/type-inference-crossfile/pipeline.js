import { getToolingConfig } from '../../shared/dict-utils.js';
import {
  buildCrossFileFingerprint,
  readCrossFileInferenceCache,
  resolveCrossFileCacheLocation,
  writeCrossFileInferenceCache
} from './cache.js';
import { runCrossFilePropagation } from './propagation.js';

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
    return { linkedCalls: 0, linkedUsages: 0, inferredReturns: 0, riskFlows: 0 };
  }

  const toolingConfig = useTooling ? getToolingConfig(rootDir) : null;
  const toolingTimeoutMs = Number.isFinite(Number(toolingConfig?.timeoutMs))
    ? Math.max(1000, Math.floor(Number(toolingConfig.timeoutMs)))
    : 15000;
  const toolingRetries = Number.isFinite(Number(toolingConfig?.maxRetries))
    ? Math.max(0, Math.floor(Number(toolingConfig.maxRetries)))
    : 2;
  const toolingBreaker = Number.isFinite(Number(toolingConfig?.circuitBreakerThreshold))
    ? Math.max(1, Math.floor(Number(toolingConfig.circuitBreakerThreshold)))
    : 3;
  const toolingLogDir = typeof toolingConfig?.logDir === 'string' && toolingConfig.logDir.trim()
    ? toolingConfig.logDir.trim()
    : null;

  const { cacheDir, cachePath } = resolveCrossFileCacheLocation({
    cacheRoot,
    cacheEnabled,
    rootDir
  });
  const crossFileFingerprint = buildCrossFileFingerprint({
    chunks,
    enableTypeInference,
    enableRiskCorrelation,
    useTooling,
    fileRelations
  });

  const cachedStats = await readCrossFileInferenceCache({
    cachePath,
    chunks,
    crossFileFingerprint,
    log
  });
  if (cachedStats) {
    return {
      ...cachedStats,
      cacheHit: true,
      fingerprint: crossFileFingerprint
    };
  }

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
    toolingConfig,
    toolingTimeoutMs,
    toolingRetries,
    toolingBreaker,
    toolingLogDir
  });

  await writeCrossFileInferenceCache({
    cacheDir,
    cachePath,
    chunks,
    crossFileFingerprint,
    stats
  });

  return {
    ...stats,
    cacheHit: false,
    fingerprint: crossFileFingerprint
  };
}
