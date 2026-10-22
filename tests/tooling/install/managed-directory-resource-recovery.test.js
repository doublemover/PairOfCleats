import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { isStorageTransferSession } from '../../../src/shared/storage/transfer.js';

// UNVALIDATED: actual directory/file/category owners; inert archive and verifier.
const temporary = await makeTempDir('poc-managed-directory-resource-');
const open = fs.open, opendir = fs.opendir, remove = fsSync.rmSync;
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const current = pending.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
try {
  const home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tooling');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
    const archive = Buffer.from('inert directory ownership archive');
    const descriptor = { schemaVersion: 1, toolId: 'fixture-directory', recipeId: 'fixture', version: '1.0.0',
      platform: process.platform, arch: process.arch,
      archive: { url: 'https://fixture.invalid/directory-v1.zip', type: 'zip', bytes: archive.length,
        sha256: createHash('sha256').update(archive).digest('hex') }, root: 'package', command: 'tool', args: [], requiredFiles: ['tool'],
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } };
    let packageRoot, denyFile = true, denyDirectory = true, denyMetadata = true;
    let fileCloses = 0, directoryCloses = 0, verified = false;
    const fileError = Object.freeze(Object.assign(new Error('frozen managed file close fault'), { code: 'EIO' }));
    const directoryError = Object.freeze(Object.assign(new Error('frozen managed Dir close fault'), { code: 'EACCES' }));
    fs.open = async (target, ...args) => {
      const handle = await open(target, ...args);
      if (!packageRoot || target !== path.join(packageRoot, 'tool')) return handle;
      return new Proxy(handle, { get(owner, property) {
        if (property === 'close') return async () => { fileCloses++; if (denyFile) throw fileError; await owner.close(); };
        const value = Reflect.get(owner, property, owner);
        return typeof value === 'function' ? value.bind(owner) : value;
      } });
    };
    fs.opendir = async (target, ...args) => {
      const directory = await opendir(target, ...args);
      if (target !== packageRoot) return directory;
      return { read: directory.read.bind(directory), close: async () => {
        directoryCloses++; if (denyDirectory) throw directoryError; await directory.close();
      } };
    };
    const leases = repoAccessPaths(toolingRoot, { coordinationRoot }).leases;
    fsSync.rmSync = (target, ...args) => {
      if (denyMetadata && path.dirname(target) === leases) throw Object.assign(new Error('category metadata removal denied'), { code: 'EACCES' });
      return remove(target, ...args);
    };
    const dependencies = { approvedOrigins: ['https://fixture.invalid'],
      download: async ({ url }) => ({ body: archive, sourceUrl: url }),
      extract: async (_archive, destination) => {
        packageRoot = path.join(destination, 'package'); await fs.mkdir(packageRoot, { recursive: true });
        await fs.writeFile(path.join(packageRoot, 'tool'), 'inert tool bytes');
      },
      verify: async ({ resourceId }) => { verified = true; return { ok: true, settlement: { resourceId, settled: true, pending: false } }; } };
    let failure;
    try { await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies }); } catch (error) { failure = error; }
    assert.equal(contains(failure, fileError), true);
    assert.equal(contains(failure, directoryError), true);
    assert.ok(getStorageDirectorySession(failure));
    assert.equal(isStorageTransferSession(failure.storageTransferSession), true);
    assert.equal(verified, false, 'a failed immutable file scan cannot reach the executable verifier');
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    const held = failure.managedInstallSession;
    const receipt = { resourceId: held.resourceId, settled: true, pending: false };
    denyFile = false;
    let directoryFailure;
    try { await held.releaseAfterSettlement(receipt); } catch (error) { directoryFailure = error; }
    assert.equal(contains(directoryFailure, directoryError), true);
    assert.equal(fileCloses, 2, 'actual file owner settles before its containing directory observer');
    assert.equal(directoryCloses, 2);
    assert.equal((await fs.stat(packageRoot)).isDirectory(), true, 'failed real directory close retains staging');
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    denyDirectory = false;
    let metadataFailure;
    try { await directoryFailure.managedInstallSession.releaseAfterSettlement(receipt); } catch (error) { metadataFailure = error; }
    assert.equal(metadataFailure.cacheOwnershipReleased(), false);
    await assert.rejects(fs.stat(packageRoot), { code: 'ENOENT' }, 'exact staging cleanup follows both actual descriptor closes');
    assert.equal(fileCloses, 2); assert.equal(directoryCloses, 3);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    denyMetadata = false;
    assert.equal(await metadataFailure.managedInstallSession.releaseAfterSettlement(receipt), true,
      'the latest full outer capability can settle original category metadata after its descriptor owners');
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(metadataFailure.cacheOwnershipReleased(), true);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    assert.equal(fileCloses, 2); assert.equal(directoryCloses, 3);
    fs.open = open; fs.opendir = opendir; fsSync.rmSync = remove;
    packageRoot = null;
    assert.equal((await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies })).ok, true,
      'normal complete package capture and publication remain available after exact recovery');
    assert.equal(verified, true);
  });
} finally { fs.open = open; fs.opendir = opendir; fsSync.rmSync = remove; await rmDirRecursive(temporary); }
console.log('Managed install settles exact file and directory owners before staging and category cleanup.');
