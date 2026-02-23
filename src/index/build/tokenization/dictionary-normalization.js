import { normalizeCodeDictLanguage } from '../../../shared/code-dictionaries.js';

export const normalizeRange = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeDictWords = (dictWordsRaw) => {
  if (dictWordsRaw && typeof dictWordsRaw.has === 'function' && typeof dictWordsRaw.size === 'number') {
    return dictWordsRaw;
  }
  if (dictWordsRaw instanceof Set) {
    return dictWordsRaw;
  }
  if (Array.isArray(dictWordsRaw)) {
    return new Set(dictWordsRaw);
  }
  return new Set();
};

export const normalizeCodeDictLanguages = (raw) => {
  if (!raw) return new Set();
  const entries = Array.isArray(raw) ? raw : (raw instanceof Set ? Array.from(raw) : [raw]);
  const out = new Set();
  for (const entry of entries) {
    const normalized = normalizeCodeDictLanguage(entry);
    if (normalized) out.add(normalized);
  }
  return out;
};

export const normalizeCodeDictByLanguage = (raw) => {
  if (!raw) return new Map();
  const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
  const out = new Map();
  for (const [lang, words] of entries) {
    const normalized = normalizeCodeDictLanguage(lang);
    if (!normalized) continue;
    const dict = normalizeDictWords(words);
    if (dict.size) out.set(normalized, dict);
  }
  return out;
};

const getDictMaxTokenLength = (dict) => {
  if (!dict) return 0;
  const cached = dict.__maxTokenLength;
  if (Number.isFinite(cached) && cached > 0) return cached;
  const altMax = Number.isFinite(dict.maxLen) && dict.maxLen > 0 ? dict.maxLen : 0;
  if (altMax) return altMax;
  if (dict.__sharedDict) return 0;
  if (typeof dict[Symbol.iterator] !== 'function') return 0;
  let maxLen = 0;
  for (const word of dict) {
    if (typeof word === 'string' && word.length > maxLen) maxLen = word.length;
  }
  dict.__maxTokenLength = maxLen;
  return maxLen;
};

const buildCompositeDict = (baseDict, commonDict, languageDict) => {
  if (!commonDict?.size && !languageDict?.size) return baseDict;
  const size = (baseDict?.size || 0) + (commonDict?.size || 0) + (languageDict?.size || 0);
  const maxLen = Math.max(
    getDictMaxTokenLength(baseDict),
    getDictMaxTokenLength(commonDict),
    getDictMaxTokenLength(languageDict)
  );
  return {
    size,
    maxLen,
    __maxTokenLength: maxLen,
    has: (value) => (
      (baseDict?.has && baseDict.has(value))
      || (commonDict?.has && commonDict.has(value))
      || (languageDict?.has && languageDict.has(value))
    )
  };
};

/**
 * Resolve dictionary words for tokenization based on mode/language.
 * @param {{context:object,mode:string,languageId?:string|null}} input
 * @returns {{size:number,has:function}|Set<string>}
 */
export function resolveTokenDictWords({ context, mode, languageId = null }) {
  const baseDict = context?.dictWords || new Set();
  if (mode !== 'code') return baseDict;
  const allowed = context?.codeDictLanguages;
  const normalizedLang = normalizeCodeDictLanguage(languageId);
  if (allowed instanceof Set) {
    if (!allowed.size) return baseDict;
    if (!normalizedLang || !allowed.has(normalizedLang)) return baseDict;
  }
  const commonDict = context?.codeDictWords;
  const languageDict = normalizedLang
    ? context?.codeDictWordsByLanguage?.get(normalizedLang)
    : null;
  if (!commonDict?.size && !languageDict?.size) return baseDict;
  const cache = context?.codeDictCache;
  const cacheKey = normalizedLang || '__common__';
  if (cache?.has(cacheKey)) return cache.get(cacheKey);
  const combined = buildCompositeDict(baseDict, commonDict, languageDict);
  if (cache) cache.set(cacheKey, combined);
  return combined;
}
