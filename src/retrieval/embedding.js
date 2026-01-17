import fs from 'node:fs';
import { resolveStubDims, stubEmbedding } from '../shared/embedding.js';
import { createOnnxEmbedder, normalizeEmbeddingProvider } from '../shared/onnx-embeddings.js';

const embedderCache = new Map();

async function getEmbedder({ provider, modelId, modelDir, rootDir, onnxConfig }) {
  const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
  const cacheKey = JSON.stringify({
    provider: resolvedProvider,
    modelId,
    modelDir,
    onnxConfig: onnxConfig || null,
    rootDir
  });
  if (embedderCache.has(cacheKey)) return embedderCache.get(cacheKey);
  if (resolvedProvider === 'onnx') {
    const embedder = createOnnxEmbedder({
      rootDir,
      modelId,
      modelsDir: modelDir,
      onnxConfig
    });
    embedderCache.set(cacheKey, embedder);
    return embedder;
  }
  const { pipeline, env } = await import('@xenova/transformers');
  if (modelDir) {
    try {
      fs.mkdirSync(modelDir, { recursive: true });
    } catch {}
    env.cacheDir = modelDir;
  }
  const embedder = await pipeline('feature-extraction', modelId);
  embedderCache.set(cacheKey, embedder);
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
export async function getQueryEmbedding({
  text,
  modelId,
  dims,
  modelDir,
  useStub,
  provider,
  onnxConfig,
  rootDir
}) {
  if (useStub) {
    return stubEmbedding(text, resolveStubDims(dims));
  }
  try {
    const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
    const embedder = await getEmbedder({
      provider: resolvedProvider,
      modelId,
      modelDir,
      rootDir,
      onnxConfig
    });
    if (resolvedProvider === 'onnx') {
      return await embedder.getEmbedding(text);
    }
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
  } catch {
    return null;
  }
}
