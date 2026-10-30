import assert from 'node:assert/strict';
import { errorGraphMatches } from '../../helpers/error-graph.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { installPinnedManagedTool, inspectManagedToolRemoval, removePinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual publication/removal/storage owners, inert archive/verifier.
const temporary = await makeTempDir('poc-managed-publication-frozen-');
const contains = (error, original) => {
  const pending = [error], seen = new Set();
  while (pending.length) { const current = pending.pop(); if (!current || seen.has(current)) continue;
    if (current === original) return true; seen.add(current);
    pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : [])); }
  return false;
};
try {
  const home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tools');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
    const archive = Buffer.from('inert canonical archive fixture');
    const descriptor = version => ({ schemaVersion: 1, toolId: 'fixture-publication', recipeId: 'fixture', version,
      platform: process.platform, arch: process.arch,
      archive: { url: `https://fixture.invalid/managed-${version}.zip`, type: 'zip', bytes: archive.length,
        sha256: createHash('sha256').update(archive).digest('hex') },
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] },
      root: 'package', command: 'tool', args: [], requiredFiles: ['tool'] });
    const dependencies = { approvedOrigins: ['https://fixture.invalid'],
      download: async ({ url }) => ({ body: archive, sourceUrl: url }),
      extract: async (_archive, destination) => { await fs.mkdir(path.join(destination, 'package'), { recursive: true });
        await fs.writeFile(path.join(destination, 'package', 'tool'), 'inert package fixture'); },
      verify: async ({ resourceId }) => ({ ok: true, settlement: { resourceId, settled: true, pending: false } }) };
    const exact = session => ({ resourceId: session.resourceId, settled: true, pending: false });
    const inspect = root => inspectStorageAccess(root, { coordinationRoot });
    assert.equal((await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies })).ok, true);

    const unsettled = Object.freeze(Object.assign(new Error('frozen new verifier without receipt'), { code: 'EIO' }));
    let pending;
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies,
      verify: async () => { throw unsettled; } }); } catch (error) { pending = error; }
    assert.equal(contains(pending, unsettled), true);
    assert.equal(pending.code, 'EIO');
    assert.equal(pending.cacheOwnershipReleased(), false);
    const held = pending.managedInstallSession;
    await assert.rejects(held.releaseAfterSettlement({ ...exact(held), pending: undefined }), /still pending/);
    assert.equal((await inspect(toolingRoot)).protected, true);
    assert.equal((await inspect(path.join(toolingRoot, 'installs', 'fixture-publication'))).protected, true,
      'the actual verifier pins its physical installation owner as well as the category');
    assert.equal(await held.releaseAfterSettlement(exact(held)), true);
    assert.equal(pending.cacheOwnershipReleased(), true);
    assert.equal((await inspect(toolingRoot)).protected, false);
    assert.equal((await inspect(path.join(toolingRoot, 'installs', 'fixture-publication'))).protected, false);

    let closed = false, native, nativeFailure;
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('3.0.0'), ...dependencies,
      verify: async ({ resourceId }) => {
        native = Object.freeze(Object.assign(new Error('frozen independent new native owner'), { cacheOwnershipPending: true,
          cacheOwnershipReleased() { return this === native && closed; }, settlement: { resourceId, settled: true, pending: false } }));
        throw native;
      } }); } catch (error) { nativeFailure = error; }
    assert.equal(contains(nativeFailure, native), true);
    const nativeHeld = nativeFailure.managedInstallSession;
    await assert.rejects(nativeHeld.releaseAfterSettlement(exact(nativeHeld)), error => errorGraphMatches(error, /observer remains pending/));
    assert.equal((await inspect(toolingRoot)).protected, true);
    closed = true;
    assert.equal(await nativeHeld.releaseAfterSettlement(exact(nativeHeld)), true);
    assert.equal(nativeFailure.cacheOwnershipReleased(), true);

    const originalRemove = fsSync.rmSync;
    let deny = true;
    try {
      fsSync.rmSync = (target, options) => {
        if (deny && String(target).startsWith(coordinationRoot + path.sep)) throw Object.assign(new Error('actual publication lease unlink denied'), { code: 'EACCES' });
        return originalRemove(target, options);
      };
      let metadata;
      try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('4.0.0'), ...dependencies }); }
      catch (error) { metadata = error; }
      assert.equal(metadata.cacheOwnershipReleased(), false);
      assert.equal((await inspect(toolingRoot)).protected, true);
      deny = false;
      assert.equal(await metadata.managedInstallSession.releaseAfterSettlement(exact(metadata.managedInstallSession)), true);
      assert.equal(metadata.cacheOwnershipReleased(), true, 'owned transaction metadata failure must not block its own retry');
      assert.equal((await inspect(toolingRoot)).protected, false);

      deny = true;
      let primary, combined;
      try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('5.0.0'), ...dependencies,
        verify: async ({ resourceId }) => {
          primary = Object.freeze(Object.assign(new Error('frozen settled new verifier failure'), { code: 'EIO',
            settlement: { resourceId, settled: true, pending: false } }));
          throw primary;
        } }); } catch (error) { combined = error; }
      assert.equal(contains(combined, primary), true);
      assert.equal(combined.code, 'EIO');
      assert.equal(combined.cacheOwnershipReleased(), false);
      deny = false;
      assert.equal(await combined.managedInstallSession.releaseAfterSettlement(exact(combined.managedInstallSession)), true);
      assert.equal(combined.cacheOwnershipReleased(), true);
    } finally { fsSync.rmSync = originalRemove; }

    const normal = await createManagedCommandFixture(path.join(temporary, 'normal-removal'));
    const normalPlan = await inspectManagedToolRemoval({ toolingRoot: normal.toolingRoot, toolId: normal.toolId });
    assert.equal((await removePinnedManagedTool(normalPlan)).ok, true);
    await assert.rejects(fs.stat(normal.command), { code: 'ENOENT' });

    const removal = await createManagedCommandFixture(path.join(temporary, 'failed-removal'));
    const removalPlan = await inspectManagedToolRemoval({ toolingRoot: removal.toolingRoot, toolId: removal.toolId });
    const rename = fs.rename, syncRemove = fsSync.rmSync;
    const primary = Object.freeze(Object.assign(new Error('frozen generation retirement failed'), { code: 'EIO' }));
    const rollback = Object.freeze(Object.assign(new Error('frozen selector rollback failed'), { code: 'EACCES' }));
    const generation = path.dirname(path.dirname(removal.command));
    let denyRemoval = true, failure;
    try {
      fs.rename = async (source, destination) => {
        if (source === generation) throw primary;
        if (path.basename(source).startsWith('removed-selector-') && path.basename(destination) === 'current.json') throw rollback;
        return rename(source, destination);
      };
      fsSync.rmSync = (target, options) => {
        let payload;
        try { payload = JSON.parse(fsSync.readFileSync(target, 'utf8')); } catch {}
        if (denyRemoval && payload?.scope === 'managed-tool-removal-resource') throw Object.assign(new Error('actual removal category unlink denied'), { code: 'EACCES' });
        return syncRemove(target, options);
      };
      try { await removePinnedManagedTool(removalPlan); } catch (error) { failure = error; }
      assert.equal(contains(failure, primary), true);
      assert.equal(contains(failure, rollback), true);
      assert.equal(failure.code, 'EIO');
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await inspect(removal.toolingRoot)).protected, true);
      const held = failure.managedRemovalSession;
      assert.throws(() => held.releaseAfterSettlement({ ...exact(held), resourceId: 'another-removal' }), /exact resource receipt/);
      denyRemoval = false;
      assert.equal(held.releaseAfterSettlement(exact(held)), true);
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal((await inspect(removal.toolingRoot)).protected, false);
      assert.equal(await fs.readFile(removal.command, 'utf8'), 'inert managed command fixture', 'failed retirement preserves exact generation bytes');
      assert.ok((await fs.readdir(removal.owner)).some(name => name.startsWith('removed-selector-')),
        'failed rollback retains its actual selector evidence for explicit repair');
    } finally { fs.rename = rename; fsSync.rmSync = syncRemove; }

    for (const observation of ['missing', 'throwing']) {
      const unknownRoot = path.join(temporary, `unknown-${observation}`);
      let primary, failure;
      try { await installPinnedManagedTool({ toolingRoot: unknownRoot, descriptor: descriptor('6.0.0'), ...dependencies,
        verify: async ({ resourceId }) => {
          primary = Object.freeze(Object.assign(new Error(`unknown ${observation} new native owner`), {
            cacheOwnershipPending: true, settlement: { resourceId, settled: true, pending: false },
            ...(observation === 'throwing' ? { cacheOwnershipReleased() { throw new Error('unconfirmed native close'); } } : {})
          }));
          throw primary;
        } }); } catch (error) { failure = error; }
      assert.equal(contains(failure, primary), true);
      const held = failure.managedInstallSession;
      await assert.rejects(held.releaseAfterSettlement(exact(held)), error => errorGraphMatches(error, /observer remains pending/));
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await inspect(unknownRoot)).protected, true);
      // All verifier resources here are inert. Preserve their unknown evidence
      // until final disposable-fixture cleanup without claiming native closure.
    }
  });
} finally { await rmDirRecursive(temporary); }
console.log('Managed publication/removal preserve frozen failures and exact metadata recovery.');
