const EMBEDDINGS_PERF_KIND_SET = new Set(['perf_progress', 'perf_summary']);

export const EMBEDDINGS_PERF_METRIC_KEYS = Object.freeze([
  'files_total',
  'files_done',
  'chunks_total',
  'chunks_done',
  'cache_attempts',
  'cache_hits',
  'cache_misses',
  'cache_rejected',
  'cache_fast_rejects',
  'cache_hit_files',
  'computed_files',
  'skipped_files',
  'texts_scheduled',
  'texts_resolved',
  'texts_embedded',
  'batches_completed',
  'tokens_processed',
  'inflight_join_hits',
  'inflight_claims',
  'embed_compute_ms',
  'elapsed_ms',
  'files_per_sec',
  'chunks_per_sec',
  'embed_resolved_per_sec',
  'file_parallelism_current',
  'file_parallelism_peak',
  'file_parallelism_adjustments',
  'writer_pending',
  'writer_max_pending',
  'queue_compute_pending',
  'queue_io_pending'
]);

const EMBEDDINGS_PERF_RATE_KEYS = new Set([
  'files_per_sec',
  'chunks_per_sec',
  'embed_resolved_per_sec'
]);

const sanitizeMode = (value) => String(value || '').trim().replace(/\s+/g, '-');

const normalizeKind = (value) => {
  const kind = String(value || '').trim().toLowerCase();
  return EMBEDDINGS_PERF_KIND_SET.has(kind) ? kind : 'perf_progress';
};

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const formatMetricValue = (key, value) => {
  if (EMBEDDINGS_PERF_RATE_KEYS.has(key)) {
    const numeric = Math.max(0, toFiniteNumber(value, 0));
    return numeric.toFixed(3);
  }
  const numeric = Math.max(0, Math.floor(toFiniteNumber(value, 0)));
  return String(numeric);
};

/**
 * Format a stable, key/value embeddings perf status line.
 *
 * @param {object} input
 * @param {string} input.mode
 * @param {'perf_progress'|'perf_summary'} [input.kind]
 * @param {Record<string, number>} [input.metrics]
 * @returns {string}
 */
export const formatEmbeddingsPerfLine = ({ mode, kind = 'perf_progress', metrics = {} } = {}) => {
  const normalizedMode = sanitizeMode(mode);
  const normalizedKind = normalizeKind(kind);
  const entries = EMBEDDINGS_PERF_METRIC_KEYS
    .map((key) => `${key}=${formatMetricValue(key, metrics?.[key])}`)
    .join(' ');
  return `[embeddings] ${normalizedMode}: ${normalizedKind} ${entries}`;
};

const parseMetricValue = (value) => {
  if (typeof value !== 'string' || !value.length) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return value;
};

/**
 * Parse a stable embeddings perf status line.
 *
 * @param {string} line
 * @returns {{mode:string,kind:'perf_progress'|'perf_summary',metrics:Record<string,number|string|null>}|null}
 */
export const parseEmbeddingsPerfLine = (line) => {
  const text = typeof line === 'string' ? line.trim() : '';
  if (!text) return null;
  const match = /^\[embeddings\]\s+([^:]+):\s+(perf_progress|perf_summary)\s+(.+)$/.exec(text);
  if (!match) return null;
  const mode = sanitizeMode(match[1]);
  const kind = normalizeKind(match[2]);
  const payload = match[3];
  const metrics = {};
  for (const key of EMBEDDINGS_PERF_METRIC_KEYS) {
    metrics[key] = null;
  }
  const parts = payload.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const [key, rawValue] = part.split('=');
    if (!key || rawValue == null || !EMBEDDINGS_PERF_METRIC_KEYS.includes(key)) continue;
    metrics[key] = parseMetricValue(rawValue);
  }
  return { mode, kind, metrics };
};
