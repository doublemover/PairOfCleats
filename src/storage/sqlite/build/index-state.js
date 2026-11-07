import { getIndexDir } from '../../../shared/dict-utils.js';
import { updateIndexStateNamespace } from '../../../shared/index-state-publication.js';

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
  await updateIndexStateNamespace(indexDir, 'sqlite', statePatch);
};
