import { extractNgrams, tri } from '../../shared/tokenize.js';

export const createCandidateSetBuilder = ({
  useSqlite,
  postingsConfig,
  buildCandidateSetSqlite,
  chargramMaxTokenLength,
  maxCandidates,
  candidatePool
}) => {
  const candidateCap = Number.isFinite(Number(maxCandidates)) && Number(maxCandidates) > 0
    ? Math.floor(Number(maxCandidates))
    : null;
  return function buildCandidateSet(idx, tokens, mode) {
    if (useSqlite && (mode === 'code' || mode === 'prose')) {
      return buildCandidateSetSqlite(mode, tokens);
    }

    const candidates = candidatePool?.acquire ? candidatePool.acquire() : new Set();
    let matched = false;
    const addCandidate = (id) => {
      candidates.add(id);
      return candidateCap && candidates.size >= candidateCap;
    };

    if (postingsConfig.enablePhraseNgrams !== false && idx.phraseNgrams?.vocab && idx.phraseNgrams?.postings) {
      const vocabIndex = idx.phraseNgrams.vocabIndex
        || (idx.phraseNgrams.vocabIndex = new Map(idx.phraseNgrams.vocab.map((t, i) => [t, i])));
      const ngrams = extractNgrams(tokens, postingsConfig.phraseMinN, postingsConfig.phraseMaxN);
      for (const ng of ngrams) {
        const hit = vocabIndex.get(ng);
        if (hit === undefined) continue;
        const posting = idx.phraseNgrams.postings[hit] || [];
        for (const id of posting) {
          if (addCandidate(id)) {
            if (candidatePool?.release) candidatePool.release(candidates);
            return null;
          }
        }
        matched = matched || posting.length > 0;
      }
    }

    if (postingsConfig.enableChargrams !== false && idx.chargrams?.vocab && idx.chargrams?.postings) {
      const vocabIndex = idx.chargrams.vocabIndex
        || (idx.chargrams.vocabIndex = new Map(idx.chargrams.vocab.map((t, i) => [t, i])));
      for (const token of tokens) {
        if (chargramMaxTokenLength && token.length > chargramMaxTokenLength) continue;
        for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; n++) {
          for (const gram of tri(token, n)) {
            const hit = vocabIndex.get(gram);
            if (hit === undefined) continue;
            const posting = idx.chargrams.postings[hit] || [];
            for (const id of posting) {
              if (addCandidate(id)) {
                if (candidatePool?.release) candidatePool.release(candidates);
                return null;
              }
            }
            matched = matched || posting.length > 0;
          }
        }
      }
    }

    if (!matched) {
      if (candidatePool?.release) candidatePool.release(candidates);
      return null;
    }
    return candidates;
  };
};

export const postingIncludesDocId = (posting, docId) => {
  if (!Array.isArray(posting) || !posting.length) return false;
  let lo = 0;
  let hi = posting.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = posting[mid];
    if (v === docId) return true;
    if (v < docId) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
};

export const resolvePhraseRange = (phraseSet, phraseRange) => {
  if (phraseRange?.min && phraseRange?.max) return phraseRange;
  if (!phraseSet || !phraseSet.size) return null;
  let min = null;
  let max = null;
  for (const phrase of phraseSet) {
    const len = String(phrase || '').split('_').filter(Boolean).length;
    if (len < 2) continue;
    min = min == null ? len : Math.min(min, len);
    max = max == null ? len : Math.max(max, len);
  }
  return min && max ? { min, max } : null;
};
