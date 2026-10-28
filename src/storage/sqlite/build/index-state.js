import fsSync from 'node:fs';
import path from 'node:path';
import { readJson } from '../utils.js';
import { writeJsonObjectFile } from '../../../shared/json-stream/json-writers.js';
import { updateIndexStateManifest } from '../../../shared/index-state-utils.js';
import { getIndexDir } from '../../../shared/dict-utils.js';
import { withGeneratedArtifactMetadata } from '../../../shared/generated-artifact-core.js';

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
    state = readJson(statePath);
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw Object.assign(
    new Error('SQLite state publication requires a valid existing index-state object.'), { code: 'ERR_INDEX_STATE_INVALID' });
  const now = new Date().toISOString();
  state.generatedAt = state.generatedAt || now;
  state.updatedAt = now;
  state.sqlite = {
    ...(state.sqlite || {}),
    ...(statePatch || {}),
    updatedAt: now
  };
  await writeJsonObjectFile(statePath, {
    fields: withGeneratedArtifactMetadata(state, 'index-state'),
    atomic: true
  });
  await updateIndexStateManifest(indexDir);
};
