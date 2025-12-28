import fs from 'node:fs';
import { stubEmbedding } from '../shared/embedding.js';

const embedderCache = new Map();

async function getEmbedder(modelId, modelDir) {
  if (embedderCache.has(modelId)) return embedderCache.get(modelId);
  const { pipeline, env } = await import('@xenova/transformers');
  if (modelDir) {
    try {
      fs.mkdirSync(modelDir, { recursive: true });
    } catch {}
    env.cacheDir = modelDir;
  }
  const embedder = await pipeline('feature-extraction', modelId);
  embedderCache.set(modelId, embedder);
  return embedder;
}

/**
 * Compute a query embedding using the configured model.
 * Returns null when embeddings are unavailable.
 * @param {object} options
 * @param {string} options.text
 * @param {string} options.modelId
 * @param {number} options.dims
 * @param {string} options.modelDir
 * @param {boolean} options.useStub
 * @returns {Promise<number[]|null>}
 */
export async function getQueryEmbedding({ text, modelId, dims, modelDir, useStub }) {
  if (useStub) {
    return stubEmbedding(text, dims);
  }
  try {
    const embedder = await getEmbedder(modelId, modelDir);
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch {
    return null;
  }
}
