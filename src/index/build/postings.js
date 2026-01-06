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
    const selectEmbedding = (chunk) => (
      Array.isArray(chunk?.embedding) && chunk.embedding.length ? chunk.embedding : zeroVec
    );
    const selectDocEmbedding = (chunk) => {
      if (Array.isArray(chunk?.embed_doc) && chunk.embed_doc.length) return chunk.embed_doc;
      if (Array.isArray(chunk?.embedding) && chunk.embedding.length) return chunk.embedding;
      return zeroVec;
    };
    const selectCodeEmbedding = (chunk) => {
      if (Array.isArray(chunk?.embed_code) && chunk.embed_code.length) return chunk.embed_code;
      if (Array.isArray(chunk?.embedding) && chunk.embedding.length) return chunk.embedding;
      return zeroVec;
    };
    const quantizeVectors = async (selector) => {
      const out = new Array(chunks.length);
      if (!workerPool) {
        for (let i = 0; i < chunks.length; i += 1) {
          out[i] = quantizeVec(selector(chunks[i]));
        }
        return out;
      }
      const batchSize = workerPool.config?.quantizeBatchSize || 128;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const end = Math.min(i + batchSize, chunks.length);
        const batch = [];
        for (let j = i; j < end; j += 1) {
          batch.push(selector(chunks[j]));
        }
        try {
          const chunk = await workerPool.runQuantize({ vectors: batch });
          for (let j = 0; j < chunk.length; j += 1) {
            out[i + j] = chunk[j];
          }
        } catch {
          for (let j = 0; j < batch.length; j += 1) {
            out[i + j] = quantizeVec(batch[j]);
          }
        }
      }
      return out;
    };
    quantizedVectors = await quantizeVectors(selectEmbedding);
    quantizedDocVectors = await quantizeVectors(selectDocEmbedding);
    quantizedCodeVectors = await quantizeVectors(selectCodeEmbedding);
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
