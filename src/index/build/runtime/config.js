import crypto from 'node:crypto';
import { normalizeLimit, normalizeRatio, normalizeDepth } from './caps.js';
import { buildGeneratedPolicyConfig } from '../generated-policy.js';

export const formatBuildTimestamp = (date) => (
  // Keep second precision for shorter build roots on Windows path-length
  // constrained environments.
  date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
);

export const formatBuildNonce = (bytes = 4) => {
  const size = Number.isFinite(Number(bytes))
    ? Math.max(2, Math.floor(Number(bytes)))
    : 3;
  return crypto.randomBytes(size).toString('hex');
};

export const buildFileScanConfig = (indexingConfig) => {
  const fileScanConfig = indexingConfig.fileScan || {};
  const minifiedScanConfig = fileScanConfig.minified || {};
  const binaryScanConfig = fileScanConfig.binary || {};
  const defaultTier1ProbeBytes = normalizeLimit(fileScanConfig.sampleBytes, 8192);
  return {
    tier1ProbeBytes: Math.max(4096, Math.min(
      8192,
      normalizeLimit(fileScanConfig.tier1ProbeBytes, defaultTier1ProbeBytes)
    )),
    sampleBytes: normalizeLimit(fileScanConfig.sampleBytes, defaultTier1ProbeBytes),
    minified: {
      sampleMinBytes: normalizeLimit(minifiedScanConfig.sampleMinBytes, 4096),
      minChars: normalizeLimit(minifiedScanConfig.minChars, 1024),
      singleLineChars: normalizeLimit(minifiedScanConfig.singleLineChars, 4096),
      avgLineThreshold: normalizeLimit(minifiedScanConfig.avgLineThreshold, 300),
      maxLineThreshold: normalizeLimit(minifiedScanConfig.maxLineThreshold, 600),
      maxWhitespaceRatio: normalizeRatio(minifiedScanConfig.maxWhitespaceRatio, 0.2)
    },
    binary: {
      sampleMinBytes: normalizeLimit(binaryScanConfig.sampleMinBytes, 65536),
      maxNonTextRatio: normalizeRatio(binaryScanConfig.maxNonTextRatio, 0.3)
    }
  };
};

export const buildShardConfig = (indexingConfig) => {
  const shardsConfig = indexingConfig.shards || {};
  const shardsClusterConfig = shardsConfig.cluster && typeof shardsConfig.cluster === 'object'
    ? shardsConfig.cluster
    : {};
  const topLevelClusterConfig = indexingConfig.clusterMode && typeof indexingConfig.clusterMode === 'object'
    ? indexingConfig.clusterMode
    : {};
  const clusterConfig = {
    ...shardsClusterConfig,
    ...topLevelClusterConfig
  };
  const normalizeNonNegativeInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.floor(parsed);
  };
  const clusterEnabled = clusterConfig.enabled === true;
  const clusterWorkerCount = normalizeLimit(clusterConfig.workerCount, null);
  const clusterDeterministicMerge = clusterConfig.deterministicMerge !== false;
  const clusterMaxSubsetRetries = normalizeNonNegativeInt(
    clusterConfig.maxSubsetRetries,
    clusterEnabled ? 1 : 0
  );
  const clusterRetryDelayMs = normalizeNonNegativeInt(clusterConfig.retryDelayMs, 250);
  const enabled = shardsConfig.enabled === true || clusterEnabled;
  return {
    enabled,
    maxWorkers: normalizeLimit(shardsConfig.maxWorkers, null),
    maxShards: normalizeLimit(shardsConfig.maxShards, null),
    minFiles: normalizeLimit(shardsConfig.minFiles, null),
    dirDepth: normalizeDepth(shardsConfig.dirDepth, 0),
    maxShardBytes: normalizeLimit(shardsConfig.maxShardBytes, 64 * 1024 * 1024),
    maxShardLines: normalizeLimit(shardsConfig.maxShardLines, 200000),
    cluster: {
      enabled: clusterEnabled,
      workerCount: clusterWorkerCount,
      deterministicMerge: clusterDeterministicMerge,
      mergeOrder: clusterDeterministicMerge ? 'stable' : 'adaptive',
      maxSubsetRetries: clusterMaxSubsetRetries,
      retryDelayMs: clusterRetryDelayMs
    }
  };
};

export const buildGeneratedIndexingPolicyConfig = (indexingConfig) => (
  buildGeneratedPolicyConfig(indexingConfig || {})
);
