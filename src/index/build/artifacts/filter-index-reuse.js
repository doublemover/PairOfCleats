import { buildSerializedFilterIndex } from './filter-index.js';
import { summarizeFilterIndex, formatBytes } from './helpers.js';

/**
 * Validate serialized filter-index shape before reuse.
 *
 * @param {object} candidate
 * @returns {boolean}
 */
export const validateSerializedFilterIndex = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('expected object');
  }
  if (!Number.isFinite(Number(candidate.schemaVersion))) {
    throw new Error('missing schemaVersion');
  }
  if (!Number.isFinite(Number(candidate.fileChargramN))) {
    throw new Error('missing fileChargramN');
  }
  if (!Array.isArray(candidate.fileById)) {
    throw new Error('missing fileById');
  }
  if (!Array.isArray(candidate.fileChunksById)) {
    throw new Error('missing fileChunksById');
  }
  if (candidate.fileById.length !== candidate.fileChunksById.length) {
    throw new Error('fileById/fileChunksById length mismatch');
  }
  if (candidate.byLang == null || typeof candidate.byLang !== 'object') {
    throw new Error('missing byLang');
  }
  return true;
};

/**
 * Resolve current filter-index artifact state without stale fallback reuse when
 * the current build fails.
 *
 * @param {{
 *   outDir:string,
 *   maxJsonBytes:number,
 *   maxJsonBytesSoft:number,
 *   state:object,
 *   resolvedConfig:object,
 *   userConfig:object,
 *   root:string,
 *   log:(message:string)=>void
 * }} input
 * @returns {{
 *   filterIndex:object|null,
 *   filterIndexStats:object|null,
 *   filterIndexReused:boolean,
 *   filterIndexFallback:{piece:object,path:string}|null
 * }}
 */
export const resolveFilterIndexArtifactState = ({
  outDir,
  maxJsonBytes,
  maxJsonBytesSoft,
  state,
  resolvedConfig,
  userConfig,
  root,
  log
}) => {
  let filterIndex = null;
  let filterIndexStats = null;
  let filterIndexReused = false;
  let filterIndexFallback = null;
  try {
    filterIndex = buildSerializedFilterIndex({
      chunks: state.chunks,
      resolvedConfig,
      userConfig,
      root
    });
    validateSerializedFilterIndex(filterIndex);
    filterIndexStats = summarizeFilterIndex(filterIndex);
    if (filterIndexStats && typeof filterIndexStats === 'object' && Number.isFinite(filterIndexStats.jsonBytes)) {
      // filter_index is currently written uncompressed (compressible=false); keep a stable estimate
      // in case later phases make it compressible.
      filterIndexStats.diskBytesEstimate = filterIndexStats.jsonBytes;
      filterIndexStats.compressionRatioEstimate = 1;
    }
    if (filterIndexStats?.jsonBytes && filterIndexStats.jsonBytes > maxJsonBytesSoft) {
      log(
        `filter_index ~${formatBytes(filterIndexStats.jsonBytes)}; ` +
        'large filter indexes increase memory usage (consider sqlite for large repos).'
      );
    }
  } catch (err) {
    const message = err?.message || String(err);
    log(`[warn] [filter_index] build failed; skipping. (${message})`);
    filterIndex = null;
    filterIndexStats = null;
    // A previous shape is not evidence of current chunk/config identity.
    // Omitting this optional artifact selects the consumer's full scan path.
    filterIndexReused = false;
    filterIndexFallback = null;
  }
  return {
    filterIndex,
    filterIndexStats,
    filterIndexReused,
    filterIndexFallback
  };
};
