import { getQueryEmbedding } from '../../embedding.js';
import { incCacheEvent } from '../../../shared/metrics.js';
import { resolveStubDims } from '../../../shared/embedding.js';
import { buildLocalCacheKey } from '../../../shared/cache-key.js';

export function createEmbeddingResolver({
  throwIfAborted,
  embeddingQueryText,
  modelConfig,
  useStubEmbeddings,
  embeddingProvider,
  embeddingOnnx,
  rootDir
}) {
  const embeddingCache = new Map();

  return async (modelId, dims, normalize, inputFormatting) => {
    throwIfAborted();
    if (!modelId) return null;
    const normalizeFlag = normalize !== false;
    const formatting = inputFormatting && typeof inputFormatting === 'object'
      ? inputFormatting
      : null;
    const resolvedDims = useStubEmbeddings
      ? resolveStubDims(dims)
      : (Number.isFinite(Number(dims)) ? Math.floor(Number(dims)) : null);
    const cacheKeyLocal = buildLocalCacheKey({
      namespace: 'embedding-query',
      payload: {
        modelId,
        dims: useStubEmbeddings ? resolvedDims : null,
        normalize: normalizeFlag,
        inputFormatting: formatting,
        stub: useStubEmbeddings
      }
    }).key;
    const cached = embeddingCache.get(cacheKeyLocal);
    if (cached) {
      incCacheEvent({ cache: 'embedding', result: 'hit' });
      return cached;
    }

    incCacheEvent({ cache: 'embedding', result: 'miss' });
    const pending = getQueryEmbedding({
      text: embeddingQueryText,
      modelId,
      dims: resolvedDims,
      modelDir: modelConfig.dir,
      useStub: useStubEmbeddings,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      rootDir,
      normalize: normalizeFlag,
      inputFormatting: formatting
    }).catch((error) => {
      embeddingCache.delete(cacheKeyLocal);
      throw error;
    });
    embeddingCache.set(cacheKeyLocal, pending);
    return pending;
  };
}
