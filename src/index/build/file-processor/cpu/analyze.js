import { buildLanguageContext } from '../../../language-registry.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../../lang/tree-sitter/config.js';
import { preloadTreeSitterLanguages } from '../../../../lang/tree-sitter.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

export const buildLanguageAnalysisContext = async ({
  ext,
  relKey,
  mode,
  text,
  languageContextOptions,
  treeSitterEnabled,
  treeSitterLanguagePasses,
  treeSitterConfigForMode,
  primaryLanguageId,
  runTreeSitter
}) => runTreeSitter(async () => {
  if (!treeSitterLanguagePasses
    && treeSitterEnabled
    && primaryLanguageId
    && TREE_SITTER_LANG_IDS.has(primaryLanguageId)) {
    try {
      await preloadTreeSitterLanguages([primaryLanguageId], {
        log: languageContextOptions?.log,
        parallel: false,
        maxLoadedLanguages: treeSitterConfigForMode?.maxLoadedLanguages
      });
    } catch {
      // ignore preload failures; prepare will fall back if needed.
    }
  }
  return buildLanguageContext({
    ext,
    relPath: relKey,
    mode,
    text,
    options: languageContextOptions
  });
});
