import { DEFAULT_MODEL_ID } from '../constants.js';
import { loadUserConfig } from '../config.js';
import { getModelsDir } from './cache.js';

/**
 * Resolve model configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{id:string,dir:string}}
 */
export function getModelConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const models = cfg.models || {};
  const id = models.id || DEFAULT_MODEL_ID;
  return {
    id,
    dir: getModelsDir(repoRoot, cfg)
  };
}
