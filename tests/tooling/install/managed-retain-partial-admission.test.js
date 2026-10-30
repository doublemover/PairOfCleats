import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { inspectManagedInstallationSync, retainManagedToolInstallationSync } from '../../../src/shared/managed-installation-retain.js';
import { repoAccessPaths, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';

// Synthetic canonical receipt and inert ordinary files, never an installation or
// executable probe. Actual inspection, exclusion, leases and rollback owners.
const temporary = await makeTempDir('managed-retain-partial-');
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = value => hash(stableStringify(value));
const remove = fs.rmSync, open = fs.openSync;
const sessions = new Set();
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home') }, async () => {
    const toolingRoot = path.join(temporary, 'tooling'), toolId = 'fixture-retain';
    const owner = path.join(toolingRoot, 'installs', toolId), installId = 'a'.repeat(64);
    const generation = path.join(owner, 'generations', installId), command = path.join(generation, 'bin', 'tool');
    const archive = { url: 'https://fixture.invalid/archive.zip', type: 'zip', bytes: 1, sha256: 'b'.repeat(64) };
    const descriptor = { schemaVersion: 1, toolId, recipeId: 'fixture-only', version: '1',
      platform: process.platform, arch: process.arch, archive, root: 'package', command: 'bin/tool', args: [], requiredFiles: ['bin/tool'] };
    const descriptorId = identity(descriptor), selector = { schemaVersion: 1, toolId, descriptorId, installId };
    const bytes = 'inert managed consumer bytes';
    const files = [{ path: 'bin/tool', bytes: Buffer.byteLength(bytes), sha256: hash(bytes) }];
    const receipt = { schemaVersion: 1, application: 'pairofcleats', toolId, descriptorId, installId,
      descriptor, root: generation, source: archive, files, filesIdentity: identity(files), selectorIdentity: identity(selector),
      verification: { ok: true, settlement: { resourceId: 'fixture-only-verifier', settled: true, pending: false } },
      installedAt: '2026-10-22T00:00:00.000Z', ownership: 'managed', leaseProtocol: 'storage-asset-access-v1' };
    fs.mkdirSync(path.dirname(command), { recursive: true }); fs.writeFileSync(command, bytes);
    fs.mkdirSync(path.join(owner, 'receipts')); fs.writeFileSync(path.join(owner, 'receipts', installId + '.json'), JSON.stringify(receipt));
    const selectorPath = path.join(owner, 'current.json'); fs.writeFileSync(selectorPath, JSON.stringify(selector));
    const options = { toolingRoot, toolId };
    assert.equal(inspectManagedInstallationSync(options).ok, true);
    const coordinationRoot = path.join(temporary, 'home', 'state', 'storage-access');
    const categoryLeases = repoAccessPaths(toolingRoot, { coordinationRoot }).leases;
    const ownerLeases = repoAccessPaths(owner, { coordinationRoot }).leases;
    let denied = new Set();
    fs.rmSync = (target, ...args) => {
      if (denied.has(path.dirname(String(target))) && String(target).endsWith('.json')) {
        throw Object.assign(new Error('controlled actual lease unlink failure'), { code: 'EACCES' });
      }
      return remove(target, ...args);
    };
    for (const both of [false, true]) {
      let failure;
      denied = new Set(both ? [categoryLeases, ownerLeases] : [categoryLeases]);
      await withExclusiveRepoCacheCleanup(owner, async () => {
        assert.throws(() => retainManagedToolInstallationSync(options), error => {
          failure = error; return error.code === 'ERR_REPO_CACHE_CLEANUP_BUSY' && error.cacheOwnershipPending === true;
        });
        sessions.add(failure.storageSession);
        assert.equal(failure.storageSession.leaseIds.length, both ? 2 : 1,
          'a final refused lease is adopted only when its actual removal failed');
        assert.equal(failure.cacheOwnershipReleased(), false);
      }, { coordinationRoot });
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      denied.clear();
      const session = failure.storageSession;
      assert.equal(session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }), true);
      assert.equal(failure.cacheOwnershipReleased(), true); sessions.delete(session);
    }

    const held = retainManagedToolInstallationSync(options); sessions.add(held.storageSession);
    assert.equal(held.command, command); assert.equal(held.storageSession.leaseIds.length, 2);
    denied.add(categoryLeases);
    let failedRelease;
    assert.throws(() => held.release(), error => { failedRelease = error; return error.cacheOwnershipPending === true; });
    assert.equal(failedRelease.storageSession, held.storageSession);
    assert.equal(isStorageSessionReleaseFailure(failedRelease, held.storageSession), true);
    assert.equal(isStorageSessionReleaseFailure({ ...failedRelease, storageSession: held.storageSession }, held.storageSession), false);
    assert.equal(isStorageSessionReleaseFailure(JSON.parse(JSON.stringify(failedRelease)), held.storageSession), false);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    assert.equal((await inspectStorageAccess(owner, { coordinationRoot })).protected, false,
      'one failed lease must not prevent an independent later release attempt');
    denied.clear(); assert.equal(held.release(), true); assert.equal(held.release(), true);
    assert.equal(failedRelease.cacheOwnershipReleased(), true); sessions.delete(held.storageSession);

    let selectorReads = 0;
    fs.openSync = (target, ...args) => {
      if (target === selectorPath && ++selectorReads === 2) {
        throw Object.freeze(Object.assign(new Error('controlled post-admission inspection failure'), { code: 'EIO' }));
      }
      return open(target, ...args);
    };
    denied.add(categoryLeases);
    let changed;
    assert.throws(() => retainManagedToolInstallationSync(options), error => {
      changed = error; return /selection changed/.test(error.message) && error.cacheOwnershipPending === true;
    });
    sessions.add(changed.storageSession);
    assert.equal(changed.storageSettlementError.cacheOwnershipPending, true);
    assert.equal(changed.cacheOwnershipReleased(), false);
    fs.openSync = open; denied.clear();
    const session = changed.storageSession;
    assert.equal(session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }), true);
    assert.equal(changed.cacheOwnershipReleased(), true); sessions.delete(session);
    assert.equal(inspectManagedInstallationSync(options).ok, true);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);

    // A self-consistent replacement receipt with the same install label cannot
    // change the descriptor identity selected before admission.
    const nextDescriptor = { ...descriptor, version: '2' }, nextDescriptorId = identity(nextDescriptor);
    const nextSelector = { ...selector, descriptorId: nextDescriptorId };
    const nextReceipt = { ...receipt, descriptor: nextDescriptor, descriptorId: nextDescriptorId,
      selectorIdentity: identity(nextSelector) };
    selectorReads = 0;
    fs.openSync = (target, ...args) => {
      if (target === selectorPath && ++selectorReads === 2) {
        fs.writeFileSync(path.join(owner, 'receipts', installId + '.json'), JSON.stringify(nextReceipt));
        fs.writeFileSync(selectorPath, JSON.stringify(nextSelector));
      }
      return open(target, ...args);
    };
    assert.throws(() => retainManagedToolInstallationSync(options), /selection changed/,
      'the original descriptor remains pinned even when another valid receipt reuses its install label');
    fs.openSync = open;
    assert.equal(inspectManagedInstallationSync(options).receipt.descriptorId, nextDescriptorId,
      'the independent replacement is well formed, so malformed-byte refusal cannot explain this control');
    fs.writeFileSync(path.join(owner, 'receipts', installId + '.json'), JSON.stringify(receipt));
    fs.writeFileSync(selectorPath, JSON.stringify(selector));
    const recovered = retainManagedToolInstallationSync(options); sessions.add(recovered.storageSession);
    assert.equal(recovered.release(), true); sessions.delete(recovered.storageSession);
  });
} finally {
  fs.rmSync = remove; fs.openSync = open;
  for (const session of sessions) session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  await rmDirRecursive(temporary);
}
console.log('Managed retained generation admission, partial rollback and exact multi-root recovery controls passed');
