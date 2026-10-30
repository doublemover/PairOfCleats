export const RETRIEVAL_WORK_VERSION = 1;

/** Invocation-owned diagnostic counters. API calls count the query-embedding
 * entry point, not model kernels; cache hits include reuse of pending promises.
 * Model observations are bounded by the four canonical retrieval modes. */
export const createRetrievalWorkObservation = () => ({ schemaVersion: RETRIEVAL_WORK_VERSION,
  scope: 'whole-search-invocation', embeddingRequests: 0, embeddingApiCalls: 0,
  embeddingCacheHits: 0, models: Object.create(null) });

export const isRetrievalModelObservation = value => value?.status === 'observed'
  && typeof value.modelId === 'string' && value.modelId.length > 0
  && typeof value.provider === 'string' && value.provider.length > 0
  && Number.isSafeInteger(value.dimensions) && value.dimensions > 0 && typeof value.stub === 'boolean'
  && /^eif1-[a-f0-9]{64}$/.test(value.inputFormatIdentity || '')
  && (value.stub ? value.artifactStatus === 'stub' && value.provider === 'stub' && /^stub:embeddings-v[1-9][0-9]*$/.test(value.artifactIdentity || '')
    : value.artifactStatus === 'verified' && /^sha256:[a-f0-9]{64}$/.test(value.artifactIdentity || '')
      || value.artifactStatus === 'immutable-revision' && /^revision:[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.artifactIdentity || ''));
