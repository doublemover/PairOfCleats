import {
  normalizeLimit,
  normalizeOptionalLimit,
  normalizeTreeSitterByLanguage
} from './caps.js';

const DEFAULT_DEFER_MISSING_MAX = 2;
const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};
const normalizeSchedulerTransport = (raw) => {
  if (typeof raw !== 'string') return 'disk';
  const value = raw.trim().toLowerCase();
  if (value === 'disk' || value === 'shm') return value;
  return 'disk';
};
const normalizeSchedulerFormat = (raw) => {
  if (typeof raw !== 'string') return 'binary-v1';
  const value = raw.trim().toLowerCase();
  if (value === 'binary-v1' || value === 'jsonl') return value;
  return 'binary-v1';
};
const normalizeSchedulerStore = (raw) => {
  if (typeof raw !== 'string') return 'paged-json';
  const value = raw.trim().toLowerCase();
  if (value === 'paged-json' || value === 'rows') return value;
  return 'paged-json';
};
const normalizeSchedulerCodec = (raw) => {
  if (typeof raw !== 'string') return 'none';
  const value = raw.trim().toLowerCase();
  if (value === 'gzip' || value === 'none') return value;
  return 'none';
};
const normalizePreloadMode = (raw) => {
  if (raw === true) return 'parallel';
  if (raw === false || raw === undefined || raw === null) return 'none';

  if (typeof raw === 'number') {
    if (raw === 0) return 'none';
    if (raw === 1) return 'serial';
  }

  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (!v) return 'none';
    if (['none', 'off', 'false', '0', 'no', 'disabled'].includes(v)) return 'none';
    if (['serial', 'seq', 'sequential'].includes(v)) return 'serial';
    if (['parallel', 'par'].includes(v)) return 'parallel';
  }

  // Safe default: avoid eager preloading unless explicitly requested.
  return 'none';
};

/**
 * Resolve runtime tree-sitter caps and scheduler settings from indexing config.
 * @param {object} indexingConfig
 * @returns {object}
 */
export const resolveTreeSitterRuntime = (indexingConfig) => {
  const treeSitterConfig = indexingConfig.treeSitter || {};
  const treeSitterEnabled = treeSitterConfig.enabled !== false;
  const treeSitterLanguages = treeSitterConfig.languages || {};
  // Keep large C/C++ headers on the native parser path by default.
  // 512KB caused frequent scheduler skips on benchmark repos (e.g. nlohmann/fmt),
  // which then fell back to slower heuristic chunking.
  const treeSitterMaxBytes = normalizeLimit(treeSitterConfig.maxBytes, 1024 * 1024);
  const treeSitterMaxLines = normalizeLimit(treeSitterConfig.maxLines, 10000);
  const treeSitterMaxParseMs = normalizeLimit(treeSitterConfig.maxParseMs, 1000);
  const treeSitterByLanguage = normalizeTreeSitterByLanguage(
    treeSitterConfig.byLanguage || {}
  );
  const heavyGrammarDefaults = {
    javascript: { maxBytes: 256 * 1024, maxLines: null, maxParseMs: null },
    typescript: { maxBytes: 256 * 1024, maxLines: null, maxParseMs: null },
    tsx: { maxBytes: 256 * 1024, maxLines: null, maxParseMs: null },
    jsx: { maxBytes: 256 * 1024, maxLines: null, maxParseMs: null },
    html: { maxBytes: 256 * 1024, maxLines: null, maxParseMs: null }
  };
  const mergedTreeSitterByLanguage = {
    ...heavyGrammarDefaults,
    ...treeSitterByLanguage
  };
  const treeSitterConfigChunking = treeSitterConfig.configChunking === true;
  const treeSitterSchedulerConfig = treeSitterConfig.scheduler
    && typeof treeSitterConfig.scheduler === 'object'
    ? treeSitterConfig.scheduler
    : {};
  const treeSitterCachePersistent = treeSitterConfig.cachePersistent !== false;
  const treeSitterCachePersistentDir = normalizeOptionalString(treeSitterConfig.cachePersistentDir);
  const treeSitterBatchByLanguage = treeSitterConfig.batchByLanguage !== false;
  const treeSitterBatchEmbeddedLanguages = treeSitterConfig.batchEmbeddedLanguages !== false;
  const treeSitterLanguagePasses = treeSitterConfig.languagePasses !== false;
  const treeSitterDeferMissing = treeSitterConfig.deferMissing !== false;
  const hasDeferMissingMax = Object.prototype.hasOwnProperty.call(treeSitterConfig, 'deferMissingMax');
  const deferMissingRaw = treeSitterConfig.deferMissingMax;
  const normalizedDeferMissingMax = normalizeOptionalLimit(deferMissingRaw);
  const treeSitterDeferMissingMax = hasDeferMissingMax
    ? (normalizedDeferMissingMax == null
      ? (deferMissingRaw === 0 || deferMissingRaw === false ? null : DEFAULT_DEFER_MISSING_MAX)
      : normalizedDeferMissingMax)
    : DEFAULT_DEFER_MISSING_MAX;

  // Native tree-sitter grammar activation happens on demand in the scheduler.
  // Keep preload config parsing for compatibility, but no eager preload is used.
  const treeSitterPreload = normalizePreloadMode(treeSitterConfig.preload);
  const treeSitterPreloadConcurrency = normalizeOptionalLimit(
    treeSitterConfig.preloadConcurrency
  );

  return {
    treeSitterEnabled,
    treeSitterLanguages,
    treeSitterConfigChunking,
    treeSitterMaxBytes,
    treeSitterMaxLines,
    treeSitterMaxParseMs,
    treeSitterByLanguage: mergedTreeSitterByLanguage,
    treeSitterPreload,
    treeSitterPreloadConcurrency,
    treeSitterBatchByLanguage,
    treeSitterBatchEmbeddedLanguages,
    treeSitterLanguagePasses,
    treeSitterDeferMissing,
    treeSitterDeferMissingMax,
    treeSitterWorker: treeSitterConfig.worker || null,
    treeSitterScheduler: {
      transport: normalizeSchedulerTransport(treeSitterSchedulerConfig.transport),
      sharedCache: treeSitterSchedulerConfig.sharedCache === true,
      format: normalizeSchedulerFormat(treeSitterSchedulerConfig.format),
      store: normalizeSchedulerStore(treeSitterSchedulerConfig.store),
      pageCodec: normalizeSchedulerCodec(treeSitterSchedulerConfig.pageCodec),
      pageSize: normalizeOptionalLimit(treeSitterSchedulerConfig.pageSize) || 128
    },
    treeSitterCachePersistent,
    treeSitterCachePersistentDir
  };
};

/**
 * Legacy preload hook (no-op): grammars now activate lazily in scheduler paths.
 * @param {object} input
 * @returns {Promise<number>}
 */
export const preloadTreeSitterRuntimeLanguages = async ({
  treeSitterEnabled,
  treeSitterLanguages: _treeSitterLanguages,
  treeSitterPreload,
  treeSitterPreloadConcurrency: _treeSitterPreloadConcurrency,
  observedLanguages: _observedLanguages = null,
  log
}) => {
  if (!treeSitterEnabled) return 0;
  void treeSitterPreload;
  void log;
  return 0;
};
