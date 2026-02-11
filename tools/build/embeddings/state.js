import fsSync from 'node:fs';
import path from 'node:path';
import { readJsonFile, MAX_JSON_BYTES } from '../../../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { updateIndexStateManifest } from '../../shared/index-state-utils.js';

/**
 * Load `index_state.json` defensively for embeddings updates.
 * @param {string} statePath
 * @returns {object}
 */
export const loadIndexState = (statePath) => {
  if (!fsSync.existsSync(statePath)) return {};
  try {
    return readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES }) || {};
  } catch {
    return {};
  }
};

/**
 * Persist `index_state.json` atomically and refresh its side manifest.
 * @param {string} statePath
 * @param {object} state
 * @returns {Promise<void>}
 */
export const writeIndexState = async (statePath, state) => {
  await writeJsonObjectFile(statePath, { fields: state, atomic: true });
  const indexDir = statePath ? path.dirname(statePath) : null;
  if (!indexDir) return;
  await updateIndexStateManifest(indexDir);
};
