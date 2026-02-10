export const isEmbeddingReady = (embedding) => (
  (Array.isArray(embedding) || (ArrayBuffer.isView(embedding) && !(embedding instanceof DataView)))
  && embedding.length > 0
);

export const isCandidateSetEmpty = (candidateSet) => (
  Boolean(candidateSet && (() => {
    if (Number.isFinite(Number(candidateSet.size))) return Number(candidateSet.size) === 0;
    if (typeof candidateSet.size === 'function') {
      const resolved = Number(candidateSet.size());
      return Number.isFinite(resolved) && resolved === 0;
    }
    if (typeof candidateSet.getSize === 'function') {
      const resolved = Number(candidateSet.getSize());
      return Number.isFinite(resolved) && resolved === 0;
    }
    if (Array.isArray(candidateSet)) return candidateSet.length === 0;
    return false;
  })())
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
