import { buildLanguageContext } from '../../../language-registry.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../../lang/tree-sitter/config.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

export const buildLanguageAnalysisContext = async ({
  ext,
  relKey,
  mode,
  text,
  languageContextOptions,
  treeSitterEnabled,
  treeSitterLanguagePasses,
  treeSitterConfigForMode: _treeSitterConfigForMode,
  primaryLanguageId,
  runTreeSitter
}) => runTreeSitter(async () => {
  if (!treeSitterLanguagePasses
    && treeSitterEnabled
    && primaryLanguageId
    && TREE_SITTER_LANG_IDS.has(primaryLanguageId)) {
    // Native scheduler mode keeps parser activation within chunking/execution paths.
  }
  return buildLanguageContext({
    ext,
    relPath: relKey,
    mode,
    text,
    options: languageContextOptions
  });
});
