const BASE_CHUNKING_DIAGNOSTICS = Object.freeze({
  treeSitterEnabled: false,
  schedulerRequired: false,
  scheduledSegmentCount: 0,
  fallbackSegmentCount: 0,
  codeFallbackSegmentCount: 0,
  schedulerMissingCount: 0,
  schedulerDegradedCount: 0,
  usedHeuristicChunking: false,
  usedHeuristicCodeChunking: false
});

/**
 * Build a normalized skip payload used by CPU-stage short-circuit returns.
 *
 * @param {object} skip
 * @returns {{chunks:Array,fileRelations:null,skip:object}}
 */
export const buildSkipResult = (skip) => ({
  chunks: [],
  fileRelations: null,
  skip
});

/**
 * Build a parse-error skip payload with stable shape.
 *
 * @param {string} stage
 * @param {unknown} err
 * @returns {{chunks:Array,fileRelations:null,skip:{reason:string,stage:string,message:string}}}
 */
export const buildParseErrorSkipResult = (stage, err) => buildSkipResult({
  reason: 'parse-error',
  stage,
  message: err?.message || String(err)
});

/**
 * Allocate per-file chunking diagnostics from an immutable baseline.
 *
 * @param {{treeSitterEnabled:boolean,schedulerRequired:boolean}} input
 * @returns {object}
 */
export const createChunkingDiagnostics = ({ treeSitterEnabled, schedulerRequired }) => ({
  ...BASE_CHUNKING_DIAGNOSTICS,
  treeSitterEnabled: Boolean(treeSitterEnabled),
  schedulerRequired: Boolean(schedulerRequired)
});
