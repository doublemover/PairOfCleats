import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { getEnvConfig } from './env.js';

const registry = new Registry();
let initialized = false;
let metrics = null;

const normalizeString = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizeLabel = (value, allowed, fallback = 'unknown') => {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  return allowed.has(normalized) ? normalized : fallback;
};

const STAGES = new Set(['stage1', 'stage2', 'stage3', 'stage4', 'unknown']);
const MODES = new Set(['code', 'prose', 'all', 'records', 'extracted-prose', 'unknown']);
const BACKENDS = new Set(['memory', 'sqlite', 'sqlite-fts', 'lmdb', 'unknown']);
const STATUSES = new Set(['ok', 'error', 'unknown']);
const ANN = new Set(['on', 'off', 'unknown']);
const POOLS = new Set(['tokenize', 'quantize', 'watch', 'unknown']);
const TASKS = new Set(['tokenize', 'quantize', 'unknown']);
const WATCH_EVENTS = new Set(['add', 'change', 'unlink', 'error', 'unknown']);
const DEBOUNCE = new Set(['scheduled', 'fired', 'canceled', 'unknown']);
const CACHES = new Set(['query', 'embedding', 'output', 'repo', 'index', 'sqlite', 'query-plan', 'unknown']);

const CACHE_RESULTS = new Set(['hit', 'miss', 'unknown']);
const SURFACES = new Set(['cli', 'api', 'mcp', 'search', 'index', 'unknown']);
const FALLBACKS = new Set(['backend', 'vector-candidates', 'unknown']);
const TIMEOUTS = new Set(['tool', 'search', 'index', 'unknown']);
const ANN_BACKENDS = new Set(['sqlite-vector', 'lancedb', 'hnsw', 'js', 'unknown']);
const PUSHDOWN_STRATEGIES = new Set(['none', 'inline', 'temp-table', 'fallback', 'unknown']);
const CANDIDATE_SIZE_BUCKETS = new Set(['none', '1-32', '33-256', '257-1024', '1025+', 'unknown']);

const normalizeStage = (value) => normalizeLabel(value, STAGES);
const normalizeMode = (value) => normalizeLabel(value, MODES);
const normalizeBackend = (value) => normalizeLabel(value, BACKENDS);
const normalizeStatus = (value) => normalizeLabel(value, STATUSES);
const normalizePool = (value) => normalizeLabel(value, POOLS);
const normalizeTask = (value) => normalizeLabel(value, TASKS);
const normalizeWatchEvent = (value) => normalizeLabel(value, WATCH_EVENTS);
const normalizeDebounce = (value) => normalizeLabel(value, DEBOUNCE);
const normalizeCache = (value) => normalizeLabel(value, CACHES);
const normalizeCacheResult = (value) => normalizeLabel(value, CACHE_RESULTS);
const normalizeSurface = (value) => normalizeLabel(value, SURFACES);
const normalizeFallback = (value) => normalizeLabel(value, FALLBACKS);
const normalizeTimeout = (value) => normalizeLabel(value, TIMEOUTS);
const normalizeAnnBackend = (value) => normalizeLabel(value, ANN_BACKENDS);
const normalizePushdownStrategy = (value) => normalizeLabel(value, PUSHDOWN_STRATEGIES);
const normalizeCandidateSizeBucket = (value) => normalizeLabel(value, CANDIDATE_SIZE_BUCKETS);
const normalizeAnn = (value) => {
  if (value === true || value === 'on') return 'on';
  if (value === false || value === 'off') return 'off';
  return normalizeLabel(value, ANN);
};

const CACHE_EVENT_SAMPLE_RATE = (() => {
  try {
    const envConfig = getEnvConfig();
    const raw = envConfig?.cacheMetricsSampleRate;
    if (raw == null) return 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(0, Math.min(1, parsed));
  } catch {
    return 1;
  }
})();

const shouldSampleCacheEvent = () => {
  if (CACHE_EVENT_SAMPLE_RATE >= 1) return true;
  if (CACHE_EVENT_SAMPLE_RATE <= 0) return false;
  return Math.random() <= CACHE_EVENT_SAMPLE_RATE;
};

const ensureMetrics = () => {
  if (initialized) return;
  metrics = {
    indexDuration: new Histogram({
      name: 'pairofcleats_index_duration_seconds',
      help: 'Index build duration in seconds.',
      labelNames: ['stage', 'mode', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 3600],
      registers: [registry]
    }),
    searchDuration: new Histogram({
      name: 'pairofcleats_search_duration_seconds',
      help: 'Search duration in seconds.',
      labelNames: ['mode', 'backend', 'ann', 'status'],
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 60],
      registers: [registry]
    }),
    indexRuns: new Counter({
      name: 'pairofcleats_index_runs_total',
      help: 'Count of index runs.',
      labelNames: ['stage', 'mode', 'status'],
      registers: [registry]
    }),
    searchRuns: new Counter({
      name: 'pairofcleats_search_runs_total',
      help: 'Count of search runs.',
      labelNames: ['mode', 'backend', 'ann', 'status'],
      registers: [registry]
    }),
    workerQueueDepth: new Gauge({
      name: 'pairofcleats_worker_queue_depth',
      help: 'Worker pool queue depth.',
      labelNames: ['pool'],
      registers: [registry]
    }),
    workerActiveTasks: new Gauge({
      name: 'pairofcleats_worker_active_tasks',
      help: 'Active worker pool tasks.',
      labelNames: ['pool'],
      registers: [registry]
    }),
    workerTaskDuration: new Histogram({
      name: 'pairofcleats_worker_task_duration_seconds',
      help: 'Worker task duration in seconds.',
      labelNames: ['pool', 'task', 'worker', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
      registers: [registry]
    }),
    workerGcPressure: new Gauge({
      name: 'pairofcleats_worker_gc_pressure_ratio',
      help: 'Estimated GC pressure ratio by worker thread.',
      labelNames: ['pool', 'worker', 'stage'],
      registers: [registry]
    }),
    stageGcPressure: new Gauge({
      name: 'pairofcleats_stage_gc_pressure_ratio',
      help: 'Estimated GC pressure ratio by indexing stage.',
      labelNames: ['stage'],
      registers: [registry]
    }),
    workerRetries: new Counter({
      name: 'pairofcleats_worker_retries_total',
      help: 'Worker pool restart attempts.',
      labelNames: ['pool'],
      registers: [registry]
    }),
    watchBacklog: new Gauge({
      name: 'pairofcleats_watch_backlog',
      help: 'Pending watch backlog size.',
      labelNames: ['pool'],
      registers: [registry]
    }),
    watchEvents: new Counter({
      name: 'pairofcleats_watch_events_total',
      help: 'Total watch events observed.',
      labelNames: ['event'],
      registers: [registry]
    }),
    watchDebounce: new Counter({
      name: 'pairofcleats_watch_debounce_total',
      help: 'Watch debounce schedule events.',
      labelNames: ['type'],
      registers: [registry]
    }),
    watchBuildDuration: new Histogram({
      name: 'pairofcleats_watch_build_duration_seconds',
      help: 'Watch-triggered build duration in seconds.',
      labelNames: ['status'],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [registry]
    }),
    watchBursts: new Counter({
      name: 'pairofcleats_watch_bursts_total',
      help: 'Detected watch event bursts.',
      labelNames: ['pool'],
      registers: [registry]
    }),
    cacheEvents: new Counter({
      name: 'pairofcleats_cache_events_total',
      help: 'Cache hit/miss events.',
      labelNames: ['cache', 'result'],
      registers: [registry]
    }),
    cacheSize: new Gauge({
      name: 'pairofcleats_cache_entries',
      help: 'Cache size by cache name.',
      labelNames: ['cache'],
      registers: [registry]
    }),
    cacheEvictions: new Counter({
      name: 'pairofcleats_cache_evictions_total',
      help: 'Cache eviction events by cache name.',
      labelNames: ['cache'],
      registers: [registry]
    }),
    fallbacks: new Counter({
      name: 'pairofcleats_fallbacks_total',
      help: 'Fallback events by surface.',
      labelNames: ['surface', 'reason'],
      registers: [registry]
    }),
    timeouts: new Counter({
      name: 'pairofcleats_timeouts_total',
      help: 'Timeout events by surface.',
      labelNames: ['surface', 'operation'],
      registers: [registry]
    }),
    annCandidatePushdown: new Counter({
      name: 'pairofcleats_ann_candidate_pushdown_total',
      help: 'ANN candidate pushdown strategy selection.',
      labelNames: ['backend', 'strategy', 'size_bucket'],
      registers: [registry]
    })
  };
  initialized = true;
};

const normalizeSeconds = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};
const normalizeRatio = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
};

/**
 * Observe index duration metrics.
 * @param {{ stage: string, mode: string, status: string, seconds: number }} input
 */
export function observeIndexDuration({ stage, mode, status, seconds }) {
  ensureMetrics();
  const labels = {
    stage: normalizeStage(stage),
    mode: normalizeMode(mode),
    status: normalizeStatus(status)
  };
  const duration = normalizeSeconds(seconds);
  metrics.indexDuration.observe(labels, duration);
  metrics.indexRuns.inc(labels);
}

/**
 * Observe search duration metrics.
 * @param {{ mode: string, backend: string, ann: string|boolean, status: string, seconds: number }} input
 */
export function observeSearchDuration({ mode, backend, ann, status, seconds }) {
  ensureMetrics();
  const labels = {
    mode: normalizeMode(mode),
    backend: normalizeBackend(backend),
    ann: normalizeAnn(ann),
    status: normalizeStatus(status)
  };
  const duration = normalizeSeconds(seconds);
  metrics.searchDuration.observe(labels, duration);
  metrics.searchRuns.inc(labels);
}

/**
 * Set worker queue depth metric.
 * @param {{ pool: string, value: number }} input
 */
export function setWorkerQueueDepth({ pool, value }) {
  ensureMetrics();
  metrics.workerQueueDepth.set({ pool: normalizePool(pool) }, Number(value) || 0);
}

/**
 * Set worker active tasks metric.
 * @param {{ pool: string, value: number }} input
 */
export function setWorkerActiveTasks({ pool, value }) {
  ensureMetrics();
  metrics.workerActiveTasks.set({ pool: normalizePool(pool) }, Number(value) || 0);
}

/**
 * Observe worker task duration metrics.
 * @param {{ pool: string, task: string, worker: string|number, status: string, seconds: number }} input
 */
export function observeWorkerTaskDuration({ pool, task, worker, status, seconds }) {
  ensureMetrics();
  metrics.workerTaskDuration.observe({
    pool: normalizePool(pool),
    task: normalizeTask(task),
    worker: worker ? String(worker) : 'unknown',
    status: normalizeStatus(status)
  }, normalizeSeconds(seconds));
}

/**
 * Set worker GC pressure ratio.
 * @param {{ pool: string, worker: string|number, stage: string, value: number }} input
 */
export function setWorkerGcPressure({ pool, worker, stage, value }) {
  ensureMetrics();
  metrics.workerGcPressure.set({
    pool: normalizePool(pool),
    worker: worker ? String(worker) : 'unknown',
    stage: normalizeStage(stage)
  }, normalizeRatio(value));
}

/**
 * Set stage GC pressure ratio.
 * @param {{ stage: string, value: number }} input
 */
export function setStageGcPressure({ stage, value }) {
  ensureMetrics();
  metrics.stageGcPressure.set({
    stage: normalizeStage(stage)
  }, normalizeRatio(value));
}

/**
 * Increment worker retry count.
 * @param {{ pool: string }} input
 */
export function incWorkerRetries({ pool }) {
  ensureMetrics();
  metrics.workerRetries.inc({ pool: normalizePool(pool) });
}

/**
 * Set watch backlog metric.
 * @param {number} value
 */
export function setWatchBacklog(value) {
  ensureMetrics();
  metrics.watchBacklog.set({ pool: 'watch' }, Number(value) || 0);
}

/**
 * Increment watch event count.
 * @param {string} eventType
 */
export function incWatchEvent(eventType) {
  ensureMetrics();
  metrics.watchEvents.inc({ event: normalizeWatchEvent(eventType) });
}

/**
 * Increment watch debounce metric.
 * @param {string} type
 */
export function incWatchDebounce(type) {
  ensureMetrics();
  metrics.watchDebounce.inc({ type: normalizeDebounce(type) });
}

/**
 * Observe watch build duration.
 * @param {{ status: string, seconds: number }} input
 */
export function observeWatchBuildDuration({ status, seconds }) {
  ensureMetrics();
  metrics.watchBuildDuration.observe({ status: normalizeStatus(status) }, normalizeSeconds(seconds));
}

/**
 * Increment watch burst count.
 */
export function incWatchBurst() {
  ensureMetrics();
  metrics.watchBursts.inc({ pool: 'watch' });
}

/**
 * Increment cache hit/miss metric.
 * @param {{ cache: string, result: string }} input
 */
export function incCacheEvent({ cache, result }) {
  if (!shouldSampleCacheEvent()) return;
  ensureMetrics();
  metrics.cacheEvents.inc({
    cache: normalizeCache(cache),
    result: normalizeCacheResult(result)
  });
}

/**
 * Set cache size gauge.
 * @param {{ cache: string, value: number }} input
 */
export function setCacheSize({ cache, value }) {
  ensureMetrics();
  metrics.cacheSize.set({ cache: normalizeCache(cache) }, Number(value) || 0);
}

/**
 * Increment cache eviction count.
 * @param {{ cache: string, count?: number }} input
 */
export function incCacheEviction({ cache, count = 1 }) {
  ensureMetrics();
  const normalized = normalizeCache(cache);
  const amount = Number(count);
  if (!Number.isFinite(amount) || amount <= 0) return;
  metrics.cacheEvictions.inc({ cache: normalized }, amount);
}

/**
 * Increment fallback counter.
 * @param {{ surface: string, reason: string }} input
 */
export function incFallback({ surface, reason }) {
  ensureMetrics();
  metrics.fallbacks.inc({
    surface: normalizeSurface(surface),
    reason: normalizeFallback(reason)
  });
}

/**
 * Increment timeout counter.
 * @param {{ surface: string, operation: string }} input
 */
export function incTimeout({ surface, operation }) {
  ensureMetrics();
  metrics.timeouts.inc({
    surface: normalizeSurface(surface),
    operation: normalizeTimeout(operation)
  });
}

/**
 * Increment ANN candidate pushdown strategy counter.
 * @param {{ backend: string, strategy: string, sizeBucket: string }} input
 */
export function incAnnCandidatePushdown({ backend, strategy, sizeBucket }) {
  ensureMetrics();
  metrics.annCandidatePushdown.inc({
    backend: normalizeAnnBackend(backend),
    strategy: normalizePushdownStrategy(strategy),
    size_bucket: normalizeCandidateSizeBucket(sizeBucket)
  });
}

/**
 * Get the metrics registry.
 * @returns {Registry}
 */
export function getMetricsRegistry() {
  ensureMetrics();
  return registry;
}

/**
 * Get text representation of metrics.
 * @returns {Promise<string>}
 */
export async function getMetricsText() {
  ensureMetrics();
  return registry.metrics();
}
