import { normalizeLimit, normalizeRatio, normalizeDepth } from './caps.js';

export const formatBuildTimestamp = (date) => (
  date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
);

export const buildFileScanConfig = (indexingConfig) => {
  const fileScanConfig = indexingConfig.fileScan || {};
  const minifiedScanConfig = fileScanConfig.minified || {};
  const binaryScanConfig = fileScanConfig.binary || {};
  return {
    sampleBytes: normalizeLimit(fileScanConfig.sampleBytes, 8192),
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
  return {
    enabled: shardsConfig.enabled === true,
    maxWorkers: normalizeLimit(shardsConfig.maxWorkers, null),
    maxShards: normalizeLimit(shardsConfig.maxShards, null),
    minFiles: normalizeLimit(shardsConfig.minFiles, null),
    dirDepth: normalizeDepth(shardsConfig.dirDepth, 0),
    maxShardBytes: normalizeLimit(shardsConfig.maxShardBytes, 64 * 1024 * 1024),
    maxShardLines: normalizeLimit(shardsConfig.maxShardLines, 200000)
  };
};
