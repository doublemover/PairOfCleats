import path from 'node:path';
import { captureSelectedModeRoots, readSelectedModeRootCapture } from '../../shared/indexing/selected-mode-roots.js';
import { getIndexDir, resolveLmdbPaths, resolveSqlitePaths } from '../../shared/dict-utils.js';
import { resolveRepoCacheRootPath } from '../../shared/repo-paths.js';
import { resolveIndexDir } from './paths.js';

const captures = new WeakMap();
const modesAllowed = ['code', 'prose', 'extracted-prose', 'records'];
const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const outputKey = { code: 'codePath', prose: 'prosePath', 'extracted-prose': 'extractedProsePath', records: 'recordsPath' };

/** Capture every source/backend path before the first asynchronous validation
 * read. Publication movement cannot replace any member of this operation.
 */
export const captureValidationSelection = ({ root, userConfig, indexRoot = null, modes,
  strict = true, capturedModes = null, backendRequirements = null }) => {
  if (!Array.isArray(modes) || !modes.length || modes.some(mode => !modesAllowed.includes(mode))) {
    throw new TypeError('Validation requires concrete supported modes.');
  }
  const scope = { root, userConfig, indexRoot };
  const source = readSelectedModeRootCapture(capturedModes || captureSelectedModeRoots(scope), scope);
  const selectedRoot = indexRoot ? path.resolve(indexRoot)
    : source.source === 'no-publication' ? resolveRepoCacheRootPath(root, userConfig) : null;
  const roots = {}, indexDirs = {}, sqlitePaths = {}, lmdbPaths = {}, unavailable = [];
  for (const mode of modes) {
    const modeRoot = source.roots[mode] || selectedRoot;
    if (!modeRoot) {
      unavailable.push(mode);
      continue;
    }
    // Non-strict local fallback is retained only for a genuine legacy source;
    // it cannot replace an explicit or published generation.
    const dir = source.source === 'no-publication'
      ? resolveIndexDir(root, mode, userConfig, modeRoot, strict)
      : getIndexDir(root, mode, userConfig, { indexRoot: modeRoot });
    roots[mode] = path.resolve(path.dirname(dir));
    indexDirs[mode] = path.resolve(dir);
    const sqlite = resolveSqlitePaths(root, userConfig, { indexRoot: roots[mode] });
    const lmdb = resolveLmdbPaths(root, userConfig, { indexRoot: roots[mode] });
    sqlitePaths[mode] = sqlite[outputKey[mode]];
    if (mode === 'code' || mode === 'prose') lmdbPaths[mode] = lmdb[outputKey[mode]];
  }
  const selection = Object.freeze({ source: source.source, indexRoot: indexRoot ? path.resolve(indexRoot) : null,
    modes: Object.freeze([...modes]), roots: Object.freeze(roots), indexDirs: Object.freeze(indexDirs),
    sqlitePaths: Object.freeze(sqlitePaths), lmdbPaths: Object.freeze(lmdbPaths), unavailable: Object.freeze(unavailable),
    pointerReceipt: source.pointerReceipt ? Object.freeze(source.pointerReceipt) : null,
    ...(backendRequirements ? { backendRequirements: Object.freeze(Object.fromEntries(['sqlite', 'lmdb'].map(backend => [backend,
      Object.freeze(Object.fromEntries(modes.map(mode => [mode, backendRequirements[backend]?.[mode] === true])))]))) } : {}) });
  captures.set(selection, { root: identity(root), userConfig, indexRoot: indexRoot ? identity(indexRoot) : null,
    strict, modes: JSON.stringify(modes), pointer: source.pointer });
  return selection;
};

export const readValidationSelection = (selection, { root, userConfig, indexRoot = null, modes, strict }) => {
  const owner = captures.get(selection);
  if (!owner || owner.root !== identity(root) || owner.userConfig !== userConfig || owner.strict !== strict
    || owner.indexRoot !== (indexRoot ? identity(indexRoot) : null) || owner.modes !== JSON.stringify(modes)) {
    throw new TypeError('Validation requires its original operation-owned source selection.');
  }
  return { selection, pointer: owner.pointer };
};
