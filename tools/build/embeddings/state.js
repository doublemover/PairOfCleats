import fsSync from 'node:fs';
import { readJsonFile, MAX_JSON_BYTES } from '../../../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';

export const loadIndexState = (statePath) => {
  if (!fsSync.existsSync(statePath)) return {};
  try {
    return readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES }) || {};
  } catch {
    return {};
  }
};

export const writeIndexState = async (statePath, state) => {
  await writeJsonObjectFile(statePath, { fields: state, atomic: true });
};
