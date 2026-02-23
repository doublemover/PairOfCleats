import crypto from 'node:crypto';
import path from 'node:path';

const DAEMON_SESSION_MAX_ENTRIES = 8;
const DAEMON_DICT_CACHE_MAX_ENTRIES = 32;
const DAEMON_TREE_SITTER_CACHE_MAX_ENTRIES = 32;
const DAEMON_EMBEDDING_WARM_MAX_ENTRIES = 24;
const MB = 1024 * 1024;
const DEFAULT_DAEMON_HEALTH = Object.freeze({
  probeEveryJobs: 4,
  maxJobsBeforeRecycle: 64,
  maxHeapUsedMb: 3072,
  maxHeapGrowthMb: 768,
  maxHeapGrowthRatio: 2.5,
  maxDictionaryEntries: DAEMON_DICT_CACHE_MAX_ENTRIES,
  maxTreeSitterEntries: DAEMON_TREE_SITTER_CACHE_MAX_ENTRIES,
  maxEmbeddingWarmEntries: DAEMON_EMBEDDING_WARM_MAX_ENTRIES
});

const daemonSessions = new Map();

/**
 * Return current timestamp in ISO-8601 format.
 *
 * @returns {string}
 */
const nowIso = () => new Date().toISOString();
/**
 * Convert megabytes to bytes with non-negative clamping.
 *
 * @param {number} mb
 * @returns {number}
 */
const toBytes = (mb) => Math.max(0, Math.floor(Number(mb) * MB));

/**
 * Parse positive integer with fallback.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toPositiveInt = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
};

/**
 * Parse positive number with fallback.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toPositiveNumber = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
};

/**
 * Parse non-negative integer with fallback.
 *
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
const toNonNegativeInt = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(numeric));
};

/**
 * Read current process heap usage safely.
 *
 * @returns {number}
 */
const safeHeapUsedBytes = () => {
  try {
    const used = Number(process.memoryUsage?.().heapUsed);
    if (!Number.isFinite(used) || used <= 0) return 0;
    return Math.max(0, Math.floor(used));
  } catch {
    return 0;
  }
};

/**
 * Normalize repository root to a stable case-folded token on Windows.
 *
 * @param {unknown} value
 * @returns {string}
 */
const normalizeRepoRoot = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const resolved = path.resolve(trimmed);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/**
 * Build deterministic repo scope token used in daemon session keys.
 *
 * @param {string} repoRoot
 * @returns {string}
 */
const resolveRepoScopeToken = (repoRoot) => {
  const normalizedRoot = normalizeRepoRoot(repoRoot);
  if (!normalizedRoot) return 'repo-default';
  const digest = crypto.createHash('sha1').update(normalizedRoot).digest('hex').slice(0, 12);
  return `repo-${digest}`;
};

/**
 * Normalize daemon session key from explicit key or cache/profile/repo tuple.
 *
 * @param {{sessionKey?:string|null,cacheRoot?:string|null,profile?:string,repoRoot?:string|null}} [input]
 * @returns {string}
 */
const normalizeSessionKey = ({ sessionKey, cacheRoot, profile = 'default', repoRoot = null } = {}) => {
  const explicit = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  if (explicit) return explicit;
  const cache = typeof cacheRoot === 'string' ? cacheRoot.trim() : '';
  const safeCache = cache || 'default-cache-root';
  const repoScope = resolveRepoScopeToken(repoRoot);
  return `${safeCache}::${profile}::${repoScope}`;
};

/**
 * Enforce global session LRU size cap.
 *
 * @returns {void}
 */
const trimDaemonSessions = () => {
  while (daemonSessions.size > DAEMON_SESSION_MAX_ENTRIES) {
    const oldest = daemonSessions.entries().next().value;
    if (!oldest) return;
    daemonSessions.delete(oldest[0]);
  }
};

/**
 * Enforce Map LRU capacity by deleting oldest entries.
 *
 * @param {Map<unknown, unknown>} cache
 * @param {number} maxEntries
 * @returns {void}
 */
const trimMapLru = (cache, maxEntries) => {
  if (!(cache instanceof Map)) return;
  const capped = toPositiveInt(maxEntries, 1);
  while (cache.size > capped) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
};

/**
 * Enforce Set LRU capacity by deleting oldest entries.
 *
 * @param {Set<unknown>} cache
 * @param {number} maxEntries
 * @returns {void}
 */
const trimSetLru = (cache, maxEntries) => {
  if (!(cache instanceof Set)) return;
  const capped = toPositiveInt(maxEntries, 1);
  while (cache.size > capped) {
    const oldest = cache.values().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
};

/**
 * Normalize daemon health thresholds with compatibility aliases.
 *
 * @param {object|null} [health]
 * @param {object} [fallback]
 * @returns {object}
 */
const normalizeDaemonHealthConfig = (health = null, fallback = DEFAULT_DAEMON_HEALTH) => {
  const raw = health && typeof health === 'object' ? health : {};
  return {
    probeEveryJobs: toPositiveInt(raw.probeEveryJobs, fallback.probeEveryJobs),
    maxJobsBeforeRecycle: toPositiveInt(raw.maxJobsBeforeRecycle, fallback.maxJobsBeforeRecycle),
    maxHeapUsedBytes: toBytes(toPositiveNumber(raw.maxHeapUsedMb, fallback.maxHeapUsedMb)),
    maxHeapGrowthBytes: toBytes(toPositiveNumber(raw.maxHeapGrowthMb, fallback.maxHeapGrowthMb)),
    maxHeapGrowthRatio: toPositiveNumber(raw.maxHeapGrowthRatio, fallback.maxHeapGrowthRatio),
    maxDictionaryEntries: toPositiveInt(
      raw.maxDictionaryEntries ?? raw.maxDictEntries,
      fallback.maxDictionaryEntries
    ),
    maxTreeSitterEntries: toPositiveInt(
      raw.maxTreeSitterEntries ?? raw.maxTreeSitterPreloadEntries,
      fallback.maxTreeSitterEntries
    ),
    maxEmbeddingWarmEntries: toPositiveInt(
      raw.maxEmbeddingWarmEntries ?? raw.maxEmbeddingWarmKeys,
      fallback.maxEmbeddingWarmEntries
    )
  };
};

/**
 * Ensure a session has a normalized health config attached.
 *
 * @param {object|null} session
 * @param {object} [fallback]
 * @returns {object}
 */
const ensureHealthConfig = (session, fallback = DEFAULT_DAEMON_HEALTH) => {
  if (!session || typeof session !== 'object') {
    return normalizeDaemonHealthConfig(null, fallback);
  }
  if (!session.health || typeof session.health !== 'object') {
    session.health = normalizeDaemonHealthConfig(null, fallback);
  }
  return session.health;
};

/**
 * Clear all in-memory warm caches tracked by a daemon session.
 *
 * @param {object|null} session
 * @returns {void}
 */
const clearRuntimeDaemonWarmCaches = (session) => {
  if (!session || typeof session !== 'object') return;
  getDaemonDictionaryCache(session)?.clear();
  getDaemonTreeSitterCache(session)?.clear();
  getDaemonEmbeddingWarmSet(session)?.clear();
};

/**
 * Recycle daemon session generation and reset warm-cache state.
 *
 * @param {object|null} session
 * @param {string[]} [reasons]
 * @returns {{recycled:boolean,reasons:string[],generation?:number,recycleCount?:number,heapUsedBytes?:number}}
 */
const recycleRuntimeDaemonSession = (session, reasons = []) => {
  if (!session || typeof session !== 'object') {
    return {
      recycled: false,
      reasons: []
    };
  }
  clearRuntimeDaemonWarmCaches(session);
  session.generation = toPositiveInt(session.generation, 1) + 1;
  session.generationJobsProcessed = 0;
  session.recycleCount = toNonNegativeInt(session.recycleCount, 0) + 1;
  session.lastRecycleAt = nowIso();
  session.lastRecycleReasons = Array.isArray(reasons)
    ? reasons.filter((entry) => typeof entry === 'string' && entry)
    : [];
  const heapUsedBytes = safeHeapUsedBytes();
  session.heapBaselineBytes = heapUsedBytes || session.heapBaselineBytes || 0;
  session.lastObservedHeapUsedBytes = heapUsedBytes || session.lastObservedHeapUsedBytes || 0;
  return {
    recycled: true,
    reasons: session.lastRecycleReasons,
    generation: session.generation,
    recycleCount: session.recycleCount,
    heapUsedBytes: session.lastObservedHeapUsedBytes
  };
};

/**
 * Probe daemon session health and recycle generation when thresholds are hit.
 *
 * @param {object|null} session
 * @param {{force?:boolean}} [options]
 * @returns {{recycled:boolean,reasons:string[],generation:number,recycleCount?:number,heapUsedBytes?:number}}
 */
export const probeRuntimeDaemonSessionHealth = (session, { force = false } = {}) => {
  if (!session || typeof session !== 'object') {
    return {
      recycled: false,
      reasons: [],
      generation: 0
    };
  }
  const health = ensureHealthConfig(session);
  const dictCache = getDaemonDictionaryCache(session);
  const treeCache = getDaemonTreeSitterCache(session);
  const embeddingWarmSet = getDaemonEmbeddingWarmSet(session);
  trimMapLru(dictCache, health.maxDictionaryEntries);
  trimMapLru(treeCache, health.maxTreeSitterEntries);
  trimSetLru(embeddingWarmSet, health.maxEmbeddingWarmEntries);
  const reasons = [];
  if (
    health.maxJobsBeforeRecycle > 0
    && Number(session.generationJobsProcessed) >= health.maxJobsBeforeRecycle
  ) {
    reasons.push(`jobs>${health.maxJobsBeforeRecycle}`);
  }
  const probeEveryJobs = Math.max(1, toPositiveInt(health.probeEveryJobs, 1));
  const shouldProbeHeap = force
    || Number(session.generationJobsProcessed) === 0
    || ((Number(session.generationJobsProcessed) + 1) % probeEveryJobs === 0);
  if (shouldProbeHeap) {
    const heapUsedBytes = safeHeapUsedBytes();
    if (!session.heapBaselineBytes || heapUsedBytes < session.heapBaselineBytes) {
      session.heapBaselineBytes = heapUsedBytes;
    }
    session.lastObservedHeapUsedBytes = heapUsedBytes;
    if (health.maxHeapUsedBytes > 0 && heapUsedBytes >= health.maxHeapUsedBytes) {
      reasons.push(`heap>${Math.floor(health.maxHeapUsedBytes / MB)}MB`);
    }
    const growthBytes = Math.max(0, heapUsedBytes - (session.heapBaselineBytes || 0));
    const growthRatio = session.heapBaselineBytes > 0
      ? (heapUsedBytes / session.heapBaselineBytes)
      : 0;
    if (
      health.maxHeapGrowthBytes > 0
      && growthBytes >= health.maxHeapGrowthBytes
      && growthRatio >= health.maxHeapGrowthRatio
    ) {
      reasons.push(
        `heap-growth>${Math.floor(health.maxHeapGrowthBytes / MB)}MB@${health.maxHeapGrowthRatio.toFixed(2)}x`
      );
    }
  }
  if (!reasons.length) {
    return {
      recycled: false,
      reasons: [],
      generation: Number(session.generation) || 1,
      recycleCount: Number(session.recycleCount) || 0,
      heapUsedBytes: Number(session.lastObservedHeapUsedBytes) || 0
    };
  }
  return recycleRuntimeDaemonSession(session, reasons);
};

/**
 * Acquire (or create) daemon session scoped by cache/profile/repo tuple.
 *
 * @param {{
 *  enabled?:boolean,
 *  sessionKey?:string|null,
 *  cacheRoot?:string|null,
 *  repoRoot?:string|null,
 *  deterministic?:boolean,
 *  profile?:string,
 *  health?:object|null
 * }} [options]
 * @returns {object|null}
 */
export const acquireRuntimeDaemonSession = ({
  enabled = false,
  sessionKey = null,
  cacheRoot = null,
  repoRoot = null,
  deterministic = true,
  profile = 'default',
  health = null
} = {}) => {
  if (!enabled) return null;
  const key = normalizeSessionKey({ sessionKey, cacheRoot, profile, repoRoot });
  const existing = daemonSessions.get(key);
  if (existing) {
    existing.health = normalizeDaemonHealthConfig(health, ensureHealthConfig(existing));
    probeRuntimeDaemonSessionHealth(existing, { force: true });
    daemonSessions.delete(key);
    existing.lastUsedAt = nowIso();
    daemonSessions.set(key, existing);
    return existing;
  }
  const session = {
    key,
    createdAt: nowIso(),
    lastUsedAt: nowIso(),
    deterministic: deterministic !== false,
    jobsProcessed: 0,
    generation: 1,
    generationJobsProcessed: 0,
    recycleCount: 0,
    lastRecycleAt: null,
    lastRecycleReasons: [],
    heapBaselineBytes: safeHeapUsedBytes(),
    lastObservedHeapUsedBytes: safeHeapUsedBytes(),
    health: normalizeDaemonHealthConfig(health),
    dictCache: new Map(),
    treeSitterPreloadCache: new Map(),
    embeddingWarmKeys: new Set()
  };
  daemonSessions.set(key, session);
  trimDaemonSessions();
  return session;
};

/**
 * Create per-job context snapshot and advance daemon session counters.
 *
 * @param {object|null} session
 * @param {{root?:string|null,buildId?:string|null}} [options]
 * @returns {object|null}
 */
export const createRuntimeDaemonJobContext = (session, { root = null, buildId = null } = {}) => {
  if (!session) return null;
  const healthResult = probeRuntimeDaemonSessionHealth(session);
  session.jobsProcessed += 1;
  session.generationJobsProcessed = Math.max(0, Number(session.generationJobsProcessed) || 0) + 1;
  session.lastUsedAt = nowIso();
  return {
    sessionKey: session.key,
    deterministic: session.deterministic !== false,
    jobNumber: session.jobsProcessed,
    generation: Number(session.generation) || 1,
    generationJobNumber: session.generationJobsProcessed,
    recycledBeforeJob: healthResult?.recycled === true,
    recycleCount: Number(session.recycleCount) || 0,
    recycleReasons: healthResult?.reasons || [],
    root: root || null,
    buildId: buildId || null
  };
};

/**
 * Get dictionary LRU cache attached to daemon session.
 *
 * @param {object|null} session
 * @returns {Map<string, unknown>|null}
 */
export const getDaemonDictionaryCache = (session) => {
  if (!session) return null;
  if (!(session.dictCache instanceof Map)) {
    session.dictCache = new Map();
  }
  const health = ensureHealthConfig(session);
  trimMapLru(session.dictCache, health.maxDictionaryEntries);
  return session.dictCache;
};

/**
 * Get tree-sitter preload LRU cache attached to daemon session.
 *
 * @param {object|null} session
 * @returns {Map<string, unknown>|null}
 */
export const getDaemonTreeSitterCache = (session) => {
  if (!session) return null;
  if (!(session.treeSitterPreloadCache instanceof Map)) {
    session.treeSitterPreloadCache = new Map();
  }
  const health = ensureHealthConfig(session);
  trimMapLru(session.treeSitterPreloadCache, health.maxTreeSitterEntries);
  return session.treeSitterPreloadCache;
};

/**
 * Get embedding warm-key LRU set attached to daemon session.
 *
 * @param {object|null} session
 * @returns {Set<string>|null}
 */
export const getDaemonEmbeddingWarmSet = (session) => {
  if (!session) return null;
  if (!(session.embeddingWarmKeys instanceof Set)) {
    session.embeddingWarmKeys = new Set();
  }
  const health = ensureHealthConfig(session);
  trimSetLru(session.embeddingWarmKeys, health.maxEmbeddingWarmEntries);
  return session.embeddingWarmKeys;
};

/**
 * Insert dictionary cache entry and refresh LRU ordering.
 *
 * @param {object|null} session
 * @param {string} signature
 * @param {unknown} payload
 * @returns {void}
 */
export const setDaemonDictionaryCacheEntry = (session, signature, payload) => {
  const dictCache = getDaemonDictionaryCache(session);
  if (!dictCache || !signature || !payload) return;
  dictCache.delete(signature);
  dictCache.set(signature, payload);
  trimMapLru(dictCache, ensureHealthConfig(session).maxDictionaryEntries);
};

/**
 * Lookup dictionary cache entry and refresh LRU ordering on hit.
 *
 * @param {object|null} session
 * @param {string} signature
 * @returns {unknown|null}
 */
export const getDaemonDictionaryCacheEntry = (session, signature) => {
  const dictCache = getDaemonDictionaryCache(session);
  if (!dictCache || !signature) return null;
  const cached = dictCache.get(signature) || null;
  if (!cached) return null;
  dictCache.delete(signature);
  dictCache.set(signature, cached);
  return cached;
};

/**
 * Lookup tree-sitter preload cache entry and refresh LRU ordering on hit.
 *
 * @param {object|null} session
 * @param {string} key
 * @returns {unknown|null}
 */
export const getDaemonTreeSitterCacheEntry = (session, key) => {
  const treeCache = getDaemonTreeSitterCache(session);
  if (!treeCache || !key) return null;
  const cached = treeCache.get(key);
  if (cached === undefined) return null;
  treeCache.delete(key);
  treeCache.set(key, cached);
  return cached;
};

/**
 * Insert tree-sitter preload cache entry and refresh LRU ordering.
 *
 * @param {object|null} session
 * @param {string} key
 * @param {unknown} payload
 * @returns {void}
 */
export const setDaemonTreeSitterCacheEntry = (session, key, payload) => {
  const treeCache = getDaemonTreeSitterCache(session);
  if (!treeCache || !key) return;
  treeCache.delete(key);
  treeCache.set(key, payload);
  trimMapLru(treeCache, ensureHealthConfig(session).maxTreeSitterEntries);
};

/**
 * Probe embedding warm set and refresh LRU ordering on hit.
 *
 * @param {object|null} session
 * @param {string} key
 * @returns {boolean}
 */
export const hasDaemonEmbeddingWarmKey = (session, key) => {
  const warmSet = getDaemonEmbeddingWarmSet(session);
  if (!warmSet || !key) return false;
  if (!warmSet.has(key)) return false;
  warmSet.delete(key);
  warmSet.add(key);
  return true;
};

/**
 * Insert embedding warm key and enforce warm-set capacity.
 *
 * @param {object|null} session
 * @param {string} key
 * @returns {void}
 */
export const addDaemonEmbeddingWarmKey = (session, key) => {
  const warmSet = getDaemonEmbeddingWarmSet(session);
  if (!warmSet || !key) return;
  warmSet.delete(key);
  warmSet.add(key);
  trimSetLru(warmSet, ensureHealthConfig(session).maxEmbeddingWarmEntries);
};

export const __testRuntimeDaemonSessions = Object.freeze({
  reset: () => daemonSessions.clear(),
  getSize: () => daemonSessions.size,
  normalizeDaemonHealthConfig,
  probeRuntimeDaemonSessionHealth
});
