const TOKEN_RETENTION_MODES = new Set(['full', 'sample', 'none']);
const DEFAULT_TOKEN_RETENTION = Object.freeze({
  mode: 'full',
  sampleSize: 32
});

/**
 * Normalize token retention options to a stable shape.
 * @param {object} [raw]
 * @returns {{mode:'full'|'sample'|'none',sampleSize:number}}
 */
export function normalizeTokenRetention(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TOKEN_RETENTION };
  }
  const modeRaw = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : DEFAULT_TOKEN_RETENTION.mode;
  const mode = TOKEN_RETENTION_MODES.has(modeRaw) ? modeRaw : DEFAULT_TOKEN_RETENTION.mode;
  const sampleSize = Number.isFinite(Number(raw.sampleSize))
    ? Math.max(1, Math.floor(Number(raw.sampleSize)))
    : DEFAULT_TOKEN_RETENTION.sampleSize;
  return { mode, sampleSize };
}

/**
 * Apply token retention rules to a chunk in-place.
 * @param {object} chunk
 * @param {{mode:'full'|'sample'|'none',sampleSize:number}} retention
 */
export function applyTokenRetention(chunk, retention) {
  if (!chunk || !retention || retention.mode === 'full') return;
  if (retention.mode === 'none') {
    if (chunk.tokens) delete chunk.tokens;
    if (chunk.tokenIds) delete chunk.tokenIds;
    if (chunk.ngrams) delete chunk.ngrams;
    return;
  }
  if (retention.mode === 'sample') {
    if (Array.isArray(chunk.tokens) && chunk.tokens.length > retention.sampleSize) {
      chunk.tokens = chunk.tokens.slice(0, retention.sampleSize);
    }
    if (Array.isArray(chunk.tokenIds) && chunk.tokenIds.length > retention.sampleSize) {
      chunk.tokenIds = chunk.tokenIds.slice(0, retention.sampleSize);
    }
    if (Array.isArray(chunk.ngrams) && chunk.ngrams.length > retention.sampleSize) {
      chunk.ngrams = chunk.ngrams.slice(0, retention.sampleSize);
    }
  }
}
