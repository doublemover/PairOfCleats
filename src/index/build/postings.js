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
export async function buildPostings(input) {
  const {
    chunks,
    df,
    tokenPostings,
    docLengths,
    fieldPostings,
    fieldDocLengths,
    phrasePost,
    triPost,
    postingsConfig,
    modelId,
    useStubEmbeddings,
    log,
    workerPool,
    embeddingsEnabled = true
  } = input;

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      k1: 1.2,
      b: 0.75,
      avgChunkLen: 0,
      totalDocs: 0,
      fieldPostings: null,
      phraseVocab: [],
      phrasePostings: [],
      chargramVocab: [],
      chargramPostings: [],
      tokenVocab: [],
      tokenPostingsList: [],
      avgDocLen: 0,
      minhashSigs: [],
      dims: embeddingsEnabled ? 384 : 0,
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

  let dims = 0;
  let quantizedVectors = [];
  let quantizedDocVectors = [];
  let quantizedCodeVectors = [];
  if (embeddingsEnabled) {
    const embedLabel = useStubEmbeddings ? 'stub' : 'model';
    log(`Using ${embedLabel} embeddings for dense vectors (${modelId})...`);
    dims = Array.isArray(chunks[0]?.embedding) ? chunks[0].embedding.length : 384;
    const zeroVec = new Array(dims).fill(0);
    const embeddingVectors = chunks.map((c) =>
      Array.isArray(c.embedding) ? c.embedding : zeroVec
    );
    const quantizeVectors = async (vectors) => {
      if (!workerPool) {
        return vectors.map((vec) => quantizeVec(vec));
      }
      const batchSize = workerPool.config?.quantizeBatchSize || 128;
      const batches = [];
      for (let i = 0; i < vectors.length; i += batchSize) {
        batches.push(vectors.slice(i, i + batchSize));
      }
      const results = [];
      for (const batch of batches) {
        try {
          const chunk = await workerPool.runQuantize({ vectors: batch });
          results.push(...chunk);
        } catch {
          results.push(...batch.map((vec) => quantizeVec(vec)));
        }
      }
      return results;
    };
    quantizedVectors = await quantizeVectors(embeddingVectors);
    const embeddingDocVectors = chunks.map((c) =>
      Array.isArray(c.embed_doc) ? c.embed_doc : (Array.isArray(c.embedding) ? c.embedding : zeroVec)
    );
    const embeddingCodeVectors = chunks.map((c) =>
      Array.isArray(c.embed_code) ? c.embed_code : (Array.isArray(c.embedding) ? c.embedding : zeroVec)
    );
    quantizedDocVectors = await quantizeVectors(embeddingDocVectors);
    quantizedCodeVectors = await quantizeVectors(embeddingCodeVectors);
  } else {
    log('Embeddings disabled; skipping dense vector build.');
  }

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

  const buildFieldPostings = () => {
    if (!fieldPostings || !fieldDocLengths) return null;
    const fields = {};
    for (const [field, postingsMap] of Object.entries(fieldPostings)) {
      if (!postingsMap || typeof postingsMap.keys !== 'function') continue;
      const vocab = Array.from(postingsMap.keys());
      const postings = vocab.map((token) => postingsMap.get(token));
      const lengths = fieldDocLengths[field] || [];
      const avgLen = lengths.length
        ? lengths.reduce((sum, len) => sum + len, 0) / lengths.length
        : 0;
      fields[field] = {
        vocab,
        postings,
        docLengths: lengths,
        avgDocLen: avgLen,
        totalDocs: lengths.length
      };
    }
    return Object.keys(fields).length ? { fields } : null;
  };

  return {
    k1,
    b,
    avgChunkLen,
    totalDocs: N,
    fieldPostings: buildFieldPostings(),
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
