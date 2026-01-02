import { quantizeVec } from '../embedding.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';

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
    postingsConfig,
    modelId,
    useStubEmbeddings,
    log
  } = input;

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      k1: 1.2,
      b: 0.75,
      avgChunkLen: 0,
      totalDocs: 0,
      trimmedVocab: [],
      phraseVocab: [],
      phrasePostings: [],
      chargramVocab: [],
      chargramPostings: [],
      tokenVocab: [],
      tokenPostingsList: [],
      avgDocLen: 0,
      minhashSigs: [],
      dims: 384,
      quantizedVectors: [],
      quantizedDocVectors: [],
      quantizedCodeVectors: []
    };
  }

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const phraseEnabled = resolvedConfig.enablePhraseNgrams !== false;
  const chargramEnabled = resolvedConfig.enableChargrams !== false;

  const { k1, b } = tuneBM25Params(chunks);
  const N = chunks.length;
  const avgChunkLen = chunks.reduce((sum, c) => sum + c.tokens.length, 0) / Math.max(N, 1);

  const vocabAll = Array.from(df.keys());
  const trimmedVocab = vocabAll.slice();
  const posts = trimmedVocab.map((token) => {
    const posting = tokenPostings.get(token) || [];
    return posting.map(([docId]) => docId);
  });

  const embedLabel = useStubEmbeddings ? 'stub' : 'model';
  log(`Using ${embedLabel} embeddings for dense vectors (${modelId})...`);
  const dims = chunks[0]?.embedding.length || 384;
  const embeddingVectors = chunks.map((c) => c.embedding);
  const quantizedVectors = embeddingVectors.map((vec) => quantizeVec(vec));
  const embeddingDocVectors = chunks.map((c) => c.embed_doc);
  const embeddingCodeVectors = chunks.map((c) => c.embed_code);
  const quantizedDocVectors = embeddingDocVectors.map((vec) => quantizeVec(vec));
  const quantizedCodeVectors = embeddingCodeVectors.map((vec) => quantizeVec(vec));

  const phraseVocab = phraseEnabled ? Array.from(phrasePost.keys()) : [];
  const phrasePostings = phraseEnabled ? phraseVocab.map((k) => Array.from(phrasePost.get(k))) : [];
  const chargramVocab = chargramEnabled ? Array.from(triPost.keys()) : [];
  const chargramPostings = chargramEnabled ? chargramVocab.map((k) => Array.from(triPost.get(k))) : [];

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
    quantizedDocVectors,
    quantizedCodeVectors
  };
}
