import { extractNgrams } from '../../shared/tokenize.js';
import { postingIncludesDocId, resolvePhraseRange } from './candidates.js';

export const createQueryAstHelpers = ({ queryAst, phraseNgramSet, phraseRange }) => {
  const resolvePhraseRangeFor = (phraseSet) => resolvePhraseRange(phraseSet, phraseRange);
  const resolvedPhraseRange = resolvePhraseRangeFor(phraseNgramSet);

  // Phrase postings are the authoritative source of phrase membership.
  // Do NOT rely on per-chunk ngram arrays: they are optional, often sampled,
  // and (in memory-constrained builds) may not be present at all.
  function getPhraseMatchInfo(idx, chunkId, phraseSet, chunkTokens) {
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
      : (Array.isArray(idx.chunkMeta?.[chunkId]?.tokens) ? idx.chunkMeta[chunkId].tokens : []);
    if (!tokens.length || !resolvedPhraseRange?.min || !resolvedPhraseRange?.max) return { matches: 0 };
    const ngrams = extractNgrams(tokens, resolvedPhraseRange.min, resolvedPhraseRange.max);
    if (!ngrams.length) return { matches: 0 };
    const ngramSet = new Set(ngrams);
    let matches = 0;
    for (const ng of phraseSet) {
      if (ngramSet.has(ng)) matches += 1;
    }
    return { matches };
  }

  const matchesQueryAst = (idx, chunkId, chunk) => {
    if (!queryAst) return true;
    const tokens = Array.isArray(chunk?.tokens)
      ? chunk.tokens
      : (Array.isArray(idx.chunkMeta?.[chunkId]?.tokens) ? idx.chunkMeta[chunkId].tokens : []);
    const tokenSet = tokens.length ? new Set(tokens) : null;
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
            const matchInfo = getPhraseMatchInfo(idx, chunkId, node.ngramSet, tokens);
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
