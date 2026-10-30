import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafeCacheDeletion, CACHE_OWNER_FILE } from '../cache-deletion.js';
import { readVerifiedContainedFile } from '../contained-file.js';

const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

/** Preview pins the authority root object and marker, not just its path text. */
export const captureStorageAuthority = async authorityRoots => {
  const snapshots = [];
  for (const root of [...new Set(authorityRoots.map(value => path.resolve(value)))].sort()) {
    assertSafeCacheDeletion(root, [root]);
    const stat = await fs.lstat(root, { bigint: true });
    const marker = await readVerifiedContainedFile(root, path.join(root, CACHE_OWNER_FILE), { maxBytes: 64 * 1024 });
    snapshots.push({ path: root, dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), markerSha256: marker.hash });
  }
  return snapshots;
};

export const revalidateStorageAuthority = async (snapshots, authorityRoots) => {
  if (!Array.isArray(snapshots) || snapshots.length === 0) throw new Error('Storage operation has no pinned authority roots.');
  const allowed = new Set(authorityRoots.map(normalize));
  for (const expected of snapshots) {
    if (!allowed.has(normalize(expected.path))) throw new Error('Preview authority was not supplied again by the launching user.');
    const [actual] = await captureStorageAuthority([expected.path]);
    if (['dev', 'ino', 'mode', 'markerSha256'].some(key => actual[key] !== expected[key])) {
      throw new Error('Storage authority root or ownership marker changed after preview.');
    }
  }
};
