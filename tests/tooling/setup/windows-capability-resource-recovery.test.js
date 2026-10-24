import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createWindowsCapabilityFixture } from '../../helpers/windows-capability-fixture.js';
import { verifyWindowsCompilerCapability, isWindowsCapabilitySession } from '../../../tools/setup/windows-capability.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';

// UNVALIDATED: actual tiny evidence/scratch/category owners, inert native calls.
const temporary = await makeTempDir('poc-windows-capability-recovery-');
const remove = fsSync.rmSync;
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
  const home = path.join(temporary, 'home'), coordinationRoot = path.join(home, 'state', 'storage-access');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
    const fixture = await createWindowsCapabilityFixture(path.join(temporary, 'evidence'));
    const inspect = root => inspectStorageAccess(root, { coordinationRoot });
    for (const value of [Object.freeze(Object.assign(new Error('frozen ordinary compile fault'), { code: 'EIO' })), 0, null]) {
      const scratchRoot = path.join(temporary, `ordinary-${String(value) === 'null' ? 'null' : typeof value}`);
      let failure;
      try { await verifyWindowsCompilerCapability(fixture.report, { scratchRoot, spawn: async () => { throw value; } }); }
      catch (error) { failure = error; }
      assert.equal(contains(failure, value), true);
      assert.equal(failure.windowsCapability.state, 'failed');
      assert.equal((await inspect(scratchRoot)).protected, false, 'ordinary settled failures release only their exact metadata');
      assert.equal(failure.windowsCapabilitySession, undefined);
    }
    for (const marker of [true, false, undefined]) {
      const scratchRoot = path.join(temporary, `native-${marker}`);
      let closed = false, deny = true;
      const native = Object.freeze(Object.assign(new Error('frozen independent compiler owner'), {
        ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
        cacheOwnershipReleased() { return this === native && closed; } }));
      let failure;
      try { await verifyWindowsCompilerCapability(fixture.report, { scratchRoot, spawn: async () => { throw native; } }); }
      catch (error) { failure = error; }
      assert.equal(contains(failure, native), true);
      assert.equal(failure.windowsCapability.state, 'teardown-pending', 'a present original observer applies even when the separate marker is false');
      assert.equal(isWindowsCapabilitySession(failure.windowsCapabilitySession), true);
      assert.equal(isWindowsCapabilitySession({ ...failure.windowsCapabilitySession }), false);
      assert.equal(Object.keys(failure).includes('windowsCapabilitySession'), false);
      assert.equal((await inspect(scratchRoot)).protected, true);
      await assert.rejects(failure.windowsCapabilitySession.releaseAfterClosure(), error => error.cacheOwnershipReleased() === false);
      closed = true;
      const leases = repoAccessPaths(scratchRoot, { coordinationRoot }).leases;
      fsSync.rmSync = (target, ...args) => {
        if (deny && path.dirname(target) === leases) throw Object.assign(new Error('actual capability lease unlink denied'), { code: 'EACCES' });
        return remove(target, ...args);
      };
      let latest;
      try { await failure.windowsCapabilitySession.releaseAfterClosure(); } catch (error) { latest = error; }
      assert.equal(latest.windowsCapabilitySession, failure.windowsCapabilitySession);
      assert.equal(latest.cacheOwnershipReleased(), false);
      assert.equal((await inspect(scratchRoot)).protected, true);
      deny = false;
      assert.deepEqual(await Promise.all([latest.windowsCapabilitySession.releaseAfterClosure(), failure.windowsCapabilitySession.releaseAfterClosure()]), [true, true]);
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal(latest.cacheOwnershipReleased(), true);
      assert.equal((await inspect(scratchRoot)).protected, false);
      fsSync.rmSync = remove;
    }
    let confirmed = false;
    const replaceable = Object.assign(new Error('replaceable compiler observation'), { cacheOwnershipPending: true,
      cacheOwnershipReleased() { return this === replaceable && confirmed; } });
    let captured;
    try { await verifyWindowsCompilerCapability(fixture.report, { scratchRoot: path.join(temporary, 'replaced-observer'),
      spawn: async () => { throw replaceable; } }); } catch (error) { captured = error; }
    replaceable.cacheOwnershipReleased = () => true;
    await assert.rejects(captured.windowsCapabilitySession.releaseAfterClosure(),
      'later property replacement cannot erase the captured original observer');
    confirmed = true;
    await captured.windowsCapabilitySession.releaseAfterClosure();
    assert.equal(captured.cacheOwnershipReleased(), true);
    for (const observation of ['missing', 'throwing']) {
      const scratchRoot = path.join(temporary, `unknown-${observation}`);
      const native = Object.freeze(Object.assign(new Error('unknown original native owner'), { cacheOwnershipPending: true,
        ...(observation === 'throwing' ? { cacheOwnershipReleased() { throw new Error('inert unknown close'); } } : {}) }));
      let failure;
      try { await verifyWindowsCompilerCapability(fixture.report, { scratchRoot, spawn: async () => { throw native; } }); }
      catch (error) { failure = error; }
      await assert.rejects(failure.windowsCapabilitySession.releaseAfterClosure());
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await inspect(scratchRoot)).protected, true);
      // Native work is inert; leave its unknown observation false until final
      // disposable-metadata removal without claiming actual child closure.
    }
    const scratchRoot = path.join(temporary, 'successful-resource-metadata-fault');
    const leases = repoAccessPaths(scratchRoot, { coordinationRoot }).leases;
    let deny = true;
    fsSync.rmSync = (target, ...args) => {
      if (deny && path.dirname(target) === leases) throw Object.assign(new Error('completed capability metadata unlink denied'), { code: 'EACCES' });
      return remove(target, ...args);
    };
    let completed;
    try { await verifyWindowsCompilerCapability(fixture.report, { scratchRoot, spawn: fixture.spawn }); } catch (error) { completed = error; }
    assert.equal(isWindowsCapabilitySession(completed.windowsCapabilitySession), true);
    assert.equal(completed.cacheOwnershipReleased(), false);
    deny = false;
    assert.equal(await completed.windowsCapabilitySession.releaseAfterClosure(), true,
      'an actual completed-resource metadata failure cannot gate its own required removal retry');
    assert.equal(completed.cacheOwnershipReleased(), true);
    fsSync.rmSync = remove;
    const receipt = await verifyWindowsCompilerCapability(fixture.report, { scratchRoot: path.join(temporary, 'ordinary-success'), spawn: fixture.spawn });
    assert.equal(receipt.state, 'compile-link-target-verified');
    assert.equal(receipt.files.length, 7);
    assert.equal(receipt.outputs.length, 2);
    assert.equal((await fs.stat(path.join(receipt.directory, 'receipt.json'))).isFile(), true);
  });
} finally { fsSync.rmSync = remove; await rmDirRecursive(temporary); }
console.log('Windows capability preserves frozen native owners and exact category metadata retry.');
