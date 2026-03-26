import fs from 'node:fs';
import { toRealPathSync } from '../../workspace/identity.js';
import {
  DEFAULT_BUILD_MODES,
  findLatestBuildRootWithIndexes,
  hasModeArtifacts,
  hasModeIndexDir,
  MODE_ARTIFACT_MARKERS,
  resolveCacheScopedBuildIdRoot,
  resolveCacheScopedBuildPointerRoot,
  resolveCurrentBuildRoots,
  sameIdentityPath
} from './build-pointer-roots.js';
import {
  buildGenerationKey,
  readCurrentBuildGeneration,
  resolveCurrentBuildGeneration
} from './build-generation.js';
import {
  BUILD_ROOT_SELECTION_SCOPES,
  resolveCanonicalBuildRoot as resolveCanonicalBuildRootInternal
} from './build-root-selection.js';

export {
  buildGenerationKey,
  BUILD_ROOT_SELECTION_SCOPES,
  DEFAULT_BUILD_MODES,
  findLatestBuildRootWithIndexes,
  hasModeArtifacts,
  hasModeIndexDir,
  MODE_ARTIFACT_MARKERS,
  readCurrentBuildGeneration,
  resolveCacheScopedBuildIdRoot,
  resolveCacheScopedBuildPointerRoot,
  resolveCurrentBuildGeneration,
  resolveCurrentBuildRoots,
  sameIdentityPath
};

export const resolveCanonicalBuildRoot = (options = {}) => resolveCanonicalBuildRootInternal({
  ...options,
  existsSync: fs.existsSync,
  toRealPathSync,
  hasModeIndexDir
});
