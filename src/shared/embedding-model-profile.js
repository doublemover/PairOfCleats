const EMBEDDING_GEMMA2_PATTERN = /(^|\/)embeddinggemma-2(?:-onnx)?$/i;
const DIMENSIONS = new Set([128, 256, 512, 768]);
const DTYPES = new Set(['fp32', 'q8', 'q4']);
// Immutable ONNX export, verified against its upstream model metadata on 2026-10-07.
export const EMBEDDING_GEMMA2_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';

export const isEmbeddingGemma2 = (modelId) => (
  EMBEDDING_GEMMA2_PATTERN.test(String(modelId || '').trim())
);

/** Resolve the opt-in text model contract, shared by inference and cache identity. */
export const resolveEmbeddingModelProfile = (modelId, options = null) => {
  if (!isEmbeddingGemma2(modelId)) {
    if (options && Object.keys(options).length) {
      throw new Error('embeddinggemma2 options require an EmbeddingGemma 2 model.');
    }
    return null;
  }
  const dtype = options?.dtype ?? 'fp32';
  const dimensions = options?.dimensions ?? 768;
  if (!DTYPES.has(dtype)) {
    throw new Error('EmbeddingGemma 2 dtype must be fp32, q8, or q4.');
  }
  if (!DIMENSIONS.has(dimensions)) {
    throw new Error('EmbeddingGemma 2 dimensions must be 128, 256, 512, or 768.');
  }
  const revision = options?.revision ?? EMBEDDING_GEMMA2_REVISION;
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/i.test(revision)) {
    throw new Error('EmbeddingGemma 2 revision must be an immutable 40-character commit SHA.');
  }
  return {
    family: 'embeddinggemma2',
    runtime: 'transformers.js@4.3.1',
    dtype,
    dimensions,
    revision: revision.toLowerCase(),
    maxLength: 8192,
    output: 'sentence_embedding',
    textOnly: true
  };
};

/** Validate before loading any model; never silently fall back to a different space. */
export const validateEmbeddingModelProfile = (profile, { provider, normalize } = {}) => {
  if (!profile) return;
  if (provider !== 'xenova') {
    throw new Error('EmbeddingGemma 2 requires the xenova (Transformers.js) provider.');
  }
  if (normalize === false) {
    throw new Error('EmbeddingGemma 2 requires normalization after dimension truncation.');
  }
};

/** Consume projected sentence embeddings, never unprojected token hidden states. */
export const normalizeEmbeddingGemma2Output = (output, count, dimensions) => {
  const tensor = output?.sentence_embedding;
  const shape = tensor?.dims;
  const data = tensor?.data;
  if (!Array.isArray(shape) || shape.length !== 2 || shape[0] !== count
    || shape[1] !== 768 || !data || data.length !== count * 768) {
    throw new Error('EmbeddingGemma 2 returned an invalid sentence_embedding shape.');
  }
  const vectors = [];
  for (let row = 0; row < count; row += 1) {
    const vector = new Float32Array(dimensions);
    let norm = 0;
    for (let column = 0; column < 768; column += 1) {
      const value = data[row * 768 + column];
      if (!Number.isFinite(value)) throw new Error('EmbeddingGemma 2 returned a nonfinite embedding.');
      if (column < dimensions) {
        vector[column] = value;
        norm += value * value;
      }
    }
    if (!(norm > 0) || !Number.isFinite(norm)) {
      throw new Error('EmbeddingGemma 2 returned a zero or invalid embedding norm.');
    }
    norm = Math.sqrt(norm);
    for (let column = 0; column < dimensions; column += 1) vector[column] /= norm;
    vectors.push(vector);
  }
  return vectors;
};
