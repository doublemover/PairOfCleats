import { getQueryEmbedding } from '../../embedding.js';
import { incCacheEvent } from '../../../shared/metrics.js';
import { resolveStubDims } from '../../../shared/embedding.js';
import { buildLocalCacheKey } from '../../../shared/cache-key.js';

const EMBEDDING_QUERY_CACHE_MAX_ENTRIES = 64;

export function createEmbeddingResolver({
  throwIfAborted,
  embeddingQueryText,
  modelConfig,
  useStubEmbeddings,
  embeddingProvider,
  embeddingOnnx,
  rootDir,
  getQueryEmbeddingImpl = getQueryEmbedding,
  maxCacheEntries = EMBEDDING_QUERY_CACHE_MAX_ENTRIES
}) {
  const embeddingCache = new Map();
  const parsedCacheEntries = Number(maxCacheEntries);
  const cacheEntryLimit = Number.isFinite(parsedCacheEntries)
    ? Math.max(1, Math.floor(parsedCacheEntries))
    : EMBEDDING_QUERY_CACHE_MAX_ENTRIES;

  /**
   * Insert one cache entry with bounded LRU semantics.
   *
   * @param {string} cacheKey
   * @param {Promise<ArrayLike<number>>} value
   * @returns {void}
   */
  const setCacheEntry = (cacheKey, value) => {
    if (embeddingCache.has(cacheKey)) {
      embeddingCache.delete(cacheKey);
    }
    embeddingCache.set(cacheKey, value);
    while (embeddingCache.size > cacheEntryLimit) {
      const oldestKey = embeddingCache.keys().next().value;
      if (oldestKey == null) break;
      embeddingCache.delete(oldestKey);
    }
  };

  return async (modelId, dims, normalize, inputFormatting) => {
    throwIfAborted();
    if (!modelId) return null;
    const normalizeFlag = normalize !== false;
    const formatting = inputFormatting && typeof inputFormatting === 'object'
      ? inputFormatting
      : null;
    const parsedDims = Number(dims);
    const resolvedDims = useStubEmbeddings
      ? resolveStubDims(dims)
      : (Number.isFinite(parsedDims) && parsedDims > 0 ? Math.floor(parsedDims) : null);
    const cacheKeyLocal = buildLocalCacheKey({
      namespace: 'embedding-query',
      payload: {
        modelId,
        dims: resolvedDims,
        normalize: normalizeFlag,
        inputFormatting: formatting,
        stub: useStubEmbeddings
      }
    }).key;
    const cached = embeddingCache.get(cacheKeyLocal);
    if (cached) {
      // Touch for LRU ordering.
      setCacheEntry(cacheKeyLocal, cached);
      incCacheEvent({ cache: 'embedding', result: 'hit' });
      return cached;
    }

    incCacheEvent({ cache: 'embedding', result: 'miss' });
    const pending = getQueryEmbeddingImpl({
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
    setCacheEntry(cacheKeyLocal, pending);
    return pending;
  };
}
