import {
  extractSymbolBaseName,
  getLanguageLexicon,
  isLexiconStopword
} from '../../lang/lexicon/index.js';
import { normalizeNonNegativeNumber } from '../../shared/limits.js';

const DEFAULT_RELATION_BOOST = Object.freeze({
  enabled: false,
  perCall: 0.25,
  perUse: 0.1,
  maxBoost: 1.5,
  maxExplainTokens: 12,
  caseTokens: false,
  caseFile: false,
  lexiconEnabled: true
});

const asPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeToken = (value, caseSensitive) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return caseSensitive ? trimmed : trimmed.toLowerCase();
};

const resolveLanguageId = (chunk) => (
  chunk?.lang
  || chunk?.metaV2?.lang
  || chunk?.metaV2?.effective?.languageId
  || null
);

const resolveUsageSource = (chunk, fileRelations) => {
  const sources = [
    chunk?.codeRelations?.usages,
    chunk?.usages,
    fileRelations?.usages
  ];
  for (const source of sources) {
    if (Array.isArray(source) && source.length) return source;
  }
  for (const source of sources) {
    if (Array.isArray(source)) return source;
  }
  return [];
};

const resolveCallSources = (chunk, fileRelations) => {
  const chunkPairs = chunk?.codeRelations?.calls;
  const callPairs = Array.isArray(chunkPairs) && chunkPairs.length ? chunkPairs
    : (Array.isArray(fileRelations?.calls) ? fileRelations.calls : EMPTY_RELATIONS);
  let callDetails = [chunk?.codeRelations?.callDetails, chunk?.codeRelations?.callDetailsWithRange]
    .filter(source => Array.isArray(source) && source.length);
  if (!callDetails.length) {
    const fallback = [fileRelations?.callDetails, fileRelations?.callDetailsWithRange]
      .find(source => Array.isArray(source) && source.length);
    callDetails = fallback ? [fallback] : [];
  }
  return { callPairs, callDetails };
};

const EMPTY_RELATIONS = Object.freeze([]);

/** Memoization is confined to this ranking request and its immutable relation sources. */
export const createRelationBoostEvaluator = ({ queryTokens = [], config = null, lexicon = null } = {}) => {
  const prepared = { languages: new Map(), relations: new WeakMap(),
    cfg: { ...DEFAULT_RELATION_BOOST, ...(config || {}) } };
  return input => computeRelationBoost({ ...input, queryTokens, config, lexicon, prepared });
};

const toSortedLimitedList = (set, maxItems) => {
  if (!(set instanceof Set) || !set.size) return [];
  const out = Array.from(set);
  out.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  return out.slice(0, maxItems);
};

const resolveLexicon = (languageId, lexicon) => {
  if (lexicon?.getLanguageLexicon && typeof lexicon.getLanguageLexicon === 'function') {
    return lexicon.getLanguageLexicon(languageId, { allowFallback: true });
  }
  return getLanguageLexicon(languageId, { allowFallback: true });
};

const hasSetToken = (set, token) => (
  set instanceof Set && set.has(token)
);

const isRankingStopword = ({
  languageId,
  token,
  resolvedLexicon,
  allowGlobalFallback,
  caseSensitive = false
}) => {
  const normalized = normalizeToken(token, caseSensitive);
  if (!normalized) return false;

  const rankingStopwords = resolvedLexicon?.stopwords?.ranking;
  if (rankingStopwords instanceof Set) {
    return rankingStopwords.has(normalized);
  }

  if (resolvedLexicon && typeof resolvedLexicon === 'object') {
    return hasSetToken(resolvedLexicon.keywords, normalized)
      || hasSetToken(resolvedLexicon.literals, normalized)
      || hasSetToken(resolvedLexicon.types, normalized)
      || hasSetToken(resolvedLexicon.builtins, normalized);
  }

  // Avoid case-folding elision when running case-sensitive relation boosting.
  if (caseSensitive) return false;

  return allowGlobalFallback
    ? isLexiconStopword(languageId, normalized, 'ranking')
    : false;
};

/**
 * Compute additive relation-boost score and explain metadata.
 * @param {object} input
 * @returns {object}
 */
export const computeRelationBoost = ({
  chunk = null,
  fileRelations = null,
  queryTokens = [],
  lexicon = null,
  config = null,
  prepared = null
} = {}) => {
  const cfg = prepared?.cfg || {
    ...DEFAULT_RELATION_BOOST,
    ...(config && typeof config === 'object' ? config : {})
  };
  const enabled = cfg.enabled === true;
  const caseTokens = cfg.caseTokens === true;
  const caseFile = cfg.caseFile === true;
  const lexiconEnabled = cfg.lexiconEnabled !== false;
  const perCall = normalizeNonNegativeNumber(cfg.perCall, DEFAULT_RELATION_BOOST.perCall);
  const perUse = normalizeNonNegativeNumber(cfg.perUse, DEFAULT_RELATION_BOOST.perUse);
  const maxBoost = normalizeNonNegativeNumber(cfg.maxBoost, DEFAULT_RELATION_BOOST.maxBoost);
  const maxExplainTokens = Math.max(1, Math.floor(asPositiveNumber(
    cfg.maxExplainTokens,
    DEFAULT_RELATION_BOOST.maxExplainTokens
  )));
  const languageId = resolveLanguageId(chunk);
  const hasInjectedLexicon = lexicon != null;
  const cachedLanguage = prepared?.languages.get(languageId);

  let resolvedLexicon = cachedLanguage?.resolvedLexicon ?? null;
  if (!cachedLanguage && lexiconEnabled) {
    try {
      resolvedLexicon = resolveLexicon(languageId, lexicon);
    } catch {
      resolvedLexicon = null;
    }
  }

  const queryTokenSet = cachedLanguage?.queryTokenSet || new Set();
  const rawQueryTokens = Array.isArray(queryTokens) ? queryTokens : [];
  for (const rawToken of cachedLanguage ? [] : rawQueryTokens) {
    const normalized = normalizeToken(rawToken, caseTokens);
    if (!normalized) continue;
    if (lexiconEnabled && isRankingStopword({
      languageId,
      token: rawToken,
      resolvedLexicon,
      allowGlobalFallback: !hasInjectedLexicon,
      caseSensitive: caseTokens
    })) continue;
    queryTokenSet.add(normalized);
  }
  if (prepared && !cachedLanguage) prepared.languages.set(languageId, { resolvedLexicon, queryTokenSet });

  const { callPairs, callDetails } = resolveCallSources(chunk, fileRelations);
  const usageSource = resolveUsageSource(chunk, fileRelations);
  let owner = prepared?.relations;
  if (owner) {
    for (const source of [callPairs, callDetails[0] || EMPTY_RELATIONS,
      callDetails[1] || EMPTY_RELATIONS, usageSource.length ? usageSource : EMPTY_RELATIONS]) {
      let next = owner.get(source);
      if (!next) { next = new WeakMap(); owner.set(source, next); }
      owner = next;
    }
  }
  const cachedRelations = owner?.get(EMPTY_RELATIONS);
  const callTokenSet = cachedRelations?.callTokenSet || new Set();
  const usageTokenSet = cachedRelations?.usageTokenSet || new Set();

  for (const entry of cachedRelations ? [] : callPairs) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const base = extractSymbolBaseName(entry[1]);
    const normalized = normalizeToken(base, caseTokens);
    if (!normalized) continue;
    callTokenSet.add(normalized);
  }
  for (const source of cachedRelations ? [] : callDetails) {
    for (const detail of source) {
      const base = extractSymbolBaseName(detail?.callee || '');
      const normalized = normalizeToken(base, caseTokens);
      if (!normalized) continue;
      callTokenSet.add(normalized);
    }
  }
  for (const entry of cachedRelations ? [] : usageSource) {
    const normalized = normalizeToken(entry, caseTokens);
    if (!normalized) continue;
    usageTokenSet.add(normalized);
  }
  owner?.set(EMPTY_RELATIONS, { callTokenSet, usageTokenSet });

  const matchedCalls = new Set();
  const matchedUsages = new Set();
  let callMatches = 0;
  let usageMatches = 0;
  for (const token of queryTokenSet) {
    if (callTokenSet.has(token)) {
      callMatches += 1;
      matchedCalls.add(token);
    }
    if (usageTokenSet.has(token)) {
      usageMatches += 1;
      matchedUsages.add(token);
    }
  }

  const rawBoost = enabled
    ? ((callMatches * perCall) + (usageMatches * perUse))
    : 0;
  const boost = enabled ? Math.min(maxBoost, rawBoost) : 0;
  const lexiconDomainCounts = resolvedLexicon?.counts
    ? {
      relations: resolvedLexicon.counts.stopwordsRelations ?? null,
      ranking: resolvedLexicon.counts.stopwordsRanking ?? null,
      chargrams: resolvedLexicon.counts.stopwordsChargrams ?? null
    }
    : null;

  return {
    enabled,
    caseTokens,
    caseFile,
    languageId,
    queryTokenCount: queryTokenSet.size,
    callMatches,
    usageMatches,
    perCall,
    perUse,
    maxBoost,
    rawBoost,
    boost,
    maxExplainTokens,
    signalTokens: toSortedLimitedList(queryTokenSet, maxExplainTokens),
    matchedCalls: toSortedLimitedList(matchedCalls, maxExplainTokens),
    matchedUsages: toSortedLimitedList(matchedUsages, maxExplainTokens),
    lexicon: {
      enabled: lexiconEnabled,
      sourceFile: resolvedLexicon?.sourceFile || null,
      formatVersion: Number.isFinite(Number(resolvedLexicon?.formatVersion))
        ? Number(resolvedLexicon.formatVersion)
        : null,
      domainTokenCounts: lexiconDomainCounts
    }
  };
};
