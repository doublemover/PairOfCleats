import { loadJsonArrayArtifact, loadJsonObjectArtifact } from '../../shared/artifact-io/loaders/core.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';

/** Only absence is optional; a declared artifact must load before LMDB opens. */
export const hasLmdbArtifactFamily = (manifest, name) => manifest?.pieces?.some(piece =>
  piece?.name === name || piece?.name?.startsWith(`${name}_`)) === true;

export const loadLmdbOptionalArray = async (indexDir, name, manifest, { maxBytes = MAX_JSON_BYTES } = {}) => {
  if (!hasLmdbArtifactFamily(manifest, name)) return null;
  return loadJsonArrayArtifact(indexDir, name, { manifest, strict: true, maxBytes });
};

export const loadLmdbOptionalObject = async (indexDir, name, manifest, { maxBytes = MAX_JSON_BYTES } = {}) => {
  if (!hasLmdbArtifactFamily(manifest, name)) return null;
  return loadJsonObjectArtifact(indexDir, name, { manifest, strict: true, maxBytes });
};
