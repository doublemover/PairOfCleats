import { quantizeVec } from '../embedding.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

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

  const normalizeDocIdList = (value) => {
    if (value == null) return [];
    if (typeof value === 'number') return [value];
    if (Array.isArray(value)) return value;
    if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
    return [];
  };

  let dims = 0;
  let quantizedVectors = [];
  let quantizedDocVectors = [];
  let quantizedCodeVectors = [];
  if (embeddingsEnabled) {
    const embedLabel = useStubEmbeddings ? 'stub' : 'model';
    log(`Using ${embedLabel} embeddings for dense vectors (${modelId})...`);

    const isByteVector = (value) => (
      value
      && typeof value === 'object'
      && typeof value.length === 'number'
      && ArrayBuffer.isView(value)
      && !(value instanceof DataView)
      && value.BYTES_PER_ELEMENT === 1
      && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
    );

    const resolveDims = () => {
      // Prefer pre-quantized embeddings (Uint8Array) if present.
      for (const chunk of chunks) {
        const vec = chunk?.embedding_u8;
        if (isByteVector(vec) && vec.length) return vec.length;
      }
      // Fall back to float embeddings.
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

    // For missing vectors we intentionally use a "zero" float vector (all 0s),
    // which quantizes to ~128 in uint8 space when min=-1,max=1.
    const ZERO_QUANT = 128;
    const zeroU8 = new Uint8Array(dims);
    zeroU8.fill(ZERO_QUANT);

    const hasPreQuantized = chunks.some((chunk) => {
      const v = chunk?.embedding_u8;
      return isByteVector(v) && v.length;
    });

    if (hasPreQuantized) {
      // Streaming/early-quant path: chunks already carry uint8 vectors.
      // This avoids building large float arrays and avoids a second quantization pass.
      quantizedVectors = new Array(chunks.length);
      quantizedDocVectors = new Array(chunks.length);
      quantizedCodeVectors = new Array(chunks.length);

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];

        const merged = chunk?.embedding_u8;
        const mergedVec = isByteVector(merged) && merged.length ? merged : zeroU8;

        // Doc vectors: an empty marker means "no doc", which should behave like
        // a zero-vector so doc-only dense search doesn't surface code-only chunks.
        const doc = chunk?.embed_doc_u8;
        let docVec = null;
        if (isByteVector(doc)) {
          docVec = doc.length ? doc : zeroU8;
        } else {
          // If doc vector wasn't provided, fall back to merged.
          docVec = mergedVec;
        }

        // Code vectors: when missing, fall back to merged.
        const code = chunk?.embed_code_u8;
        let codeVec = null;
        if (isByteVector(code) && code.length) {
          codeVec = code;
        } else {
          codeVec = mergedVec;
        }

        quantizedVectors[i] = mergedVec;
        quantizedDocVectors[i] = docVec;
        quantizedCodeVectors[i] = codeVec;
      }
    } else {
      // Legacy path: quantize from float embeddings.
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
    }
  } else {
    log('Embeddings disabled; skipping dense vector build.');
  }

  // Convert phrase/chargram postings into dense arrays while aggressively
  // releasing the source Sets/Maps to keep peak RSS lower.
  let phraseVocab = [];
  let phrasePostings = [];
  if (phraseEnabled && phrasePost && typeof phrasePost.keys === 'function') {
    phraseVocab = Array.from(phrasePost.keys()).sort(sortStrings);
    phrasePostings = new Array(phraseVocab.length);
    for (let i = 0; i < phraseVocab.length; i += 1) {
      const key = phraseVocab[i];
      const posting = phrasePost.get(key);
      phrasePostings[i] = normalizeDocIdList(posting);
      phrasePost.delete(key);
    }
    if (typeof phrasePost.clear === 'function') phrasePost.clear();
  }

  let chargramVocab = [];
  let chargramPostings = [];
  if (chargramEnabled && triPost && typeof triPost.keys === 'function') {
    chargramVocab = Array.from(triPost.keys()).sort(sortStrings);
    chargramPostings = new Array(chargramVocab.length);
    for (let i = 0; i < chargramVocab.length; i += 1) {
      const key = chargramVocab[i];
      const posting = triPost.get(key);
      chargramPostings[i] = normalizeDocIdList(posting);
      triPost.delete(key);
    }
    if (typeof triPost.clear === 'function') triPost.clear();
  }

  const tokenVocab = Array.from(tokenPostings.keys()).sort(sortStrings);
  const tokenPostingsList = tokenVocab.map((t) => tokenPostings.get(t));
  const avgDocLen = docLengths.length
    ? docLengths.reduce((sum, len) => sum + len, 0) / docLengths.length
    : 0;

  const minhashSigs = chunks.map((c) => c.minhashSig);

  const buildFieldPostings = () => {
    if (!fieldPostings || !fieldDocLengths) return null;
    const fields = {};
    const fieldNames = Object.keys(fieldPostings).sort(sortStrings);
    for (const field of fieldNames) {
      const postingsMap = fieldPostings[field];
      if (!postingsMap || typeof postingsMap.keys !== 'function') continue;
      const vocab = Array.from(postingsMap.keys()).sort(sortStrings);
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
