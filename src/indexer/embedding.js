import { pipeline, env } from '@xenova/transformers';
import { stubEmbedding } from '../shared/embedding.js';

/**
 * Quantize a float vector into uint8 bins for compact storage.
 * @param {number[]} vec
 * @param {number} [minVal]
 * @param {number} [maxVal]
 * @param {number} [levels]
 * @returns {number[]}
 */
export function quantizeVec(vec, minVal = -1, maxVal = 1, levels = 256) {
  return vec.map((f) =>
    Math.max(0, Math.min(levels - 1, Math.round(((f - minVal) / (maxVal - minVal)) * (levels - 1))))
  );
}

/**
 * L2-normalize an embedding vector.
 * @param {number[]} vec
 * @returns {number[]}
 */
export function normalizeVec(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return vec || [];
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (!Number.isFinite(norm) || norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Build an embedder wrapper for chunk embeddings.
 * @param {object} options
 * @param {boolean} options.useStubEmbeddings
 * @param {string} options.modelId
 * @param {number} options.dims
 * @param {string} options.modelsDir
 * @returns {{getChunkEmbedding:(text:string)=>Promise<number[]>,embedderPromise:Promise<any>|null}}
 */
export function createEmbedder({ useStubEmbeddings, modelId, dims, modelsDir }) {
  if (modelsDir) {
    env.cacheDir = modelsDir;
  }
  const embedderPromise = useStubEmbeddings ? null : pipeline('feature-extraction', modelId);

  async function getChunkEmbedding(text) {
    if (useStubEmbeddings) {
      const safeDims = Math.max(1, Number(dims) || 384);
      return stubEmbedding(text, safeDims);
    }
    const embedder = await embedderPromise;
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  return { getChunkEmbedding, embedderPromise };
}
