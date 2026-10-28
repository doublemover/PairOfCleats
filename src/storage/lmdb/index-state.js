import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import { readJsonFile } from '../../shared/artifact-io/json.js';
import { writeJsonObjectFile } from '../../shared/json-stream/json-writers.js';
import { withGeneratedArtifactMetadata } from '../../shared/generated-artifact-core.js';
import { updateIndexStateManifest } from '../../shared/index-state-utils.js';

/** Required LMDB state publication. Read/write/manifest failures remain the
 * actual command failure; in-memory ready state cannot substitute for disk. */
export const updateLmdbState = async (indexDir, patch) => {
  if (!indexDir) return null;
  const statePath = path.join(indexDir, 'index_state.json');
  let state = fs.existsSync(statePath) ? readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES }) : {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw Object.assign(
    new Error('LMDB state publication requires a valid existing index-state object.'), { code: 'ERR_INDEX_STATE_INVALID' });
  const now = new Date().toISOString();
  state.generatedAt = state.generatedAt || now;
  state.updatedAt = now;
  state.lmdb = { ...(state.lmdb || {}), ...patch, updatedAt: now };
  state = withGeneratedArtifactMetadata(state, 'index-state');
  await writeJsonObjectFile(statePath, { fields: state, atomic: true });
  await updateIndexStateManifest(indexDir);
  return state;
};
