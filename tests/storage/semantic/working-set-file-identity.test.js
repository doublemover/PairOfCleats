#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import path from 'node:path';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';

const { dir: root } = await prepareIsolatedTestCacheDir('semantic-working-set-file-identity');
const nativeLstat = fs.lstat;
const firstWideId = 2n ** 53n;
const secondWideId = firstWideId + 1n;
const identities = new Map();
const createFile = async (directory, name, size, dev, ino) => {
  const filename = path.join(directory, name);
  await fs.writeFile(filename, Buffer.alloc(size, size));
  identities.set(filename, { dev, ino });
  return filename;
};
try {
  assert.equal(Number(firstWideId), Number(secondWideId), 'fixture identities collide only after lossy conversion');
  const wideRoot = path.join(root, 'wide');
  const zeroRoot = path.join(root, 'zero');
  const devicesRoot = path.join(root, 'devices');
  await Promise.all([wideRoot, zeroRoot, devicesRoot].map(directory => fs.mkdir(directory)));
  const first = await createFile(wideRoot, 'first', 17, 1n, firstWideId);
  await createFile(wideRoot, 'second', 53, 1n, secondWideId);
  await createFile(wideRoot, 'other-device', 11, 2n, firstWideId);
  const alias = path.join(wideRoot, 'first-alias');
  await fs.link(first, alias);
  identities.set(alias, identities.get(first));
  await createFile(zeroRoot, 'first', 7, 1n, 0n);
  await createFile(zeroRoot, 'second', 13, 1n, 0n);
  await createFile(devicesRoot, 'first', 3, firstWideId, 123n);
  await createFile(devicesRoot, 'second', 5, secondWideId, 123n);

  // Real directory entries, files and hard links; only representative platform
  // file identifiers are controlled so the regression runs on every CI host.
  fs.lstat = async (filename, options) => {
    const stat = await nativeLstat(filename, options);
    const identity = identities.get(path.resolve(filename));
    if (identity) {
      for (const key of ['dev', 'ino']) stat[key] = options?.bigint ? identity[key] : Number(identity[key]);
    }
    return stat;
  };
  const wide = await reopenSemanticDiskAccount({
    roots: [wideRoot, wideRoot, path.join(wideRoot, 'missing')], limit: 81
  });
  assert.equal(wide.retainedBytes, 81, 'distinct wide identities cost their exact bytes; a real hard link costs once');
  assert.equal(wide.retainedFiles, 3, 'the inode key includes the device identity');
  assert.equal(wide.account.used, 81);
  await assert.rejects(reopenSemanticDiskAccount({ roots: [wideRoot], limit: 80 }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  const zero = await reopenSemanticDiskAccount({ roots: [zeroRoot], limit: 20 });
  assert.equal(zero.retainedBytes, 20, 'unavailable inode identities fall back conservatively to distinct paths');
  assert.equal(zero.retainedFiles, 2);
  const devices = await reopenSemanticDiskAccount({ roots: [devicesRoot], limit: 8 });
  assert.equal(devices.retainedBytes, 8, 'wide device IDs remain exact as well');
  assert.equal(devices.retainedFiles, 2);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(reopenSemanticDiskAccount({ roots: [wideRoot], limit: 81, signal: aborted.signal }), { name: 'AbortError' });
} finally {
  fs.lstat = nativeLstat;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('semantic physical file identity, hard links, exact disk limits and zero-inode fallback passed');
