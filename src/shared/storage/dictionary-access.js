import path from 'node:path';
import { createHash } from 'node:crypto';
import { getApplicationHome, getCacheRootBase, getStorageCategorySelection } from '../cache-roots.js';
import { getEnvConfig } from '../env.js';
import { isPathWithinRoot } from '../file-paths.js';
import { acquireRepoCacheAccessLease } from '../cache/repo-access.js';

const declaredRoots = new Set();
export const dictionaryStorageCoordinationRoot = () => path.join(getApplicationHome(), 'state', 'storage-access');

// The existing configuration/path owner declares the category root. A file's
// text, manifest references and arbitrary parent directory names grant nothing.
export const registerDictionaryStorageRoot = root => {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('Dictionary storage root must be configuration-selected and absolute.');
  declaredRoots.add(path.resolve(root));
};

export const acquireDictionaryStorageRead = (target, { root = null, scope = 'dictionary-byte-reader' } = {}) => {
  const file = path.resolve(target);
  let selected = root ? path.resolve(root) : [...declaredRoots]
    .filter(candidate => isPathWithinRoot(file, candidate)).sort((a, b) => b.length - a.length)[0];
  if (!selected) {
    const env = getEnvConfig();
    const defaultRoot = path.resolve(env.dictDir || getStorageCategorySelection('dictionaries') || path.join(getCacheRootBase(), 'dictionaries'));
    if (isPathWithinRoot(file, defaultRoot)) selected = defaultRoot;
  }
  if (!selected) return { covered: false, external: true, releaseAfterClosure: () => true };
  if (!isPathWithinRoot(file, selected)) throw new Error('Dictionary reader target differs from its declared category.');
  const lease = acquireRepoCacheAccessLease(selected, { coordinationRoot: dictionaryStorageCoordinationRoot(), scope,
    resourceId: createHash('sha256').update(file).digest('hex') });
  return { covered: true, root: selected, releaseAfterClosure: () => {
    if (!lease.release()) throw Object.assign(new Error('Dictionary reader lease changed before actual handle closure.'), { code: 'ERR_DICTIONARY_STORAGE_LEASE' });
    return true;
  } };
};

export const isDictionaryStorageAccessError = error => error?.cacheOwnershipPending === true
  || /^ERR_(?:REPO_CACHE_|DICTIONARY_STORAGE_|STORAGE_)/u.test(error?.code || '');
