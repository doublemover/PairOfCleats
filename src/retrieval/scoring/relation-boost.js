import {
  extractSymbolBaseName,
  getLanguageLexicon,
  isLexiconStopword
} from '../../lang/lexicon/index.js';

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
  if (Array.isArray(chunk?.codeRelations?.usages)) return chunk.codeRelations.usages;
  if (Array.isArray(chunk?.usages)) return chunk.usages;
  if (Array.isArray(fileRelations?.usages)) return fileRelations.usages;
  return [];
};

const resolveCallSources = (chunk, fileRelations) => {
  const callPairs = [];
  const callDetails = [];
  if (Array.isArray(chunk?.codeRelations?.calls)) callPairs.push(...chunk.codeRelations.calls);
  if (Array.isArray(chunk?.codeRelations?.callDetails)) callDetails.push(...chunk.codeRelations.callDetails);
  if (Array.isArray(chunk?.codeRelations?.callDetailsWithRange)) {
    callDetails.push(...chunk.codeRelations.callDetailsWithRange);
  }
  if (!callPairs.length && Array.isArray(fileRelations?.calls)) callPairs.push(...fileRelations.calls);
  if (!callDetails.length && Array.isArray(fileRelations?.callDetails)) {
    callDetails.push(...fileRelations.callDetails);
  }
  if (!callDetails.length && Array.isArray(fileRelations?.callDetailsWithRange)) {
    callDetails.push(...fileRelations.callDetailsWithRange);
  }
  return { callPairs, callDetails };
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
  config = null
} = {}) => {
  const cfg = {
    ...DEFAULT_RELATION_BOOST,
    ...(config && typeof config === 'object' ? config : {})
  };
  const enabled = cfg.enabled === true;
  const caseTokens = cfg.caseTokens === true;
  const caseFile = cfg.caseFile === true;
  const lexiconEnabled = cfg.lexiconEnabled !== false;
  const perCall = asPositiveNumber(cfg.perCall, DEFAULT_RELATION_BOOST.perCall);
  const perUse = asPositiveNumber(cfg.perUse, DEFAULT_RELATION_BOOST.perUse);
  const maxBoost = asPositiveNumber(cfg.maxBoost, DEFAULT_RELATION_BOOST.maxBoost);
  const maxExplainTokens = Math.max(1, Math.floor(asPositiveNumber(
    cfg.maxExplainTokens,
    DEFAULT_RELATION_BOOST.maxExplainTokens
  )));
  const languageId = resolveLanguageId(chunk);

  let resolvedLexicon = null;
  if (lexiconEnabled) {
    try {
      resolvedLexicon = resolveLexicon(languageId, lexicon);
    } catch {
      resolvedLexicon = null;
    }
  }

  const queryTokenSet = new Set();
  const rawQueryTokens = Array.isArray(queryTokens) ? queryTokens : [];
  for (const rawToken of rawQueryTokens) {
    const normalized = normalizeToken(rawToken, caseTokens);
    if (!normalized) continue;
    if (lexiconEnabled && isLexiconStopword(languageId, normalized, 'ranking')) continue;
    queryTokenSet.add(normalized);
  }

  const callTokenSet = new Set();
  const usageTokenSet = new Set();
  const { callPairs, callDetails } = resolveCallSources(chunk, fileRelations);

  for (const entry of callPairs) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const base = extractSymbolBaseName(entry[1]);
    const normalized = normalizeToken(base, caseTokens);
    if (!normalized) continue;
    callTokenSet.add(normalized);
  }
  for (const detail of callDetails) {
    const base = extractSymbolBaseName(detail?.callee || '');
    const normalized = normalizeToken(base, caseTokens);
    if (!normalized) continue;
    callTokenSet.add(normalized);
  }
  for (const entry of resolveUsageSource(chunk, fileRelations)) {
    const normalized = normalizeToken(entry, caseTokens);
    if (!normalized) continue;
    usageTokenSet.add(normalized);
  }

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
