import path from 'node:path';
import { createHash } from 'node:crypto';
import { getApplicationHome } from '../cache-roots.js';

const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const digest = value => createHash('sha256').update(normalize(value)).digest('hex');
export const nativePublicationHomeDigest = home => digest(home);
export const nativePublicationRegistryPaths = (target, { home = getApplicationHome() } = {}) => {
  if (typeof target !== 'string' || !path.isAbsolute(target) || typeof home !== 'string' || !path.isAbsolute(home)) {
    throw new TypeError('Native publication requires absolute launch paths.');
  }
  // One asset has one coordinator across launch homes. Its fixed location is
  // derived from the selected target, never from an untrusted metadata path.
  const root = path.join(path.dirname(target), '.poc-native-storage', digest(target));
  return { root, record: path.join(root, 'publication.json'), lock: path.join(root, 'publication.lock'),
    access: path.join(root, 'access'), homeGuard: path.join(root, `home-${digest(home)}.json`) };
};
