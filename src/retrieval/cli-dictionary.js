import fsSync from 'node:fs';
import { getCodeDictionaryPaths, getDictionaryPaths } from '../../tools/shared/dict-utils.js';
import { normalizeCodeDictLanguages } from '../shared/code-dictionaries.js';

/**
 * Load dictionary files into a normalized Set.
 * @param {string} root
 * @param {object} dictConfig
 * @param {object} [options]
 * @returns {Promise<{dict:Set<string>, dictionaryPaths:string[], codeDictionaryPaths?:object, codeDictSummary?:object}>}
 */
export async function loadDictionary(root, dictConfig, options = {}) {
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  const dict = new Set();
  const addWordsFromFile = (dictFile, target) => {
    try {
      const contents = fsSync.readFileSync(dictFile, 'utf8');
      contents
        .split(/\r?\n/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
        .forEach((word) => target.add(word));
    } catch {}
  };
  for (const dictFile of dictionaryPaths) {
    addWordsFromFile(dictFile, dict);
  }
  if (options.includeCode) {
    const codeDictLanguages = normalizeCodeDictLanguages(options.codeDictLanguages);
    const codeDictPaths = await getCodeDictionaryPaths(root, dictConfig, {
      languages: codeDictLanguages.size ? Array.from(codeDictLanguages) : []
    });
    const codeDictWords = new Set();
    for (const dictFile of codeDictPaths.common) {
      addWordsFromFile(dictFile, codeDictWords);
    }
    for (const dictFiles of codeDictPaths.byLanguage.values()) {
      for (const dictFile of dictFiles) {
        addWordsFromFile(dictFile, codeDictWords);
      }
    }
    for (const word of codeDictWords) dict.add(word);
    return {
      dict,
      dictionaryPaths,
      codeDictionaryPaths: codeDictPaths,
      codeDictSummary: {
        files: codeDictPaths.all.length,
        words: codeDictWords.size,
        languages: Array.from(codeDictPaths.byLanguage.keys()).sort()
      }
    };
  }
  return { dict, dictionaryPaths };
}
