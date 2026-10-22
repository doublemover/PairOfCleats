import path from 'node:path';
import { getApplicationHome, getCacheRoot } from '../../shared/cache-roots.js';
import { getRepoId } from '../../shared/repo-paths.js';
import { readStorageLocator } from '../../shared/storage/locator-read.js';
import { acquireStorageSession } from '../../shared/storage/session.js';

const selectionError = message => Object.assign(new Error(message), { code: 'ERR_INDEX_STORAGE_SELECTION' });

/** Resolve only the canonical namespace selected by the actual launch/config.
 * A caller-supplied cache path or a filesystem parent grants no extra authority.
 */
export const acquireIndexStorageSession = (repoCacheRoot, { repoRoot, userConfig, env = process.env } = {}) => {
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
  if (path.resolve(repoCacheRoot) !== expected) throw selectionError('Index writer root differs from its canonical launch-selected repository namespace.');
  const revalidate = () => {
    const current = locator();
    if (current.status !== before.status || current.sha256 !== before.sha256
      || path.resolve(configured || getCacheRoot({ env: launchEnv })) !== cache) {
      throw selectionError('Index storage selection changed during writer admission; re-plan against the selected category.');
    }
  };
  revalidate();
  const state = path.join(home, 'state');
  const session = acquireStorageSession({ roots: [expected], authorizedRoots: [cache, repos, state],
    coordinationRoot: path.join(state, 'storage-access'), scope: 'index-cache-writer' });
  return { session, revalidate };
};

export const retainIndexStorageFailure = (error, session, owner = null, released = () => false) => {
  const primary = error && typeof error === 'object' ? error : new Error(String(error), { cause: error });
  let original = null;
  try {
    const observe = primary.cacheOwnershipReleased;
    if (primary.cacheOwnershipPending === true || typeof observe === 'function') {
      original = () => { try { return typeof observe === 'function' && observe.call(primary) === true; } catch { return false; } };
    }
  } catch { original = () => false; }
  return Object.assign(new AggregateError([primary], primary.message || 'Index storage ownership remains unsettled.', { cause: primary }), {
    code: primary.code || 'ERR_INDEX_STORAGE_PENDING', name: primary.name || 'AggregateError', cacheOwnershipPending: true,
    cacheOwnershipReleased: () => { try { return released() === true && (!original || original()); } catch { return false; } }, storageSession: session,
    ...(owner ? { indexStorageOwner: owner } : {})
  });
};

/** The existing writer owner still decides when its work is drained. Its exact
 * successful release must precede the category leases, including on retry.
 */
export const attachIndexStorageSession = (lock, { session, revalidate }) => {
  const releaseIndex = lock.release.bind(lock);
  let indexReleased = false, released = false, releasing = null;
  const owner = Object.create(Object.getPrototypeOf(lock), Object.getOwnPropertyDescriptors(lock));
  Object.defineProperties(owner, {
    storageSession: { value: session },
    revalidateStorageSelection: { value: revalidate },
    release: { value: () => {
      if (released) return Promise.resolve(true);
      if (releasing) return releasing;
      releasing = Promise.resolve().then(async () => {
        try {
          if (!indexReleased) {
            if (await releaseIndex() !== true) throw selectionError('Index writer release did not confirm its exact owner.');
            indexReleased = true;
          }
          if (session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }) !== true) {
            throw selectionError('Index category lease release did not confirm its exact owner.');
          }
          released = true;
          return true;
        } catch (error) { throw retainIndexStorageFailure(error, session, owner, () => released); }
      }).finally(() => { releasing = null; });
      return releasing;
    } }
  });
  return owner;
};
