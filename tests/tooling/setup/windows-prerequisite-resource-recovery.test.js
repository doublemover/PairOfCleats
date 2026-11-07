import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createWindowsCapabilityFixture } from '../../helpers/windows-capability-fixture.js';
import { WINDOWS_PREREQUISITE_CATALOG } from '../../../tools/setup/windows-prerequisite-catalog.js';
import { createWindowsPrerequisitePlan, applyWindowsPrerequisitePlan } from '../../../tools/setup/windows-prerequisite-plan.js';
import { verifyWindowsCompilerCapability, isWindowsCapabilitySession } from '../../../tools/setup/windows-capability.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: Windows path contract, actual disposable locks/leases and inert
// inspection/vendor/compiler injections. This never runs or installs a binary.
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const current = pending.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
if (process.platform === 'win32') {
  const temporary = await makeTempDir('poc-windows-prerequisite-recovery-');
  const remove = fs.rm, syncRemove = fsSync.rmSync;
  try {
    const home = path.join(temporary, 'home'), stateRoot = path.join(temporary, 'state');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
      const request = { mode: 'install', arch: 'x64', installPath: path.join(temporary, 'BuildTools'),
        bootstrapperPath: path.join(temporary, 'inert-bootstrapper.exe'), stateRoot };
      const metadata = { path: request.bootstrapperPath, bytes: 1234, sha256: WINDOWS_PREREQUISITE_CATALOG.sha256,
        signature: { status: 'Valid', subject: 'O=Microsoft Corporation', thumbprint: 'a'.repeat(40) } };
      const catalog = { ...WINDOWS_PREREQUISITE_CATALOG, allocation: { complete: true,
        writes: [{ root: stateRoot, requiredBytes: 64, source: 'inert-fixture-only-not-production-evidence' }] } };
      const dependencies = { platform: 'win32', env: {}, catalog, inspectInstaller: async () => metadata,
        discoverTarget: async () => ({ state: 'absent', instance: null }) };
      const approved = await createWindowsPrerequisitePlan(request, dependencies);
      assert.equal(approved.blockers.length, 0, 'only the injected fixture catalog supplies inert allocation metadata');
      const input = { ...dependencies, approveSystemChanges: true, acceptInstallerTerms: true };
      const lockPath = path.join(stateRoot, 'windows-prerequisite-apply.lock');
      const primary = Object.freeze(Object.assign(new Error('frozen vendor failure'), { code: 'EIO' }));
      const unlinkError = Object.freeze(Object.assign(new Error('frozen apply-lock unlink fault'), { code: 'EACCES' }));
      let denyLock = true;
      fs.rm = async (target, options) => { if (denyLock && target === lockPath) throw unlinkError; return remove(target, options); };
      let failure;
      try { await applyWindowsPrerequisitePlan(approved, { ...input, spawn: async () => { throw primary; } }); }
      catch (error) { failure = error; }
      assert.equal(contains(failure, primary), true);
      assert.equal(contains(failure, unlinkError), true);
      assert.equal(failure.code, 'EIO');
      assert.equal(failure.prerequisiteOutcome.state, 'failed');
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await fs.stat(lockPath)).isFile(), true);
      assert.equal(Object.keys(failure).includes('prerequisiteApplySession'), false);
      denyLock = false;
      assert.deepEqual(await Promise.all([failure.prerequisiteApplySession.releaseAfterClosure(), failure.prerequisiteApplySession.releaseAfterClosure()]), [true, true]);
      assert.equal(failure.cacheOwnershipReleased(), true);
      await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
      fs.rm = remove;

      for (const marker of [true, false, undefined]) {
        let closed = false;
        const native = Object.freeze(Object.assign(new Error('frozen pending vendor owner'), {
          ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
          cacheOwnershipReleased() { return this === native && closed; } }));
        let pending;
        try { await applyWindowsPrerequisitePlan(approved, { ...input, spawn: async () => { throw native; } }); }
        catch (error) { pending = error; }
        assert.equal(contains(pending, native), true);
        assert.equal(pending.prerequisiteOutcome.state, 'teardown-pending');
        await assert.rejects(pending.prerequisiteApplySession.releaseAfterClosure());
        assert.equal((await fs.stat(lockPath)).isFile(), true);
        closed = true;
        assert.equal(await pending.prerequisiteApplySession.releaseAfterClosure(), true);
        assert.equal(pending.cacheOwnershipReleased(), true);
      }
      await assert.rejects(applyWindowsPrerequisitePlan(approved, { ...input, spawn: async () => { throw 0; } }),
        error => error.cause === 0 && error.prerequisiteOutcome.state === 'failed');

      const fixture = await createWindowsCapabilityFixture(path.join(temporary, 'capability-evidence'));
      fixture.report.toolchain.compiler.installationPath = request.installPath;
      let closed = false, denyCapability = true;
      const native = Object.freeze(Object.assign(new Error('frozen nested capability owner'), { cacheOwnershipPending: true,
        cacheOwnershipReleased() { return this === native && closed; } }));
      const capabilityRoot = path.join(stateRoot, 'capability');
      fsSync.rmSync = (target, ...args) => {
        if (denyCapability && String(target).startsWith(coordinationRoot + path.sep)) throw Object.assign(new Error('nested capability metadata unlink denied'), { code: 'EACCES' });
        return syncRemove(target, ...args);
      };
      denyLock = true;
      fs.rm = async (target, options) => { if (denyLock && target === lockPath) throw unlinkError; return remove(target, options); };
      let nested;
      try { await applyWindowsPrerequisitePlan(approved, { ...input, spawn: async () => ({ exitCode: 0 }),
        discover: async () => fixture.report,
        verifyCapability: (report, options) => verifyWindowsCompilerCapability(report, { ...options, spawn: async () => { throw native; } }) }); }
      catch (error) { nested = error; }
      assert.equal(contains(nested, native), true);
      assert.equal(isWindowsCapabilitySession(nested.windowsCapabilitySession), true);
      assert.equal((await inspectStorageAccess(capabilityRoot, { coordinationRoot })).protected, true);
      closed = true;
      let capabilityFailure;
      try { await nested.prerequisiteApplySession.releaseAfterClosure(); } catch (error) { capabilityFailure = error; }
      assert.equal(capabilityFailure.prerequisiteApplySession, nested.prerequisiteApplySession);
      assert.equal((await fs.stat(lockPath)).isFile(), true);
      assert.equal((await inspectStorageAccess(capabilityRoot, { coordinationRoot })).protected, true);
      denyCapability = false;
      let lockFailure;
      try { await capabilityFailure.prerequisiteApplySession.releaseAfterClosure(); } catch (error) { lockFailure = error; }
      assert.equal(contains(lockFailure, unlinkError), true);
      assert.equal((await inspectStorageAccess(capabilityRoot, { coordinationRoot })).protected, false,
        'the genuine capability session settles before its enclosing apply lock');
      assert.equal(lockFailure.cacheOwnershipReleased(), false);
      denyLock = false;
      assert.equal(await lockFailure.prerequisiteApplySession.releaseAfterClosure(), true,
        'the latest outer capability retries only its remaining original apply lock');
      assert.equal(nested.cacheOwnershipReleased(), true);
      assert.equal(lockFailure.cacheOwnershipReleased(), true);
      fs.rm = remove; fsSync.rmSync = syncRemove;

      const result = await applyWindowsPrerequisitePlan(approved, { ...input, spawn: async () => ({ exitCode: 3010 }) });
      assert.equal(result.state, 'reboot-required');
      assert.equal(result.readinessRecorded, false);

      let forgedCalls = 0;
      const unknown = Object.freeze(Object.assign(new Error('unknown independent vendor owner'), { cacheOwnershipPending: true,
        windowsCapabilitySession: { releaseAfterClosure: () => { forgedCalls++; return true; } } }));
      let unknownFailure;
      try { await applyWindowsPrerequisitePlan(approved, { ...input, spawn: async () => { throw unknown; } }); }
      catch (error) { unknownFailure = error; }
      await assert.rejects(unknownFailure.prerequisiteApplySession.releaseAfterClosure());
      assert.equal(forgedCalls, 0, 'matching property/method data does not establish an actual capability producer');
      assert.equal(unknownFailure.cacheOwnershipReleased(), false);
      assert.equal((await fs.stat(lockPath)).isFile(), true);
      // Unknown native work above is inert. Keep its observation false through
      // final disposable fixture cleanup; never report native closure.
    });
  } finally { fs.rm = remove; fsSync.rmSync = syncRemove; await rmDirRecursive(temporary); }
}
console.log('Windows prerequisite owner preserves native evidence and exact apply-lock recovery.');
