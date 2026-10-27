import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoCacheRootPath } from '../repo-paths.js';
import { readJsonFile } from '../artifact-io/json.js';
import { retainRepoCacheAccess, retainCachePathAccess } from '../cache/repo-access.js';
import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import { DEFAULT_BUILD_MODES, hasModeArtifacts, resolveCacheScopedBuildPointerRoot } from './build-pointer.js';
import { readVerifiedContainedFileSync } from '../contained-file.js';

const captures = new WeakMap();
const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const remember = (selection, scope) => {
  captures.set(selection, { root: identity(scope.root), userConfig: scope.userConfig,
    indexRoot: scope.indexRoot ? identity(scope.indexRoot) : null, selection: structuredClone(selection) });
  return selection;
};

/** Reuse only an actual captured read from this operation's exact context.
 * A serialized receipt or later mutation of its display fields grants no input.
 */
export const readSelectedModeRootCapture = (selection, scope) => {
  const captured = captures.get(selection);
  if (!captured || captured.root !== identity(scope.root) || captured.userConfig !== scope.userConfig
    || captured.indexRoot !== (scope.indexRoot ? identity(scope.indexRoot) : null)) {
    throw new TypeError('Selected mode roots require the original repository/configuration capture.');
  }
  return structuredClone(captured.selection);
};

/** One operation-owned pointer read. Declared missing modes remain selected so
 * validators and health cannot mistake a broken publication for a disabled mode. */
export const captureSelectedModeRoots = ({ root, userConfig, indexRoot = null }) => {
  const scope = { root, userConfig, indexRoot };
  if (indexRoot) {
    const selectedRoot = path.resolve(indexRoot);
    retainCachePathAccess(selectedRoot);
    const statePath = path.join(selectedRoot, 'build_state.json');
    const state = fs.existsSync(statePath) ? readJsonFile(statePath, { maxBytes: 8 * 1024 * 1024 }) : null;
    const declared = Array.isArray(state?.modes) ? state.modes : [];
    const modes = DEFAULT_BUILD_MODES.filter(mode => declared.includes(mode) || hasModeArtifacts(selectedRoot, mode));
    return remember({ source: 'explicit-index-root', modes, roots: Object.fromEntries(modes.map(mode => [mode, selectedRoot])), pointer: null }, scope);
  }
  const repoCacheRoot = resolveRepoCacheRootPath(root, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  retainRepoCacheAccess(repoCacheRoot);
  if (!fs.existsSync(currentPath)) return remember({ source: 'no-publication', modes: [], roots: {}, pointer: null }, scope);
  const read = readVerifiedContainedFileSync(repoCacheRoot, currentPath, { maxBytes: 512 * 1024 });
  const pointer = JSON.parse(read.buffer.toString('utf8'));
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
  return remember({ source: 'published-mode-roots', modes, roots, pointer,
    pointerReceipt: { path: currentPath, sha256: read.hash } }, scope);
};
