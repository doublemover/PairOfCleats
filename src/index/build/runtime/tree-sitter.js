import { preloadTreeSitterLanguages } from '../../../lang/tree-sitter.js';
import {
  normalizeLimit,
  normalizeOptionalLimit,
  normalizeTreeSitterByLanguage
} from './caps.js';

const DEFAULT_MAX_LOADED_LANGUAGES = 3;
const DEFAULT_MAX_LOADED_LANGUAGES_WITH_PASSES = 1;
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

  // IMPORTANT: Tree-sitter WASM grammar loading can consume non-trivial memory.
  // Default to *on-demand* loading rather than preloading every enabled grammar.
  const treeSitterPreload = normalizePreloadMode(treeSitterConfig.preload);
  const treeSitterPreloadConcurrency = normalizeOptionalLimit(
    treeSitterConfig.preloadConcurrency
  );

  // Optional cap for the number of loaded WASM grammars retained in memory.
  // When null, the tree-sitter runtime will use its conservative internal defaults.
  const hasMaxLoadedLanguages = Object.prototype.hasOwnProperty.call(treeSitterConfig, 'maxLoadedLanguages');
  const defaultMaxLoadedLanguages = treeSitterLanguagePasses
    ? DEFAULT_MAX_LOADED_LANGUAGES_WITH_PASSES
    : DEFAULT_MAX_LOADED_LANGUAGES;
  const treeSitterMaxLoadedLanguages = hasMaxLoadedLanguages
    ? normalizeOptionalLimit(treeSitterConfig.maxLoadedLanguages)
    : defaultMaxLoadedLanguages;

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
  treeSitterLanguages: _treeSitterLanguages,
  treeSitterPreload,
  treeSitterPreloadConcurrency,
  treeSitterMaxLoadedLanguages,
  observedLanguages = null,
  log
}) => {
  if (!treeSitterEnabled) return 0;
  if (treeSitterPreload === 'none') return 0;

  const observed = Array.isArray(observedLanguages) ? observedLanguages.filter(Boolean) : null;
  if (!observed || !observed.length) return 0;
  const enabledTreeSitterLanguages = observed;

  await preloadTreeSitterLanguages(enabledTreeSitterLanguages, {
    log,
    parallel: treeSitterPreload === 'parallel',
    concurrency: treeSitterPreloadConcurrency,
    maxLoadedLanguages: treeSitterMaxLoadedLanguages
  });
  return enabledTreeSitterLanguages.length;
};
