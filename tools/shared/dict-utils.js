import path from 'node:path';
import { loadUserConfig } from '../dict-utils/config.js';
import { resolveRepoRoot } from '../dict-utils/paths.js';

export { DEFAULT_MODEL_ID, DEFAULT_TRIAGE_PROMOTE_FIELDS } from '../dict-utils/constants.js';
export { resolveToolRoot, getToolVersion } from '../dict-utils/tool.js';
export {
  applyAdaptiveDictConfig,
  getAutoPolicy,
  getCacheRoot,
  getDictConfig,
  getEffectiveConfigHash,
  loadUserConfig
} from '../dict-utils/config.js';
export { getDefaultCacheRoot } from '../dict-utils/cache.js';
export {
  getBuildsRoot,
  getCacheRuntimeConfig,
  getCurrentBuildInfo,
  getIndexDir,
  getMetricsDir,
  getQueryCacheDir,
  getModelConfig,
  getModelsDir,
  getCodeDictionaryPaths,
  getDictionaryPaths,
  getRepoCacheRoot,
  getRepoDictPath,
  getRepoId,
  getRepoRoot,
  getRuntimeConfig,
  getToolingConfig,
  getToolingDir,
  getTriageConfig,
  getTriageRecordsDir,
  getExtensionsDir,
  resolveIndexRoot,
  resolveLmdbPaths,
  resolveNodeOptions,
  resolveRepoRoot,
  resolveRuntimeEnv,
  resolveSqlitePaths
} from '../dict-utils/paths.js';

/**
 * Resolve repo root + user config from an optional repo argument.
 * @param {string|undefined|null} repoArg
 * @param {string} [cwd]
 * @returns {{repoRoot:string,userConfig:object,rootArg:string|null}}
 */
export function resolveRepoConfig(repoArg, cwd = process.cwd()) {
  const rootArg = repoArg ? path.resolve(repoArg) : null;
  const repoRoot = rootArg || resolveRepoRoot(cwd);
  const userConfig = loadUserConfig(repoRoot);
  return { repoRoot, userConfig, rootArg };
}
