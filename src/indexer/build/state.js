import { extractNgrams, tri } from '../../shared/tokenize.js';

/**
 * Create the mutable state for index building.
 * @returns {object}
 */
export function createIndexState() {
  return {
    df: new Map(),
    wordFreq: new Map(),
    chunks: [],
    tokenPostings: new Map(),
    docLengths: [],
    triPost: new Map(),
    phrasePost: new Map(),
    scannedFiles: [],
    scannedFilesTimes: [],
    skippedFiles: [],
    totalTokens: 0
  };
}

/**
 * Append a processed chunk into global index structures.
 * @param {object} state
 * @param {object} chunk
 */
export function appendChunk(state, chunk) {
  const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  const seq = Array.isArray(chunk.seq) && chunk.seq.length ? chunk.seq : tokens;
  if (!seq.length) return;

  state.totalTokens += seq.length;
  const ngrams = Array.isArray(chunk.ngrams) && chunk.ngrams.length
    ? chunk.ngrams
    : extractNgrams(seq, 2, 4);

  const chargrams = Array.isArray(chunk.chargrams) && chunk.chargrams.length
    ? chunk.chargrams
    : null;
  const charSet = new Set(chargrams || []);
  if (!chargrams) {
    seq.forEach((w) => {
      for (let n = 3; n <= 5; ++n) tri(w, n).forEach((g) => charSet.add(g));
    });
  }

  const freq = {};
  tokens.forEach((t) => {
    freq[t] = (freq[t] || 0) + 1;
  });
  const chunkId = state.chunks.length;

  state.docLengths[chunkId] = tokens.length;
  for (const [tok, count] of Object.entries(freq)) {
    let postings = state.tokenPostings.get(tok);
    if (!postings) {
      postings = [];
      state.tokenPostings.set(tok, postings);
    }
    postings.push([chunkId, count]);
  }

  for (const ng of ngrams) {
    if (!state.phrasePost.has(ng)) state.phrasePost.set(ng, new Set());
    state.phrasePost.get(ng).add(chunkId);
  }
  for (const tg of charSet) {
    if (!state.triPost.has(tg)) state.triPost.set(tg, new Set());
    state.triPost.get(tg).add(chunkId);
  }

  tokens.forEach((t) => state.df.set(t, (state.df.get(t) || 0) + 1));
  seq.forEach((w) => state.wordFreq.set(w, (state.wordFreq.get(w) || 0) + 1));

  chunk.id = chunkId;
  state.chunks.push(chunk);
}
