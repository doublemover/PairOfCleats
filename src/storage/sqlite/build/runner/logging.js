/**
 * Build logger helpers that respect `emitOutput` and optional external logger.
 * @param {{emitOutput:boolean,externalLogger?:object|null}} input
 * @returns {{
 *   log:(message:string,meta?:object|null)=>void,
 *   warn:(message:string,meta?:object|null)=>void,
 *   error:(message:string,meta?:object|null)=>void
 * }}
 */
export const createRunnerLogger = ({ emitOutput, externalLogger = null }) => {
  const log = (message, meta = null) => {
    if (!emitOutput || !message) return;
    if (typeof externalLogger?.log === 'function') {
      externalLogger.log(message, meta);
      return;
    }
    console.error(message);
  };
  const warn = (message, meta = null) => {
    if (!emitOutput || !message) return;
    if (typeof externalLogger?.warn === 'function') {
      externalLogger.warn(message, meta);
      return;
    }
    if (typeof externalLogger?.log === 'function') {
      externalLogger.log(message, meta);
      return;
    }
    console.error(message);
  };
  const error = (message, meta = null) => {
    if (!emitOutput || !message) return;
    if (typeof externalLogger?.error === 'function') {
      externalLogger.error(message, meta);
      return;
    }
    if (typeof externalLogger?.log === 'function') {
      externalLogger.log(message, meta);
      return;
    }
    console.error(message);
  };
  return { log, warn, error };
};

/**
 * Format embedding stats for logging.
 * @param {object|null} stats
 * @returns {string|null}
 */
export const formatEmbedStats = (stats) => {
  if (!stats || typeof stats !== 'object') return null;
  const parts = [];
  if (Number.isFinite(stats.denseChunks) || Number.isFinite(stats.totalChunks)) {
    const dense = Number.isFinite(stats.denseChunks) ? stats.denseChunks : 0;
    const total = Number.isFinite(stats.totalChunks) ? stats.totalChunks : 0;
    parts.push(`chunks ${dense}/${total}`);
  }
  if (Number.isFinite(stats.denseFloatChunks) || Number.isFinite(stats.denseU8Chunks)) {
    const floatChunks = Number.isFinite(stats.denseFloatChunks) ? stats.denseFloatChunks : 0;
    const u8Chunks = Number.isFinite(stats.denseU8Chunks) ? stats.denseU8Chunks : 0;
    parts.push(`float=${floatChunks} u8=${u8Chunks}`);
  }
  if (Number.isFinite(stats.filesTotal)) {
    const withEmbeddings = Number.isFinite(stats.filesWithEmbeddings) ? stats.filesWithEmbeddings : 0;
    const totalFiles = Number.isFinite(stats.filesTotal) ? stats.filesTotal : 0;
    const missing = Number.isFinite(stats.filesMissingEmbeddings) ? stats.filesMissingEmbeddings : 0;
    parts.push(`files ${withEmbeddings}/${totalFiles} (missing ${missing})`);
  }
  if (Array.isArray(stats.sampleMissingFiles) && stats.sampleMissingFiles.length) {
    parts.push(`sample missing: ${stats.sampleMissingFiles.join(', ')}`);
  }
  return parts.length ? parts.join(', ') : null;
};

/**
 * Format vector extension state for logging.
 * @param {object|null} state
 * @returns {string|null}
 */
export const formatVectorAnnState = (state) => {
  if (!state || typeof state !== 'object') return null;
  const parts = [
    `enabled=${state.enabled === true}`,
    `loaded=${state.loaded === true}`,
    `ready=${state.ready === true}`
  ];
  if (state.table) parts.push(`table=${state.table}`);
  if (state.column) parts.push(`column=${state.column}`);
  if (state.reason) parts.push(`reason=${state.reason}`);
  return parts.join(', ');
};

/**
 * Format incremental bundle manifest metadata for logging.
 * @param {object|null} manifest
 * @returns {string|null}
 */
export const formatBundleManifest = (manifest) => {
  if (!manifest || typeof manifest !== 'object') return null;
  const parts = [];
  if (manifest.bundleRecordsIncremental !== undefined) {
    parts.push(`bundleRecordsIncremental=${manifest.bundleRecordsIncremental === true}`);
  }
  if (manifest.bundleEmbeddings !== undefined) {
    parts.push(`bundleEmbeddings=${manifest.bundleEmbeddings}`);
  }
  if (manifest.bundleEmbeddingStage) parts.push(`bundleEmbeddingStage=${manifest.bundleEmbeddingStage}`);
  if (manifest.bundleEmbeddingMode) parts.push(`bundleEmbeddingMode=${manifest.bundleEmbeddingMode}`);
  if (manifest.bundleEmbeddingIdentityKey) {
    parts.push(`bundleEmbeddingIdentityKey=${manifest.bundleEmbeddingIdentityKey}`);
  }
  return parts.length ? parts.join(', ') : null;
};
