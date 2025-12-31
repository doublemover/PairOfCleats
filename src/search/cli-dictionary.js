import fsSync from 'node:fs';
import { getDictionaryPaths } from '../../tools/dict-utils.js';

/**
 * Load dictionary files into a normalized Set.
 * @param {string} root
 * @param {object} dictConfig
 * @returns {Promise<{dict:Set<string>, dictionaryPaths:string[]}>}
 */
export async function loadDictionary(root, dictConfig) {
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  const dict = new Set();
  for (const dictFile of dictionaryPaths) {
    try {
      const contents = fsSync.readFileSync(dictFile, 'utf8');
      contents
        .split(/\r?\n/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
        .forEach((word) => dict.add(word));
    } catch {}
  }
  return { dict, dictionaryPaths };
}
