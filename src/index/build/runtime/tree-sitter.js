import {
  preloadTreeSitterLanguages,
  resolveEnabledTreeSitterLanguages
} from '../../../lang/tree-sitter.js';
import {
  normalizeLimit,
  normalizeOptionalLimit,
  normalizeTreeSitterByLanguage
} from './caps.js';

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
  const treeSitterPreloadRaw = typeof treeSitterConfig.preload === 'string'
    ? treeSitterConfig.preload.trim().toLowerCase()
    : (treeSitterConfig.preload === true ? 'parallel' : '');
  const treeSitterPreload = treeSitterPreloadRaw === 'parallel' ? 'parallel' : 'serial';
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
    treeSitterByLanguage,
    treeSitterPreload,
    treeSitterPreloadConcurrency,
    treeSitterWorker: treeSitterConfig.worker || null
  };
};

export const preloadTreeSitterRuntimeLanguages = async ({
  treeSitterEnabled,
  treeSitterLanguages,
  treeSitterPreload,
  treeSitterPreloadConcurrency,
  log
}) => {
  if (!treeSitterEnabled) return;
  const enabledTreeSitterLanguages = resolveEnabledTreeSitterLanguages({
    enabled: treeSitterEnabled,
    languages: treeSitterLanguages
  });
  await preloadTreeSitterLanguages(enabledTreeSitterLanguages, {
    log,
    parallel: treeSitterPreload === 'parallel',
    concurrency: treeSitterPreloadConcurrency
  });
};
