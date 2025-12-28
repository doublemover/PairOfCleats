import * as varint from 'varint';
import { quantizeVec } from '../embedding.js';

const tuneBM25Params = (chunks) => {
  const avgLen = chunks.reduce((s, c) => s + c.tokens.length, 0) / chunks.length;
  const b = avgLen > 800 ? 0.6 : 0.8;
  const k1 = avgLen > 800 ? 1.2 : 1.7;
  return { k1, b };
};

/**
 * Build postings and vector artifacts for the index.
 * @param {object} input
 * @returns {object}
 */
export function buildPostings(input) {
  const {
    chunks,
    df,
    tokenPostings,
    docLengths,
    phrasePost,
    triPost,
    modelId,
    log
  } = input;

  const { k1, b } = tuneBM25Params(chunks);
  const N = chunks.length;
  const avgChunkLen = chunks.reduce((sum, c) => sum + c.tokens.length, 0) / Math.max(N, 1);

  const vocabAll = Array.from(df.keys());
  const trimmedVocab = vocabAll.slice();
  const vmap = new Map(trimmedVocab.map((t, i) => [t, i]));
  const posts = Array.from({ length: trimmedVocab.length }, () => []);
  const sparse = [];

  chunks.forEach((c, r) => {
    const row = [];
    c.tokens.forEach((t) => {
      const col = vmap.get(t);
      if (col === undefined) return;
      posts[col].push(r);
      const idf = Math.log((N - df.get(t) + 0.5) / (df.get(t) + 0.5) + 1);
      const freq = c.tokens.filter((x) => x === t).length;
      const bm =
        idf *
        ((freq * (k1 + 1)) /
          (freq + k1 * (1 - b + b * (c.tokens.length / avgChunkLen))));
      if (bm) row.push([col, bm * c.weight]);
    });
    sparse.push(row);
  });

  log(`Using real model embeddings for dense vectors (${modelId})...`);
  const dims = chunks[0]?.embedding.length || 384;
  const embeddingVectors = chunks.map((c) => c.embedding);
  const quantizedVectors = embeddingVectors.map((vec) => quantizeVec(vec));

  const gap = posts.map((list) => {
    list.sort((a, b) => a - b);
    let prev = 0;
    return list.map((id) => {
      const g = id - prev;
      prev = id;
      return g;
    });
  });
  const postingBuffers = gap.map((list) => Buffer.from(list.flatMap((id) => varint.encode(id))));
  const postingsBin = Buffer.concat(postingBuffers);

  const phraseVocab = Array.from(phrasePost.keys());
  const phrasePostings = phraseVocab.map((k) => Array.from(phrasePost.get(k)));
  const chargramVocab = Array.from(triPost.keys());
  const chargramPostings = chargramVocab.map((k) => Array.from(triPost.get(k)));

  const tokenVocab = Array.from(tokenPostings.keys());
  const tokenPostingsList = tokenVocab.map((t) => tokenPostings.get(t));
  const avgDocLen = docLengths.length
    ? docLengths.reduce((sum, len) => sum + len, 0) / docLengths.length
    : 0;

  const minhashSigs = chunks.map((c) => c.minhashSig);

  return {
    k1,
    b,
    avgChunkLen,
    totalDocs: N,
    trimmedVocab,
    postingsBin,
    phraseVocab,
    phrasePostings,
    chargramVocab,
    chargramPostings,
    tokenVocab,
    tokenPostingsList,
    avgDocLen,
    minhashSigs,
    dims,
    quantizedVectors,
    sparse
  };
}
