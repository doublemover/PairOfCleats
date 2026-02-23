const estimateEntryBytes = (entry) => {
  const statSize = Number(entry?.stat?.size);
  if (Number.isFinite(statSize) && statSize >= 0) return statSize;
  const entrySize = Number(entry?.size);
  if (Number.isFinite(entrySize) && entrySize >= 0) return entrySize;
  return 0;
};

const estimateRepoLinesFromEntries = (entries = []) => {
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += estimateEntryBytes(entry);
  }
  // Conservative estimate; source trees with short lines still remain under
  // tiny thresholds due the explicit file/byte guards.
  const estimatedLines = Math.floor(totalBytes / 48);
  return {
    totalBytes,
    estimatedLines
  };
};

/**
 * Resolve tiny-repo fast-path activation and shortcut settings.
 *
 * @param {{runtime:object,entries:Array<object>}} [input]
 * @returns {object}
 */
export const resolveTinyRepoFastPath = ({ runtime, entries = [] } = {}) => {
  const config = runtime?.indexingConfig?.tinyRepoFastPath
    && typeof runtime.indexingConfig.tinyRepoFastPath === 'object'
    ? runtime.indexingConfig.tinyRepoFastPath
    : {};
  const enabled = config.enabled === true;
  if (!enabled) {
    return {
      enabled: false,
      active: false,
      reason: 'disabled-or-unconfigured',
      estimatedLines: 0,
      totalBytes: 0,
      fileCount: Array.isArray(entries) ? entries.length : 0
    };
  }
  const fileCount = Array.isArray(entries) ? entries.length : 0;
  const { totalBytes, estimatedLines } = estimateRepoLinesFromEntries(entries);
  const maxEstimatedLines = Number.isFinite(Number(config.maxEstimatedLines))
    ? Math.max(1000, Math.floor(Number(config.maxEstimatedLines)))
    : 5000;
  const maxFiles = Number.isFinite(Number(config.maxFiles))
    ? Math.max(1, Math.floor(Number(config.maxFiles)))
    : 256;
  const maxBytes = Number.isFinite(Number(config.maxBytes))
    ? Math.max(64 * 1024, Math.floor(Number(config.maxBytes)))
    : 3 * 1024 * 1024;
  const active = fileCount > 0
    && fileCount <= maxFiles
    && totalBytes <= maxBytes
    && estimatedLines <= maxEstimatedLines;
  return {
    enabled: true,
    active,
    reason: active ? 'threshold-match' : 'threshold-miss',
    estimatedLines,
    totalBytes,
    fileCount,
    maxEstimatedLines,
    maxFiles,
    maxBytes,
    disableImportGraph: active && config.disableImportGraph !== false,
    disableCrossFileInference: active && config.disableCrossFileInference !== false,
    minimalArtifacts: active && config.minimalArtifacts !== false
  };
};
