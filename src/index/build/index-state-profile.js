import {
  INDEX_STATE_ARTIFACTS_SCHEMA_VERSION,
  normalizeIndexProfileId,
  resolveRequiredArtifactsForProfile
} from '../../contracts/index-profile.js';

/**
 * Resolve per-artifact presence flags for index_state.artifacts.
 * Vector-only profiles intentionally mark sparse artifacts as omitted while
 * preserving dense sidecar presence when embeddings are enabled.
 *
 * @param {object} input
 * @returns {Record<string, boolean>}
 */
const buildIndexStateArtifactsPresent = ({
  profileId,
  mode,
  embeddingsEnabled,
  postingsConfig
}) => {
  const sparseEnabled = profileId !== 'vector_only';
  const present = {
    chunk_meta: true,
    token_postings: sparseEnabled,
    phrase_ngrams: sparseEnabled && postingsConfig?.enablePhraseNgrams === true,
    chargram_postings: sparseEnabled && postingsConfig?.enableChargrams === true,
    dense_vectors: embeddingsEnabled,
    // Dense sidecar artifacts are emitted alongside merged dense vectors whenever
    // dense vectors are written, regardless of mode.
    dense_vectors_doc: embeddingsEnabled,
    dense_vectors_code: embeddingsEnabled,
    index_state: true,
    filelists: true
  };
  return Object.fromEntries(Object.entries(present).sort(([left], [right]) => left.localeCompare(right)));
};

export const buildIndexStateArtifactsBlock = ({
  profileId,
  mode,
  embeddingsEnabled,
  postingsConfig
}) => {
  const resolvedProfileId = normalizeIndexProfileId(profileId);
  const present = buildIndexStateArtifactsPresent({
    profileId: resolvedProfileId,
    mode,
    embeddingsEnabled,
    postingsConfig
  });
  const omitted = Object.entries(present)
    .filter(([, isPresent]) => isPresent !== true)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
  const requiredForSearch = resolveRequiredArtifactsForProfile(resolvedProfileId);
  return {
    schemaVersion: INDEX_STATE_ARTIFACTS_SCHEMA_VERSION,
    present,
    omitted,
    requiredForSearch
  };
};
