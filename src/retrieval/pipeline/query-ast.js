import { extractNgrams } from '../../shared/tokenize.js';
import { postingIncludesDocId, resolvePhraseRange } from './candidates.js';
import { createVocabIndex } from '../vocab-index.js';
import { TEXT_ANALYZER_VERSION } from '../../shared/text-analyzer.js';

/** Whether positive lexical seeding can omit rows admitted by the Boolean AST. */
export const requiresBooleanUniverse = queryAst => {
  const visit = node => {
    if (!node) return { seed: false, narrowed: false, valid: false };
    if (node.type === 'term' || node.type === 'phrase') return { seed: true, narrowed: false, valid: true };
    if (node.type === 'not') return { seed: false, narrowed: false, valid: visit(node.child).valid };
    const left = visit(node.left), right = visit(node.right);
    const valid = left.valid && right.valid;
    if (node.type === 'and') return { seed: left.seed || right.seed, narrowed: left.narrowed || right.narrowed, valid };
    if (node.type === 'or') return { seed: left.seed && right.seed,
      narrowed: left.narrowed || right.narrowed || left.seed !== right.seed, valid };
    return { seed: false, narrowed: false, valid: false };
  };
  const result = visit(queryAst);
  return result.valid && (!result.seed || result.narrowed);
};

/** Exact contiguous membership in the admitted literal token stream. */
export const matchesLiteralPhraseTokens = (literal, phrase, caseSensitive = false) => {
  if (!phrase.length || literal.length < phrase.length) return false;
  for (let start = 0; start <= literal.length - phrase.length; start++) {
    if (phrase.every((token, offset) => caseSensitive
      ? literal[start + offset] === token
      : String(literal[start + offset]).toLowerCase() === String(token).toLowerCase())) return true;
  }
  return false;
};

export const hasCaseSensitivePhrase = node => !!node && ((node.type === 'phrase' && node.caseSensitive === true)
  || hasCaseSensitivePhrase(node.left) || hasCaseSensitivePhrase(node.right) || hasCaseSensitivePhrase(node.child));
export const assertCasePreservedPhraseEvidence = (idx, chunk = null) => {
  if (chunk?.phraseTokensCasePreserved === true || idx?.state?.features?.literalAnalyzer === TEXT_ANALYZER_VERSION) return;
  throw Object.assign(new Error('Case-sensitive phrases require case-preserving literal evidence. Rebuild this index with the current analyzer.'), {
    code: 'ERR_LITERAL_ANALYZER_REBUILD'
  });
};

/**
 * Build helpers for navigating a parsed query AST.
 * @param {{queryAst:object,phraseNgramSet?:Set<string>,phraseRange?:object}} input
 * @returns {object}
 */
export const createQueryAstHelpers = ({ queryAst, phraseNgramSet, phraseRange, termMatches = null }) => {
  const resolvePhraseRangeFor = (phraseSet) => resolvePhraseRange(phraseSet, phraseRange);
  const resolvedPhraseRange = resolvePhraseRangeFor(phraseNgramSet);
  const tokenSetCache = new WeakMap();
  const tokenSetCacheById = new Map();
  const ngramSetCache = new WeakMap();
  const ngramSetCacheById = new Map();
  const phraseRangeKey = resolvedPhraseRange?.min && resolvedPhraseRange?.max
    ? `${resolvedPhraseRange.min}:${resolvedPhraseRange.max}`
    : null;
  // Positive Boolean operators and grouping deliberately request lexical
  // constraints. Whitespace-only terms instead describe semantic intent for
  // ANN hits; phrases and exclusions remain hard constraints in either mode.
  const hasExplicitBoolean = (node) => {
    if (!node) return false;
    if (node.grouped || node.type === 'or' || (node.type === 'and' && node.implicit !== true)) return true;
    return hasExplicitBoolean(node.left) || hasExplicitBoolean(node.right) || hasExplicitBoolean(node.child);
  };
  const allowSemanticTerms = !hasExplicitBoolean(queryAst);
  const hasPhrase = node => !!node && (node.type === 'phrase' || hasPhrase(node.left) || hasPhrase(node.right) || hasPhrase(node.child));
  const requiresLiteral = hasPhrase(queryAst);

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
        || (phraseIndex.vocabIndex = createVocabIndex(phraseIndex.vocab));
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

  const matchesQueryAst = (idx, chunkId, chunk, semantic = false) => {
    if (!queryAst) return true;
    const chunkRecord = resolveChunk(idx, chunkId, chunk);
    if (hasCaseSensitivePhrase(queryAst)) assertCasePreservedPhraseEvidence(idx, chunkRecord);
    if (requiresLiteral && (chunkRecord?.phraseTokensComplete === false
      || chunkRecord?.phraseTokens === null)) return false;
    const tokens = resolveChunkTokens(idx, chunkId, chunkRecord);
    const tokenSet = getCachedTokenSet(chunkRecord, chunkId, tokens);
    const evalNode = (node, relaxTerms = semantic && allowSemanticTerms) => {
      if (!node) return true;
      switch (node.type) {
        case 'term': {
          if (relaxTerms) return true;
          if (termMatches) return termMatches(node, chunkId);
          if (!node.tokens || !node.tokens.length) return false;
          if (!tokenSet) return false;
          return node.tokens.some((tok) => tokenSet.has(tok));
        }
        case 'phrase': {
          const literal = chunkRecord?.phraseTokens ?? tokens;
          const phrase = node.tokens ?? [];
          return matchesLiteralPhraseTokens(literal, phrase, node.caseSensitive === true);
        }
        case 'not':
          return !evalNode(node.child, false);
        case 'and':
          return evalNode(node.left, relaxTerms) && evalNode(node.right, relaxTerms);
        case 'or':
          return evalNode(node.left, relaxTerms) || evalNode(node.right, relaxTerms);
        default:
          return true;
      }
    };
    return evalNode(queryAst);
  };

  const hasExclusion = node => !!node && (node.type === 'not' || hasExclusion(node.left) || hasExclusion(node.right) || hasExclusion(node.child));
  return {
    hasHardSemanticConstraints: requiresLiteral || !allowSemanticTerms || hasExclusion(queryAst),
    matchesQueryAst,
    getPhraseMatchInfo,
    resolvedPhraseRange
  };
};
