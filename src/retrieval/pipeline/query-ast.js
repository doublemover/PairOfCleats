import { extractNgrams } from '../../shared/tokenize.js';
import { postingIncludesDocId, resolvePhraseRange } from './candidates.js';

/**
 * Build helpers for navigating a parsed query AST.
 * @param {{queryAst:object,phraseNgramSet?:Set<string>,phraseRange?:object}} input
 * @returns {object}
 */
export const createQueryAstHelpers = ({ queryAst, phraseNgramSet, phraseRange }) => {
  const resolvePhraseRangeFor = (phraseSet) => resolvePhraseRange(phraseSet, phraseRange);
  const resolvedPhraseRange = resolvePhraseRangeFor(phraseNgramSet);
  const tokenSetCache = new WeakMap();
  const tokenSetCacheById = new Map();
  const ngramSetCache = new WeakMap();
  const ngramSetCacheById = new Map();
  const phraseRangeKey = resolvedPhraseRange?.min && resolvedPhraseRange?.max
    ? `${resolvedPhraseRange.min}:${resolvedPhraseRange.max}`
    : null;

  const resolveChunk = (idx, chunkId, chunk) => (
    chunk || idx?.chunkMeta?.[chunkId] || null
  );

  const resolveChunkTokens = (idx, chunkId, chunk) => {
    if (Array.isArray(chunk?.tokens)) return chunk.tokens;
    const fallback = idx?.chunkMeta?.[chunkId];
    return Array.isArray(fallback?.tokens) ? fallback.tokens : [];
  };

  const getCachedTokenSet = (chunk, chunkId, tokens) => {
    if (!tokens.length) return null;
    if (chunk && typeof chunk === 'object') {
      const cached = tokenSetCache.get(chunk);
      if (cached && cached.tokens === tokens) return cached.set;
      const set = new Set(tokens);
      tokenSetCache.set(chunk, { tokens, set });
      return set;
    }
    if (chunkId == null) return new Set(tokens);
    const cached = tokenSetCacheById.get(chunkId);
    if (cached && cached.tokens === tokens) return cached.set;
    const set = new Set(tokens);
    tokenSetCacheById.set(chunkId, { tokens, set });
    return set;
  };

  const getCachedNgramSet = (chunk, chunkId, tokens) => {
    if (!tokens.length || !phraseRangeKey) return null;
    if (chunk && typeof chunk === 'object') {
      const cached = ngramSetCache.get(chunk);
      if (cached && cached.tokens === tokens && cached.rangeKey === phraseRangeKey) return cached.set;
      const ngrams = extractNgrams(tokens, resolvedPhraseRange.min, resolvedPhraseRange.max);
      const set = ngrams.length ? new Set(ngrams) : null;
      ngramSetCache.set(chunk, { tokens, rangeKey: phraseRangeKey, set });
      return set;
    }
    if (chunkId == null) {
      const ngrams = extractNgrams(tokens, resolvedPhraseRange.min, resolvedPhraseRange.max);
      return ngrams.length ? new Set(ngrams) : null;
    }
    const cached = ngramSetCacheById.get(chunkId);
    if (cached && cached.tokens === tokens && cached.rangeKey === phraseRangeKey) return cached.set;
    const ngrams = extractNgrams(tokens, resolvedPhraseRange.min, resolvedPhraseRange.max);
    const set = ngrams.length ? new Set(ngrams) : null;
    ngramSetCacheById.set(chunkId, { tokens, rangeKey: phraseRangeKey, set });
    return set;
  };

  // Phrase postings are the authoritative source of phrase membership.
  // Do NOT rely on per-chunk ngram arrays: they are optional, often sampled,
  // and (in memory-constrained builds) may not be present at all.
  function getPhraseMatchInfo(idx, chunkId, phraseSet, chunkTokens, chunk = null) {
    if (!phraseSet || !phraseSet.size || !idx) return { matches: 0 };
    const phraseIndex = idx.phraseNgrams;
    if (phraseIndex && phraseIndex.vocab && phraseIndex.postings) {
      const vocabIndex = phraseIndex.vocabIndex
        || (phraseIndex.vocabIndex = new Map(phraseIndex.vocab.map((t, i) => [t, i])));
      let matches = 0;
      for (const ng of phraseSet) {
        const hit = vocabIndex.get(ng);
        if (hit === undefined) continue;
        const posting = phraseIndex.postings[hit] || [];
        if (postingIncludesDocId(posting, chunkId)) matches += 1;
      }
      if (matches) return { matches };
      if (phraseIndex.vocab.length || phraseIndex.postings.length) return { matches: 0 };
    }
    const tokens = Array.isArray(chunkTokens)
      ? chunkTokens
      : resolveChunkTokens(idx, chunkId, chunk);
    if (!tokens.length || !resolvedPhraseRange?.min || !resolvedPhraseRange?.max) return { matches: 0 };
    const ngramSet = getCachedNgramSet(chunk, chunkId, tokens);
    if (!ngramSet || !ngramSet.size) return { matches: 0 };
    let matches = 0;
    for (const ng of phraseSet) {
      if (ngramSet.has(ng)) matches += 1;
    }
    return { matches };
  }

  const matchesQueryAst = (idx, chunkId, chunk) => {
    if (!queryAst) return true;
    const chunkRecord = resolveChunk(idx, chunkId, chunk);
    const tokens = resolveChunkTokens(idx, chunkId, chunkRecord);
    const tokenSet = getCachedTokenSet(chunkRecord, chunkId, tokens);
    const evalNode = (node) => {
      if (!node) return true;
      switch (node.type) {
        case 'term': {
          if (!node.tokens || !node.tokens.length) return false;
          if (!tokenSet) return false;
          return node.tokens.some((tok) => tokenSet.has(tok));
        }
        case 'phrase': {
          if (node.ngramSet && node.ngramSet.size) {
            const matchInfo = getPhraseMatchInfo(idx, chunkId, node.ngramSet, tokens, chunkRecord);
            return matchInfo.matches > 0;
          }
          if (!node.tokens || !node.tokens.length) return false;
          if (!tokenSet) return false;
          return node.tokens.some((tok) => tokenSet.has(tok));
        }
        case 'not':
          return !evalNode(node.child);
        case 'and':
          return evalNode(node.left) && evalNode(node.right);
        case 'or':
          return evalNode(node.left) || evalNode(node.right);
        default:
          return true;
      }
    };
    return evalNode(queryAst);
  };

  return {
    matchesQueryAst,
    getPhraseMatchInfo,
    resolvedPhraseRange
  };
};
