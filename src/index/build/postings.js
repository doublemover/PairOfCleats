import { quantizeVec } from '../embedding.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';

const resolveTokenCount = (chunk) => (
  Number.isFinite(chunk?.tokenCount)
    ? chunk.tokenCount
    : (Array.isArray(chunk?.tokens) ? chunk.tokens.length : 0)
);

const tuneBM25Params = (chunks) => {
  const avgLen = chunks.reduce((s, c) => s + resolveTokenCount(c), 0) / chunks.length;
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
    quantizePool,
    embeddingsEnabled = true
  } = input;

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const fieldedEnabled = resolvedConfig.fielded !== false;
  const buildEmptyFieldPostings = () => {
    if (!fieldedEnabled) return null;
    const fields = {};
    const fieldNames = new Set();
    if (fieldPostings && typeof fieldPostings === 'object') {
      Object.keys(fieldPostings).forEach((field) => fieldNames.add(field));
    }
    if (fieldDocLengths && typeof fieldDocLengths === 'object') {
      Object.keys(fieldDocLengths).forEach((field) => fieldNames.add(field));
    }
    if (!fieldNames.size) {
      ['name', 'signature', 'doc', 'comment', 'body'].forEach((field) => fieldNames.add(field));
    }
    for (const field of fieldNames) {
      const lengths = Array.isArray(fieldDocLengths?.[field])
        ? fieldDocLengths[field]
        : [];
      fields[field] = {
        vocab: [],
        postings: [],
        docLengths: lengths,
        avgDocLen: 0,
        totalDocs: lengths.length
      };
    }
    return { fields };
  };

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      k1: 1.2,
      b: 0.75,
      avgChunkLen: 0,
      totalDocs: 0,
      fieldPostings: buildEmptyFieldPostings(),
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

  const phraseEnabled = resolvedConfig.enablePhraseNgrams !== false;
  const chargramEnabled = resolvedConfig.enableChargrams !== false;

  const { k1, b } = tuneBM25Params(chunks);
  const N = chunks.length;
  const avgChunkLen = chunks.reduce((sum, c) => sum + resolveTokenCount(c), 0) / Math.max(N, 1);

  let dims = 0;
  let quantizedVectors = [];
  let quantizedDocVectors = [];
  let quantizedCodeVectors = [];
  if (embeddingsEnabled) {
    const embedLabel = useStubEmbeddings ? 'stub' : 'model';
    log(`Using ${embedLabel} embeddings for dense vectors (${modelId})...`);
    const resolveDims = () => {
      for (const chunk of chunks) {
        const vec = chunk?.embedding;
        if (Array.isArray(vec) && vec.length) return vec.length;
        const code = chunk?.embed_code;
        if (Array.isArray(code) && code.length) return code.length;
        const doc = chunk?.embed_doc;
        if (Array.isArray(doc) && doc.length) return doc.length;
      }
      return 384;
    };
    dims = resolveDims();
    const zeroVec = new Array(dims).fill(0);
    const selectEmbedding = (chunk) => (
      Array.isArray(chunk?.embedding) && chunk.embedding.length ? chunk.embedding : zeroVec
    );
    const selectDocEmbedding = (chunk) => {
      // `embed_doc: []` is used as an explicit marker for "no doc embedding" to
      // avoid allocating a full dims-length zero vector per chunk.
      if (Array.isArray(chunk?.embed_doc)) {
        return chunk.embed_doc.length ? chunk.embed_doc : zeroVec;
      }
      if (Array.isArray(chunk?.embedding) && chunk.embedding.length) return chunk.embedding;
      return zeroVec;
    };
    const selectCodeEmbedding = (chunk) => {
      if (Array.isArray(chunk?.embed_code) && chunk.embed_code.length) return chunk.embed_code;
      if (Array.isArray(chunk?.embedding) && chunk.embedding.length) return chunk.embedding;
      return zeroVec;
    };
    const quantizeWorker = quantizePool || workerPool;
    let quantizeWarned = false;
    const warnQuantizeFallback = () => {
      if (quantizeWarned) return;
      if (typeof log === 'function') {
        log('Quantize worker unavailable; falling back to inline quantization.');
      }
      quantizeWarned = true;
    };
    const quantizeVectors = async (selector) => {
      const out = new Array(chunks.length);
      if (!quantizeWorker) {
        for (let i = 0; i < chunks.length; i += 1) {
          out[i] = quantizeVec(selector(chunks[i]));
        }
        return out;
      }
      const batchSize = quantizeWorker.config?.quantizeBatchSize || 128;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const end = Math.min(i + batchSize, chunks.length);
        const batch = [];
        for (let j = i; j < end; j += 1) {
          batch.push(selector(chunks[j]));
        }
        try {
          const chunk = await quantizeWorker.runQuantize({ vectors: batch });
          if (Array.isArray(chunk) && chunk.length === batch.length) {
            for (let j = 0; j < chunk.length; j += 1) {
              out[i + j] = chunk[j];
            }
          } else {
            warnQuantizeFallback();
            for (let j = 0; j < batch.length; j += 1) {
              out[i + j] = quantizeVec(batch[j]);
            }
          }
        } catch {
          warnQuantizeFallback();
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
