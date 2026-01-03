import { extractNgrams, extractPunctuationTokens, splitId, splitWordsWithDict } from '../shared/tokenize.js';

/**
 * Parse churn arg into a numeric threshold.
 * @param {string|number|boolean|undefined|null} value
 * @returns {number|null}
 */
export function parseChurnArg(value) {
  if (value === undefined || value === null) return null;
  if (value === true) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --churn value: ${value}`);
  }
  return parsed;
}

/**
 * Parse modified-after/since CLI arguments.
 * @param {string|number|undefined|null} afterArg
 * @param {string|number|undefined|null} sinceArg
 * @returns {{modifiedAfter:number|null,modifiedSinceDays:number|null}}
 */
export function parseModifiedArgs(afterArg, sinceArg) {
  let modifiedAfter = null;
  let modifiedSinceDays = null;
  if (afterArg !== undefined && afterArg !== null) {
    const parsed = Date.parse(String(afterArg));
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid --modified-after value: ${afterArg}`);
    }
    modifiedAfter = parsed;
  }
  if (sinceArg !== undefined && sinceArg !== null) {
    const parsed = Number(sinceArg);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid --modified-since value: ${sinceArg}`);
    }
    modifiedSinceDays = parsed;
    const sinceMs = Date.now() - (parsed * 24 * 60 * 60 * 1000);
    modifiedAfter = modifiedAfter == null ? sinceMs : Math.max(modifiedAfter, sinceMs);
  }
  return { modifiedAfter, modifiedSinceDays };
}

/**
 * Parse a query string into include/exclude tokens and phrases.
 * @param {string} raw
 * @returns {{includeTerms:string[],excludeTerms:string[],phrases:string[],excludePhrases:string[]}}
 */
export function parseQueryInput(raw) {
  const includeTerms = [];
  const excludeTerms = [];
  const phrases = [];
  const excludePhrases = [];
  const matcher = /(-?)"([^"]+)"|(-?\S+)/g;
  let match = null;
  while ((match = matcher.exec(raw)) !== null) {
    if (match[2] !== undefined) {
      const phrase = match[2].trim();
      if (!phrase) continue;
      if (match[1] === '-') excludePhrases.push(phrase);
      else phrases.push(phrase);
      continue;
    }
    let token = match[3] || '';
    if (!token) continue;
    let negate = false;
    if (token.startsWith('-') && token.length > 1) {
      negate = true;
      token = token.slice(1);
    }
    if (!token) continue;
    (negate ? excludeTerms : includeTerms).push(token);
  }
  return { includeTerms, excludeTerms, phrases, excludePhrases };
}

const normalizeToken = (value) => String(value || '').normalize('NFKD');

const expandQueryToken = (raw, dict, options) => {
  const normalized = normalizeToken(raw);
  if (!normalized) return [];
  if (normalized.length <= 3 || dict.has(normalized)) return [normalized];
  const expanded = splitWordsWithDict(normalized, dict, options);
  return expanded.length ? expanded : [normalized];
};

/**
 * Tokenize raw query terms into identifier tokens.
 * @param {string[]|string|null|undefined} rawTerms
 * @param {Set<string>} dict
 * @returns {string[]}
 */
export function tokenizeQueryTerms(rawTerms, dict, options) {
  const tokens = [];
  const entries = Array.isArray(rawTerms) ? rawTerms : (rawTerms ? [rawTerms] : []);
  for (const entry of entries) {
    tokens.push(...extractPunctuationTokens(entry));
    const parts = splitId(String(entry || '')).map(normalizeToken).filter(Boolean);
    for (const part of parts) {
      tokens.push(...expandQueryToken(part, dict, options));
    }
  }
  return tokens.filter(Boolean);
}

/**
 * Tokenize a phrase string into dictionary-aware tokens.
 * @param {string} phrase
 * @param {Set<string>} dict
 * @returns {string[]}
 */
export function tokenizePhrase(phrase, dict, options) {
  const parts = splitId(String(phrase || '')).map(normalizeToken).filter(Boolean);
  const tokens = [];
  tokens.push(...extractPunctuationTokens(phrase));
  for (const part of parts) {
    tokens.push(...expandQueryToken(part, dict, options));
  }
  return tokens.filter(Boolean);
}

/**
 * Build phrase n-grams for a list of phrase token arrays.
 * @param {Array<string[]>} phraseTokens
 * @param {object} [config]
 * @returns {{ngrams:string[],minLen:number|null,maxLen:number|null}}
 */
export function buildPhraseNgrams(phraseTokens, config = {}) {
  const enabled = config.enablePhraseNgrams !== false;
  if (!enabled) return { ngrams: [], minLen: null, maxLen: null };
  const minAllowed = Number.isFinite(Number(config.phraseMinN)) ? Number(config.phraseMinN) : 2;
  const maxAllowed = Number.isFinite(Number(config.phraseMaxN))
    ? Number(config.phraseMaxN)
    : Math.max(minAllowed, 4);
  const ngrams = [];
  let minLen = null;
  let maxLen = null;
  for (const tokens of phraseTokens) {
    if (!Array.isArray(tokens) || tokens.length < 2) continue;
    const len = tokens.length;
    if (len < minAllowed || len > maxAllowed) continue;
    minLen = minLen == null ? len : Math.min(minLen, len);
    maxLen = maxLen == null ? len : Math.max(maxLen, len);
    ngrams.push(...extractNgrams(tokens, len, len));
  }
  return { ngrams, minLen, maxLen };
}
