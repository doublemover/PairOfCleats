import { stem as stemEnglish } from '../shared/tokenize.js';
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

export const applyLanguageTokenHooks = ({ rawTerms, baseTokens, options = {}, kind = 'query' }) => {
  const tokens = Array.isArray(baseTokens) ? baseTokens : [];
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

export const tokenizeQueryTerms = (rawTerms, dict, options = {}) => {
  const baseTokens = tokenizeQueryTermsCore(rawTerms, dict, options);
  return applyLanguageTokenHooks({
    rawTerms,
    baseTokens,
    options,
    kind: 'query'
  });
};

export const tokenizePhrase = (phrase, dict, options = {}) => {
  const baseTokens = tokenizePhraseCore(phrase, dict, options);
  return applyLanguageTokenHooks({
    rawTerms: [phrase],
    baseTokens,
    options,
    kind: 'phrase'
  });
};

export function annotateQueryAst(ast, dict, options = {}, postingsConfig) {
  if (!ast || typeof ast !== 'object') return null;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return node;
    const next = { ...node };
    if (next.type === BOOLEAN_NODE_TYPES.TERM) {
      next.tokens = tokenizeQueryTerms([next.value], dict, options);
      return next;
    }
    if (next.type === BOOLEAN_NODE_TYPES.PHRASE) {
      const tokens = tokenizePhrase(next.value, dict, options);
      next.tokens = tokens;
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
