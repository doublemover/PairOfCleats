import { getEmbeddingAdapter } from '../shared/embedding-adapter.js';

let warnedEmbedderFailure = false;

const warnOnce = (message) => {
  if (warnedEmbedderFailure) return;
  warnedEmbedderFailure = true;
  console.warn(message);
};

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
  try {
    const adapter = getEmbeddingAdapter({
      rootDir,
      useStub: useStub === true,
      modelId,
      dims,
      modelsDir: modelDir,
      provider,
      onnxConfig
    });
    const embedding = await adapter.embedOne(text);
    if (!embedding || !embedding.length) return null;
    return embedding;
  } catch (err) {
    warnOnce(`[embeddings] Query embedder unavailable; skipping ANN. ${err?.message || err}`);
    return null;
  }
}
