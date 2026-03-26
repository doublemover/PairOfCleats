import {
  BUILD_ROOT_RESOLUTION_FAILURES,
  BUILD_ROOT_SELECTION_SCOPE,
  getBuildsRoot as getBuildsRootShared,
  getCurrentBuildInfo as getCurrentBuildInfoShared,
  getIndexDir as getIndexDirShared,
  getLegacyRepoId,
  getRepoCacheRoot as getRepoCacheRootShared,
  getRepoId,
  getRepoRoot,
  resolveCurrentBuildModeRoot as resolveCurrentBuildModeRootShared,
  resolveIndexRoot as resolveIndexRootShared,
  resolvePath,
  resolveRepoRoot
} from '../../../src/shared/repo-paths.js';
import { getCacheRoot, loadUserConfig } from '../config.js';

const REPO_PATH_OPTIONS = Object.freeze({
  getCacheRoot,
  loadUserConfig
});

export {
  BUILD_ROOT_RESOLUTION_FAILURES,
  BUILD_ROOT_SELECTION_SCOPE,
  getLegacyRepoId,
  getRepoId,
  getRepoRoot,
  resolvePath,
  resolveRepoRoot
};

export function resolveCurrentBuildModeRoot(repoRoot, userConfig = null, options = {}) {
  return resolveCurrentBuildModeRootShared(repoRoot, userConfig, {
    ...REPO_PATH_OPTIONS,
    ...options
  });
}

export function getRepoCacheRoot(repoRoot, userConfig = null) {
  return getRepoCacheRootShared(repoRoot, userConfig, REPO_PATH_OPTIONS);
}

export function getBuildsRoot(repoRoot, userConfig = null) {
  return getBuildsRootShared(repoRoot, userConfig, REPO_PATH_OPTIONS);
}

export function getCurrentBuildInfo(repoRoot, userConfig = null, options = {}) {
  return getCurrentBuildInfoShared(repoRoot, userConfig, {
    ...REPO_PATH_OPTIONS,
    ...options
  });
}

export function resolveIndexRoot(repoRoot, userConfig = null, options = {}) {
  return resolveIndexRootShared(repoRoot, userConfig, {
    ...REPO_PATH_OPTIONS,
    ...options
  });
}

export function getIndexDir(repoRoot, mode, userConfig = null, options = {}) {
  return getIndexDirShared(repoRoot, mode, userConfig, {
    ...REPO_PATH_OPTIONS,
    ...options
  });
}
