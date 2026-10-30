import path from 'node:path';
import { isPathWithinRoot } from '../file-paths.js';
import { getApplicationHome, getCacheRoot } from '../cache-roots.js';
import { getRepoId } from '../repo-paths.js';
import { readStorageLocator } from './locator-read.js';
import { acquireStorageSession } from './session.js';

const selectionError = message => Object.assign(new Error(message), { code: 'ERR_INDEX_STORAGE_SELECTION' });
const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

/** Resolve only the canonical namespace selected by the actual launch/config.
 * A caller-supplied cache path or a filesystem parent grants no extra authority.
 */
export const acquireRepoStorageSession = (repoCacheRoot, { repoRoot, userConfig, env = process.env } = {}, { scope = 'index-cache-writer', resourceRoots = [] } = {}) => {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)
    || !userConfig || typeof userConfig !== 'object' || Array.isArray(userConfig)
    || !env || typeof env !== 'object' || Array.isArray(env) || !path.isAbsolute(repoCacheRoot || '')) {
    throw new TypeError('Index storage coordination requires its explicit repository and effective configuration.');
  }
  const launchEnv = { ...env };
  const configured = userConfig.cache?.root || null;
  if (configured !== null && (typeof configured !== 'string' || !path.isAbsolute(configured))) {
    throw selectionError('Index storage requires the effective absolute configured cache root.');
  }
  const home = getApplicationHome({ env: launchEnv });
  const locator = () => {
    const current = readStorageLocator(home);
    if (current.status === 'invalid') throw selectionError('Index storage locator is unreadable or incompatible.');
    return current;
  };
  const before = locator();
  const cache = path.resolve(configured || getCacheRoot({ env: launchEnv }));
  if (cache === path.parse(cache).root) throw selectionError('A volume root is not an index cache category.');
  const repos = path.join(cache, 'repos');
  const expected = path.join(repos, getRepoId(repoRoot));
  if (!Array.isArray(resourceRoots) || resourceRoots.length > 16 || resourceRoots.some(root => typeof root !== 'string'
    || !path.isAbsolute(root) || !isPathWithinRoot(root, expected))) {
    throw selectionError('Repository resource differs from its canonical launch-selected namespace.');
  }
  if (identity(repoCacheRoot) !== identity(expected)) throw selectionError('Index writer root differs from its canonical launch-selected repository namespace.');
  const revalidate = () => {
    const current = locator();
    if (current.status !== before.status || current.sha256 !== before.sha256
      || identity(configured || getCacheRoot({ env: launchEnv })) !== identity(cache)) {
      throw selectionError('Index storage selection changed during writer admission; re-plan against the selected category.');
    }
  };
  revalidate();
  const state = path.join(home, 'state');
  const session = acquireStorageSession({ roots: [expected, ...resourceRoots], authorizedRoots: [cache, repos, state],
    coordinationRoot: path.join(state, 'storage-access'), scope });
  return { session, revalidate };
};
