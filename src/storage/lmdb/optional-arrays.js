import { loadJsonArrayArtifact } from '../../shared/artifact-io/loaders/core.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';

/** Only absence is optional; a declared artifact must load before LMDB opens. */
export const loadLmdbOptionalArray = async (indexDir, name, manifest) => {
  if (!manifest?.pieces?.some(piece => piece?.name === name)) return null;
  return loadJsonArrayArtifact(indexDir, name, { manifest, strict: true, maxBytes: MAX_JSON_BYTES });
};
