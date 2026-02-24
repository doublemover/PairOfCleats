import { getCodeDictionaryPaths, getDictionaryPaths } from '../../tools/shared/dict-utils.js';
import { normalizeCodeDictLanguages } from '../shared/code-dictionaries.js';
import {
  loadCodeDictionaryWordSets,
  loadDictionaryWordSetFromFiles
} from '../shared/dictionary-wordlists.js';

/**
 * Load dictionary files into a normalized Set.
 * @param {string} root
 * @param {object} dictConfig
 * @param {object} [options]
 * @returns {Promise<{dict:Set<string>, dictionaryPaths:string[], codeDictionaryPaths?:object, codeDictSummary?:object}>}
 */
export async function loadDictionary(root, dictConfig, options = {}) {
  const dictionaryPathsPromise = getDictionaryPaths(root, dictConfig);
  if (options.includeCode) {
    const codeDictLanguages = normalizeCodeDictLanguages(options.codeDictLanguages);
    const [dictionaryPaths, codeDictPaths] = await Promise.all([
      dictionaryPathsPromise,
      getCodeDictionaryPaths(root, dictConfig, {
        languages: codeDictLanguages.size ? Array.from(codeDictLanguages) : []
      })
    ]);
    const [dict, codeDictWords] = await Promise.all([
      loadDictionaryWordSetFromFiles(dictionaryPaths, { lowerCase: true }),
      loadCodeDictionaryWordSets({
        commonFiles: codeDictPaths.common,
        byLanguage: codeDictPaths.byLanguage,
        lowerCase: true
      })
    ]);
    for (const word of codeDictWords.allWords) dict.add(word);
    return {
      dict,
      dictionaryPaths,
      codeDictionaryPaths: codeDictPaths,
      codeDictSummary: {
        files: codeDictPaths.all.length,
        words: codeDictWords.allWords.size,
        languages: Array.from(codeDictPaths.byLanguage.keys()).sort()
      }
    };
  }
  const dictionaryPaths = await dictionaryPathsPromise;
  const dict = await loadDictionaryWordSetFromFiles(dictionaryPaths, { lowerCase: true });
  return { dict, dictionaryPaths };
}
