import { getEmbeddingAdapter } from '../shared/embedding-adapter.js';
import {
  formatEmbeddingInput,
  resolveEmbeddingInputFormatting
} from '../shared/embedding-input-format.js';
import { getEnvConfig } from '../shared/env/runtime.js';
import { createWarnOnce } from '../shared/logging/warn-once.js';
import { resolveEmbeddingModelProfile } from '../shared/embedding-model-profile.js';

const warnOnce = createWarnOnce();

const resolveEnvEmbeddingMode = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'stub') return 'stub';
  if (['off', 'false', '0', 'disabled', 'none'].includes(normalized)) return 'off';
  return null;
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
 * @param {{family?:string,queryPrefix?:string|null,passagePrefix?:string|null}|null} [options.inputFormatting]
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
  rootDir,
  normalize,
  inputFormatting = null,
  modelProfile = null
}) {
  try {
    const envMode = resolveEnvEmbeddingMode(getEnvConfig().embeddings);
    if (envMode === 'off') return null;
    const resolvedUseStub = useStub === true || envMode === 'stub';
    const profile = resolveEmbeddingModelProfile(modelId, modelProfile);
    if (profile && dims != null && Number(dims) !== profile.dimensions) {
      throw new Error('EmbeddingGemma 2 query dimensions do not match the persisted model profile. Rebuild the index.');
    }
    const adapter = getEmbeddingAdapter({
      rootDir,
      useStub: resolvedUseStub,
      modelId,
      dims,
      modelsDir: modelDir,
      provider,
      onnxConfig,
      normalize,
      modelProfile: profile
    });
    const resolvedInputFormatting = inputFormatting && typeof inputFormatting === 'object'
      ? inputFormatting
      : resolveEmbeddingInputFormatting(modelId);
    const formattedText = formatEmbeddingInput(text, {
      modelId,
      kind: 'query',
      formatting: resolvedInputFormatting
    });
    const embedding = await adapter.embedOne(formattedText);
    if (!embedding || !embedding.length) return null;
    return embedding;
  } catch (err) {
    warnOnce(`[embeddings] Query embedder unavailable; skipping ANN. ${err?.message || err}`);
    return null;
  }
}
