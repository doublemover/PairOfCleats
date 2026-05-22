import path from 'node:path';
import { loadUserConfig } from '../../tools/dict-utils/config.js';
import { getRuntimeConfig, resolveRuntimeEnv } from '../../tools/dict-utils/paths.js';
import { resolveRepoRoot } from './repo-paths.js';
import { toRealPathSync } from '../workspace/identity.js';

export {
  BUILD_ROOT_RESOLUTION_FAILURES,
  BUILD_ROOT_SELECTION_SCOPE,
  getLegacyRepoId,
  getRepoId,
  getRepoRoot,
  resolvePath,
  resolveRepoRoot
} from './repo-paths.js';

export {
  applyAdaptiveDictConfig,
  getAutoPolicy,
  getCacheRoot,
  getDictConfig,
  getEffectiveConfigHash,
  loadUserConfig
} from '../../tools/dict-utils/config.js';

export { DEFAULT_MODEL_ID, DEFAULT_TRIAGE_PROMOTE_FIELDS } from '../../tools/dict-utils/constants.js';
export { getDefaultCacheRoot } from '../../tools/dict-utils/cache.js';
export { getToolVersion, resolveToolRoot } from '../../tools/dict-utils/tool.js';
export {
  getBuildsRoot,
  getCacheRuntimeConfig,
  getCodeDictionaryPaths,
  getCurrentBuildInfo,
  getDictionaryPaths,
  getExtensionsDir,
  getIndexDir,
  getMetricsDir,
  getModelConfig,
  getModelsDir,
  getQueryCacheDir,
  getRepoCacheRoot,
  getRepoDictPath,
  getRuntimeConfig,
  getToolingConfig,
  getToolingDir,
  getTriageConfig,
  getTriageRecordsDir,
  resolveCurrentBuildModeRoot,
  resolveIndexRoot,
  resolveLmdbPaths,
  resolveNodeOptions,
  resolveRuntimeEnv,
  resolveSqlitePaths
} from '../../tools/dict-utils/paths.js';
export {
  isWithinRoot,
  normalizeIdentityPath,
  toRealPath,
  toRealPathSync
} from '../workspace/identity.js';

/**
 * Resolve repo root + user config from an optional repo argument.
 *
 * @param {string|undefined|null} repoArg
 * @param {string} [cwd]
 * @returns {{repoRoot:string,userConfig:object,rootArg:string|null}}
 */
export function resolveRepoConfig(repoArg, cwd = process.cwd()) {
  const rootArg = repoArg ? path.resolve(repoArg) : null;
  const repoRoot = rootArg
    ? toRealPathSync(rootArg)
    : toRealPathSync(resolveRepoRoot(cwd));
  const userConfig = loadUserConfig(repoRoot);
  return { repoRoot, userConfig, rootArg };
}

/**
 * Resolve repo config and runtime env for runtime callers.
 *
 * @param {string|undefined|null} repoArg
 * @param {{cwd?:string,baseEnv?:NodeJS.ProcessEnv}} [options]
 * @returns {{
 *   repoRoot:string,
 *   userConfig:object,
 *   rootArg:string|null,
 *   runtimeConfig:object,
 *   runtimeEnv:NodeJS.ProcessEnv
 * }}
 */
export function bootstrapRuntime(repoArg, options = {}) {
  const cwd = options.cwd || process.cwd();
  const inputEnv = options.baseEnv || process.env;
  const { repoRoot, userConfig, rootArg } = resolveRepoConfig(repoArg, cwd);
  const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, inputEnv);
  return { repoRoot, userConfig, rootArg, runtimeConfig, runtimeEnv };
}

/**
 * Resolve repo root from an optional repo/root argument.
 *
 * @param {string|undefined|null} repoArg
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolveRepoRootArg(repoArg, cwd = process.cwd()) {
  const rootArg = repoArg ? path.resolve(repoArg) : null;
  return rootArg
    ? toRealPathSync(rootArg)
    : toRealPathSync(resolveRepoRoot(cwd));
}

/**
 * Resolve repo-local config path from an optional override.
 *
 * @param {string} repoRoot
 * @param {string|undefined|null} configArg
 * @returns {string}
 */
export function resolveRepoConfigPath(repoRoot, configArg) {
  return configArg
    ? path.resolve(configArg)
    : path.join(repoRoot, '.pairofcleats.json');
}
