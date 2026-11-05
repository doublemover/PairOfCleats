import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { withStorageDirectory } from './directory.js';
import { storageFileIdentity, sameStorageFileIdentity } from './inventory.js';
import { describeStorageFailure } from './failure-observation.js';

const names = { sqlite: ['', '-wal', '-shm', '-journal'], lmdb: ['data.mdb', 'lock.mdb'] };
export const nativePublicationFilePath = (backend, target, name) => {
  if (!Object.hasOwn(names, backend) || !names[backend].includes(name)) throw new TypeError('Unknown native publication member.');
  return backend === 'sqlite' ? target + name : path.join(target, name);
};
const statPath = async target => {
  assertNoSymlinkPath(path.parse(target).root, target, { allowMissing: true });
  try { return await fs.lstat(target, { bigint: true }); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'native-publication-stat' }).code === 'ENOENT') return null;
    throw error;
  }
};

/** Constant-size native families only. An unknown member is retained; this
 * inventory grants neither publication nor recursive directory authority. */
export const inspectNativePublicationFiles = async (backend, target) => {
  if (!Object.hasOwn(names, backend) || !path.isAbsolute(target)
    || target === path.parse(target).root) throw new TypeError('Native publication requires an exact backend target.');
  const root = await statPath(target);
  if (root && (root.isSymbolicLink() || (backend === 'sqlite' ? !root.isFile() : !root.isDirectory()))) {
    return { complete: false, reason: 'nonordinary-native-target', missing: false, root: null, files: [] };
  }
  if (backend === 'lmdb' && root) {
    let unknown = false;
    await withStorageDirectory(target, async directory => {
      for (let count = 0; ; count++) {
        if (count === 3) { unknown = true; break; }
        const entry = await directory.read();
        if (!entry) break;
        if (!names.lmdb.includes(entry.name)) { unknown = true; break; }
      }
    });
    if (unknown) return { complete: false, reason: 'unknown-native-member', missing: false,
      root: storageFileIdentity(root), files: [] };
  }
  const files = [];
  let logicalBytes = 0n;
  for (const name of names[backend]) {
    const stat = backend === 'sqlite' && name === '' ? root : await statPath(nativePublicationFilePath(backend, target, name));
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.ino === 0n
      || !Number.isSafeInteger(Number(stat.size))) {
      return { complete: false, reason: 'unqualified-native-member', missing: false,
        root: root ? storageFileIdentity(root) : null, files: [] };
    }
    files.push({ name, identity: storageFileIdentity(stat) });
    logicalBytes += stat.size;
    if (logicalBytes > BigInt(Number.MAX_SAFE_INTEGER)) return { complete: false, reason: 'native-family-size-budget',
      missing: false, root: root ? storageFileIdentity(root) : null, files: [] };
  }
  return { complete: true, missing: !root && !files.length, root: root ? storageFileIdentity(root) : null, files };
};

export const sameNativePublicationFiles = (backend, left, right, { allowLmdbReaderLock = false } = {}) => {
  if (!left?.complete || !right?.complete || left.missing !== right.missing || left.files.length !== right.files.length) return false;
  if (backend === 'lmdb' && left.root && (!right.root
    || left.root.dev !== right.root.dev || left.root.ino !== right.root.ino)) return false;
  return left.files.every((file, index) => {
    const other = right.files[index];
    if (file.name !== other?.name) return false;
    if (backend === 'lmdb' && file.name === 'lock.mdb' && allowLmdbReaderLock) {
      return ['dev', 'ino', 'size', 'mode', 'nlink'].every(key => file.identity[key] === other.identity[key]);
    }
    return sameStorageFileIdentity(file.identity, other.identity);
  });
};
