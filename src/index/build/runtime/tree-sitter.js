import {
  preloadTreeSitterLanguages,
  resolveEnabledTreeSitterLanguages
} from '../../../lang/tree-sitter.js';
import {
  normalizeLimit,
  normalizeOptionalLimit,
  normalizeTreeSitterByLanguage
} from './caps.js';

const DEFAULT_MAX_LOADED_LANGUAGES = 3;
const DEFAULT_DEFER_MISSING_MAX = 2;

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

export const resolveTreeSitterRuntime = (indexingConfig) => {
  const treeSitterConfig = indexingConfig.treeSitter || {};
  const treeSitterEnabled = treeSitterConfig.enabled !== false;
  const treeSitterLanguages = treeSitterConfig.languages || {};
  const treeSitterMaxBytes = normalizeLimit(treeSitterConfig.maxBytes, 512 * 1024);
  const treeSitterMaxLines = normalizeLimit(treeSitterConfig.maxLines, 10000);
  const treeSitterMaxParseMs = normalizeLimit(treeSitterConfig.maxParseMs, 1000);
  const treeSitterByLanguage = normalizeTreeSitterByLanguage(
    treeSitterConfig.byLanguage || {}
  );
  const treeSitterConfigChunking = treeSitterConfig.configChunking === true;
  const treeSitterBatchByLanguage = treeSitterConfig.batchByLanguage !== false;
  const treeSitterBatchEmbeddedLanguages = treeSitterConfig.batchEmbeddedLanguages !== false;
  const treeSitterLanguagePasses = treeSitterConfig.languagePasses !== false;
  const treeSitterDeferMissing = treeSitterConfig.deferMissing !== false;
  const hasDeferMissingMax = Object.prototype.hasOwnProperty.call(treeSitterConfig, 'deferMissingMax');
  const treeSitterDeferMissingMax = hasDeferMissingMax
    ? normalizeOptionalLimit(treeSitterConfig.deferMissingMax) ?? 0
    : DEFAULT_DEFER_MISSING_MAX;

  // IMPORTANT: Tree-sitter WASM grammar loading can consume non-trivial memory.
  // Default to *on-demand* loading rather than preloading every enabled grammar.
  const treeSitterPreload = normalizePreloadMode(treeSitterConfig.preload);
  const treeSitterPreloadConcurrency = normalizeOptionalLimit(
    treeSitterConfig.preloadConcurrency
  );

  // Optional cap for the number of loaded WASM grammars retained in memory.
  // When null, the tree-sitter runtime will use its conservative internal defaults.
  const hasMaxLoadedLanguages = Object.prototype.hasOwnProperty.call(treeSitterConfig, 'maxLoadedLanguages');
  const treeSitterMaxLoadedLanguages = hasMaxLoadedLanguages
    ? normalizeOptionalLimit(treeSitterConfig.maxLoadedLanguages)
    : DEFAULT_MAX_LOADED_LANGUAGES;

  return {
    treeSitterEnabled,
    treeSitterLanguages,
    treeSitterConfigChunking,
    treeSitterMaxBytes,
    treeSitterMaxLines,
    treeSitterMaxParseMs,
    treeSitterByLanguage,
    treeSitterPreload,
    treeSitterPreloadConcurrency,
    treeSitterMaxLoadedLanguages,
    treeSitterBatchByLanguage,
    treeSitterBatchEmbeddedLanguages,
    treeSitterLanguagePasses,
    treeSitterDeferMissing,
    treeSitterDeferMissingMax,
    treeSitterWorker: treeSitterConfig.worker || null
  };
};

export const preloadTreeSitterRuntimeLanguages = async ({
  treeSitterEnabled,
  treeSitterLanguages,
  treeSitterPreload,
  treeSitterPreloadConcurrency,
  treeSitterMaxLoadedLanguages,
  log
}) => {
  if (!treeSitterEnabled) return;
  if (treeSitterPreload === 'none') return;

  const enabledTreeSitterLanguages = resolveEnabledTreeSitterLanguages({
    enabled: treeSitterEnabled,
    languages: treeSitterLanguages
  });

  if (!enabledTreeSitterLanguages.length) return;

  await preloadTreeSitterLanguages(enabledTreeSitterLanguages, {
    log,
    parallel: treeSitterPreload === 'parallel',
    concurrency: treeSitterPreloadConcurrency,
    maxLoadedLanguages: treeSitterMaxLoadedLanguages
  });
};
