import { Counter, Gauge, Histogram, Registry } from 'prom-client';

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
const CACHES = new Set(['query', 'embedding', 'output', 'repo', 'index', 'sqlite', 'unknown']);
const CACHE_RESULTS = new Set(['hit', 'miss', 'unknown']);
const SURFACES = new Set(['cli', 'api', 'mcp', 'search', 'index', 'unknown']);
const FALLBACKS = new Set(['backend', 'vector-candidates', 'unknown']);
const TIMEOUTS = new Set(['tool', 'search', 'index', 'unknown']);

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
const normalizeAnn = (value) => {
  if (value === true || value === 'on') return 'on';
  if (value === false || value === 'off') return 'off';
  return normalizeLabel(value, ANN);
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
    })
  };
  initialized = true;
};

const normalizeSeconds = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

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

export function setWorkerQueueDepth({ pool, value }) {
  ensureMetrics();
  metrics.workerQueueDepth.set({ pool: normalizePool(pool) }, Number(value) || 0);
}

export function setWorkerActiveTasks({ pool, value }) {
  ensureMetrics();
  metrics.workerActiveTasks.set({ pool: normalizePool(pool) }, Number(value) || 0);
}

export function observeWorkerTaskDuration({ pool, task, worker, status, seconds }) {
  ensureMetrics();
  metrics.workerTaskDuration.observe({
    pool: normalizePool(pool),
    task: normalizeTask(task),
    worker: worker ? String(worker) : 'unknown',
    status: normalizeStatus(status)
  }, normalizeSeconds(seconds));
}

export function incWorkerRetries({ pool }) {
  ensureMetrics();
  metrics.workerRetries.inc({ pool: normalizePool(pool) });
}

export function setWatchBacklog(value) {
  ensureMetrics();
  metrics.watchBacklog.set({ pool: 'watch' }, Number(value) || 0);
}

export function incWatchEvent(eventType) {
  ensureMetrics();
  metrics.watchEvents.inc({ event: normalizeWatchEvent(eventType) });
}

export function incWatchDebounce(type) {
  ensureMetrics();
  metrics.watchDebounce.inc({ type: normalizeDebounce(type) });
}

export function observeWatchBuildDuration({ status, seconds }) {
  ensureMetrics();
  metrics.watchBuildDuration.observe({ status: normalizeStatus(status) }, normalizeSeconds(seconds));
}

export function incWatchBurst() {
  ensureMetrics();
  metrics.watchBursts.inc({ pool: 'watch' });
}

export function incCacheEvent({ cache, result }) {
  ensureMetrics();
  metrics.cacheEvents.inc({
    cache: normalizeCache(cache),
    result: normalizeCacheResult(result)
  });
}

export function setCacheSize({ cache, value }) {
  ensureMetrics();
  metrics.cacheSize.set({ cache: normalizeCache(cache) }, Number(value) || 0);
}

export function incCacheEviction({ cache, count = 1 }) {
  ensureMetrics();
  const normalized = normalizeCache(cache);
  const amount = Number(count);
  if (!Number.isFinite(amount) || amount <= 0) return;
  metrics.cacheEvictions.inc({ cache: normalized }, amount);
}

export function incFallback({ surface, reason }) {
  ensureMetrics();
  metrics.fallbacks.inc({
    surface: normalizeSurface(surface),
    reason: normalizeFallback(reason)
  });
}

export function incTimeout({ surface, operation }) {
  ensureMetrics();
  metrics.timeouts.inc({
    surface: normalizeSurface(surface),
    operation: normalizeTimeout(operation)
  });
}

export function getMetricsRegistry() {
  ensureMetrics();
  return registry;
}

export async function getMetricsText() {
  ensureMetrics();
  return registry.metrics();
}
