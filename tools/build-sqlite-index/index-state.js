import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { readJson } from '../../src/storage/sqlite/utils.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { updateIndexStateManifest } from '../index-state-utils.js';

export const updateSqliteState = async (indexDir, patch) => {
  if (!indexDir) return;
  const statePath = path.join(indexDir, 'index_state.json');
  let state = {};
  if (fsSync.existsSync(statePath)) {
    try {
      state = readJson(statePath) || {};
    } catch {
      state = {};
    }
  }
  const now = new Date().toISOString();
  state.generatedAt = state.generatedAt || now;
  state.updatedAt = now;
  state.sqlite = {
    ...(state.sqlite || {}),
    ...patch,
    updatedAt: now
  };
  try {
    await writeJsonObjectFile(statePath, { fields: state, atomic: true });
  } catch {
    // Ignore index state write failures.
  }
  await updateIndexStateManifest(indexDir);
};
