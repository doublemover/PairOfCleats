import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { readJson } from '../../../src/storage/sqlite/utils.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { updateIndexStateManifest } from '../../shared/index-state-utils.js';
import { getIndexDir } from '../../shared/dict-utils.js';

export const updateSqliteState = async (indexDirOrOptions, patch = null) => {
  let indexDir = indexDirOrOptions;
  let statePatch = patch;
  if (indexDirOrOptions && typeof indexDirOrOptions === 'object' && !Array.isArray(indexDirOrOptions)) {
    const {
      root,
      userConfig,
      indexRoot,
      mode,
      indexDir: explicitIndexDir,
      ...rest
    } = indexDirOrOptions;
    statePatch = patch || rest;
    if (!explicitIndexDir && root && mode) {
      const options = indexRoot ? { indexRoot } : {};
      indexDir = getIndexDir(root, mode, userConfig, options);
    } else {
      indexDir = explicitIndexDir || null;
    }
  }
  if (!indexDir || typeof indexDir !== 'string') return;
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
    ...(statePatch || {}),
    updatedAt: now
  };
  try {
    await writeJsonObjectFile(statePath, { fields: state, atomic: true });
  } catch {
    // Ignore index state write failures.
  }
  await updateIndexStateManifest(indexDir);
};
