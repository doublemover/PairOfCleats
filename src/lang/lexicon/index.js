import { loadLanguageLexicon } from './load.js';
import { normalizeLookupToken } from './normalize.js';

const VALID_DOMAINS = new Set(['relations', 'ranking', 'chargrams']);

export const getLanguageLexicon = (languageId, options = {}) => loadLanguageLexicon(languageId, options);

export const isLexiconStopword = (languageId, token, domain = 'relations', options = {}) => {
  if (typeof token !== 'string') return false;
  const resolvedDomain = VALID_DOMAINS.has(domain) ? domain : 'relations';
  const lexicon = getLanguageLexicon(languageId, options);
  const stopwords = lexicon?.stopwords?.[resolvedDomain];
  if (!(stopwords instanceof Set)) return false;
  const normalized = normalizeLookupToken(token);
  if (!normalized) return false;
  return stopwords.has(normalized);
};

export const extractSymbolBaseName = (name) => {
  if (typeof name !== 'string') return '';
  let value = name.trim();
  if (!value) return '';

  value = value
    .replace(/\(\)\s*$/g, '')
    .replace(/[;,]+$/g, '')
    .trim();

  if (!value) return '';

  const parts = value
    .split(/::|->|\.|#|\//g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const base = (parts.length ? parts[parts.length - 1] : value)
    .replace(/\(\)\s*$/g, '')
    .replace(/[;,]+$/g, '')
    .trim();

  return base;
};
