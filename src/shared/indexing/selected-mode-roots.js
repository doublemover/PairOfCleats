import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoCacheRootPath } from '../repo-paths.js';
import { readJsonFile } from '../artifact-io/json.js';
import { retainRepoCacheAccess } from '../cache/repo-access.js';
import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import { DEFAULT_BUILD_MODES, hasModeArtifacts, resolveCacheScopedBuildPointerRoot } from './build-pointer.js';

/** One operation-owned pointer read. Declared missing modes remain selected so
 * validators and health cannot mistake a broken publication for a disabled mode. */
export const captureSelectedModeRoots = ({ root, userConfig, indexRoot = null }) => {
  if (indexRoot) {
    const selectedRoot = path.resolve(indexRoot);
    const statePath = path.join(selectedRoot, 'build_state.json');
    const state = fs.existsSync(statePath) ? readJsonFile(statePath, { maxBytes: 8 * 1024 * 1024 }) : null;
    const declared = Array.isArray(state?.modes) ? state.modes : [];
    const modes = DEFAULT_BUILD_MODES.filter(mode => declared.includes(mode) || hasModeArtifacts(selectedRoot, mode));
    return { source: 'explicit-index-root', modes, roots: Object.fromEntries(modes.map(mode => [mode, selectedRoot])), pointer: null };
  }
  const repoCacheRoot = resolveRepoCacheRootPath(root, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  if (!fs.existsSync(currentPath)) return { source: 'no-publication', modes: [], roots: {}, pointer: null };
  retainRepoCacheAccess(repoCacheRoot);
  const pointer = readJsonFile(currentPath, { maxBytes: 512 * 1024, containedRoot: repoCacheRoot });
  assertCurrentIndexFormat({ operation: 'read', component: 'selected modes', foundVersion: pointer.artifactSurfaceVersion,
    repoRoot: root, indexPath: currentPath });
  const rootsMap = pointer.buildRootsByMode ?? pointer.buildRoots;
  if (rootsMap != null && (typeof rootsMap !== 'object' || Array.isArray(rootsMap))) throw new Error('Published mode root map is invalid.');
  const declared = rootsMap ? Object.keys(rootsMap) : Array.isArray(pointer.modes) ? pointer.modes : [];
  const modes = DEFAULT_BUILD_MODES.filter(mode => declared.includes(mode));
  const roots = {};
  for (const mode of modes) {
    const raw = rootsMap?.[mode] ?? pointer.buildRoot;
    const selected = resolveCacheScopedBuildPointerRoot(raw, repoCacheRoot, buildsRoot);
    if (!selected) throw new Error(`Published ${mode} root is invalid.`);
    roots[mode] = selected;
  }
  return { source: 'published-mode-roots', modes, roots, pointer };
};
