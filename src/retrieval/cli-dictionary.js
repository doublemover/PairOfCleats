import { getCodeDictionaryPaths, getDictionaryPaths } from '../shared/dict-utils.js';
import { normalizeCodeDictLanguages } from '../shared/code-dictionaries.js';
import {
  loadCodeDictionaryWordSets,
  loadDictionaryWordSetFromFiles
} from '../shared/dictionary-wordlists.js';
import { createHash } from 'node:crypto';

const dictionaryIdentity = (dict, languages = [], codeWords = null) => createHash('sha256')
  .update(JSON.stringify({ version: 3, languages: [...languages].sort(), words: [...dict].sort(),
    common: codeWords ? [...codeWords.commonWords].sort() : [],
    byLanguage: codeWords ? [...codeWords.wordsByLanguage].map(([language, words]) =>
      [language, [...words].sort()]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0) : [] })).digest('hex');

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
    const variants = [new Set(dict)];
    if (codeDictWords.commonWords.size) variants.push(new Set([...dict, ...codeDictWords.commonWords]));
    for (const words of codeDictWords.wordsByLanguage.values()) {
      variants.push(new Set([...dict, ...codeDictWords.commonWords, ...words]));
    }
    // The same union can represent different per-language tokenizations. Bind
    // the original base/common/language partitions before mutating the union.
    const policyIdentity = dictionaryIdentity(dict, codeDictLanguages, codeDictWords);
    for (const word of codeDictWords.allWords) dict.add(word);
    Object.defineProperty(dict, 'queryDictionaries', { value: variants });
    return {
      dict,
      policyIdentity,
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
  return { dict, dictionaryPaths, policyIdentity: dictionaryIdentity(dict) };
}
