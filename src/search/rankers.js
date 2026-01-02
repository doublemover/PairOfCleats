import { SimpleMinHash } from '../indexer/minhash.js';

/**
 * Legacy BM25-like scoring using chunk metadata fields directly.
 * @param {object} idx
 * @param {string[]} tokens
 * @param {number} topN
 * @returns {Array<{idx:number,score:number}>}
 */
export function rankBM25Legacy(idx, tokens, topN) {
  const scores = new Map();
  const ids = idx.chunkMeta.map((_, i) => i);
  ids.forEach((i) => {
    const chunk = idx.chunkMeta[i];
    if (!chunk) return;
    let score = 0;
    tokens.forEach((tok) => {
      if (chunk.tokens && chunk.tokens.includes(tok)) score += 1 * (chunk.weight || 1);
      if (chunk.ngrams && chunk.ngrams.includes(tok)) score += 2 * (chunk.weight || 1);
      if (chunk.headline && chunk.headline.includes(tok)) score += 3 * (chunk.weight || 1);
    });
    scores.set(i, score);
  });
  return [...scores.entries()]
    .filter(([, s]) => s > 0)
    .map(([i, s]) => ({ idx: i, score: s }))
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .slice(0, topN);
}

/**
 * Build or normalize the token index view for BM25 scoring.
 * @param {object} idx
 * @returns {object|null}
 */
export function getTokenIndex(idx) {
  const tokenIndex = idx.tokenIndex;
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) return null;
  if (!tokenIndex.vocabIndex) {
    tokenIndex.vocabIndex = new Map(tokenIndex.vocab.map((t, i) => [t, i]));
  }
  if (!Array.isArray(tokenIndex.docLengths)) tokenIndex.docLengths = [];
  if (!tokenIndex.totalDocs) tokenIndex.totalDocs = tokenIndex.docLengths.length;
  if (!tokenIndex.avgDocLen) {
    const total = tokenIndex.docLengths.reduce((sum, len) => sum + len, 0);
    tokenIndex.avgDocLen = tokenIndex.docLengths.length ? total / tokenIndex.docLengths.length : 0;
  }
  return tokenIndex;
}

/**
 * Rank documents using BM25 over the token postings index.
 * Falls back to legacy scoring when the token index is missing.
 * @param {object} params
 * @param {object} params.idx
 * @param {string[]} params.tokens
 * @param {number} params.topN
 * @param {object|null} [params.tokenIndexOverride]
 * @param {number} [params.k1]
 * @param {number} [params.b]
 * @returns {Array<{idx:number,score:number}>}
 */
export function rankBM25({ idx, tokens, topN, tokenIndexOverride = null, k1 = 1.2, b = 0.75 }) {
  const tokenIndex = tokenIndexOverride || getTokenIndex(idx);
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) return rankBM25Legacy(idx, tokens, topN);

  const scores = new Map();
  const docLengths = tokenIndex.docLengths;
  const avgDocLen = tokenIndex.avgDocLen || 1;
  const totalDocs = tokenIndex.totalDocs || idx.chunkMeta.length || 1;

  const qtf = new Map();
  tokens.forEach((tok) => qtf.set(tok, (qtf.get(tok) || 0) + 1));

  for (const [tok, qCount] of qtf.entries()) {
    const tokIdx = tokenIndex.vocabIndex.get(tok);
    if (tokIdx === undefined) continue;
    const posting = tokenIndex.postings[tokIdx] || [];
    const df = posting.length;
    if (!df) continue;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

    for (const [docId, tf] of posting) {
      const dl = docLengths[docId] || 0;
      const denom = tf + k1 * (1 - b + b * (dl / avgDocLen));
      const score = idf * ((tf * (k1 + 1)) / denom) * qCount;
      scores.set(docId, (scores.get(docId) || 0) + score);
    }
  }

  const weighted = [...scores.entries()].map(([docId, score]) => {
    const weight = idx.chunkMeta[docId]?.weight || 1;
    return { idx: docId, score: score * weight };
  });

  return weighted
    .filter(({ score }) => score > 0)
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .slice(0, topN);
}

function minhashSigForTokens(tokens) {
  const mh = new SimpleMinHash();
  tokens.forEach((t) => mh.update(t));
  return mh.hashValues;
}

function jaccard(sigA, sigB) {
  let match = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) match++;
  return match / sigA.length;
}

/**
 * Rank documents using MinHash signatures.
 * @param {object} idx
 * @param {string[]} tokens
 * @param {number} topN
 * @returns {Array<{idx:number,sim:number}>}
 */
export function rankMinhash(idx, tokens, topN, candidateSet = null) {
  if (!idx.minhash?.signatures?.length) return [];
  if (!Array.isArray(tokens) || !tokens.length) return [];
  const qSig = minhashSigForTokens(tokens);
  const ids = candidateSet ? Array.from(candidateSet) : idx.minhash.signatures.map((_, i) => i);
  const scored = [];
  for (const id of ids) {
    const sig = idx.minhash.signatures[id];
    if (!sig) continue;
    scored.push({ idx: id, sim: jaccard(qSig, sig) });
  }
  return scored
    .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
    .slice(0, topN);
}

/**
 * Rank documents using dense vector dot products.
 * @param {object} idx
 * @param {number[]} queryEmbedding
 * @param {number} topN
 * @param {Set<number>|null} candidateSet
 * @returns {Array<{idx:number,sim:number}>}
 */
export function rankDenseVectors(idx, queryEmbedding, topN, candidateSet) {
  const vectors = idx.denseVec?.vectors;
  if (!queryEmbedding || !Array.isArray(vectors) || !vectors.length) return [];
  const dims = idx.denseVec?.dims || queryEmbedding.length;
  const levels = 256;
  const minVal = -1;
  const maxVal = 1;
  const scale = (maxVal - minVal) / (levels - 1);
  const ids = candidateSet ? Array.from(candidateSet) : vectors.map((_, i) => i);
  const scored = [];

  for (const id of ids) {
    const vec = vectors[id];
    const isArrayLike = Array.isArray(vec) || ArrayBuffer.isView(vec);
    if (!isArrayLike || vec.length !== dims) continue;
    let dot = 0;
    for (let i = 0; i < dims; i++) {
      const v = vec[i] * scale + minVal;
      dot += v * queryEmbedding[i];
    }
    scored.push({ idx: id, sim: dot });
  }

  return scored
    .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
    .slice(0, topN);
}
