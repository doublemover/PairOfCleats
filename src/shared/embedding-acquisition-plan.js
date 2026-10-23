/** Shared exact loader selection; component paths come from the upstream registry. */
export const resolveEmbeddingAcquisitionPlan = (modelId, profile = null) => ({
  version: 1, modelId, runtime: profile?.runtime ?? null,
  revision: profile?.revision ?? null, dtype: profile?.dtype ?? 'q8',
  textOnly: profile?.textOnly === true
});
