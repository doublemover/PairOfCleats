import crypto from 'node:crypto';
import path from 'node:path';
import { normalizeLimit, normalizeRatio, normalizeDepth } from './caps.js';
import { buildGeneratedPolicyConfig } from '../generated-policy.js';

/**
 * Format build timestamp token for artifact directory names.
 *
 * @param {Date} date
 * @returns {string}
 */
export const formatBuildTimestamp = (date) => (
  // Keep second precision for shorter build roots on Windows path-length
  // constrained environments.
  date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
);

/**
 * Format random build nonce.
 *
 * @param {number} [bytes]
 * @returns {string}
 */
export const formatBuildNonce = (bytes = 4) => {
  const size = Number.isFinite(Number(bytes))
    ? Math.max(2, Math.floor(Number(bytes)))
    : 3;
  return crypto.randomBytes(size).toString('hex');
};

/**
 * Resolve build id/build root (including collision-safe suffixing).
 *
 * @param {object} input
 * @param {string|null} [input.resolvedIndexRoot]
 * @param {string} input.buildsRoot
 * @param {string|null} [input.scmHeadId]
 * @param {string|null} [input.configHash]
 * @param {(path:string)=>boolean} input.existsSync
 * @returns {{buildId:string,buildRoot:string}}
 */
export const resolveRuntimeBuildRoot = ({
  resolvedIndexRoot = null,
  buildsRoot,
  scmHeadId = null,
  configHash = null,
  existsSync
}) => {
  const scmHeadShort = scmHeadId ? String(scmHeadId).slice(0, 7) : 'noscm';
  const configHash8 = configHash ? configHash.slice(0, 8) : 'nohash';
  const buildNonce = formatBuildNonce();
  const computedBuildIdBase = `${formatBuildTimestamp(new Date())}_${buildNonce}_${scmHeadShort}_${configHash8}`;
  let computedBuildId = computedBuildIdBase;
  let buildRoot = resolvedIndexRoot || path.join(buildsRoot, computedBuildId);
  if (!resolvedIndexRoot) {
    let suffix = 1;
    while (existsSync(buildRoot)) {
      computedBuildId = `${computedBuildIdBase}_${suffix.toString(36)}`;
      buildRoot = path.join(buildsRoot, computedBuildId);
      suffix += 1;
    }
  }
  const buildId = resolvedIndexRoot ? path.basename(buildRoot) : computedBuildId;
  return { buildId, buildRoot };
};

/**
 * Build normalized file-scan tuning config used by stage-0 discovery.
 *
 * @param {object} indexingConfig
 * @returns {object}
 */
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

/**
 * Build normalized shard/cluster config with deterministic merge defaults.
 *
 * @param {object} indexingConfig
 * @returns {object}
 */
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

/**
 * Build generated/minified/vendor indexing policy config.
 *
 * @param {object} indexingConfig
 * @returns {object}
 */
export const buildGeneratedIndexingPolicyConfig = (indexingConfig) => (
  buildGeneratedPolicyConfig(indexingConfig || {})
);
