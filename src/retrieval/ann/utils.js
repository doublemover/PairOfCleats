export const isEmbeddingReady = (embedding) => (
  (Array.isArray(embedding) || (ArrayBuffer.isView(embedding) && !(embedding instanceof DataView)))
  && embedding.length > 0
);

export const isCandidateSetEmpty = (candidateSet) => (
  Boolean(candidateSet && typeof candidateSet.size === 'number' && candidateSet.size === 0)
);

export const isAnnProviderAvailable = ({
  embedding,
  backendReady = true,
  enabled = true
} = {}) => (
  enabled !== false
  && backendReady
  && isEmbeddingReady(embedding)
);

export const canRunAnnQuery = ({
  signal = null,
  embedding,
  candidateSet = null,
  backendReady = true,
  enabled = true
} = {}) => (
  !signal?.aborted
  && isAnnProviderAvailable({ embedding, backendReady, enabled })
  && !isCandidateSetEmpty(candidateSet)
);
