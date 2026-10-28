import fsSync from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { readJsonFile } from '../../../src/shared/artifact-io/json.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { updateIndexStateManifest } from '../../../src/shared/index-state-utils.js';
import { withGeneratedArtifactMetadata } from '../../../src/shared/generated-artifact-core.js';

/**
 * Load the existing state before mutation; only actual absence starts empty.
 * @param {string} statePath
 * @returns {object}
 */
export const loadIndexState = (statePath) => {
  if (!fsSync.existsSync(statePath)) return {};
  const state = readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES });
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw Object.assign(
    new Error('Embedding state publication requires a valid existing index-state object.'), { code: 'ERR_INDEX_STATE_INVALID' });
  return state;
};

/**
 * Persist `index_state.json` atomically and refresh its side manifest.
 * @param {string} statePath
 * @param {object} state
 * @returns {Promise<void>}
 */
export const writeIndexState = async (statePath, state) => {
  await writeJsonObjectFile(statePath, {
    fields: withGeneratedArtifactMetadata(state, 'index-state'),
    atomic: true
  });
  const indexDir = statePath ? path.dirname(statePath) : null;
  if (!indexDir) return;
  await updateIndexStateManifest(indexDir);
};
