import {
  preloadTreeSitterLanguages,
  resolveEnabledTreeSitterLanguages
} from '../../../lang/tree-sitter.js';
import {
  normalizeLimit,
  normalizeOptionalLimit,
  normalizeTreeSitterByLanguage
} from './caps.js';

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

  // IMPORTANT: Tree-sitter WASM grammar loading can consume non-trivial memory.
  // Default to *on-demand* loading rather than preloading every enabled grammar.
  const treeSitterPreload = normalizePreloadMode(treeSitterConfig.preload);
  const treeSitterPreloadConcurrency = normalizeOptionalLimit(
    treeSitterConfig.preloadConcurrency
  );

  // Optional cap for the number of loaded WASM grammars retained in memory.
  // When null, the tree-sitter runtime will use its conservative internal defaults.
  const treeSitterMaxLoadedLanguages = normalizeOptionalLimit(
    treeSitterConfig.maxLoadedLanguages
  );

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
