import { EMBEDDING_IDENTITY_VERSION } from '../../../shared/embedding-identity.js';
import { assertEmbeddingArtifactCompatibility, embeddingArtifactReusable } from '../../../shared/embedding-artifact-identity.js';
import { createHash } from 'node:crypto';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { isRetrievalModelObservation } from '../../../contracts/retrieval-work.js';
import { resolveEmbeddingArtifactIdentityAsync } from '../../../shared/embedding-artifact-lease.js';
import { getQueryEmbedding } from '../../embedding.js';
import { incCacheEvent } from '../../../shared/metrics/core.js';
import { resolveStubDims } from '../../../shared/embedding.js';
import { buildLocalCacheKey } from '../../../shared/cache-key.js';
import { admitEmbeddingVector, invalidEmbeddingOutput } from '../../../shared/embedding-output-admission.js';
import { resolveEmbeddingModelProfile, resolveQueryEmbeddingContract } from '../../../shared/embedding-model-profile.js';
import { createWarnOnce } from '../../../shared/logging/warn-once.js';

const EMBEDDING_QUERY_CACHE_MAX_ENTRIES = 64;
const processCaches = new WeakMap();
const warnOnce = createWarnOnce();

export function createEmbeddingResolver({
  throwIfAborted,
  embeddingQueryText,
  modelConfig,
  useStubEmbeddings,
  embeddingProvider,
  embeddingOnnx,
  rootDir,
  generation = null,
  getQueryEmbeddingImpl = getQueryEmbedding,
  maxCacheEntries = EMBEDDING_QUERY_CACHE_MAX_ENTRIES,
  work = null
}) {
  let embeddingCache = processCaches.get(getQueryEmbeddingImpl);
  if (!embeddingCache) { embeddingCache = new Map(); processCaches.set(getQueryEmbeddingImpl, embeddingCache); }
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

  return async (modelId, dims, normalize, inputFormatting, modelProfile = null, expectedIdentity = null, observationMode = null) => {
    throwIfAborted();
    if (work) work.embeddingRequests++;
    if (!modelId) return null;
    const normalizeFlag = normalize !== false;
    const formatting = inputFormatting && typeof inputFormatting === 'object'
      ? inputFormatting
      : null;
    const parsedDims = Number(dims);
    const resolvedDims = useStubEmbeddings
      ? resolveStubDims(dims)
      : (Number.isFinite(parsedDims) && parsedDims > 0 ? Math.floor(parsedDims) : null);
    const selectedProfile = resolveEmbeddingModelProfile(modelId, modelProfile);
    const modelArtifact = await resolveEmbeddingArtifactIdentityAsync({ provider: embeddingProvider,
      modelId, modelsDir: modelConfig?.dir, rootDir, onnx: embeddingOnnx,
      modelProfile: selectedProfile, stub: useStubEmbeddings });
    if (expectedIdentity) {
      if (expectedIdentity.version !== EMBEDDING_IDENTITY_VERSION) {
        throw Object.assign(new Error('Unsupported embedding identity. Rebuild the dense index.'), { code: 'ERR_EMBEDDING_IDENTITY_UNSUPPORTED' });
      }
      assertEmbeddingArtifactCompatibility(expectedIdentity.modelArtifact, modelArtifact);
      if (expectedIdentity.dims != null && resolvedDims !== null && expectedIdentity.dims !== resolvedDims) {
        throw invalidEmbeddingOutput('requested query width disagrees with the persisted embedding identity.', {
          expectedDimensions: expectedIdentity.dims, observedDimensions: resolvedDims
        });
      }
    }
    const contract = resolveQueryEmbeddingContract({ modelId, modelProfile: selectedProfile,
      dims: expectedIdentity?.dims ?? resolvedDims, useStub: useStubEmbeddings });
    const cacheKeyLocal = buildLocalCacheKey({
      namespace: 'embedding-query',
      payload: {
        text: String(embeddingQueryText || '').normalize('NFC'),
        rootDir,
        modelDir: modelConfig?.dir,
        provider: embeddingProvider,
        onnxConfig: embeddingOnnx,
        generation,
        modelId,
        dims: resolvedDims,
        outputContract: contract,
        normalize: normalizeFlag,
        inputFormatting: formatting,
        modelProfile: selectedProfile,
        modelArtifact,
        stub: useStubEmbeddings
      }
    }).key;
    const cached = embeddingCache.get(cacheKeyLocal);
    const observe = work ? value => {
      if (work && ['code', 'prose', 'extracted-prose', 'records'].includes(observationMode)) {
        const dimensions = Array.isArray(value) || ArrayBuffer.isView(value) ? value.length : null;
        const artifactIdentity = modelArtifact?.status === 'stub' ? `stub:embeddings-v${EMBEDDING_IDENTITY_VERSION}`
          : modelArtifact?.status === 'verified' ? `sha256:${modelArtifact.digest}`
            : modelArtifact?.status === 'immutable-revision' ? `revision:${modelArtifact.revision}` : null;
        work.models[observationMode] = {
          status: embeddingArtifactReusable(modelArtifact) && Number.isSafeInteger(dimensions) && dimensions > 0 ? 'observed' : 'unqualified',
          modelId, provider: useStubEmbeddings ? 'stub' : embeddingProvider,
          dimensions: Number.isSafeInteger(dimensions) && dimensions > 0 ? dimensions : null,
          stub: useStubEmbeddings === true, artifactIdentity,
          artifactStatus: modelArtifact?.status || null,
          inputFormatIdentity: 'eif1-' + createHash('sha256').update(stableStringifyForSignature({
            version: EMBEDDING_IDENTITY_VERSION, formatting, normalize: normalizeFlag, modelProfile: selectedProfile
          })).digest('hex')
        };
        if (!isRetrievalModelObservation(work.models[observationMode])) work.models[observationMode].status = 'unqualified';
      }
      return value;
    } : null;
    const admit = value => {
      if (value == null) return null;
      try { return admitEmbeddingVector(value, { ...contract, provider: embeddingProvider }); }
      catch (error) {
        if (error.code !== 'ERR_EMBEDDING_OUTPUT') throw error;
        warnOnce('[embeddings] Query vector rejected; skipping ANN (ERR_EMBEDDING_OUTPUT).');
        return null;
      }
    };
    const admitCached = value => {
      const accepted = admit(value);
      if (accepted === null && embeddingCache.get(cacheKeyLocal) === cached) embeddingCache.delete(cacheKeyLocal);
      return accepted;
    };
    if (cached) {
      // Touch for LRU ordering.
      setCacheEntry(cacheKeyLocal, cached);
      incCacheEvent({ cache: 'embedding', result: 'hit' });
      if (work) work.embeddingCacheHits++;
      const accepted = cached.then(admitCached);
      return work ? accepted.then(observe) : accepted;
    }

    incCacheEvent({ cache: 'embedding', result: 'miss' });
    if (work) work.embeddingApiCalls++;
    const pending = getQueryEmbeddingImpl({
      text: String(embeddingQueryText || '').normalize('NFC'),
      modelId,
      dims: resolvedDims,
      modelDir: modelConfig.dir,
      useStub: useStubEmbeddings,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      rootDir,
      normalize: normalizeFlag,
      inputFormatting: formatting,
      modelProfile: selectedProfile,
      modelArtifact
    }).then(admit).then(value => {
      if (!value && embeddingCache.get(cacheKeyLocal) === pending) embeddingCache.delete(cacheKeyLocal);
      return value;
    }).catch((error) => {
      if (embeddingCache.get(cacheKeyLocal) === pending) embeddingCache.delete(cacheKeyLocal);
      throw error;
    });
    setCacheEntry(cacheKeyLocal, pending);
    return work ? pending.then(observe) : pending;
  };
}
