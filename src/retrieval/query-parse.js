import { stem as stemEnglish } from '../shared/tokenize.js';
import { types } from 'node:util';
import {
  parseChurnArg as parseChurnArgCore,
  parseModifiedArgs as parseModifiedArgsCore,
  parseQueryInput as parseQueryInputCore,
  parseQueryWithFallback as parseQueryWithFallbackCore,
  tokenizePhrase as tokenizePhraseCore,
  tokenizeQueryTerms as tokenizeQueryTermsCore,
  buildPhraseNgrams as buildPhraseNgramsCore
} from './query.js';

const BOOLEAN_NODE_TYPES = Object.freeze({
  TERM: 'term',
  PHRASE: 'phrase',
  NOT: 'not',
  AND: 'and',
  OR: 'or'
});

const LATIN_ALPHA_PATTERN = /^[A-Za-z]+$/;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const TOKEN_SPLIT_PATTERN = /[\s"'`()[\]{}<>.,!?;:|/\\]+/;
const DEFAULT_CJK_MIN_GRAM = 2;
const DEFAULT_CJK_MAX_GRAM = 3;
const MAX_CJK_FALLBACK_TOKENS = 256;

/**
 * Normalize language tag into lowercased primary language subtag.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
const normalizeLanguageTag = (value) => {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return null;
  const [primary] = trimmed.split(/[-_]/);
  return primary || null;
};

const resolveRequestedLanguage = (options = {}) => {
  const explicit = normalizeLanguageTag(options.language || options.lang);
  if (explicit) return explicit;
  if (Array.isArray(options.languages) && options.languages.length) {
    const first = normalizeLanguageTag(options.languages[0]);
    if (first) return first;
  }
  return null;
};

const detectLanguageFromText = (rawText) => {
  if (CJK_PATTERN.test(rawText)) return 'cjk';
  return 'auto';
};

const resolveBooleanOption = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
};

const resolveNumericOption = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

/**
 * Resolve language/tokenization profile for query token augmentation.
 *
 * @param {object} [options]
 * @param {string[]|string} [rawTerms]
 * @returns {{
 *  language:string,
 *  requestedLanguage:string|null,
 *  detectedLanguage:string,
 *  stemmingEnabled:boolean,
 *  cjkFallbackEnabled:boolean,
 *  cjkMinGram:number,
 *  cjkMaxGram:number
 * }}
 */
export const resolveLanguageTokenProfile = (options = {}, rawTerms = []) => {
  const entries = Array.isArray(rawTerms) ? rawTerms : (rawTerms ? [rawTerms] : []);
  const rawText = entries.map((entry) => String(entry || '')).join(' ').trim();
  const requestedLanguage = resolveRequestedLanguage(options);
  const detectedLanguage = detectLanguageFromText(rawText);
  const language = requestedLanguage || detectedLanguage;
  const cjkLanguage = language === 'cjk' || language === 'zh' || language === 'ja' || language === 'ko';
  const stemmingMode = options.stemming;
  const stemmingEnabled = stemmingMode === true
    || (String(stemmingMode || '').trim().toLowerCase() === 'auto' && language === 'en');
  const cjkFallbackEnabled = resolveBooleanOption(options.cjkFallback, cjkLanguage);
  const cjkMinGram = resolveNumericOption(
    options.cjkMinGram,
    DEFAULT_CJK_MIN_GRAM,
    1,
    6
  );
  const cjkMaxGram = resolveNumericOption(
    options.cjkMaxGram,
    Math.max(cjkMinGram, DEFAULT_CJK_MAX_GRAM),
    cjkMinGram,
    8
  );
  return {
    language,
    requestedLanguage,
    detectedLanguage,
    stemmingEnabled,
    cjkFallbackEnabled,
    cjkMinGram,
    cjkMaxGram
  };
};

const resolveTokenHook = (options = {}) => {
  if (typeof options.tokenHook === 'function') return options.tokenHook;
  if (typeof options.expandToken === 'function') return options.expandToken;
  if (typeof options.languageTokenHook === 'function') return options.languageTokenHook;
  if (options.tokenHooks && typeof options.tokenHooks.expandToken === 'function') {
    return options.tokenHooks.expandToken;
  }
  return null;
};

const addUnique = (target, seen, token) => {
  if (!token) return;
  const value = String(token).trim();
  if (!value || seen.has(value)) return;
  seen.add(value);
  target.push(value);
};

const addTokenArray = (target, seen, values) => {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    addUnique(target, seen, value);
  }
};

/**
 * Derive CJK fallback tokens and n-grams from raw terms.
 *
 * @param {string[]|string} rawTerms
 * @param {{cjkFallbackEnabled:boolean,cjkMinGram:number,cjkMaxGram:number}} profile
 * @returns {string[]}
 */
const extractCjkFallbackTokens = (rawTerms, profile) => {
  if (!profile.cjkFallbackEnabled) return [];
  const entries = Array.isArray(rawTerms) ? rawTerms : (rawTerms ? [rawTerms] : []);
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    if (out.length >= MAX_CJK_FALLBACK_TOKENS) break;
    const text = String(entry || '');
    if (!text || !CJK_PATTERN.test(text)) continue;
    const segments = text.split(TOKEN_SPLIT_PATTERN).filter(Boolean);
    for (const segment of segments) {
      if (!CJK_PATTERN.test(segment)) continue;
      addUnique(out, seen, segment);
      const chars = Array.from(segment);
      const maxN = Math.min(profile.cjkMaxGram, chars.length);
      for (let n = profile.cjkMinGram; n <= maxN; n += 1) {
        for (let i = 0; i <= chars.length - n; i += 1) {
          addUnique(out, seen, chars.slice(i, i + n).join(''));
          if (out.length >= MAX_CJK_FALLBACK_TOKENS) break;
        }
        if (out.length >= MAX_CJK_FALLBACK_TOKENS) break;
      }
      if (out.length >= MAX_CJK_FALLBACK_TOKENS) break;
    }
  }
  return out;
};

const expandStemTokens = (tokens, profile) => {
  if (!profile.stemmingEnabled) return [];
  const out = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!LATIN_ALPHA_PATTERN.test(token) || token.length < 4) continue;
    const normalized = token.toLowerCase();
    const stemmed = stemEnglish(normalized);
    if (!stemmed || stemmed === normalized || stemmed.length < 3) continue;
    addUnique(out, seen, stemmed);
  }
  return out;
};

/**
 * Apply language-aware token expansions (CJK n-grams, stemming, hook output).
 *
 * @param {{rawTerms:string[]|string,baseTokens:string[],options?:object,kind?:'query'|'phrase'}} input
 * @returns {string[]}
 */
export const applyLanguageTokenHooks = ({ rawTerms, baseTokens, options = {}, kind = 'query' }) => {
  const tokens = Array.isArray(baseTokens) ? baseTokens : [];
  if (kind === 'phrase') return tokens.slice();
  const profile = resolveLanguageTokenProfile(options, rawTerms);
  const merged = [];
  const seen = new Set();
  addTokenArray(merged, seen, tokens);
  addTokenArray(merged, seen, extractCjkFallbackTokens(rawTerms, profile));
  addTokenArray(merged, seen, expandStemTokens(merged, profile));
  const tokenHook = resolveTokenHook(options);
  if (!tokenHook) return merged;
  const withHooks = [];
  const hookSeen = new Set();
  for (const token of merged) {
    addUnique(withHooks, hookSeen, token);
    const expanded = tokenHook(token, {
      kind,
      rawTerms,
      profile
    });
    if (Array.isArray(expanded)) {
      addTokenArray(withHooks, hookSeen, expanded);
    } else if (expanded != null) {
      addUnique(withHooks, hookSeen, expanded);
    }
  }
  return withHooks;
};

export const parseChurnArg = parseChurnArgCore;
export const parseModifiedArgs = parseModifiedArgsCore;
export const parseQueryInput = parseQueryInputCore;
export const parseQueryWithFallback = parseQueryWithFallbackCore;
export const buildPhraseNgrams = buildPhraseNgramsCore;

/**
 * Tokenize query terms and apply language-aware token expansion hooks.
 *
 * @param {string[]|string} rawTerms
 * @param {Set<string>|Map<string, number>|object|null} dict
 * @param {object} [options]
 * @returns {string[]}
 */
export const tokenizeQueryTerms = (rawTerms, dict, options = {}) => {
  const baseTokens = tokenizeQueryTermsCore(rawTerms, dict, options);
  return applyLanguageTokenHooks({
    rawTerms,
    baseTokens,
    options,
    kind: 'query'
  });
};

/**
 * Tokenize phrase text and apply language-aware token expansion hooks.
 *
 * @param {string} phrase
 * @param {Set<string>|Map<string, number>|object|null} dict
 * @param {object} [options]
 * @returns {string[]}
 */
export const tokenizePhrase = (phrase, dict, options = {}) => {
  const baseTokens = tokenizePhraseCore(phrase, dict, options);
  return applyLanguageTokenHooks({
    rawTerms: [phrase],
    baseTokens,
    options,
    kind: 'phrase'
  });
};

const originalSetHas = Set.prototype.has;
const tokenHookKeys = ['tokenHook', 'expandToken', 'languageTokenHook', 'tokenHooks'];
const primitive = value => value == null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
const plainOptions = input => input && typeof input === 'object' && !types.isProxy(input)
  && [Object.prototype, null].includes(Object.getPrototypeOf(input));
const captureCoreOptions = input => {
  if (!plainOptions(input) || tokenHookKeys.some(key => key in input)) return null;
  const owned = {};
  for (const key of ['caseSensitive', 'language', 'lang', 'languages', 'stemming', 'cjkFallback',
    'cjkMinGram', 'cjkMaxGram', 'segmentation', 'dpMaxTokenLength']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor) { if (key in input) return null; continue; }
    if (!Object.hasOwn(descriptor, 'value')) return null;
    const value = descriptor.value;
    if (key === 'languages' && Array.isArray(value)) {
      if (types.isProxy(value)) return null;
      // The profile consumes only the first language, not the config's other
      // dictionary inventory arrays or its adaptive segmentation schedule.
      const length = Object.getOwnPropertyDescriptor(value, 'length').value;
      const first = length ? Object.getOwnPropertyDescriptor(value, '0') : null;
      if (length && (!first || !Object.hasOwn(first, 'value') || !primitive(first.value))) return null;
      owned[key] = Object.freeze(length ? [first.value] : []);
    } else { if (!primitive(value)) return null; owned[key] = value; }
  }
  return Object.freeze(owned);
};
const passiveNgramOptions = input => {
  if (!plainOptions(input)) return false;
  return ['enablePhraseNgrams', 'phraseMinN', 'phraseMaxN'].every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor ? Object.hasOwn(descriptor, 'value') && primitive(descriptor.value) : !(key in input);
  });
};
const reusableCoreOptions = (dict, options, postingsConfig, queryMatch) => {
  if (!types.isSet(dict) || types.isProxy(dict) || Object.getPrototypeOf(dict) !== Set.prototype
    || !Reflect.ownKeys(dict).every(key => {
      if (!['__maxTokenLength', 'maxLen'].includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(dict, key);
      return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'number'
        && Number.isFinite(descriptor.value) && descriptor.value >= 0;
    }) || dict.has !== originalSetHas || !passiveNgramOptions(postingsConfig) || typeof queryMatch !== 'string') return null;
  return captureCoreOptions(options);
};

/** One synchronous cold-plan owner. Reuse only the pure default core; aggregate
 * language projection still receives its original raw terms, order and profile.
 * Custom hooks/dictionaries/options retain the unchanged tokenizer call path.
 */
export const createQueryLeafAnalysis = (dict, options = {}, { postingsConfig = {}, queryMatch = 'auto' } = {}) => {
  const capturedOptions = reusableCoreOptions(dict, options, postingsConfig, queryMatch);
  const reusable = capturedOptions !== null;
  const ownedOptions = reusable ? capturedOptions : options;
  const terms = new Map(), phrases = new Map();
  let termCoreAnalyses = 0, phraseCoreAnalyses = 0;
  const queryTerms = (rawTerms, selectedOptions) => {
    const entries = Array.isArray(rawTerms) ? rawTerms : rawTerms ? [rawTerms] : [];
    if (!reusable || !entries.every(entry => typeof entry === 'string')) {
      return tokenizeQueryTerms(rawTerms, dict, selectedOptions);
    }
    const baseTokens = [];
    const caseSensitive = selectedOptions.caseSensitive === true;
    for (const entry of entries) {
      const key = JSON.stringify([caseSensitive, entry]);
      if (!terms.has(key)) {
        terms.set(key, Object.freeze(tokenizeQueryTermsCore([entry], dict, selectedOptions)));
        termCoreAnalyses++;
      }
      baseTokens.push(...terms.get(key));
    }
    return applyLanguageTokenHooks({ rawTerms, baseTokens, options: selectedOptions, kind: 'query' });
  };
  return Object.freeze({
    tokenizeTerms: rawTerms => queryTerms(rawTerms, ownedOptions),
    // Form this at the same aggregate call boundary as the original planner.
    tokenizeScoringTerms: rawTerms => queryTerms(rawTerms, { ...ownedOptions, caseSensitive: false }),
    tokenizePhrase: phrase => {
      if (!reusable || typeof phrase !== 'string') return tokenizePhrase(phrase, dict, ownedOptions);
      if (!phrases.has(phrase)) {
        phrases.set(phrase, Object.freeze(tokenizePhraseCore(phrase, dict, ownedOptions)));
        phraseCoreAnalyses++;
      }
      return applyLanguageTokenHooks({ rawTerms: [phrase], baseTokens: phrases.get(phrase), options: ownedOptions, kind: 'phrase' });
    },
    // Internal work accounting; no new plan/cache/API/artifact output fields.
    snapshotWork: () => Object.freeze({ reusableDefaultCore: reusable,
      termCoreAnalyses: reusable ? termCoreAnalyses : null, phraseCoreAnalyses: reusable ? phraseCoreAnalyses : null })
  });
};

/**
 * Walk boolean query AST and attach token/ngram payloads per node type.
 *
 * @param {object} ast
 * @param {Set<string>|Map<string, number>|object|null} dict
 * @param {object} [options]
 * @param {object} [postingsConfig]
 * @param {object|null} [leafAnalysis] Internal synchronous plan-owned analyzers.
 * @returns {object|null}
 */
export function annotateQueryAst(ast, dict, options = {}, postingsConfig, leafAnalysis = null) {
  if (!ast || typeof ast !== 'object') return null;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return node;
    const next = { ...node };
    if (next.type === BOOLEAN_NODE_TYPES.TERM) {
      next.tokens = leafAnalysis ? leafAnalysis.tokenizeTerms([next.value]) : tokenizeQueryTerms([next.value], dict, options);
      return next;
    }
    if (next.type === BOOLEAN_NODE_TYPES.PHRASE) {
      const tokens = leafAnalysis ? leafAnalysis.tokenizePhrase(next.value) : tokenizePhrase(next.value, dict, options);
      next.tokens = tokens;
      next.caseSensitive = options.caseSensitive === true;
      const phraseInfo = buildPhraseNgrams([tokens], postingsConfig);
      next.ngrams = phraseInfo.ngrams;
      next.ngramSet = phraseInfo.ngrams.length ? new Set(phraseInfo.ngrams) : null;
      return next;
    }
    if (next.type === BOOLEAN_NODE_TYPES.NOT) {
      next.child = visit(next.child);
      return next;
    }
    if (next.type === BOOLEAN_NODE_TYPES.AND || next.type === BOOLEAN_NODE_TYPES.OR) {
      next.left = visit(next.left);
      next.right = visit(next.right);
      return next;
    }
    return next;
  };
  return visit(ast);
}
